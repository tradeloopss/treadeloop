// TradeLoop MT5 sync worker — runs on the sync VPS (systemd unit
// tradeloop-mt5-worker, see worker/mt5/README.md). It's the scheduler and the
// database side of MT5 sync; the MetaTrader5 API itself only lives in the
// bridges (bridge.py, one per terminal).
//
// Every couple of seconds it claims accounts that are due (a lease, so two
// passes never grab the same one), hands each to a free terminal, stores the
// raw deals it returns, and pokes the app to turn new deals into trades.
//
// Brokers: a generic MT5 terminal only knows servers listed in its
// servers.dat, and there's no way to search for more headless. So each
// supported broker has a "pack" — its servers.dat, taken from that broker's own
// MT5 installer — and a terminal loads the right pack before serving a broker
// (bridge /reset). Terminals stick with a broker, and an account with its
// terminal, so switches are rare.
import os from "node:os"
import { execFile } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { eq, inArray, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { metatraderConnections, metatraderDeals, tradingAccounts } from "@/lib/db/schema"
import { decrypt } from "@/lib/crypto"
import { utcToServerTime, zoneFromMeasuredOffset } from "@/lib/metatrader-time"
import { recordSyncRun } from "@/lib/sync-runs"

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (value == null || value === "") throw new Error(`${name} is not set`)
  return value
}

const BRIDGE_TOKEN = env("MT5_BRIDGE_TOKEN")
const CRON_SECRET = env("CRON_SECRET")
const APP_URL = env("APP_URL", "https://www.tradeloop.pro")
const BROKERS_DIR = env("MT5_BROKERS_DIR", "/srv/mt5/brokers")
const STATUS_FILE = env("MT5_STATUS_FILE", "/var/lib/tradeloop/mt5-status.json")
const DISPLAY = env("MT5_DISPLAY", ":99")
const SYNC_INTERVAL_MS = Number(env("MT5_SYNC_INTERVAL_SEC", "60")) * 1000
const LEASE_MINUTES = 4
const TICK_MS = 2_000
const WORKER_ID = `${os.hostname()}:${process.pid}`

// ---------------------------------------------------------------------------
// Brokers

interface Broker {
  slug: string
  name: string
  prefixes: string[] // server-name prefixes, compared letters/digits only: "Exness-" ~ "exness"
}

let brokers: Broker[] = []
let brokersReadAt = 0

function loadBrokers(): Broker[] {
  if (Date.now() - brokersReadAt > 60_000) {
    try {
      brokers = JSON.parse(readFileSync(`${BROKERS_DIR}/brokers.json`, "utf8"))
    } catch (err) {
      console.error("[mt5] could not read brokers.json:", err instanceof Error ? err.message : err)
    }
    brokersReadAt = Date.now()
  }
  return brokers
}

const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

// The MT5 pack whose prefix matches the most of the server name, so
// "ICMarketsSC-MT5" picks icmarketssc over icmarkets.
function brokerFor(server: string): Broker | null {
  const s = letters(server)
  let best: { broker: Broker; length: number } | null = null
  for (const broker of loadBrokers()) {
    for (const prefix of broker.prefixes) {
      const p = letters(prefix)
      if (p && s.startsWith(p) && (!best || p.length > best.length)) best = { broker, length: p.length }
    }
  }
  return best?.broker ?? null
}

// MT4 terminals know every server we have a .srv file for (one terminal
// serves all MT4 brokers), listed in mt4-servers.json by the pack installer.
let mt4Servers = new Set<string>()
let mt4ServersReadAt = 0
function mt4ServerKnown(server: string): boolean {
  if (Date.now() - mt4ServersReadAt > 60_000) {
    try {
      mt4Servers = new Set((JSON.parse(readFileSync(`${BROKERS_DIR}/mt4-servers.json`, "utf8")) as string[]).map((n) => n.toLowerCase()))
    } catch {
      mt4Servers = new Set()
    }
    mt4ServersReadAt = Date.now()
  }
  return mt4Servers.has(server.trim().toLowerCase())
}

// The pack as the terminal (under Wine) sees it: / is Z:.
const wineServersDat = (slug: string) => `Z:${`${BROKERS_DIR}/${slug}/servers.dat`.replace(/\//g, "\\")}`

// ---------------------------------------------------------------------------
// Bridges

type Platform = "mt5" | "mt4"

interface Bridge {
  platform: Platform
  slot: string
  port: number
  busy: boolean
  broker: string | null // pack currently loaded; null = unknown, reset first
  login: string | null // account last logged in
  failures: number
  lastError: string | null
  alive: boolean // answered /health recently; a down bridge gets no work
}

function parseBridges(platform: Platform, spec: string): Bridge[] {
  return spec
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [slot, port] = entry.split(":")
      return { platform, slot, port: Number(port), busy: false, broker: null, login: null, failures: 0, lastError: null, alive: false }
    })
}

const bridges: Bridge[] = [
  ...parseBridges("mt5", env("MT5_BRIDGES", "t1:9101,t2:9102")),
  ...parseBridges("mt4", process.env.MT4_BRIDGES ?? ""),
]

class BridgeError extends Error {
  constructor(
    readonly kind: string,
    message: string,
  ) {
    super(message)
  }
}

interface SyncResponse {
  account: { login: number; company: string; name: string; currency: string; balance: number; equity: number; server: string }
  deals: Record<string, any>[]
  orders: Record<string, any>[]
  positions: Record<string, any>[]
  serverClock: number | null
  utcNow: number
}

async function callBridge<T>(bridge: Bridge, path: string, body?: unknown, timeoutMs = 240_000): Promise<T> {
  let res: Response
  try {
    res = await fetch(`http://127.0.0.1:${bridge.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "X-Bridge-Token": BRIDGE_TOKEN, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw new BridgeError("bridge", `MT5 bridge ${bridge.slot} unreachable: ${err instanceof Error ? err.message : err}`)
  }
  const json = (await res.json().catch(() => null)) as any
  if (!res.ok || !json || json.ok === false) {
    throw new BridgeError(json?.kind ?? "bridge", json?.message ?? `MT5 bridge ${bridge.slot} returned ${res.status}`)
  }
  return json as T
}

// ---------------------------------------------------------------------------
// Scheduling

type Connection = typeof metatraderConnections.$inferSelect

// Atomically leases up to `limit` due accounts of a platform: new ones first,
// then the most overdue. SKIP LOCKED keeps a second worker (or an overlapping
// pass) off them.
async function claimDue(platform: Platform, limit: number): Promise<Connection[]> {
  const claimed = await db.execute<{ id: number }>(sql`
    update metatrader_connections
       set "leaseUntil" = now() + make_interval(mins => ${LEASE_MINUTES})
     where id in (
       select id from metatrader_connections
        where platform = ${platform}
          and status in ('pending', 'connected')
          and "nextSyncAt" <= now()
          and ("leaseUntil" is null or "leaseUntil" < now())
        order by (status = 'pending') desc, "nextSyncAt" asc
        limit ${limit}
        for update skip locked)
    returning id`)
  const ids = claimed.rows.map((r) => r.id)
  if (ids.length === 0) return []
  return db.select().from(metatraderConnections).where(inArray(metatraderConnections.id, ids))
}

// Same account's terminal first, then one already holding the broker's pack.
function pickBridge(free: Bridge[], connection: Connection, broker: Broker | null): Bridge {
  if (free.length === 0) throw new Error("no free bridge")
  return (
    free.find((b) => b.login === connection.login) ??
    (broker ? free.find((b) => b.broker === broker.slug) : undefined) ??
    free.find((b) => b.broker === null) ??
    free[0]
  )
}

// ---------------------------------------------------------------------------
// One account

const MAX_BACKOFF_MS = 30 * 60_000
const PERMANENT = new Set(["auth", "server", "unsupported"])

// Server time → the incremental window: re-read the last 3 days every time
// (deals are de-duplicated by ticket), so nothing that arrives late is missed.
const OVERLAP_SECONDS = 3 * 86_400

let normalizePending = false

async function syncConnection(bridge: Bridge, connection: Connection) {
  const startedAt = Date.now()
  const firstSync = connection.lastDealTime == null && connection.status === "pending"
  try {
    const broker = bridge.platform === "mt5" ? brokerFor(connection.server) : null
    const known = bridge.platform === "mt5" ? broker != null : mt4ServerKnown(connection.server)
    if (!known) {
      console.warn(`[mt5] no ${bridge.platform} pack for server "${connection.server}" (connection ${connection.id})`)
      throw new BridgeError(
        "unsupported",
        `We don't have "${connection.server}" set up yet. Double-check the server name in MetaTrader (File → Login to Trade Account); if it's right, we've been notified and will add your broker.`,
      )
    }
    if (broker && bridge.broker !== broker.slug) {
      await callBridge(bridge, "/reset", { serversDat: wineServersDat(broker.slug) }, 60_000)
      bridge.broker = broker.slug
      bridge.login = null
    }

    const zone = connection.serverTimeZone
    const to = Math.floor(Date.now() / 1000) + 3 * 86_400
    const from = connection.lastDealTime
      ? Math.max(0, Math.floor(connection.lastDealTime.getTime() / 1000) - OVERLAP_SECONDS)
      : connection.historyFrom
        ? Math.floor(utcToServerTime(connection.historyFrom.getTime(), zone) / 1000)
        : 0

    const res = await callBridge<SyncResponse>(bridge, "/sync", {
      login: Number(connection.login),
      password: decrypt(connection.passwordEnc),
      server: connection.server,
      from,
      to,
    })
    bridge.login = connection.login
    bridge.failures = 0
    bridge.lastError = null

    // Raw deals, with the opening order's stop/target attached for R.
    const orders = new Map(res.orders.map((o) => [String(o.ticket), o]))
    const rows = res.deals.map((d) => {
      const order = d.order && d.order !== "0" ? orders.get(String(d.order)) : undefined
      const opening = d.entry === 0 || d.entry === 2
      return {
        connectionId: connection.id,
        ticket: String(d.ticket),
        orderTicket: d.order && d.order !== "0" ? String(d.order) : null,
        positionId: d.position_id && d.position_id !== "0" ? String(d.position_id) : null,
        time: new Date(Number(d.time_msc)),
        type: Number(d.type),
        entry: Number(d.entry),
        symbol: d.symbol || null,
        volume: String(d.volume ?? 0),
        price: String(d.price ?? 0),
        profit: String(d.profit ?? 0),
        commission: String(d.commission ?? 0),
        swap: String(d.swap ?? 0),
        fee: String(d.fee ?? 0),
        stopLoss: opening && order?.sl ? String(order.sl) : null,
        takeProfit: opening && order?.tp ? String(order.tp) : null,
        raw: d,
      }
    })
    let added = 0
    for (let i = 0; i < rows.length; i += 500) {
      const inserted = await db
        .insert(metatraderDeals)
        .values(rows.slice(i, i + 500))
        .onConflictDoNothing({ target: [metatraderDeals.connectionId, metatraderDeals.ticket] })
        .returning({ id: metatraderDeals.id })
      added += inserted.length
    }

    // A stop/target set after entry lives on the open position, not on the
    // order that opened it — record the first one seen, so R can be worked
    // out once the trade closes.
    for (const p of res.positions) {
      if (!p.sl && !p.tp) continue
      await db.execute(sql`
        update metatrader_deals
           set "stopLoss" = coalesce("stopLoss", ${p.sl ? String(p.sl) : null}),
               "takeProfit" = coalesce("takeProfit", ${p.tp ? String(p.tp) : null})
         where "connectionId" = ${connection.id} and "positionId" = ${String(p.identifier)} and entry in (0, 2)
           and ("stopLoss" is null or "takeProfit" is null)`)
    }

    // The broker's clock vs ours: a fresh tick (within 2 minutes of a
    // half-hour offset) tells us the server's time zone.
    let measuredZone: string | null = null
    if (res.serverClock) {
      const drift = res.serverClock - res.utcNow
      const offset = Math.round(drift / 1800) * 1800
      if (Math.abs(drift - offset) <= 120) measuredZone = zoneFromMeasuredOffset(offset, Date.now())
    }
    const zoneChanged = measuredZone != null && measuredZone !== zone

    const newest = rows.reduce((max, r) => (r.time > max ? r.time : max), connection.lastDealTime ?? new Date(0))
    const nextSyncAt = new Date(Date.now() + SYNC_INTERVAL_MS + Math.floor(Math.random() * 5_000))
    const changed = added > 0 || zoneChanged || firstSync
    await db
      .update(metatraderConnections)
      .set({
        status: "connected",
        statusMessage: null,
        brokerName: res.account.company || null,
        holderName: res.account.name || null,
        currency: res.account.currency || null,
        balance: String(res.account.balance),
        equity: String(res.account.equity),
        openPositions: res.positions.length,
        ...(measuredZone ? { serverTimeZone: measuredZone } : {}),
        // A different time zone re-dates every trade: rebuild them all.
        ...(zoneChanged ? { normalizedAt: null } : {}),
        ...(changed ? { dealsChangedAt: sql`now()` } : {}),
        lastDealTime: newest.getTime() > 0 ? newest : null,
        lastSyncedAt: new Date(),
        lastSyncStatus: "ok",
        lastSyncError: null,
        lastSyncCount: added,
        errorCount: 0,
        nextSyncAt,
        leaseUntil: null,
      })
      .where(eq(metatraderConnections.id, connection.id))
    if (connection.accountId != null) {
      await db
        .update(tradingAccounts)
        .set({ currentBalance: String(res.account.balance), balanceUpdatedAt: new Date() })
        .where(eq(tradingAccounts.id, connection.accountId))
    }
    if (changed) normalizePending = true
    await recordSyncRun({ broker: "metatrader", connectionId: connection.id, userId: connection.userId, trigger: firstSync ? "connect" : "auto", startedAt, imported: added })
    if (added > 0 || firstSync) console.log(`[mt5] connection ${connection.id} (${connection.server}) on ${bridge.slot}: +${added} deals`)
  } catch (err) {
    const kind = err instanceof BridgeError ? err.kind : "internal"
    const message = err instanceof Error ? err.message : String(err)
    const permanent = PERMANENT.has(kind)
    const errorCount = connection.errorCount + 1
    // A new account that keeps failing for other reasons is reported rather
    // than retried forever in "connecting".
    const giveUp = permanent || (connection.status === "pending" && errorCount >= 5)
    const backoff = Math.min(SYNC_INTERVAL_MS * 2 ** (errorCount - 1), MAX_BACKOFF_MS)
    if (!permanent) {
      bridge.failures++
      bridge.lastError = message
      // A terminal that fails twice in a row gets restarted on its next job.
      if (bridge.failures >= 2) bridge.broker = null
    }
    await db
      .update(metatraderConnections)
      .set({
        ...(giveUp
          ? {
              status: "error",
              statusMessage: permanent ? message : "Couldn't reach MetaTrader right now — please try connecting again in a few minutes.",
              nextSyncAt: null,
            }
          : { nextSyncAt: new Date(Date.now() + backoff) }),
        errorCount,
        lastSyncStatus: "error",
        lastSyncError: message.slice(0, 500),
        leaseUntil: null,
      })
      .where(eq(metatraderConnections.id, connection.id))
    await recordSyncRun({ broker: "metatrader", connectionId: connection.id, userId: connection.userId, trigger: firstSync ? "connect" : "auto", startedAt, error: err })
    console.warn(`[mt5] connection ${connection.id} (${connection.server}) on ${bridge.slot} failed [${kind}]${giveUp ? " — giving up" : ""}: ${message}`)
  }
}

// Asks the app to turn new deals into trades. Batched: one call covers every
// account that changed since the last one.
async function flushNormalize() {
  if (!normalizePending) return
  normalizePending = false
  try {
    const res = await fetch(`${APP_URL}/api/cron/metatrader-sync`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      signal: AbortSignal.timeout(300_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (err) {
    // The app's minute cron retries due accounts on its own.
    console.warn("[mt5] normalize call failed:", err instanceof Error ? err.message : err)
  }
}

// ---------------------------------------------------------------------------
// Terminal housekeeping

// MT5 pops windows no one can see — the update notice after it updates
// itself, the first-run account wizard, crash reports — and some block the
// Python API until closed. Anything that isn't a terminal's main window
// ("<login> - <server>…" or "MetaTrader 5 - …") gets closed.
function closeStrayWindows() {
  execFile("wmctrl", ["-l"], { env: { ...process.env, DISPLAY } }, (err, stdout) => {
    if (err) return
    for (const line of stdout.split("\n")) {
      const match = /^(0x[0-9a-f]+)\s+\S+\s+\S+\s?(.*)$/i.exec(line.trim())
      if (!match) continue
      const [, id, title] = match
      if (/^(\d+ - |MetaTrader 5)/.test(title)) continue
      execFile("wmctrl", ["-i", "-c", id], { env: { ...process.env, DISPLAY } }, () => {})
    }
  })
}

function writeStatus(extra: Record<string, unknown> = {}) {
  try {
    writeFileSync(
      STATUS_FILE,
      JSON.stringify({
        worker: WORKER_ID,
        at: new Date().toISOString(),
        bridges: bridges.map((b) => ({ platform: b.platform, slot: b.slot, alive: b.alive, busy: b.busy, broker: b.broker, failures: b.failures, lastError: b.lastError })),
        brokers: loadBrokers().map((b) => b.slug),
        ...extra,
      }),
    )
  } catch {
    // status is best-effort
  }
}

// Idle bridges are pinged so accounts only go to ones that are up (an MT4
// slot, say, before its terminal has been installed).
async function checkBridges() {
  await Promise.all(
    bridges
      .filter((b) => !b.busy)
      .map(async (b) => {
        const wasAlive = b.alive
        b.alive = await callBridge(b, "/health", undefined, 5_000).then(
          () => true,
          () => false,
        )
        if (b.alive !== wasAlive) console.log(`[mt5] bridge ${b.platform}/${b.slot} is ${b.alive ? "up" : "down"}`)
      }),
  )
}

// New accounts on a platform with no live terminal (MT4 before its terminal
// is installed, or every bridge down) would otherwise sit on "logging in"
// with no explanation. They stay pending and connect by themselves once a
// terminal is back; this just tells the user so.
const QUEUED_MESSAGE: Record<Platform, string> = {
  mt5: "Our MetaTrader 5 sync is briefly unavailable — your account is queued and will connect automatically.",
  mt4: "MetaTrader 4 sync is still being set up on our sync server — your account is queued and will connect automatically once it's ready. You can close this.",
}

async function flagQueued() {
  for (const platform of ["mt5", "mt4"] as const) {
    if (bridges.some((b) => b.platform === platform && b.alive)) continue
    const message = QUEUED_MESSAGE[platform]
    await db.execute(sql`
      update metatrader_connections set "statusMessage" = ${message}
       where platform = ${platform} and status = 'pending' and "statusMessage" is distinct from ${message}`)
  }
}

// ---------------------------------------------------------------------------
// Main loop

let stopping = false
let ticks = 0

async function tick() {
  ticks++
  if (ticks % 5 === 0) closeStrayWindows()
  if (ticks % 8 === 1) {
    await checkBridges()
    await flagQueued()
  }
  for (const platform of ["mt5", "mt4"] as const) {
    const free = bridges.filter((b) => b.platform === platform && b.alive && !b.busy)
    if (free.length === 0) continue
    const due = await claimDue(platform, free.length)
    for (const connection of due) {
      const broker = platform === "mt5" ? brokerFor(connection.server) : null
      const bridge = pickBridge(
        bridges.filter((b) => b.platform === platform && b.alive && !b.busy),
        connection,
        broker,
      )
      bridge.busy = true
      void syncConnection(bridge, connection).finally(() => {
        bridge.busy = false
      })
    }
  }
  await flushNormalize()
  if (ticks % 5 === 0) writeStatus()
}

async function main() {
  console.log(`[mt5] worker ${WORKER_ID} starting — bridges ${bridges.map((b) => `${b.platform}/${b.slot}:${b.port}`).join(", ")}, interval ${SYNC_INTERVAL_MS / 1000}s`)
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      stopping = true
    })
  }
  while (!stopping) {
    try {
      await tick()
    } catch (err) {
      console.error("[mt5] tick failed:", err instanceof Error ? err.message : err)
    }
    await new Promise((r) => setTimeout(r, TICK_MS))
  }
  // Let in-flight syncs finish (their leases would expire anyway).
  const deadline = Date.now() + 60_000
  while (bridges.some((b) => b.busy) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500))
  await flushNormalize()
  process.exit(0)
}

void main()
