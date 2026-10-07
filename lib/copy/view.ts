import { resolveFollowerSymbol, sameInstrument, type ContractSpec } from "./contracts"
import type { CopyRules, FollowerConfig, Health, PropSyncState, Side, Step } from "./engine"
import type { ProviderProfile } from "@/lib/compliance/engine"

// What the Copy Trading pages are drawn from: everything the server knows
// about a trader's copy setup, in a form that can be sent to the browser
// (plain numbers and ISO dates — never a credential).

export type Role = "leader" | "follower" | "both" | "unassigned"
export const ROLE_LABELS: Record<Role, string> = { leader: "Leader", follower: "Follower", both: "Both", unassigned: "Unassigned" }
export type GroupStatus = "draft" | "active" | "paused"

export type AccountView = {
  id: number
  name: string
  broker: string | null
  // MetaTrader 5, Rithmic… ("Manual" when no connection is linked)
  platform: string
  login: string | null
  currency: string
  balance: number | null
  equity: number | null
  openPositions: number
  linked: boolean
  health: Health
  healthNote: string | null
  lastSyncAt: string | null
  // from the last connection test; null when none has been run
  latencyMs: number | null
  heartbeatAt: string | null
  preferredRole: Role
  // what the account is used as across the groups it is in
  role: Role
  groups: { id: number; name: string; as: "leader" | "follower" }[]
  // the provider whose rules apply to it (lib/compliance), by key; null when none has rules of its own
  provider: string | null
  // how TradeLoop reaches the account, and what it logs in with: said as it is
  connectedBy: string
  authentication: string | null
  // whether TradeLoop can place orders on it (live mode needs this)
  canExecute: boolean
  executionNote: string
  dayPnl: number
  openPnl: number | null
  openNotional: number
  propSync: PropSyncState
  // the symbols this account has traded, as its own broker spells them
  symbols: string[]
  // fast: the sync server keeps a terminal open for this account, so it is read every second and trades at once
  lane: "fast" | "standard"
  // the round trip from the sync server to this account's broker, as its terminal measures it
  pingMs: number | null
}

// A follower (or the Leader itself) the provider's rules don't allow in this group: lib/compliance.
export type ComplianceProblem = { accountId: number; provider: string; reasonCode: string; message: string }
export type FollowerView = { id: number; accountId: number; config: FollowerConfig; mappings: { leaderSymbol: string; followerSymbol: string }[] }
export type GroupLimits = { defaultMode: string; defaultRatio: number; globalRiskPct: number; respectPropSync: boolean }
export type GroupView = {
  id: number
  name: string
  status: GroupStatus
  leaderAccountId: number
  followers: FollowerView[]
  contracts: ContractSpec[]
  rules: CopyRules
  limits: GroupLimits
  // what the providers' rules have against this group as it is set up; empty when nothing
  compliance: ComplianceProblem[]
  createdAt: string
}

export type PositionView = { accountId: number; symbol: string; side: Side; quantity: number; entry: number | null; current: number | null; openPnl: number | null; stopLoss: number | null; takeProfit: number | null; simulated: boolean; groupId: number | null }

export type OrderView = {
  id: number
  groupId: number
  correlationId: string
  masterOrderId: string
  masterAccountId: number
  followerAccountId: number
  action: string
  symbol: string
  leaderSymbol: string
  side: Side
  quantity: number
  leaderQuantity: number | null
  requestedPrice: number | null
  executionPrice: number | null
  status: string
  reason: string | null
  slippage: number | null
  // from the leader's trade being seen to the broker's answer; and TradeLoop's
  // own share of it, when the copy lane sent the order itself and timed it
  latencyMs: number | null
  tradeloopMs: number | null
  simulated: boolean
  createdAt: string
  steps: Step[]
}

export type EventView = { id: number; groupId: number | null; accountId: number | null; level: "info" | "success" | "warning" | "error"; code: string; title: string; body: string | null; action: string | null; masterOrderId: string | null; createdAt: string; unread: boolean }

export type CopyState = {
  // simulation: the engine works everything out and records it, and sends nothing to a broker
  mode: "simulation" | "live"
  accounts: AccountView[]
  groups: GroupView[]
  positions: PositionView[]
  orders: OrderView[]
  events: EventView[]
  // the providers that have rules of their own, as the trader is shown them
  providers: ProviderProfile[]
  // false when the live positions couldn't be read this time
  liveData: boolean
  // the background engine: whether it is switched on, and when it last ran
  engine: { background: boolean; lastRunAt: string | null; ok: boolean }
  at: string
}

// An order's latency in words. When the copy lane sent the order itself it timed
// both halves: its own (seeing the leader's trade, sizing, handing the order
// over) and the broker's round trip, which no software on our side can shorten.
export function latencyParts(o: Pick<OrderView, "latencyMs" | "tradeloopMs">): { total: string; split: string | null } | null {
  if (o.latencyMs == null) return null
  if (o.tradeloopMs == null) return { total: `${o.latencyMs}ms`, split: null }
  return { total: `${o.latencyMs}ms`, split: `TradeLoop ${o.tradeloopMs}ms + broker ${Math.max(0, o.latencyMs - o.tradeloopMs)}ms` }
}

export const ACTION_LABELS: Record<string, string> = { open: "Entry", increase: "Add", partial_close: "Partial close", close: "Close", modify_sl: "Stop loss", trailing_stop: "Trailing stop", modify_tp: "Take profit", cancel: "Cancel" }
export const ORDER_STATUS: Record<string, { label: string; tone: "good" | "ok" | "warn" | "bad" | "none" }> = {
  filled: { label: "Filled", tone: "good" },
  pending: { label: "Pending", tone: "ok" },
  sent: { label: "Sent", tone: "ok" },
  partial: { label: "Partial", tone: "warn" },
  blocked: { label: "Blocked", tone: "warn" },
  skipped: { label: "Skipped", tone: "none" },
  cancelled: { label: "Cancelled", tone: "none" },
  rejected: { label: "Rejected", tone: "bad" },
  failed: { label: "Failed", tone: "bad" },
  unsupported: { label: "Not supported", tone: "bad" },
}
export const isFilled = (status: string) => status === "filled"
export const isFailure = (status: string) => status === "rejected" || status === "failed" || status === "blocked" || status === "unsupported" || status === "partial"

export const money = (v: number | null | undefined, signed = false) => {
  if (v == null || !Number.isFinite(v)) return "—"
  const text = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${v < 0 ? "−" : signed ? "+" : ""}$${text}`
}
// a price as a terminal shows it: two decimals for an index or a metal, up to five for a currency pair
export const price = (v: number | null | undefined) => (v == null ? "—" : Math.abs(v) < 10 ? v.toLocaleString("en-US", { maximumFractionDigits: 5 }) : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
export const ago = (iso: string | null, now = Date.now()) => {
  if (!iso) return "never"
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s} sec ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86_400)} d ago`
}

// ------------------------------------------------------------------ what a group holds
//
// Flatten closes positions, so what it covers is decided in one place, here,
// and the page and the server both ask it: what the trader sees counted is
// what gets closed, and nothing else. Two scopes:
//   groupScope   everything the group's accounts hold, in any symbol, the
//                Leader's included — what Flatten All closes
//   symbolScope  what they hold of one contract — what the Cockpit's table
//                shows, and what a row's Flatten (or "this contract only") closes

export type AccountScope = { accountId: number; leader: boolean; follower: FollowerView | null; positions: PositionView[] }
export type ScopeRow = AccountScope & {
  // the contract as this account's own broker names it (a follower may be mapped: NQ -> MNQ, XAUUSD.m -> XAUUSDm)
  symbol: string
  via: "mapping" | "auto" | "same"
}

// a live position is the account's, whoever opened it; a simulated one exists only inside its group
const heldBy = (group: GroupView, positions: PositionView[], accountId: number) => positions.filter((p) => p.accountId === accountId && (p.simulated ? p.groupId === group.id : true))

export function groupScope(group: GroupView, positions: PositionView[]): AccountScope[] {
  return [{ accountId: group.leaderAccountId, leader: true, follower: null, positions: heldBy(group, positions, group.leaderAccountId) }, ...group.followers.map((f) => ({ accountId: f.accountId, leader: false, follower: f, positions: heldBy(group, positions, f.accountId) }))]
}

// "XAUUSD.m x3, US100.std x3": what a set of positions is made of
export function symbolCounts(positions: PositionView[]): string {
  const counts = new Map<string, number>()
  for (const p of positions) counts.set(p.symbol, (counts.get(p.symbol) ?? 0) + 1)
  return [...counts].map(([symbol, n]) => (n > 1 ? `${symbol} ×${n}` : symbol)).join(", ")
}

export function symbolScope(group: GroupView, accounts: AccountView[], positions: PositionView[], contract: string): ScopeRow[] {
  const known = new Map(accounts.map((a) => [a.id, a.symbols]))
  const row = (accountId: number, follower: FollowerView | null): ScopeRow => {
    const own = follower ? resolveFollowerSymbol(contract, follower.mappings, known.get(accountId) ?? []) : { symbol: contract, via: "same" as const }
    return {
      accountId,
      leader: !follower,
      follower,
      symbol: own.symbol,
      via: own.via,
      positions: heldBy(group, positions, accountId).filter((p) => sameInstrument(p.symbol, own.symbol)),
    }
  }
  return [row(group.leaderAccountId, null), ...group.followers.map((f) => row(f.accountId, f))]
}

// What an account holds of one symbol, as one line: long and short tickets net out.
export function netPosition(positions: PositionView[]): { side: Side | null; quantity: number; avgPrice: number | null; current: number | null; openPnl: number | null; tickets: number; simulated: boolean } {
  const signed = positions.reduce((s, p) => s + (p.side === "long" ? p.quantity : -p.quantity), 0)
  const net = Math.round(Math.abs(signed) * 1e8) / 1e8
  const side: Side | null = net === 0 ? (positions.length ? positions[0].side : null) : signed > 0 ? "long" : "short"
  const mine = positions.filter((p) => p.side === side && p.entry != null)
  const volume = mine.reduce((s, p) => s + p.quantity, 0)
  const pnl = positions.filter((p) => p.openPnl != null)
  return {
    side: positions.length ? side : null,
    quantity: positions.length && net === 0 ? positions.reduce((s, p) => s + p.quantity, 0) : net,
    avgPrice: volume > 0 ? mine.reduce((s, p) => s + p.entry! * p.quantity, 0) / volume : null,
    current: positions.find((p) => p.current != null)?.current ?? null,
    openPnl: pnl.length ? pnl.reduce((s, p) => s + p.openPnl!, 0) : null,
    tickets: positions.length,
    simulated: positions.length > 0 && positions.every((p) => p.simulated),
  }
}

// What an account is doing in Copy Trading right now, in a word.
export function copyStatus(account: AccountView, groups: GroupView[]): { label: string; tone: "good" | "warn" | "bad" | "none" } {
  const online = account.health === "connected" || account.health === "syncing" || account.health === "warning"
  const mine = groups.filter((g) => g.leaderAccountId === account.id || g.followers.some((f) => f.accountId === account.id))
  if (!mine.length) return { label: "Not copying", tone: "none" }
  const live = mine.filter((g) => g.status === "active" && (g.leaderAccountId === account.id || g.followers.some((f) => f.accountId === account.id && f.config.enabled)))
  if (!live.length) return { label: "Paused", tone: "warn" }
  if (!online) return { label: "Offline", tone: "bad" }
  return live.some((g) => g.leaderAccountId !== account.id) ? { label: "Copying", tone: "good" } : { label: "Leading", tone: "good" }
}

// How a group's followers are sized, in a word: "1x" when they all are, otherwise that they differ.
export function sizingSummary(group: GroupView): string {
  const times = (n: number) => `${Number.isInteger(n) ? n.toFixed(1) : String(Math.round(n * 100) / 100)}x`
  const each = group.followers.map((f) => {
    const c = f.config
    return c.sizingMode === "same" ? times(1) : c.sizingMode === "percentage" ? times((c.percentage ?? 100) / 100) : c.sizingMode === "multiplier" ? times(c.multiplier ?? 1) : c.sizingMode === "risk" ? `${c.riskPercentage ?? 1}% risk` : c.sizingMode === "fixed" ? `Fixed ${c.fixedQuantity ?? 1}` : "By size"
  })
  const kinds = [...new Set(each)]
  return kinds.length === 0 ? "No followers" : kinds.length === 1 ? kinds[0] : "Per account"
}

// The contracts a group's Cockpit has a tab for: the ones it imported, and
// anything else the Leader holds right now (a group that copies all symbols).
export function cockpitContracts(group: GroupView, positions: PositionView[]): { symbol: string; imported: boolean }[] {
  const tabs = group.contracts.map((c) => ({ symbol: c.symbol, imported: true }))
  for (const p of positions) if (p.accountId === group.leaderAccountId && !p.simulated && !tabs.some((t) => sameInstrument(t.symbol, p.symbol))) tabs.push({ symbol: p.symbol, imported: false })
  return tabs
}

// The order history's tabs: every status is in exactly one.
export type OrderBucket = "open" | "filled" | "canceled" | "failed"
export const ORDER_BUCKETS: { key: OrderBucket; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "filled", label: "Filled" },
  { key: "canceled", label: "Canceled" },
  { key: "failed", label: "Failed" },
]
export const orderBucket = (status: string): OrderBucket => (status === "filled" ? "filled" : status === "pending" || status === "sent" ? "open" : status === "cancelled" || status === "skipped" ? "canceled" : "failed")
// Which way the order itself trades: an entry goes with the position, and
// everything that takes it off (a close, its stop, its target) goes against it.
export const orderSide = (o: Pick<OrderView, "action" | "side">): "buy" | "sell" => ((o.action === "open" || o.action === "increase") === (o.side === "long") ? "buy" : "sell")
export const ORDER_TYPES: Record<string, string> = { open: "Market", increase: "Market", partial_close: "Market", close: "Market", modify_sl: "Stop loss", trailing_stop: "Trailing stop", modify_tp: "Take profit", cancel: "Cancel" }

// One leader order with the follower orders made from it.
export type Copy = { masterOrderId: string; groupId: number; action: string; symbol: string; side: Side; leaderQuantity: number | null; at: string; orders: OrderView[]; filled: number; total: number; simulated: boolean }
export function groupCopies(orders: OrderView[]): Copy[] {
  const map = new Map<string, Copy>()
  for (const o of orders) {
    const c = map.get(o.masterOrderId) ?? { masterOrderId: o.masterOrderId, groupId: o.groupId, action: o.action, symbol: o.leaderSymbol, side: o.side, leaderQuantity: o.leaderQuantity, at: o.createdAt, orders: [], filled: 0, total: 0, simulated: o.simulated }
    c.orders.push(o)
    // a follower that is switched off was never asked: it is listed, and not counted
    if (o.status !== "skipped") c.total++
    if (isFilled(o.status)) c.filled++
    map.set(o.masterOrderId, c)
  }
  return [...map.values()].sort((a, b) => b.at.localeCompare(a.at))
}

// Copies today and the share that went through, for a set of orders.
export function copyStats(orders: OrderView[], today: string, dayOf: (iso: string) => string) {
  const done = orders.filter((o) => o.status !== "pending" && o.status !== "sent" && o.status !== "skipped" && o.status !== "cancelled")
  const filled = done.filter((o) => isFilled(o.status)).length
  const todays = orders.filter((o) => dayOf(o.createdAt) === today)
  return { total: done.length, filled, successRate: done.length ? filled / done.length : null, today: todays.length, todayFilled: todays.filter((o) => isFilled(o.status)).length }
}
