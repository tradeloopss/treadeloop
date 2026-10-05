import { guardOrder } from "@/lib/order-execution/guard"
import type { GuardDecision } from "@/lib/order-execution/types"
import type { AccountEvaluation } from "@/lib/propmax/engine"
import { pointValueAt, resolveFollowerSymbol, specFor, type ContractSpec } from "./contracts"
import { calculateFollowerOrder, translatePrice, validateCopyRules, type CopyRules, type Decision, type FollowerConfig, type LivePosition, type PropSyncState, type Side } from "./engine"

// Copying a trade the instant it happens.
//
// The app's copy engine runs on the web servers: by the time it has been told
// of a leader's trade, has read the trader's setup and has queued an order,
// most of a second is gone. So for accounts that sit on the sync server's copy
// lane, the app hands the lane a PLAN ahead of time: everything it needs to
// work out a follower's order by itself, with the very functions the app uses
// (calculateFollowerOrder, the copy rules, the prop-rule guard). When the
// leader trades, the lane sizes and sends the followers' orders there and
// then, and tells the app afterwards.
//
// Nothing is decided twice. Every order the lane sends carries a reference
// (entryRef / closeRef) that is unique in order_commands; the app's engine
// looks that reference up before it queues the same order, and takes the
// lane's as its own.
//
// Pure: no database, no clock of its own. The app writes the plan
// (lib/copy/server.ts), the lane reads it (worker/mt5/copy-lane.ts), and both
// call decideEntry.

// How long a plan is good for. The engine rewrites it on every pass (every few
// seconds); a lane holding one older than this copies nothing by itself.
export const PLAN_TTL_MS = 20_000

export const entryRef = (groupId: number, leaderRef: string, accountId: number) => `e:${groupId}:${leaderRef}:${accountId}`
export const closeRef = (groupId: number, leaderRef: string, accountId: number) => `c:${groupId}:${leaderRef}:${accountId}`

// The part of PropSync's evaluation the order guard reads, and nothing else of it.
export type GuardRule = Pick<AccountEvaluation["rules"][number], "type" | "name" | "status" | "severity" | "currentValue" | "limitValue">
export type GuardView = { risk: { status: string }; rules: GuardRule[] }
export const guardView = (e: AccountEvaluation | null): GuardView | null => (e ? { risk: { status: e.risk.status }, rules: e.rules.map((r) => ({ type: r.type, name: r.name, status: r.status, severity: r.severity, currentValue: r.currentValue, limitValue: r.limitValue })) } : null)

export type PlanFollower = {
  accountId: number
  name: string
  config: FollowerConfig
  mappings: { leaderSymbol: string; followerSymbol: string }[]
  // the names this account's broker is known to use, for telling XAUUSD from XAUUSDm
  symbols: string[]
  // today's closed result; the lane adds what is open now
  closedToday: number
  // already switched for the group's "respect PropSync" setting
  propSync: PropSyncState
  guard: GuardView | null
}
export type PlanLink = { leaderRef: string; accountId: number; positionRef: string }
export type PlanGroup = {
  id: number
  timeZone: string
  rules: CopyRules
  contracts: ContractSpec[]
  followers: PlanFollower[]
  // followers' positions the app already holds for the leader's open ones
  links: PlanLink[]
}
export type LanePlan = { v: 1; userId: string; at: number; until: number; groups: PlanGroup[] }

// What the lane says about an order it sent by itself (order_commands.lane).
export type LaneReport = {
  groupId: number
  leaderRef: string
  leaderSymbol: string
  leaderQuantity: number
  // the number the order carried to the broker; the follower's position keeps it
  magic: number | null
  // the follower's ticket this order opened, or closed
  ticket: string | null
  price: number | null
  decision: Decision | null
  // when the lane saw the leader's trade; from then to the order leaving
  // (TradeLoop's part); and the broker's round trip, as the terminal timed it
  detectedAt: number
  tradeloopMs: number
  brokerMs: number | null
  // set by the app once the order is in its books (the lane waits for it
  // before it lets the app see that the leader's position has closed)
  booked?: boolean
}

export const planIsGood =(plan: LanePlan | null | undefined, now: number): plan is LanePlan => !!plan && plan.v === 1 && now < plan.until && Array.isArray(plan.groups)

// The hour and weekday in the trader's time zone: the copy rules' trading hours.
export function clock(timeZone: string, now: Date): { minutes: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0"
  return { minutes: Number(get("hour")) * 60 + Number(get("minute")), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")) }
}

export const specOf = (contracts: ContractSpec[], symbol: string) => contracts.find((c) => c.symbol === symbol.toUpperCase()) ?? specFor(symbol)

// The dollar value of what an account holds open, as the risk limits count it.
export function notionalOf(positions: { symbol: string; quantity: number; price: number | null }[]): number {
  return positions.reduce((sum, x) => {
    const point = pointValueAt(specFor(x.symbol), x.price)
    return point != null && x.price != null ? sum + x.quantity * x.price * point : sum
  }, 0)
}

export type EntryInput = {
  rules: CopyRules
  contracts: ContractSpec[]
  follower: Pick<PlanFollower, "config" | "mappings" | "symbols">
  // the leader's position, and how much of it this order is for
  position: LivePosition
  quantity: number
  leaderEquity: number | null
  // the follower's account as it stands; openQuantity is asked for once its own symbol is known
  account: { equity: number | null; dayPnl: number; openNotional: number; connected: boolean; openQuantity: (symbol: string, side: Side) => number }
  propSync: PropSyncState
  minutes: number
  weekday: number
  now: Date
}
export type EntryDecision = { symbol: string; spec: ContractSpec; decision: Decision; entry: number | null; stopLoss: number | null; takeProfit: number | null }

// One follower's order for one new position of the leader: which symbol, how
// much, with which stop and target, or why not. The engine and the lane both
// decide with this.
export function decideEntry(input: EntryInput): EntryDecision {
  const p = input.position
  // the follower's own broker's name for the instrument
  const symbol = resolveFollowerSymbol(p.symbol, input.follower.mappings, input.follower.symbols).symbol
  const spec = specOf(input.contracts, symbol)
  const entry = p.price ?? p.entry
  const decision = calculateFollowerOrder({
    order: { symbol: p.symbol, side: p.side, quantity: input.quantity, orderType: "market", entry, stopLoss: p.stopLoss, takeProfit: p.takeProfit },
    spec,
    config: input.follower.config,
    leaderEquity: input.leaderEquity,
    account: { equity: input.account.equity, dayPnl: input.account.dayPnl, openNotional: input.account.openNotional, openQuantity: input.account.openQuantity(symbol, p.side), connected: input.account.connected },
    propSync: input.propSync,
    rules: { rules: input.rules, imported: input.contracts.map((c) => c.symbol), minutes: input.minutes, weekday: input.weekday },
    now: input.now,
  })
  const stopLoss = input.rules.stopLoss ? translatePrice({ leaderPrice: p.stopLoss, leaderEntry: p.entry, followerEntry: entry, leaderSymbol: p.symbol, followerSymbol: symbol }) : null
  const takeProfit = input.rules.takeProfit ? translatePrice({ leaderPrice: p.takeProfit, leaderEntry: p.entry, followerEntry: entry, leaderSymbol: p.symbol, followerSymbol: symbol }) : null
  return { symbol, spec, decision, entry, stopLoss, takeProfit }
}

// Whether the group's rules let a leader's close through to the followers.
export function closeAllowed(rules: CopyRules, contracts: ContractSpec[], position: Pick<LivePosition, "side" | "symbol">, at: { minutes: number; weekday: number }): { ok: boolean; reason: string } {
  return validateCopyRules(rules, "close", { side: position.side, orderType: "market", symbol: position.symbol }, { imported: contracts.map((c) => c.symbol), minutes: at.minutes, weekday: at.weekday })
}

// The prop-rule guard for an order the lane is about to open, with what the
// lane itself has opened on the account since the plan was written counted in
// (PropSync's own figures are a few seconds old by then).
export function guardEntry(guard: GuardView | null, order: { accountId: number; symbol: string; side: Side; volume: number; stopLoss: number | null; takeProfit: number | null }, since: { volume: number; positions: number }): GuardDecision {
  const evaluation = guard
    ? {
        ...guard,
        rules: guard.rules.map((r) => (r.currentValue == null ? r : r.type === "max_contracts" ? { ...r, currentValue: r.currentValue + since.volume } : r.type === "max_open_positions" ? { ...r, currentValue: r.currentValue + since.positions } : r)),
      }
    : null
  return guardOrder({ accountId: order.accountId, broker: "mt5", kind: "place", symbol: order.symbol, side: order.side, volume: order.volume, stopLoss: order.stopLoss, takeProfit: order.takeProfit, positionRef: null, orderType: "market" }, evaluation as AccountEvaluation | null)
}
