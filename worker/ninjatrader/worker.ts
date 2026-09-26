// TradeLoop NinjaTrader worker — runs on the sync VPS beside NinjaTrader 8.
//
//   Tradovate  ── NinjaTrader 8 (this VPS) ── TradeLoop add-on (relay) ──> POST /api/ninjatrader/relay
//        │                    ▲
//        │ login              │ this worker: hands each user's stored Tradovate
//        └────────────────────┘ login to the NinjaTrader-side provisioner, keeps
//                                the connection list in step, tracks status.
//
// The design mirrors the MT5 worker: it leases due connections
// (ninjatrader_connections, SKIP LOCKED), decrypts each login only in memory,
// and serves it to a local provisioner over 127.0.0.1 with a bearer token —
// decrypted passwords never touch disk. The provisioner (a Windows-side helper
// or an operator) adds/removes the NinjaTrader connections named "tl-<id>";
// the add-on then relays those logins' fills, which flips a login to
// "connected". A login the provisioner reports as rejected becomes "reauth".
//
// Build: esbuild worker/ninjatrader/worker.ts --bundle --platform=node --target=node22 --format=cjs --outfile=worker.cjs --external:pg-native

import os from "node:os"
import http from "node:http"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { and, eq, inArray, ne, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { ninjatraderConnections } from "@/lib/db/schema"
import { decrypt } from "@/lib/crypto"
import { addonSource } from "@/lib/ninjatrader/addon-source"
import { tlog } from "@/lib/tradovate/log"

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (value == null || value === "") throw new Error(`${name} is not set`)
  return value
}

const PROVISION_TOKEN = env("NINJATRADER_PROVISION_TOKEN") // the local provisioner's bearer
const RELAY_SECRET = env("NINJATRADER_RELAY_SECRET") // written into the add-on
const APP_URL = env("APP_URL", "https://www.tradeloop.pro")
const PROVISION_PORT = Number(process.env.NINJATRADER_PROVISION_PORT ?? "9210")
const STATUS_FILE = env("NINJATRADER_STATUS_FILE", "/var/lib/tradeloop/ninjatrader-status.json")
const ADDON_FILE = process.env.NINJATRADER_ADDON_FILE ?? "/var/lib/tradeloop/TradeLoopRelay.cs"
const TICK_MS = 5_000
const LEASE_MINUTES = 5
// A login the provisioner has been given but that has never relayed is retried
// for a while, then flagged so the user knows to check it.
const CONNECT_GRACE_MS = 10 * 60 * 1000
const WORKER_ID = `${os.hostname()}:${process.pid}`

let stopping = false
let ticks = 0

type Row = typeof ninjatraderConnections.$inferSelect

// ---------------------------------------------------------------- leasing

// The logins the VPS should currently hold: everything not disconnected.
async function activeConnections(): Promise<Row[]> {
  return db.select().from(ninjatraderConnections).where(ne(ninjatraderConnections.status, "disconnected"))
}

// Claims due logins (new first) so two workers never provision the same one.
async function claimDue(limit: number): Promise<number[]> {
  const claimed = await db.execute<{ id: number }>(sql`
    update ninjatrader_connections
       set "leaseUntil" = now() + make_interval(mins => ${LEASE_MINUTES})
     where id in (
       select id from ninjatrader_connections
        where status in ('pending', 'provisioning', 'connected')
          and "nextSyncAt" <= now()
          and ("leaseUntil" is null or "leaseUntil" < now())
        order by (status = 'pending') desc, "nextSyncAt" asc
        limit ${limit}
        for update skip locked)
    returning id`)
  return claimed.rows.map((r) => r.id)
}

// ------------------------------------------------- local provisioner API

// A tiny 127.0.0.1-only HTTP server the NinjaTrader-side provisioner calls.
//   GET  /provision  -> the logins to ensure in NinjaTrader, passwords included
//                       (decrypted here, in memory only)
//   POST /report     -> { id, status: "connected"|"reauth"|"error", message? }
// Bearer NINJATRADER_PROVISION_TOKEN on both. Never exposed off localhost.
function startProvisionServer() {
  const server = http.createServer(async (req, res) => {
    const authorized = req.headers.authorization === `Bearer ${PROVISION_TOKEN}`
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" })
      res.end(JSON.stringify(body))
    }
    if (!authorized) return send(401, { error: "unauthorized" })
    try {
      if (req.method === "GET" && req.url?.startsWith("/provision")) {
        const rows = await activeConnections()
        return send(200, {
          logins: rows.map((r) => ({
            id: r.id,
            connectionName: r.ntConnectionName,
            connectionKind: r.connectionKind,
            username: r.username,
            password: r.passwordEnc ? safeDecrypt(r.passwordEnc) : "",
            status: r.status,
          })),
        })
      }
      if (req.method === "POST" && req.url?.startsWith("/report")) {
        const body = await readJson(req)
        await handleReport(body)
        return send(200, { ok: true })
      }
      return send(404, { error: "not found" })
    } catch (err) {
      tlog("provision_api_error", { message: err instanceof Error ? err.message : String(err) }, "error")
      return send(500, { error: "internal" })
    }
  })
  server.listen(PROVISION_PORT, "127.0.0.1", () => tlog("provision_api_listening", { port: PROVISION_PORT }))
  return server
}

function safeDecrypt(enc: string): string {
  try {
    return decrypt(enc)
  } catch {
    return ""
  }
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = ""
    req.on("data", (c) => {
      raw += c
      if (raw.length > 100_000) reject(new Error("body too large"))
    })
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"))
      } catch {
        reject(new Error("bad json"))
      }
    })
    req.on("error", reject)
  })
}

async function handleReport(body: Record<string, unknown>) {
  const id = Number(body.id)
  const status = String(body.status ?? "")
  if (!Number.isInteger(id)) return
  if (status === "connected") {
    await db
      .update(ninjatraderConnections)
      .set({ status: "connected", statusMessage: null, errorCount: 0, updatedAt: new Date() })
      .where(and(eq(ninjatraderConnections.id, id), ne(ninjatraderConnections.status, "disconnected")))
  } else if (status === "reauth" || status === "error") {
    const message = typeof body.message === "string" ? body.message.slice(0, 300) : "Tradovate rejected this login."
    await db
      .update(ninjatraderConnections)
      .set({ status: "reauth", statusMessage: message, nextSyncAt: null, updatedAt: new Date() })
      .where(and(eq(ninjatraderConnections.id, id), ne(ninjatraderConnections.status, "disconnected")))
    tlog("login_rejected", { id }, "warn")
  }
}

// --------------------------------------------------------- status upkeep

// Moves leased logins along: pending → provisioning (handed to the
// provisioner), and marks a login that never came online within the grace
// window so the user can re-enter it. A login the relay has flipped to
// "connected" just gets its next check scheduled.
async function reconcile(ids: number[]) {
  if (ids.length === 0) return
  const rows = await db.select().from(ninjatraderConnections).where(inArray(ninjatraderConnections.id, ids))
  const now = Date.now()
  for (const r of rows) {
    if (r.status === "disconnected") continue
    if (r.status === "pending") {
      await setRow(r.id, { status: "provisioning", nextSyncAt: soon(60_000) })
    } else if (r.status === "provisioning") {
      const waited = now - r.createdAt.getTime()
      if (r.lastSeenAt) {
        await setRow(r.id, { status: "connected", statusMessage: null, nextSyncAt: soon(120_000) })
      } else if (waited > CONNECT_GRACE_MS) {
        await setRow(r.id, {
          status: "error",
          statusMessage: "We couldn't connect this login on our server yet. Check the username and password, or reconnect.",
          nextSyncAt: soon(300_000),
        })
      } else {
        await setRow(r.id, { nextSyncAt: soon(60_000) })
      }
    } else {
      // connected: keep polling gently; the relay keeps lastSeenAt fresh.
      await setRow(r.id, { nextSyncAt: soon(120_000) })
    }
  }
}

const soon = (ms: number) => new Date(Date.now() + ms + Math.floor(Math.random() * 5_000))

async function setRow(id: number, values: Partial<Row>) {
  await db
    .update(ninjatraderConnections)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(ninjatraderConnections.id, id))
}

// ------------------------------------------------------------------ loop

function writeAddonFile() {
  try {
    mkdirSync(dirname(ADDON_FILE), { recursive: true })
    // The relay build of the add-on: same code, keyed with the relay secret,
    // posting to /api/ninjatrader/relay. Load it once into NinjaTrader.
    writeFileSync(ADDON_FILE, "﻿" + addonSource({ key: RELAY_SECRET, syncUrl: `${APP_URL.replace(/\/+$/, "")}/api/ninjatrader/relay` }))
  } catch (err) {
    tlog("addon_write_failed", { message: err instanceof Error ? err.message : String(err) }, "warn")
  }
}

async function writeStatus() {
  try {
    const rows = await activeConnections()
    mkdirSync(dirname(STATUS_FILE), { recursive: true })
    writeFileSync(
      STATUS_FILE,
      JSON.stringify({
        worker: WORKER_ID,
        at: new Date().toISOString(),
        logins: rows.map((r) => ({ id: r.id, name: r.ntConnectionName, kind: r.connectionKind, status: r.status, lastSeenAt: r.lastSeenAt })),
      }),
    )
  } catch {
    // best-effort
  }
}

async function tick() {
  ticks++
  await reconcile(await claimDue(25))
  if (ticks % 3 === 0) await writeStatus()
}

async function main() {
  tlog("worker_starting", { worker: WORKER_ID, provisionPort: PROVISION_PORT })
  writeAddonFile()
  const server = startProvisionServer()
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => (stopping = true))
  while (!stopping) {
    try {
      await tick()
    } catch (err) {
      tlog("tick_failed", { message: (err instanceof Error ? err.message : String(err)).slice(0, 300) }, "error")
    }
    await new Promise((r) => setTimeout(r, TICK_MS))
  }
  server.close()
  await writeStatus()
  tlog("worker_stopped", { worker: WORKER_ID })
  process.exit(0)
}

void main()