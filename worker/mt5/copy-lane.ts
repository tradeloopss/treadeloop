// TradeLoop copy lane — runs on the sync VPS beside the MT5 sync worker
// (systemd unit tradeloop-copy-lane, see worker/mt5/README.md).
//
// Copy Trading needs two things the sync worker's shared terminals can't give:
// a leader whose positions are known the moment they change, and a follower
// whose trading session is already open when an order arrives. So the lane
// has terminals of its own (MT5_COPY_BRIDGES), and gives one to each account
// the app marks for copying (metatrader_connections.copyRole):
//   leader    read-only session, watched without a pause (bridge /watch
//             answers within a few milliseconds of a change)
//   follower  master-password session kept open, read every few seconds
// There are only so many terminals. An account that doesn't get one keeps
// working through the sync worker, as before, only slower; the app can see
// which is which (copySlot, copySeenAt) and routes orders accordingly.
//
// HOW A TRADE IS COPIED
//
// The instant path. The app gives each leader a plan (lib/copy/plan.ts):
// its groups, their rules, each follower's sizing and risk picture. When the
// leader opens a position, the lane works out each follower's order right
// here with the app's own functions (decideEntry, the prop-rule guard) and
// sends it on the follower's terminal at once. A leader's full close closes
// the followers' positions the same way. No database and no web server stand
// between the leader's trade and the follower's order.
//
// Each of those orders has a name (entryRef / closeRef) that is unique in
// order_commands. The lane writes the row as it sends the order, and only
// after its rows are written does it publish the leader's new position to the
// database, which is the only way the app's engine learns of it. So when the
// engine comes to copy that position, the order is already there under its
// name and the engine takes it over instead of sending another.
//
// The regular path. Everything else — a follower without a terminal here, a
// plan that is missing or old, a trade the rules or the risk limits turn down,
// partial closes, stops and targets, retries, Flatten All — is decided by the
// app's engine as before. The lane tells it the moment something changed and
// sends the orders it queues (order_commands.broker = 'mt5c').
//
// The sync worker is not involved: it still imports deals for every account
// on its own terminals, and leaves the open positions of an account that is
// held here alone.
import { randomInt } from "node:crypto"
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { and, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { metatraderConnections, orderCommands } from "@/lib/db/schema"
import { decrypt } from "@/lib/crypto"
import { DEFAULT_FOLLOWER, DEFAULT_RULES, NO_PROPSYNC, type LivePosition } from "@/lib/copy/engine"
import { clock, closeAllowed, closeRef, decideEntry, entryRef, guardEntry, notionalOf, planIsGood, type LanePlan, type LaneReport } from "@/lib/copy/plan"

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (value == null || value === "") throw new Error(`${name} is not set`)
  return value
}

const BRIDGE_TOKEN = env("MT5_BRIDGE_TOKEN")
const CRON_SECRET = env("CRON_SECRET")
const APP_URL = env("APP_URL", "https://www.tradeloop.pro")
const BROKERS_DIR = env("MT5_BROKERS_DIR", "/srv/mt5/brokers")
const JOURNAL = env("COPY_LANE_JOURNAL", "/var/lib/tradeloop/copy-lane.journal")
// How long one /watch waits for a leader's positions to change before it is asked again.
const WATCH_MS = 1_000
// A follower's positions only change when we trade it (or its stop is hit): read this often.
const FOLLOWER_POLL_MS = 3_000
const ASSIGN_MS = 1_000
const ORDER_TICK_MS = 250
// Even when nothing changed, the database is told the account is being watched this often.
const KEEPALIVE_MS = 3_000
// A position that is gone from the list without a closing deal is believed gone after this long.
const MISSING_MS = 12_000
// A leader's position counts as opened just now only if the account was read this recently before it.
const NEW_WITHIN_MS = 5_000
// A follower takes an order sent from here only if it was read this recently.
const READY_WITHIN_MS = 15_000
// A leader's position that closed is kept in what the app sees until the app has the
// lane's orders for it in its books, or this long.
const HOLD_MS = 20_000
// After this many failed reads in a row, the terminal is restarted.
const RESET_AFTER = 2

type Position = { symbol: string; side: "long" | "short"; volume: number; openPrice: number; currentPrice: number | null; stopLoss: number | null; takeProfit: number | null; profit: number | null; identifier: string }
type Seen = Position & { magic: string | null }
type Connection = { id: number; userId: string; accountId: number | null; login: string; server: string; passwordEnc: string; tradingPasswordEnc: string | null; copyRole: string | null; copyPlan: LanePlan | null }
type Reading = { positions: Record<string, any>[]; signature: string; closed: string[]; balance: number; equity: number; tradeAllowed: boolean; fresh: boolean; ping: number | null }
type Slot = {
  slot: string
  port: number
  broker: string | null
  connection: Connection | null
  // the account as its terminal last listed it, by ticket
  known: Map<string, Seen>
  // tickets that left the list without a closing deal, and when that was first seen
  missing: Map<string, number>
  // a leader's closed positions still shown to the app, until it has booked the lane's orders for them
  held: Map<string, { position: Seen; until: number; refs: string[] }>
  // nothing has been read since the account got this terminal (or since the terminal was restarted)
  first: boolean
  seenSignature: string
  bridgeSignature: string
  publishedSignature: string
  writtenAt: number
  readAt: number
  pauseUntil: number
  failures: number
  equity: number | null
  balance: number | null
  ping: number | null
  tradeAllowed: boolean
  // orders sent from here that no reading shows yet
  inflight: { ref: string; symbol: string; side: "long" | "short"; volume: number; price: number | null; at: number }[]
  // what the lane opened on the account, and when: counted on top of a plan written before it
  openedHere: { ref: string; at: number; volume: number }[]
  primed: string
  // writes to the database, in the order the readings came
  publishing: Promise<unknown>
  // every order row started so far is written when this resolves
  reported: Promise<unknown>
}

const slots: Slot[] = env("MT5_COPY_BRIDGES")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((entry) => {
    const [slot, port] = entry.split(":")
    return { slot, port: Number(port), broker: null, connection: null, known: new Map(), missing: new Map(), held: new Map(), first: true, seenSignature: "", bridgeSignature: "", publishedSignature: "", writtenAt: 0, readAt: 0, pauseUntil: 0, failures: 0, equity: null, balance: null, ping: null, tradeAllowed: false, inflight: [], openedHere: [], primed: "", publishing: Promise.resolve(), reported: Promise.resolve() }
  })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const num = (v: string | null) => (v != null ? Number(v) : null)
const str = (v: number | null | undefined) => (v == null ? null : String(v))

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
      // whatever it queued for the terminals here is sent now, not at the next look
      void orders().catch(() => undefined)
    } while (tickAgain)
  } finally {
    ticking = false
  }
}

// --- who gets a terminal ---
const trades = (c: Connection) => (c.copyRole === "follower" || c.copyRole === "both") && c.tradingPasswordEnc != null
const leads = (c: Connection) => c.copyRole !== "follower"
const secrets = new Map<string, string>()
function secret(c: Connection): string {
  const enc = trades(c) ? c.tradingPasswordEnc! : c.passwordEnc
  let value = secrets.get(enc)
  if (value == null) {
    if (secrets.size > 200) secrets.clear()
    value = decrypt(enc)
    secrets.set(enc, value)
  }
  return value
}
const session = (c: Connection) => ({ login: Number(c.login), password: secret(c), server: c.server, trading: trades(c) })

function clear(s: Slot) {
  s.known.clear()
  s.missing.clear()
  s.held.clear()
  s.first = true
  s.seenSignature = ""
  s.bridgeSignature = ""
  s.publishedSignature = ""
  s.inflight = []
  s.openedHere = []
  s.primed = ""
  s.failures = 0
  s.readAt = 0
  s.tradeAllowed = false
}

async function assign() {
  const wanted = (await db
    .select({ id: metatraderConnections.id, userId: metatraderConnections.userId, accountId: metatraderConnections.accountId, login: metatraderConnections.login, server: metatraderConnections.server, passwordEnc: metatraderConnections.passwordEnc, tradingPasswordEnc: metatraderConnections.tradingPasswordEnc, copyRole: metatraderConnections.copyRole, copyPlan: metatraderConnections.copyPlan })
    .from(metatraderConnections)
    .where(and(isNotNull(metatraderConnections.copyRole), eq(metatraderConnections.platform, "mt5")))
    // leaders first: without its leader read fast, a follower's terminal is no use
    .orderBy(sql`(${metatraderConnections.copyRole} = 'follower')`, metatraderConnections.id)) as Connection[]
  const byId = new Map(wanted.map((c) => [c.id, c]))
  // An account that has just stopped copying may still have orders waiting for
  // its terminal here (the closes of a Flatten All). Those first: it is let go after.
  const leaving = slots.some((s) => s.connection && !byId.has(s.connection.id))
  const waiting = leaving ? new Set((await db.selectDistinct({ accountId: orderCommands.accountId }).from(orderCommands).where(and(eq(orderCommands.broker, "mt5c"), eq(orderCommands.status, "pending")))).map((r) => r.accountId)) : new Set<number>()
  for (const s of slots) {
    if (!s.connection) continue
    const still = byId.get(s.connection.id)
    if (!still) {
      if (s.connection.accountId != null && waiting.has(s.connection.accountId)) continue
      console.log(`[lane] ${s.slot}: released (connection ${s.connection.id})`)
      s.connection = null
      clear(s)
    } else {
      // a session opened for reading can't trade, and the other way round the password differs: start over
      const changed = trades(still) !== trades(s.connection)
      s.connection = still
      if (changed) clear(s)
    }
  }
  for (const c of wanted) {
    if (slots.some((s) => s.connection?.id === c.id)) continue
    if (!brokerFor(c.server)) continue
    const free = slots.find((s) => !s.connection)
    if (!free) break
    free.connection = c
    clear(free)
    free.pauseUntil = 0
    console.log(`[lane] ${free.slot}: ${c.copyRole} ${c.login} (${c.server}), connection ${c.id}`)
  }
  // the database says which accounts have a terminal, and nothing else does
  const held = slots.filter((s) => s.connection).map((s) => s.connection!.id)
  await db.update(metatraderConnections).set({ copySlot: null }).where(and(isNotNull(metatraderConnections.copySlot), held.length ? notInArray(metatraderConnections.id, held) : sql`true`))
  for (const s of slots) if (s.connection) await db.update(metatraderConnections).set({ copySlot: s.slot }).where(and(eq(metatraderConnections.id, s.connection.id), sql`${metatraderConnections.copySlot} is distinct from ${s.slot}`))
}

// --- the journal: every order sent from here, written down before it leaves ---
//
// If the lane stops between sending an order and recording it in the database,
// this file is what remembers it. On the way back up, before anything else,
// each such order gets its row (so the app can never send it a second time),
// and once the follower's account can be read the row is settled: the order
// carried a number of its own (magic) that MetaTrader keeps on the position.
type Attempt = { ref: string; magic: number; userId: string; accountId: number; kind: "place" | "close"; symbol: string; side: "long" | "short"; volume: number; ticket: string | null; report: LaneReport; at: number; rowId?: number; settle?: boolean }
const unsettled = new Map<string, Attempt>()
function journal(line: Record<string, unknown>) {
  try {
    appendFileSync(JOURNAL, `${JSON.stringify(line)}\n`)
  } catch (err) {
    console.error("[lane] journal write failed:", err instanceof Error ? err.message : err)
  }
}
function readJournal() {
  if (!existsSync(JOURNAL)) return
  for (const line of readFileSync(JOURNAL, "utf8").split("\n")) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line)
      if (e.t === "try") unsettled.set(e.ref, e.attempt)
      else if (e.t === "row" && unsettled.has(e.ref)) unsettled.get(e.ref)!.rowId = e.id
      else if (e.t === "done") unsettled.delete(e.ref)
    } catch {
      // a line cut short by a crash: the order it was for never left
    }
  }
  // start the file again with only what is still open, and nothing older than ten minutes
  for (const [ref, a] of unsettled) {
    if (Date.now() - a.at > 600_000) unsettled.delete(ref)
    else a.settle = true
  }
  writeFileSync(JOURNAL, [...unsettled.values()].flatMap((a) => [JSON.stringify({ t: "try", ref: a.ref, attempt: a }), ...(a.rowId ? [JSON.stringify({ t: "row", ref: a.ref, id: a.rowId })] : [])]).map((l) => `${l}\n`).join(""))
}
const names = new Set<string>()
// Resolves once everything the journal left open is settled (or it has taken
// too long). Until then no account is published: the app must not learn of a
// leader's position while it is still unknown whether its order went out.
let recovering: Promise<unknown> = Promise.resolve()
let recovered = () => {}

async function recover() {
  readJournal()
  if (unsettled.size) recovering = Promise.race([new Promise<void>((r) => (recovered = r)), sleep(15_000)])
  for (const a of unsettled.values()) {
    names.add(a.ref)
    if (a.rowId) continue
    // sent, perhaps; never recorded. The row first: with it there, the app won't send the order again.
    const [row] = await db
      .insert(orderCommands)
      .values({ userId: a.userId, accountId: a.accountId, broker: "mt5c", kind: a.kind, status: "sent", positionRef: a.kind === "close" ? a.ticket : null, symbol: a.symbol, side: a.side, volume: String(a.volume), orderType: a.kind === "place" ? "market" : null, clientRef: a.ref, lane: a.report, leaseUntil: new Date(Date.now() + 3_600_000) })
      .onConflictDoNothing()
      .returning({ id: orderCommands.id })
    const id = row?.id ?? (await db.select({ id: orderCommands.id }).from(orderCommands).where(eq(orderCommands.clientRef, a.ref)))[0]?.id
    if (id) {
      a.rowId = id
      journal({ t: "row", ref: a.ref, id })
    }
  }
  if (unsettled.size) console.warn(`[lane] ${unsettled.size} order(s) from before the restart are being checked against the broker`)
}

// What the lane adds to its report on an order, kept beside what the app has
// written there meanwhile (that it has the order in its books).
const merged = (patch: Partial<LaneReport>) => sql`coalesce(${orderCommands.lane}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`

// Settles the orders whose outcome isn't known (left open by the journal, or
// whose answer never came), from a reading of the account taken after them.
// An order that is simply in the air is not touched.
let settling: Promise<unknown> = Promise.resolve()
function settle(s: Slot): Promise<void> {
  const run = settling.then(() => settleNow(s))
  settling = run.catch(() => undefined)
  return run
}
async function settleNow(s: Slot) {
  const accountId = s.connection?.accountId
  for (const a of [...unsettled.values()]) {
    if (a.accountId !== accountId || !a.rowId || !a.settle) continue
    const opened = a.kind === "place" ? [...s.known.values()].find((p) => p.magic === String(a.magic)) : undefined
    const gone = a.kind === "close" && !!a.ticket && !s.known.has(a.ticket)
    if (opened || gone) await db.update(orderCommands).set({ status: "filled", resultMessage: "Order executed.", brokerRef: opened?.identifier ?? a.ticket, lane: merged({ ticket: opened?.identifier ?? a.ticket, price: opened?.openPrice ?? null }), leaseUntil: null, updatedAt: new Date() }).where(and(eq(orderCommands.id, a.rowId), eq(orderCommands.status, "sent")))
    else {
      // It never reached the broker. Not in the app's books yet: the row goes,
      // and the app's engine sends the order its own way. Already there: it is
      // marked as not sent, and the app tells the trader.
      const removed = await db.delete(orderCommands).where(and(eq(orderCommands.id, a.rowId), eq(orderCommands.status, "sent"), sql`(${orderCommands.lane}->>'booked') is null`)).returning({ id: orderCommands.id })
      if (!removed.length) await db.update(orderCommands).set({ status: "failed", resultMessage: "The order did not reach the broker.", leaseUntil: null, updatedAt: new Date() }).where(and(eq(orderCommands.id, a.rowId), eq(orderCommands.status, "sent")))
    }
    console.warn(`[lane] ${s.slot}: order ${a.ref}, whose answer never came, ${opened || gone ? "had been executed" : "had not reached the broker"}`)
    unsettled.delete(a.ref)
    journal({ t: "done", ref: a.ref })
  }
  if (![...unsettled.values()].some((a) => a.settle)) recovered()
}

// --- reading an account ---
const toSeen = (p: Record<string, any>): Seen => ({
  symbol: String(p.symbol ?? ""),
  side: Number(p.type) === 1 ? "short" : "long",
  volume: Number(p.volume ?? 0),
  openPrice: Number(p.price_open ?? 0),
  currentPrice: p.price_current != null ? Number(p.price_current) : null,
  stopLoss: p.sl ? Number(p.sl) : null,
  takeProfit: p.tp ? Number(p.tp) : null,
  profit: p.profit != null ? Number(p.profit) + Number(p.swap ?? 0) : null,
  identifier: String(p.identifier ?? p.ticket ?? ""),
  magic: p.magic != null && String(p.magic) !== "0" ? String(p.magic) : null,
})
const toPublished = ({ magic: _magic, ...p }: Seen): Position => p
// what the copy engine acts on: which positions, how big, and their stops — not prices
const signatureOf = (list: Position[]) => JSON.stringify([...list].sort((a, b) => a.identifier.localeCompare(b.identifier)).map((p) => [p.identifier, p.symbol, p.side, p.volume, p.stopLoss, p.takeProfit]))

// The symbols a follower is likely to be sent: kept in its Market Watch, so the
// price is already streaming when the order comes.
function primeFor(s: Slot): string[] {
  const accountId = s.connection?.accountId
  const out = new Set<string>()
  for (const p of s.known.values()) out.add(p.symbol)
  for (const l of slots) {
    const plan = l.connection?.copyPlan
    if (!plan) continue
    for (const g of plan.groups) for (const f of g.followers) if (f.accountId === accountId) for (const m of f.mappings) out.add(m.followerSymbol)
  }
  return [...out].slice(0, 25)
}

async function read(s: Slot, path: "/positions" | "/watch") {
  const c = s.connection
  if (!c) return
  try {
    const slug = brokerFor(c.server)
    if (!slug) return
    if (s.broker !== slug) {
      await callBridge(s, "/reset", { serversDat: wineServersDat(slug) }, 60_000)
      s.broker = slug
    }
    const prime = trades(c) ? primeFor(s) : []
    const body = { ...session(c), check: [...s.known.keys()], ...(path === "/watch" ? { signature: s.bridgeSignature, waitMs: WATCH_MS } : {}), ...(prime.join() !== s.primed ? { prime } : {}) }
    const res = await callBridge<Reading>(s, path, body, 90_000)
    if (s.connection?.id !== c.id) return
    s.primed = prime.join()
    s.failures = 0
    // with the plan as it is now, not as it was when the wait began
    absorb(s, s.connection, res)
  } catch (err) {
    const kind = err instanceof BridgeError ? err.kind : "internal"
    s.failures++
    s.tradeAllowed = false
    // a wrong password or an unknown server won't fix itself in a second
    s.pauseUntil = Date.now() + (kind === "auth" || kind === "unsupported" ? 60_000 : 2_000)
    console.warn(`[lane] ${s.slot}: ${c.login} read failed [${kind}]: ${err instanceof Error ? err.message : err}`)
    if (s.failures >= RESET_AFTER && kind !== "auth" && kind !== "unsupported") {
      // the terminal has stopped answering: end it. The next read starts it again.
      console.warn(`[lane] ${s.slot}: restarting the terminal after ${s.failures} failed reads`)
      await callBridge(s, "/reset", {}, 60_000).catch(() => undefined)
      s.failures = 0
      s.first = true
      s.bridgeSignature = ""
    }
  }
}

// One reading of an account: what changed, what to do about it, what to tell the app.
function absorb(s: Slot, c: Connection, res: Reading) {
  const now = Date.now()
  const recent = !s.first && !res.fresh && now - s.readAt <= NEW_WITHIN_MS
  const listed = new Map(res.positions.map(toSeen).map((p) => [p.identifier, p]))
  // A ticket that is no longer listed is only dropped when a closing deal
  // says so, or when it has stayed away. Until then it is carried forward:
  // a terminal that has just reconnected lists nothing for a moment, and
  // that must never reach the copy engine as "the leader closed everything".
  const confirmed = new Set(res.closed)
  const closed: Seen[] = []
  for (const [ticket, old] of s.known) {
    if (listed.has(ticket)) {
      s.missing.delete(ticket)
      continue
    }
    const since = s.missing.get(ticket) ?? now
    if (confirmed.has(ticket) || (!res.fresh && now - since >= MISSING_MS)) {
      s.missing.delete(ticket)
      closed.push(old)
    } else {
      s.missing.set(ticket, since)
      listed.set(ticket, old)
    }
  }
  const opened = [...listed.values()].filter((p) => !s.known.has(p.identifier))
  // a ticket more or less, or a size, stop or target that moved
  const seen = signatureOf([...listed.values()])
  const changed = !s.first && seen !== s.seenSignature
  s.seenSignature = seen
  // an order sent from here that this reading shows is no longer in the air
  s.inflight = s.inflight.filter((o) => now - o.at < 30_000 && !opened.some((p) => p.symbol === o.symbol && p.side === o.side))
  s.known = listed
  s.bridgeSignature = res.signature
  s.equity = res.equity
  s.balance = res.balance
  s.ping = res.ping
  s.tradeAllowed = res.tradeAllowed
  s.readAt = now
  s.openedHere = s.openedHere.filter((o) => now - o.at < 60_000)
  const first = s.first
  s.first = false
  if ([...unsettled.values()].some((a) => a.settle)) void settle(s).catch((err) => console.error(`[lane] ${s.slot}: settling failed:`, err instanceof Error ? err.message : err))

  // The instant path: a leader's new position, or one it closed, acted on here and now.
  if (leads(c) && !first) {
    if (recent) for (const p of opened) copyOpen(s, c, p, now)
    for (const p of closed) copyClose(s, c, p, now)
  }
  if (first || changed) {
    if (!first) console.log(`[lane] ${s.slot}: ${c.login} positions changed (${listed.size} open${opened.length ? `, +${opened.length}` : ""}${closed.length ? `, -${closed.length}` : ""})`)
    publish(s, c, closed.length > 0, true)
  } else if (now - s.writtenAt >= KEEPALIVE_MS) publish(s, c, false, false)
}

// Writes the account to the database: its positions, and that it is being
// watched. In the order the readings came, and never before the rows of the
// orders that reading set off: the app must find those when it sees the position.
function publish(s: Slot, c: Connection, closedSome: boolean, tell: boolean) {
  const now = Date.now()
  for (const [ticket, h] of s.held) if (now >= h.until || s.known.has(ticket)) s.held.delete(ticket)
  const list = [...s.known.values(), ...[...s.held.values()].map((h) => h.position)].map(toPublished)
  const signature = signatureOf(list)
  const after = Promise.all([s.reported, recovering])
  s.writtenAt = now
  s.publishing = s.publishing
    .then(() => after)
    .then(async () => {
      if (s.connection?.id !== c.id) return
      const at = new Date()
      // it is connected — we have just read it — whatever a refused second login on the shared terminals said
      await db
        .update(metatraderConnections)
        .set({ openPositions: list.length, openPositionsData: list, balance: str(s.balance), equity: str(s.equity), copyPingMs: s.ping != null ? Math.round(s.ping) : null, lastSyncedAt: at, copySeenAt: at, status: "connected", statusMessage: null, ...(closedSome ? { nextSyncAt: at } : {}) })
        .where(eq(metatraderConnections.id, c.id))
      const differs = signature !== s.publishedSignature
      s.publishedSignature = signature
      if (tell || differs) void tick()
    })
    .catch((err) => console.error(`[lane] ${s.slot}: write failed:`, err instanceof Error ? err.message : err))
}

// --- the instant path ---
const followerSlot = (leader: Connection, accountId: number) => {
  const s = slots.find((x) => x.connection?.accountId === accountId && trades(x.connection))
  // the same trader's account, read a moment ago, on a session that can trade
  return s && s.connection!.userId === leader.userId && !s.first && s.tradeAllowed && Date.now() >= s.pauseUntil && Date.now() - s.readAt <= READY_WITHIN_MS ? s : null
}
// The followers' orders the lane sent for a leader's position, by group and
// leader ticket, from the moment each leaves: what a close closes before the
// app has heard of the entry. `ticket` is the follower's, once the broker has answered.
type Entered = { accountId: number; ref: string; ticket: string | null; symbol: string; side: "long" | "short"; volume: number; done: Promise<unknown> }
const enteredFor = new Map<string, Entered[]>()

function copyOpen(leader: Slot, c: Connection, p: Seen, detectedAt: number) {
  const plan = c.copyPlan
  if (!planIsGood(plan, detectedAt) || plan.userId !== c.userId) return
  const position: LivePosition = { key: p.identifier, symbol: p.symbol, side: p.side, quantity: p.volume, entry: p.openPrice, stopLoss: p.stopLoss, takeProfit: p.takeProfit, price: p.currentPrice }
  const now = new Date(detectedAt)
  for (const g of plan.groups) {
    const at = clock(g.timeZone, now)
    for (const f of g.followers) {
      const ref = entryRef(g.id, p.identifier, f.accountId)
      if (names.has(ref)) continue
      const fs = followerSlot(c, f.accountId)
      // no terminal here for it, or not ready: the app's engine copies this one
      if (!fs) continue
      // what the follower holds: as its terminal lists it, and what was sent from here a moment ago
      const mine: { symbol: string; side: "long" | "short"; quantity: number; price: number | null }[] = [...[...fs.known.values()].map((x) => ({ symbol: x.symbol, side: x.side, quantity: x.volume, price: x.currentPrice ?? x.openPrice })), ...fs.inflight.map((x) => ({ symbol: x.symbol, side: x.side, quantity: x.volume, price: x.price }))]
      const openPnl = [...fs.known.values()].reduce((sum, x) => sum + (x.profit ?? 0), 0)
      const d = decideEntry({
        rules: g.rules,
        contracts: g.contracts,
        follower: f,
        position,
        quantity: p.volume,
        leaderEquity: leader.equity ?? leader.balance,
        account: { equity: fs.equity ?? fs.balance, dayPnl: f.closedToday + openPnl, openNotional: notionalOf(mine), connected: true, openQuantity: (symbol, side) => mine.filter((x) => x.symbol.toUpperCase() === symbol.toUpperCase() && x.side === side).reduce((sum, x) => sum + x.quantity, 0) },
        propSync: f.propSync,
        minutes: at.minutes,
        weekday: at.weekday,
        now,
      })
      // not copied, for a reason the app's engine will work out the same way and record
      if (!d.decision.allowed) continue
      const since = fs.openedHere.filter((o) => o.at >= plan.at)
      const guard = guardEntry(f.guard, { accountId: f.accountId, symbol: d.symbol, side: p.side, volume: d.decision.finalQuantity, stopLoss: d.stopLoss, takeProfit: d.takeProfit }, { volume: since.reduce((sum, o) => sum + o.volume, 0), positions: since.length })
      if (!guard.allowed) continue
      fs.inflight.push({ ref, symbol: d.symbol, side: p.side, volume: d.decision.finalQuantity, price: d.entry, at: detectedAt })
      fs.openedHere.push({ ref, at: detectedAt, volume: d.decision.finalQuantity })
      send(leader, fs, { ref, userId: plan.userId, accountId: f.accountId, kind: "place", symbol: d.symbol, side: p.side, volume: d.decision.finalQuantity, stopLoss: d.stopLoss, takeProfit: d.takeProfit, ticket: null, guard, report: { groupId: g.id, leaderRef: p.identifier, leaderSymbol: p.symbol, leaderQuantity: p.volume, magic: null, ticket: null, price: null, decision: d.decision, detectedAt, tradeloopMs: 0, brokerMs: null } })
    }
  }
}

function copyClose(leader: Slot, c: Connection, p: Seen, detectedAt: number) {
  const plan = c.copyPlan
  const key = (groupId: number) => `${groupId}:${p.identifier}`
  if (!planIsGood(plan, detectedAt) || plan.userId !== c.userId) return
  for (const g of plan.groups) {
    if (!closeAllowed(g.rules, g.contracts, p, clock(g.timeZone, new Date(detectedAt))).ok) continue
    const here = enteredFor.get(key(g.id)) ?? []
    const mine = here.map((o) => o.ref)
    // The app has to see the position open before it sees it closed, or it
    // never books the orders sent here for it. Keep it listed until it has.
    if (mine.length) leader.held.set(p.identifier, { position: p, until: detectedAt + HOLD_MS, refs: [...new Set([...(leader.held.get(p.identifier)?.refs ?? []), ...mine])] })
    const flying = here.filter((o) => o.ticket == null)
    if (flying.length) {
      // A follower's order for this very position is still at its broker. Its
      // answer first: then there is a ticket to close.
      void Promise.all(flying.map((o) => o.done)).then(() => {
        if (leader.connection?.id === c.id) copyClose(leader, leader.connection, p, detectedAt)
      })
      continue
    }
    const links = [...here.map((o) => ({ accountId: o.accountId, ticket: o.ticket! })), ...g.links.filter((l) => l.leaderRef === p.identifier).map((l) => ({ accountId: l.accountId, ticket: l.positionRef }))]
    const done = new Set<number>()
    for (const l of links) {
      if (done.has(l.accountId)) continue
      done.add(l.accountId)
      const ref = closeRef(g.id, p.identifier, l.accountId)
      if (names.has(ref)) continue
      const fs = followerSlot(c, l.accountId)
      // as the follower's terminal lists it; or, opened here a moment ago and not read yet, as it was sent
      const held = fs?.known.get(l.ticket) ?? here.find((o) => o.accountId === l.accountId && o.ticket === l.ticket)
      // (an order the broker refused left nothing to close, and is no longer in the list)
      if (!fs || !held) continue
      send(leader, fs, { ref, userId: plan.userId, accountId: l.accountId, kind: "close", symbol: held.symbol, side: held.side, volume: held.volume, stopLoss: null, takeProfit: null, ticket: l.ticket, guard: { allowed: true, reasons: [], severity: "ok" }, report: { groupId: g.id, leaderRef: p.identifier, leaderSymbol: p.symbol, leaderQuantity: p.volume, magic: null, ticket: l.ticket, price: null, decision: null, detectedAt, tradeloopMs: 0, brokerMs: null } })
    }
    enteredFor.delete(key(g.id))
  }
}

type Order = { ref: string; userId: string; accountId: number; kind: "place" | "close"; symbol: string; side: "long" | "short"; volume: number; stopLoss: number | null; takeProfit: number | null; ticket: string | null; guard: { allowed: boolean; reasons: string[]; severity: "ok" | "warning" | "block" }; report: LaneReport }
type Sent = { accepted: boolean; retcode: number; comment: string; order: string; deal: string; price: number; volume: number; sendMs: number; totalMs: number }

// Sends one order on a follower's terminal now, and records it beside: the
// row in order_commands under the order's name, started at the same moment.
// Nothing here waits for the database before the order leaves.
function send(leader: Slot, fs: Slot, o: Order) {
  const c = fs.connection!
  names.add(o.ref)
  const magic = randomInt(1, 2 ** 48 - 1)
  const report: LaneReport = { ...o.report, magic }
  const attempt: Attempt = { ref: o.ref, magic, userId: o.userId, accountId: o.accountId, kind: o.kind, symbol: o.symbol, side: o.side, volume: o.volume, ticket: o.ticket, report, at: Date.now() }
  unsettled.set(o.ref, attempt)
  journal({ t: "try", ref: o.ref, attempt })

  const startedAt = Date.now()
  const began = performance.now()
  const order = callBridge<Sent>(fs, "/order", { login: c.login, password: secret(c), server: c.server, kind: o.kind, symbol: o.symbol, side: o.side, volume: o.volume, stopLoss: o.stopLoss, takeProfit: o.takeProfit, positionRef: o.ticket, orderType: o.kind === "place" ? "market" : null, magic, fast: true, wait: 0.5 }, 25_000).then(
    (result) => ({ result, error: null as unknown, took: performance.now() - began }),
    (error) => ({ result: null as Sent | null, error, took: performance.now() - began }),
  )
  const row = db
    .insert(orderCommands)
    .values({ userId: o.userId, accountId: o.accountId, broker: "mt5c", kind: o.kind, status: "sent", positionRef: o.ticket, symbol: o.symbol, side: o.side, volume: String(o.volume), stopLoss: str(o.stopLoss), takeProfit: str(o.takeProfit), orderType: o.kind === "place" ? "market" : null, ruleCheck: o.guard, clientRef: o.ref, lane: report, leaseUntil: new Date(Date.now() + 3_600_000) })
    .onConflictDoNothing()
    .returning({ id: orderCommands.id })
    .then((rows) => rows[0]?.id ?? null)

  // an entry is known for its leader's position from now, so a close that comes before the broker's answer waits for it
  const key = `${o.report.groupId}:${o.report.leaderRef}`
  const entered: Entered | null = o.kind === "place" ? { accountId: o.accountId, ref: o.ref, ticket: null, symbol: o.symbol, side: o.side, volume: o.volume, done: Promise.resolve() } : null
  if (entered) enteredFor.set(key, [...(enteredFor.get(key) ?? []), entered])
  const forget = () => {
    if (!entered) return
    const left = (enteredFor.get(key) ?? []).filter((x) => x !== entered)
    if (left.length) enteredFor.set(key, left)
    else enteredFor.delete(key)
  }
  const finished = (async () => {
    const [{ result, error, took }, id] = await Promise.all([order, row.catch(() => null)])
    if (id) {
      attempt.rowId = id
      journal({ t: "row", ref: o.ref, id })
    } else console.error(`[lane] ${fs.slot}: no row for ${o.ref}: the app already had an order under this name`)
    const where = id ? and(eq(orderCommands.id, id), eq(orderCommands.status, "sent")) : undefined
    const close = () => {
      unsettled.delete(o.ref)
      journal({ t: "done", ref: o.ref })
    }
    if (result) {
      // from seeing the leader's trade to the broker's answer, less the broker's own round trip: that part is ours
      const lane = { ticket: o.kind === "place" ? (result.accepted ? result.order : null) : o.ticket, price: result.price || null, brokerMs: result.sendMs, tradeloopMs: Math.max(0, Math.round((startedAt - o.report.detectedAt + took - result.sendMs) * 10) / 10) }
      const ref = result.deal && result.deal !== "0" ? result.deal : result.order
      if (where) await db.update(orderCommands).set(result.accepted ? { status: "filled", resultMessage: "Order executed.", brokerRef: ref, brokerResult: result, lane: merged(lane), leaseUntil: null, updatedAt: new Date() } : { status: "rejected", resultMessage: `Broker rejected the order (retcode ${result.retcode}: ${result.comment || "no reason given"}).`, brokerRef: ref, brokerResult: result, lane: merged(lane), leaseUntil: null, updatedAt: new Date() }).where(where)
      if (entered && result.accepted) entered.ticket = result.order
      // refused: it adds nothing to what the account holds
      if (!result.accepted) {
        fs.openedHere = fs.openedHere.filter((x) => x.ref !== o.ref)
        forget()
      }
      console.log(`[lane] ${fs.slot}: ${o.kind} ${o.volume} ${o.symbol} on ${c.login} ${result.accepted ? "filled" : `rejected (${result.comment})`}: TradeLoop ${lane.tradeloopMs}ms + broker ${result.sendMs}ms`)
      close()
      return
    }
    // No answer from the bridge. Whether the order reached the broker is read
    // off the account itself: a position with this order's number, or the
    // ticket that was to be closed no longer there.
    console.warn(`[lane] ${fs.slot}: ${o.kind} ${o.symbol} on ${c.login} failed: ${error instanceof Error ? error.message : error}`)
    fs.openedHere = fs.openedHere.filter((x) => x.ref !== o.ref)
    forget()
    const before = fs.readAt
    await read(fs, "/positions")
    // settled from that reading; or, if the account couldn't be read, from the next one that can
    // (the app gives the order up as lost after two minutes without one)
    attempt.settle = true
    if (fs.readAt !== before) await settle(fs)
  })().catch((err) => {
    console.error(`[lane] ${fs.slot}: recording ${o.ref} failed:`, err instanceof Error ? err.message : err)
    // with no ticket to its name it can't be closed from here: the app's engine does that
    if (entered && entered.ticket == null) forget()
  })
  if (entered) entered.done = finished

  // The leader's position is published only after this order's row is written,
  // and after the broker's answer when that comes promptly: an order that
  // failed has taken its row back by then, and the app copies the trade itself.
  leader.reported = Promise.all([leader.reported, row.catch(() => null), Promise.race([finished, sleep(2_000)])])
  // then: read the follower, so the app sees its new position; and tell the engine
  void finished.then(async () => {
    await read(fs, "/positions")
    fs.inflight = fs.inflight.filter((x) => x.ref !== o.ref)
    void tick()
  })
}

// A leader's closed position is let go of once the app has booked the orders sent for it.
async function releaseHeld() {
  for (const s of slots) {
    if (!s.held.size || !s.connection) continue
    let released = false
    for (const [ticket, h] of s.held) {
      const open = Date.now() < h.until && h.refs.length ? await db.select({ id: orderCommands.id }).from(orderCommands).where(and(inArray(orderCommands.clientRef, h.refs), sql`(${orderCommands.lane}->>'booked') is null`)) : []
      if (open.length) continue
      s.held.delete(ticket)
      released = true
    }
    if (released) publish(s, s.connection, true, true)
  }
}

// --- the regular path: orders the app's engine queued for a terminal here ---
type Command = typeof orderCommands.$inferSelect
async function finish(id: number, set: Partial<Command>) {
  await db.update(orderCommands).set({ ...set, leaseUntil: null, updatedAt: new Date() }).where(eq(orderCommands.id, id))
}

async function execute(s: Slot, cmd: Command) {
  const c = s.connection
  // the account lost its terminal between the order being taken and its turn: the sync worker sends it
  if (!c || c.accountId !== cmd.accountId || !trades(c)) return finish(cmd.id, { broker: "mt5" })
  const startedAt = Date.now()
  try {
    const result = await callBridge<Sent>(s, "/order", { login: c.login, password: secret(c), server: c.server, kind: cmd.kind, positionRef: cmd.positionRef, orderRef: cmd.orderRef, symbol: cmd.symbol, side: cmd.side, volume: num(cmd.volume), price: num(cmd.price), stopLoss: num(cmd.stopLoss), takeProfit: num(cmd.takeProfit), orderType: cmd.orderType, fast: true }, 25_000)
    const ref = result.deal && result.deal !== "0" ? result.deal : result.order
    if (result.accepted) await finish(cmd.id, { status: "filled", resultMessage: "Order executed.", brokerRef: ref, brokerResult: result })
    else await finish(cmd.id, { status: "rejected", resultMessage: `Broker rejected the order (retcode ${result.retcode}: ${result.comment || "no reason given"}).`, brokerRef: ref, brokerResult: result })
    console.log(`[lane] ${s.slot}: order ${cmd.id} (${cmd.kind} ${c.login}) ${result.accepted ? "filled" : `rejected — ${result.comment}`} in ${Date.now() - startedAt}ms (broker ${result.sendMs}ms)`)
  } catch (err) {
    const attempts = cmd.attempts + 1
    const giveUp = attempts >= 3
    await finish(cmd.id, { status: giveUp ? "failed" : "pending", resultMessage: err instanceof Error ? err.message : String(err), attempts })
    console.warn(`[lane] ${s.slot}: order ${cmd.id} attempt ${attempts} failed${giveUp ? " (giving up)" : ""}: ${err instanceof Error ? err.message : err}`)
  }
}

let ordering = false
async function orders() {
  if (ordering) return
  ordering = true
  try {
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
    const byAccount = new Map<number, Command[]>()
    for (const cmd of rows) byAccount.set(cmd.accountId, [...(byAccount.get(cmd.accountId) ?? []), cmd])
    for (const [accountId, list] of byAccount) {
      const s = slots.find((x) => x.connection?.accountId === accountId && trades(x.connection))
      if (!s) {
        for (const cmd of list) await finish(cmd.id, { broker: "mt5" })
        continue
      }
      // in the order they were queued on that terminal; then read the account, and tell the engine
      void (async () => {
        for (const cmd of list) await execute(s, cmd)
        await read(s, "/positions")
        void tick()
      })().catch((err) => console.error(`[lane] ${s.slot}: orders failed:`, err instanceof Error ? err.message : err))
    }
  } finally {
    ordering = false
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

// One terminal's own loop: a leader is watched without a pause, a follower read every few seconds.
async function loop(s: Slot) {
  for (;;) {
    const c = s.connection
    if (!c || Date.now() < s.pauseUntil) {
      await sleep(100)
      continue
    }
    try {
      if (leads(c)) await read(s, "/watch")
      else {
        const wait = s.first ? 0 : FOLLOWER_POLL_MS - (Date.now() - s.readAt)
        if (wait > 0) await sleep(Math.min(wait, 250))
        if (s.first || Date.now() - s.readAt >= FOLLOWER_POLL_MS) await read(s, "/positions")
      }
    } catch (err) {
      console.error(`[lane] ${s.slot} loop failed:`, err instanceof Error ? err.message : err)
      await sleep(1_000)
    }
  }
}

// The first run of anything is slow (the time-zone tables, the random source,
// the sizing code not yet compiled): tens of milliseconds, once. That once is
// spent here at start-up, not on a trader's first copy.
function warm() {
  const position: LivePosition = { key: "0", symbol: "EURUSD", side: "long", quantity: 1, entry: 1.1, stopLoss: 1.09, takeProfit: null, price: 1.1 }
  const rules = { ...DEFAULT_RULES, symbolScope: "all" as const }
  for (let i = 0; i < 200; i++) {
    const at = clock(i % 2 ? "UTC" : "Africa/Cairo", new Date())
    const d = decideEntry({ rules, contracts: [], follower: { config: DEFAULT_FOLLOWER, mappings: [], symbols: ["EURUSDm"] }, position, quantity: 1, leaderEquity: 10_000, account: { equity: 10_000, dayPnl: 0, openNotional: notionalOf([{ symbol: "EURUSD", quantity: 1, price: 1.1 }]), connected: true, openQuantity: () => 0 }, propSync: NO_PROPSYNC, minutes: at.minutes, weekday: at.weekday, now: new Date() })
    guardEntry(null, { accountId: 0, symbol: d.symbol, side: "long", volume: d.decision.finalQuantity, stopLoss: d.stopLoss, takeProfit: d.takeProfit }, { volume: 0, positions: 0 })
    closeAllowed(rules, [], position, at)
    JSON.stringify({ ref: entryRef(0, "0", 0) + closeRef(0, "0", 0), magic: randomInt(1, 2 ** 48 - 1), d })
  }
  journal({ t: "start", at: Date.now() })
}

async function main() {
  console.log(`[lane] starting with ${slots.length} terminal(s): ${slots.map((s) => s.slot).join(", ")}`)
  warm()
  // first of all: whatever was in the air when the lane last stopped gets its row
  await recover()
  await assign().catch((err) => console.error("[lane] assign failed:", err instanceof Error ? err.message : err))
  every(ASSIGN_MS, "assign", assign)
  every(ORDER_TICK_MS, "orders", orders)
  every(500, "held", releaseHeld)
  for (const s of slots) void loop(s)
}

// on the way out, say nobody has a terminal: the app then stops sending orders here at once
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    db.update(metatraderConnections).set({ copySlot: null }).where(isNotNull(metatraderConnections.copySlot)).then(
      () => process.exit(0),
      () => process.exit(0),
    )
  })

main().catch((err) => {
  console.error("[lane] could not start:", err instanceof Error ? err.message : err)
  process.exit(1)
})
