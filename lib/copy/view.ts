import type { ContractSpec } from "./contracts"
import type { CopyRules, FollowerConfig, Health, PropSyncState, Side, Step } from "./engine"

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
  // whether TradeLoop can place orders on it (live mode needs this)
  canExecute: boolean
  executionNote: string
  dayPnl: number
  openPnl: number | null
  openNotional: number
  propSync: PropSyncState
}

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
  latencyMs: number | null
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
  // false when the live positions couldn't be read this time
  liveData: boolean
  at: string
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
export const price = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 5 : 2 }))
export const ago = (iso: string | null, now = Date.now()) => {
  if (!iso) return "never"
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s} sec ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86_400)} d ago`
}

// One leader order with the follower orders made from it.
export type Copy = { masterOrderId: string; groupId: number; action: string; symbol: string; side: Side; leaderQuantity: number | null; at: string; orders: OrderView[]; filled: number; total: number; simulated: boolean }
export function groupCopies(orders: OrderView[]): Copy[] {
  const map = new Map<string, Copy>()
  for (const o of orders) {
    const c = map.get(o.masterOrderId) ?? { masterOrderId: o.masterOrderId, groupId: o.groupId, action: o.action, symbol: o.leaderSymbol, side: o.side, leaderQuantity: o.leaderQuantity, at: o.createdAt, orders: [], filled: 0, total: 0, simulated: o.simulated }
    c.orders.push(o)
    c.total++
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
