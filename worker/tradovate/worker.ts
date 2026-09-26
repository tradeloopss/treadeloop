// TradeLoop Tradovate sync worker — runs on the sync VPS next to the MT5
// worker (see README.md in this folder and docs/integrations/tradovate.md).
//
//   Tradovate REST + WebSocket → this worker → Postgres (provider_* tables)
//                                            → POST /api/cron/tradovate-sync → journal trades
//
// Every tick (2 s):
//   • claims connections that are due (initial sync, schedule, "Sync now",
//     reconnect) with SKIP LOCKED leases, and runs the idempotent REST sync
//     (which is also the reconciliation) — lib/tradovate/sync.ts
//   • keeps one user-data WebSocket per connected login and environment
//     (lib/tradovate/realtime.ts: heartbeats, one syncrequest per socket,
//     reconnect with backoff) and stores each fill/order/position/balance
//     event as it arrives
//   • after a socket reconnects, makes the connection due at once — events
//     missed while it was down are recovered by that reconciliation
//   • renews access tokens before they expire (renewaccesstoken → refresh)
//   • asks the app to turn new executions into trades
// No tokens or secrets are ever logged (lib/tradovate/log.ts).
//
// Build: esbuild worker/tradovate/worker.ts --bundle --platform=node --target=node22 --format=cjs --outfile=worker.cjs --external:pg-native

import os from "node:os"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import WebSocket from "ws"
import { and, eq, ne, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { providerAccounts, tradingConnections } from "@/lib/db/schema"
import { SYNC_ENTITY_TYPES, tradovateConfig } from "@/lib/tradovate/config"
import { tlog } from "@/lib/tradovate/log"
import { TradovateSocket, type SocketLike } from "@/lib/tradovate/realtime"
import type { RealtimeEvent, RealtimeStatus } from "@/lib/providers/types"
import {
  defaultSyncDeps,
  endpointsFor,
  ensureTokens,
  ingestRealtimeEvent,
  ingestSyncSnapshot,
  markTradesDirty,
  newRealtimeCaches,
  runTradovateSync,
  type RealtimeCaches,
  type TradingConnection,
} from "@/lib/tradovate/sync"

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (value == null || value === "") throw new Error(`${name} is not set`)
  return value
}

const CRON_SECRET = env("CRON_SECRET")
const APP_URL = env("APP_URL", "https://www.tradeloop.pro")
const STATUS_FILE = env("TRADOVATE_STATUS_FILE", "/var/lib/tradeloop/tradovate-status.json")
const CONCURRENCY = Math.max(1, Number(process.env.TRADOVATE_SYNC_CONCURRENCY ?? "3"))
const LEASE_MINUTES = 5
const TICK_MS = 2_000
const EVENT_WRITE_GAP_MS = 5_000
const WORKER_ID = `${os.hostname()}:${process.pid}`

const config = tradovateConfig()
const deps = defaultSyncDeps(config)

interface LiveConnection {
  id: number
  sockets: Map<string, TradovateSocket> // environment → socket
  status: Map<string, RealtimeStatus>
  caches: RealtimeCaches
  token: string
  lastEventWrite: number
  realtimeStatus: string
}

const live = new Map<number, LiveConnection>()
const syncing = new Set<number>() // connection ids with a REST sync in flight
let running = 0
let normalizePending = true // at start: anything left dirty by a previous run
let stopping = false
let ticks = 0

// ---------------------------------------------------------------- REST sync

async function claimDue(limit: number): Promise<number[]> {
  const claimed = await db.execute<{ id: number }>(sql`
    update trading_connections
       set "leaseUntil" = now() + make_interval(mins => ${LEASE_MINUTES})
     where id in (
       select id from trading_connections
        where provider = 'tradovate'
          and environment <> 'mock'
          and status in ('pending', 'connected')
          and "nextSyncAt" <= now()
          and ("leaseUntil" is null or "leaseUntil" < now())
        order by (status = 'pending') desc, "nextSyncAt" asc
        limit ${limit}
        for update skip locked)
    returning id`)
  return claimed.rows.map((r) => r.id)
}

async function runSync(id: number) {
  running++
  syncing.add(id)
  try {
    const { tradesDirty } = await runTradovateSync(id, deps, "auto")
    if (tradesDirty) normalizePending = true
  } catch {
    // recorded on the connection and in sync_runs by runTradovateSync
  } finally {
    syncing.delete(id)
    running--
  }
}

// Asks the app to turn new executions into trades (batched).
async function flushNormalize() {
  if (!normalizePending) return
  normalizePending = false
  try {
    const res = await fetch(`${APP_URL}/api/cron/tradovate-sync`, { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` }, signal: AbortSignal.timeout(300_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (err) {
    normalizePending = true // try again next tick
    tlog("normalize_call_failed", { message: err instanceof Error ? err.message : String(err) }, "warn")
  }
}

// ----------------------------------------------------------------- realtime

async function connectionRow(id: number): Promise<TradingConnection | null> {
  const [row] = await db.select().from(tradingConnections).where(eq(tradingConnections.id, id))
  return row ?? null
}

function aggregate(statuses: Map<string, RealtimeStatus>): string {
  const all = [...statuses.values()]
  if (all.length === 0) return "offline"
  if (all.every((s) => s === "live")) return "live"
  if (all.some((s) => s === "degraded" || s === "closed")) return "degraded"
  return "connecting"
}

async function onStatus(lc: LiveConnection, environment: string, status: RealtimeStatus, detail?: string) {
  const previous = lc.status.get(environment)
  lc.status.set(environment, status)
  tlog("ws_status", { connectionId: lc.id, environment, status, detail: detail ?? null })
  const next = aggregate(lc.status)
  const reconnected = status === "live" && previous === "degraded"
  if (next !== lc.realtimeStatus || reconnected) {
    lc.realtimeStatus = next
    await db
      .update(tradingConnections)
      // After a reconnect, reconcile right away: anything sent while the
      // socket was down is picked up by the REST pass.
      .set({ realtimeStatus: next, ...(reconnected ? { nextSyncAt: new Date() } : {}), updatedAt: new Date() })
      .where(eq(tradingConnections.id, lc.id))
      .catch(() => {})
  }
}

async function onEvent(lc: LiveConnection, event: RealtimeEvent) {
  try {
    const row = await connectionRow(lc.id)
    if (!row || row.status !== "connected") return
    const endpoint = endpointsFor(row, config).find((e) => e.environment === event.environment)
    if (!endpoint) return
    const api = deps.apiFor(row, endpoint, () => lc.token)
    const { tradesDirty } = await ingestRealtimeEvent(row, event, api, deps, lc.caches)
    if (tradesDirty) {
      await markTradesDirty(lc.id)
      normalizePending = true
    }
    if (Date.now() - lc.lastEventWrite > EVENT_WRITE_GAP_MS) {
      lc.lastEventWrite = Date.now()
      await db.update(tradingConnections).set({ lastRealtimeEventAt: new Date() }).where(eq(tradingConnections.id, lc.id))
    }
  } catch (err) {
    tlog("event_failed", { connectionId: lc.id, environment: event.environment, entityType: event.entityType, message: err instanceof Error ? err.message : String(err) }, "warn")
  }
}

async function onSnapshot(lc: LiveConnection, environment: string, entities: Record<string, unknown[]>) {
  try {
    const row = await connectionRow(lc.id)
    if (!row) return
    const endpoint = endpointsFor(row, config).find((e) => e.environment === environment)
    if (!endpoint) return
    const { tradesDirty } = await ingestSyncSnapshot(row, environment, entities, deps.apiFor(row, endpoint, () => lc.token), deps, lc.caches)
    if (tradesDirty) {
      await markTradesDirty(lc.id)
      normalizePending = true
    }
  } catch (err) {
    tlog("snapshot_failed", { connectionId: lc.id, environment, message: err instanceof Error ? err.message : String(err) }, "warn")
  }
}

// The environments (demo/live) this login has accounts in — one socket each.
async function accountEnvironments(id: number): Promise<Set<string>> {
  const rows = await db.selectDistinct({ environment: providerAccounts.environment }).from(providerAccounts).where(eq(providerAccounts.connectionId, id))
  return new Set(rows.map((r) => r.environment))
}

async function startRealtime(row: TradingConnection) {
  let tokens
  try {
    tokens = await ensureTokens(row, deps)
  } catch {
    return // reauth/rate limit — recorded by ensureTokens / next sync
  }
  const envs = await accountEnvironments(row.id)
  const lc: LiveConnection = { id: row.id, sockets: new Map(), status: new Map(), caches: newRealtimeCaches(), token: tokens.accessToken, lastEventWrite: 0, realtimeStatus: row.realtimeStatus }
  live.set(row.id, lc)
  for (const endpoint of endpointsFor(row, config).filter((e) => envs.has(e.environment))) {
    const socket = new TradovateSocket({
      environment: endpoint.environment,
      url: endpoint.wsUrl,
      token: () => lc.token,
      userId: row.providerUserId,
      entityTypes: SYNC_ENTITY_TYPES,
      createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
      handlers: {
        onEvent: (event) => onEvent(lc, event),
        onSnapshot: (environment, entities) => onSnapshot(lc, environment, entities),
        onStatus: (status, detail) => void onStatus(lc, endpoint.environment, status, detail),
      },
      log: (event, fields) => tlog(event, { connectionId: row.id, ...fields }),
    })
    lc.sockets.set(endpoint.environment, socket)
    socket.start()
  }
  tlog("realtime_started", { connectionId: row.id, environments: [...lc.sockets.keys()] })
}

async function stopRealtime(id: number) {
  const lc = live.get(id)
  if (!lc) return
  live.delete(id)
  await Promise.all([...lc.sockets.values()].map((s) => s.close()))
  await db.update(tradingConnections).set({ realtimeStatus: "offline" }).where(eq(tradingConnections.id, id)).catch(() => {})
  tlog("realtime_stopped", { connectionId: id })
}

// Sockets for every connected login; none for anything else. Tokens are
// renewed here (about once a minute) so sockets reconnect with a valid one.
async function reconcileSockets(renewTokens: boolean) {
  const rows = await db
    .select()
    .from(tradingConnections)
    .where(and(eq(tradingConnections.provider, "tradovate"), ne(tradingConnections.environment, "mock"), eq(tradingConnections.status, "connected")))
  const wanted = new Set(rows.map((r) => r.id))
  for (const id of [...live.keys()]) if (!wanted.has(id)) await stopRealtime(id)
  for (const row of rows) {
    const lc = live.get(row.id)
    if (!lc) {
      await startRealtime(row)
    } else if (renewTokens && !syncing.has(row.id)) {
      // (a sync in flight renews the token itself — don't race it)
      try {
        lc.token = (await ensureTokens(row, deps)).accessToken
      } catch {
        await stopRealtime(row.id) // reauth needed — the connection says so
        continue
      }
      // An account in a new environment (e.g. a first live account) needs its own socket.
      const envs = await accountEnvironments(row.id)
      if ([...envs].some((e) => !lc.sockets.has(e))) {
        await stopRealtime(row.id)
        await startRealtime(row)
      }
    }
  }
}

// ------------------------------------------------------------------- loop

function writeStatus() {
  try {
    mkdirSync(dirname(STATUS_FILE), { recursive: true })
    writeFileSync(
      STATUS_FILE,
      JSON.stringify({
        worker: WORKER_ID,
        at: new Date().toISOString(),
        mode: config.mode,
        running,
        connections: [...live.values()].map((lc) => ({ id: lc.id, realtime: lc.realtimeStatus, sockets: Object.fromEntries(lc.status) })),
      }),
    )
  } catch {
    // best-effort
  }
}

async function tick() {
  ticks++
  const free = CONCURRENCY - running
  if (free > 0) for (const id of await claimDue(free)) void runSync(id)
  if (ticks % 5 === 1) await reconcileSockets(ticks % 30 === 1)
  if (ticks % 150 === 0) normalizePending = true // every ~5 min, in case a call was lost
  await flushNormalize()
  if (ticks % 5 === 0) writeStatus()
}

async function main() {
  tlog("worker_starting", { worker: WORKER_ID, mode: config.mode, environments: config.endpoints.map((e) => e.environment), concurrency: CONCURRENCY })
  if (config.mode === "off" || config.mode === "mock") tlog("worker_idle", { reason: `TRADOVATE_MODE=${config.mode} — no real connections to serve` })
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => (stopping = true))
  while (!stopping) {
    try {
      await tick()
    } catch (err) {
      tlog("tick_failed", { message: (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, 300) }, "error")
    }
    await new Promise((r) => setTimeout(r, TICK_MS))
  }
  // Graceful shutdown: close sockets, let in-flight syncs finish (their
  // leases would expire anyway), hand new executions to the app.
  await Promise.all([...live.keys()].map((id) => stopRealtime(id)))
  const deadline = Date.now() + 60_000
  while (running > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500))
  await flushNormalize()
  tlog("worker_stopped", { worker: WORKER_ID })
  process.exit(0)
}

void main()
