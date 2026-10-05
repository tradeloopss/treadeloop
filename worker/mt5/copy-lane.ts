// TradeLoop copy lane — runs on the sync VPS beside the MT5 sync worker
// (systemd unit tradeloop-copy-lane, see worker/mt5/README.md).
//
// Copy Trading needs two things the sync worker's shared terminals can't give:
// a leader whose positions are read every second, and a follower whose trading
// session is already open when an order arrives. A shared terminal has to log
// in to an account first, which takes seconds and is why a copy used to take
// half a minute.
//
// So the lane has terminals of its own (MT5_COPY_BRIDGES), and gives one to
// each account the app marks for copying (metatrader_connections.copyRole):
//   leader    read-only session; positions read every second; when they
//             change they are written to the database and the app's copy
//             engine is called at once
//   follower  master-password session kept open; orders the app queues for it
//             (order_commands.broker = 'mt5c') are sent on it straight away
// There are only so many terminals. An account that doesn't get one keeps
// working through the sync worker, as before, only slower; the app can see
// which is which (copySlot, copySeenAt) and routes orders accordingly.
//
// The sync worker is not involved and not changed: it still imports deals for
// every account on its own terminals.
import { execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import { and, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { metatraderConnections, orderCommands } from "@/lib/db/schema"
import { decrypt } from "@/lib/crypto"

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (value == null || value === "") throw new Error(`${name} is not set`)
  return value
}

const BRIDGE_TOKEN = env("MT5_BRIDGE_TOKEN")
const CRON_SECRET = env("CRON_SECRET")
const APP_URL = env("APP_URL", "https://www.tradeloop.pro")
const BROKERS_DIR = env("MT5_BROKERS_DIR", "/srv/mt5/brokers")
const DISPLAY = env("MT5_DISPLAY", ":99")
// A leader is read this often; a follower (whose positions only change when we trade it) less.
const LEADER_POLL_MS = 1_000
const FOLLOWER_POLL_MS = 3_000
const ASSIGN_MS = 3_000
const ORDER_TICK_MS = 250
// Even when nothing changed, the database is told the account is being watched this often.
const KEEPALIVE_MS = 3_000
// A position that is gone from the list without a closing deal is believed gone after this long.
const MISSING_MS = 12_000

type Position = { symbol: string; side: "long" | "short"; volume: number; openPrice: number; currentPrice: number | null; stopLoss: number | null; takeProfit: number | null; profit: number | null; identifier: string }
type Connection = { id: number; accountId: number | null; login: string; server: string; passwordEnc: string; tradingPasswordEnc: string | null; copyRole: string | null }
type Slot = {
  slot: string
  port: number
  broker: string | null
  connection: Connection | null
  // what was last published for the account, by ticket
  known: Map<string, Position>
  // tickets that left the list without a closing deal, and when that was first seen
  missing: Map<string, number>
  signature: string
  writtenAt: number
  polledAt: number
  pauseUntil: number
  polling: boolean
  // one bridge call at a time per terminal
  chain: Promise<unknown>
}

const slots: Slot[] = env("MT5_COPY_BRIDGES")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((entry) => {
    const [slot, port] = entry.split(":")
    return { slot, port: Number(port), broker: null, connection: null, known: new Map(), missing: new Map(), signature: "", writtenAt: 0, polledAt: 0, pauseUntil: 0, polling: false, chain: Promise.resolve() }
  })

class BridgeError extends Error {
  constructor(
    readonly kind: string,
    message: string,
  ) {
    super(message)
  }
}

async function callBridge<T>(slot: Slot, path: string, body: unknown, timeoutMs: number): Promise<T> {
  let res: Response
  try {
    res = await fetch(`http://127.0.0.1:${slot.port}${path}`, { method: "POST", headers: { "X-Bridge-Token": BRIDGE_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    throw new BridgeError("bridge", `bridge ${slot.slot} unreachable: ${err instanceof Error ? err.message : err}`)
  }
  const json = (await res.json().catch(() => null)) as any
  if (!res.ok || !json || json.ok === false) throw new BridgeError(json?.kind ?? "bridge", json?.message ?? `bridge ${slot.slot} returned ${res.status}`)
  return json as T
}

// Runs one thing at a time on a terminal, in the order asked.
function onSlot<T>(slot: Slot, run: () => Promise<T>): Promise<T> {
  const next = slot.chain.then(run, run)
  slot.chain = next.catch(() => undefined)
  return next
}

// --- brokers: a terminal only knows the servers in the pack it was given ---
const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")
let brokers: { slug: string; prefixes: string[] }[] = []
let brokersReadAt = 0
function brokerFor(server: string): string | null {
  if (Date.now() - brokersReadAt > 60_000) {
    try {
      brokers = JSON.parse(readFileSync(`${BROKERS_DIR}/brokers.json`, "utf8"))
    } catch (err) {
      console.error("[lane] could not read brokers.json:", err instanceof Error ? err.message : err)
    }
    brokersReadAt = Date.now()
  }
  const s = letters(server)
  let best: { slug: string; length: number } | null = null
  for (const b of brokers) for (const prefix of b.prefixes) if (letters(prefix) && s.startsWith(letters(prefix)) && (!best || letters(prefix).length > best.length)) best = { slug: b.slug, length: letters(prefix).length }
  return best?.slug ?? null
}
const wineServersDat = (slug: string) => `Z:${`${BROKERS_DIR}/${slug}/servers.dat`.replace(/\//g, "\\")}`

// --- the app's copy engine: called the moment something it cares about changed ---
let ticking = false
let tickAgain = false
async function tick() {
  if (ticking) {
    tickAgain = true
    return
  }
  ticking = true
  try {
    do {
      tickAgain = false
      await fetch(`${APP_URL}/api/cron/copy-engine`, { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` }, signal: AbortSignal.timeout(30_000) }).catch((err) => console.warn("[lane] engine call failed:", err instanceof Error ? err.message : err))
    } while (tickAgain)
  } finally {
    ticking = false
  }
}

// --- who gets a terminal ---
const trades = (c: Connection) => (c.copyRole === "follower" || c.copyRole === "both") && c.tradingPasswordEnc != null

async function assign() {
  const wanted = (await db
    .select({ id: metatraderConnections.id, accountId: metatraderConnections.accountId, login: metatraderConnections.login, server: metatraderConnections.server, passwordEnc: metatraderConnections.passwordEnc, tradingPasswordEnc: metatraderConnections.tradingPasswordEnc, copyRole: metatraderConnections.copyRole })
    .from(metatraderConnections)
    .where(and(isNotNull(metatraderConnections.copyRole), eq(metatraderConnections.platform, "mt5")))
    // leaders first: without its leader read fast, a follower's terminal is no use
    .orderBy(sql`(${metatraderConnections.copyRole} = 'follower')`, metatraderConnections.id)) as Connection[]
  const byId = new Map(wanted.map((c) => [c.id, c]))
  for (const s of slots) {
    if (!s.connection) continue
    const still = byId.get(s.connection.id)
    if (!still) {
      console.log(`[lane] ${s.slot}: released (connection ${s.connection.id})`)
      s.connection = null
      s.known.clear()
      s.missing.clear()
      s.signature = ""
    } else s.connection = still
  }
  for (const c of wanted) {
    if (slots.some((s) => s.connection?.id === c.id)) continue
    if (!brokerFor(c.server)) continue
    const free = slots.find((s) => !s.connection)
    if (!free) break
    free.connection = c
    free.known.clear()
    free.missing.clear()
    free.signature = ""
    free.pauseUntil = 0
    console.log(`[lane] ${free.slot}: ${c.copyRole} ${c.login} (${c.server}), connection ${c.id}`)
  }
  // the database says which accounts have a terminal, and nothing else does
  const held = slots.filter((s) => s.connection).map((s) => s.connection!.id)
  await db.update(metatraderConnections).set({ copySlot: null }).where(and(isNotNull(metatraderConnections.copySlot), held.length ? notInArray(metatraderConnections.id, held) : sql`true`))
  for (const s of slots) if (s.connection) await db.update(metatraderConnections).set({ copySlot: s.slot }).where(and(eq(metatraderConnections.id, s.connection.id), sql`${metatraderConnections.copySlot} is distinct from ${s.slot}`))
}

// --- reading an account ---
const toPosition = (p: Record<string, any>): Position => ({
  symbol: String(p.symbol ?? ""),
  side: Number(p.type) === 1 ? "short" : "long",
  volume: Number(p.volume ?? 0),
  openPrice: Number(p.price_open ?? 0),
  currentPrice: p.price_current != null ? Number(p.price_current) : null,
  stopLoss: p.sl ? Number(p.sl) : null,
  takeProfit: p.tp ? Number(p.tp) : null,
  profit: p.profit != null ? Number(p.profit) + Number(p.swap ?? 0) : null,
  identifier: String(p.identifier ?? p.ticket ?? ""),
})
// what the copy engine acts on: which positions, how big, and their stops — not prices
const signatureOf = (list: Position[]) => JSON.stringify([...list].sort((a, b) => a.identifier.localeCompare(b.identifier)).map((p) => [p.identifier, p.symbol, p.side, p.volume, p.stopLoss, p.takeProfit]))

async function poll(s: Slot, force = false) {
  const c = s.connection
  if (!c || Date.now() < s.pauseUntil) return
  const leader = c.copyRole !== "follower"
  if (!force && Date.now() - s.polledAt < (leader ? LEADER_POLL_MS : FOLLOWER_POLL_MS)) return
  s.polledAt = Date.now()
  try {
    const slug = brokerFor(c.server)
    if (!slug) return
    if (s.broker !== slug) {
      await callBridge(s, "/reset", { serversDat: wineServersDat(slug) }, 60_000)
      s.broker = slug
    }
    const master = trades(c)
    const res = await callBridge<{ positions: Record<string, any>[]; closed: string[]; balance: number; equity: number; fresh: boolean }>(s, "/positions", { login: Number(c.login), password: decrypt(master ? c.tradingPasswordEnc! : c.passwordEnc), server: c.server, trading: master, check: [...s.missing.keys()] }, 90_000)
    if (s.connection?.id !== c.id) return
    const listed = new Map(res.positions.map(toPosition).map((p) => [p.identifier, p]))
    // A ticket that is no longer listed is only dropped when a closing deal
    // says so, or when it has stayed away. Until then it is carried forward:
    // a terminal that has just reconnected lists nothing for a moment, and
    // that must never reach the copy engine as "the leader closed everything".
    const closed = new Set(res.closed)
    for (const [ticket, old] of s.known) {
      if (listed.has(ticket)) {
        s.missing.delete(ticket)
        continue
      }
      const since = s.missing.get(ticket) ?? Date.now()
      if (closed.has(ticket) || (!res.fresh && Date.now() - since >= MISSING_MS)) s.missing.delete(ticket)
      else {
        s.missing.set(ticket, since)
        listed.set(ticket, old)
      }
    }
    const published = [...listed.values()]
    const signature = signatureOf(published)
    const changed = signature !== s.signature
    if (changed || Date.now() - s.writtenAt >= KEEPALIVE_MS) {
      const now = new Date()
      // it is connected — we have just read it — whatever a refused second login on the shared terminals said
      await db.update(metatraderConnections).set({ openPositions: published.length, openPositionsData: published, balance: String(res.balance), equity: String(res.equity), lastSyncedAt: now, copySeenAt: now, status: "connected", statusMessage: null }).where(eq(metatraderConnections.id, c.id))
      s.writtenAt = Date.now()
    }
    if (changed) {
      const first = s.signature === ""
      s.signature = signature
      s.known = new Map(published.map((p) => [p.identifier, p]))
      if (!first) console.log(`[lane] ${s.slot}: ${c.login} positions changed (${published.length} open)`)
      void tick()
    } else s.known = new Map(published.map((p) => [p.identifier, p]))
  } catch (err) {
    const kind = err instanceof BridgeError ? err.kind : "internal"
    // a wrong password or an unknown server won't fix itself in a second
    s.pauseUntil = Date.now() + (kind === "auth" || kind === "unsupported" ? 60_000 : 5_000)
    console.warn(`[lane] ${s.slot}: ${c.login} read failed [${kind}]: ${err instanceof Error ? err.message : err}`)
  }
}

// --- sending a follower's orders ---
function sh(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => execFile(cmd, args, { env: { ...process.env, DISPLAY } }, (_e, stdout) => resolve(stdout ?? "")))
}
// The "Algo Trading" button starts off on a headless terminal, and an order is
// refused while it is (the bridge reports "autotrading"). Ctrl+E turns it on.
async function enableAutoTrading(login: string) {
  const id = (await sh("xdotool", ["search", "--name", String(login)])).split("\n").map((x) => x.trim()).filter(Boolean)[0]
  if (!id) return console.warn(`[lane] enableAutoTrading: no window found for ${login}`)
  await sh("xdotool", ["windowactivate", "--sync", id])
  await new Promise((r) => setTimeout(r, 300))
  await sh("xdotool", ["key", "--window", id, "--clearmodifiers", "ctrl+e"])
  await new Promise((r) => setTimeout(r, 700))
}

type Command = typeof orderCommands.$inferSelect
async function finish(id: number, set: Partial<Command>) {
  await db.update(orderCommands).set({ ...set, leaseUntil: null, updatedAt: new Date() }).where(eq(orderCommands.id, id))
}

async function execute(s: Slot, cmd: Command) {
  const c = s.connection!
  const startedAt = Date.now()
  try {
    const num = (v: string | null) => (v != null ? Number(v) : null)
    const body = { login: c.login, password: decrypt(c.tradingPasswordEnc!), server: c.server, kind: cmd.kind, positionRef: cmd.positionRef, orderRef: cmd.orderRef, symbol: cmd.symbol, side: cmd.side, volume: num(cmd.volume), price: num(cmd.price), stopLoss: num(cmd.stopLoss), takeProfit: num(cmd.takeProfit), orderType: cmd.orderType }
    let result: { accepted: boolean; retcode: number; comment: string; order: string; deal: string } | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await callBridge(s, "/order", body, 25_000)
        break
      } catch (err) {
        if (err instanceof BridgeError && err.kind === "autotrading" && attempt < 2) {
          await enableAutoTrading(c.login)
          continue
        }
        throw err
      }
    }
    if (!result) throw new BridgeError("order", "order was not sent")
    const ref = result.deal && result.deal !== "0" ? result.deal : result.order
    if (result.accepted) await finish(cmd.id, { status: "filled", resultMessage: "Order executed.", brokerRef: ref, brokerResult: result })
    else await finish(cmd.id, { status: "rejected", resultMessage: `Broker rejected the order (retcode ${result.retcode}: ${result.comment || "no reason given"}).`, brokerRef: ref, brokerResult: result })
    console.log(`[lane] ${s.slot}: order ${cmd.id} (${cmd.kind} ${c.login}) ${result.accepted ? "filled" : `rejected — ${result.comment}`} in ${Date.now() - startedAt}ms`)
  } catch (err) {
    const attempts = cmd.attempts + 1
    const giveUp = attempts >= 3
    await finish(cmd.id, { status: giveUp ? "failed" : "pending", resultMessage: err instanceof Error ? err.message : String(err), attempts })
    console.warn(`[lane] ${s.slot}: order ${cmd.id} attempt ${attempts} failed${giveUp ? " (giving up)" : ""}: ${err instanceof Error ? err.message : err}`)
  }
}

async function orders() {
  const accounts = slots.filter((s) => s.connection && trades(s.connection) && s.connection.accountId != null).map((s) => s.connection!.accountId!)
  // an order queued for the lane while its account has no terminal here goes back to the sync worker
  await db.update(orderCommands).set({ broker: "mt5" }).where(and(eq(orderCommands.broker, "mt5c"), eq(orderCommands.status, "pending"), accounts.length ? notInArray(orderCommands.accountId, accounts) : sql`true`))
  if (!accounts.length) return
  const claimed = await db.execute<{ id: number }>(sql`
    update order_commands set "leaseUntil" = now() + make_interval(mins => 2), "updatedAt" = now()
    where id in (
      select id from order_commands
      where broker = 'mt5c' and status = 'pending' and ("leaseUntil" is null or "leaseUntil" < now())
      order by "createdAt" limit 20 for update skip locked
    ) returning id`)
  const ids = claimed.rows.map((r) => r.id)
  if (!ids.length) return
  const rows = (await db.select().from(orderCommands).where(inArray(orderCommands.id, ids))).sort((a, b) => a.id - b.id)
  for (const cmd of rows) {
    const s = slots.find((x) => x.connection?.accountId === cmd.accountId && trades(x.connection))
    if (!s) {
      await finish(cmd.id, { broker: "mt5" })
      continue
    }
    // in the order they were queued on that terminal; then read the account, and tell the engine
    void onSlot(s, async () => {
      await execute(s, cmd)
      await poll(s, true)
      void tick()
    })
  }
}

// --- the loops ---
function every(ms: number, name: string, run: () => Promise<void>) {
  let busy = false
  setInterval(async () => {
    if (busy) return
    busy = true
    try {
      await run()
    } catch (err) {
      console.error(`[lane] ${name} failed:`, err instanceof Error ? err.message : err)
    } finally {
      busy = false
    }
  }, ms)
}

console.log(`[lane] starting with ${slots.length} terminal(s): ${slots.map((s) => s.slot).join(", ")}`)
every(ASSIGN_MS, "assign", assign)
setInterval(() => {
  for (const s of slots) {
    if (!s.connection || s.polling) continue
    s.polling = true
    void onSlot(s, () => poll(s))
      .catch((err) => console.error(`[lane] ${s.slot} poll failed:`, err instanceof Error ? err.message : err))
      .finally(() => {
        s.polling = false
      })
  }
}, 250)
every(ORDER_TICK_MS, "orders", orders)
// on the way out, say nobody has a terminal: the app then stops sending orders here at once
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    db.update(metatraderConnections).set({ copySlot: null }).where(isNotNull(metatraderConnections.copySlot)).then(
      () => process.exit(0),
      () => process.exit(0),
    )
  })
