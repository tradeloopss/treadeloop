import { payoutInFlight } from "../payout-engine"

// The Wallet's rules (pure — no database): how ledger rows are grouped under
// the Transaction History filters, what each row is called, and the balance
// history behind the Total Balance card. The Wallet tracks money; asking for
// it is the Payout page's job.

// --- Filters -------------------------------------------------------------------------

// `types` = the ledger row types under the filter. Fees have none: a payout fee
// isn't a ledger row of its own, it is part of the payout it was taken from, so
// that list is built from the payouts.
export const TX_FILTERS = [
  { key: "all", label: "All", types: null },
  { key: "earnings", label: "Earnings", types: ["subscription"] },
  { key: "payouts", label: "Payouts", types: ["payout"] },
  { key: "bonuses", label: "Bonuses", types: ["bonus"] },
  { key: "adjustments", label: "Adjustments", types: ["adjustment", "refund", "reversal"] },
  { key: "fees", label: "Fees", types: null },
] as const
export type TxFilterKey = (typeof TX_FILTERS)[number]["key"]
export const txFilter = (key: string | null | undefined) => TX_FILTERS.find((f) => f.key === key) ?? TX_FILTERS[0]

// The filter a ledger row sits under (besides "All").
export function txGroup(type: string): Exclude<TxFilterKey, "all"> {
  if (type === "subscription") return "earnings"
  if (type === "payout") return "payouts"
  if (type === "bonus") return "bonuses"
  if (type === "fee") return "fees"
  return "adjustments"
}

export const TX_LABELS: Record<string, string> = { subscription: "Commission", bonus: "Bonus", adjustment: "Adjustment", refund: "Refund", reversal: "Reversal", payout: "Payout", fee: "Payout fee" }
export const txLabel = (type: string) => TX_LABELS[type] ?? type.replace(/_/g, " ")

// How many rows each filter holds, from a count per ledger type.
export function txCounts(byType: Record<string, number>, fees: number): Record<TxFilterKey, number> {
  const out: Record<TxFilterKey, number> = { all: 0, earnings: 0, payouts: 0, bonuses: 0, adjustments: 0, fees }
  for (const [type, count] of Object.entries(byType)) {
    out.all += count
    out[txGroup(type)] += count
  }
  return out
}

// --- References ------------------------------------------------------------------------

// What a row is called when someone quotes it to support. A commission keeps
// the reference it has everywhere else (C-04829).
const pad = (id: number) => String(id).padStart(5, "0")
export const txRef = (type: string, id: number) => (type === "subscription" ? `C-${pad(id)}` : type === "fee" ? `FEE-${pad(id)}` : `TX-${pad(id)}`)
export const payoutRef = (id: number) => `PO-${id}`

// --- Fees ------------------------------------------------------------------------------

export type FeeSource = { id: number; fee: number; status: string; requestedAt: string; completedAt: string | null }
// A fee was (or is being) charged only on a payout that went out or is on its
// way — one that was cancelled, rejected or failed gave the whole amount back.
export const feeCharged = (p: Pick<FeeSource, "fee" | "status">) => p.fee > 0 && (p.status === "paid" || payoutInFlight(p.status))

// The Fees list: one row per payout a fee was taken from, shaped like a ledger row.
export function feeRows(payouts: FeeSource[]) {
  return payouts
    .filter(feeCharged)
    .map((p) => ({ id: p.id, type: "fee", status: p.status === "paid" ? "paid" : "processing", amount: -p.fee, baseAmount: null, ratePercent: null, ruleSource: null, holdUntil: null, note: null, createdAt: p.completedAt ?? p.requestedAt, referral: null, plan: null, payoutId: p.id }))
}

// --- Hiding the balance ----------------------------------------------------------------

// The eye on the Total Balance card. A cookie rather than browser storage, so
// the page is already drawn hidden when it arrives — no flash of the figure.
export const HIDE_BALANCE_COOKIE = "tl_aff_hide_balance"

// --- Balance history -------------------------------------------------------------------

// Mirrors engine.ledgerBalances: the rows whose amounts add up to
// available + pending. Anything reversed, refunded or cancelled counts for nothing.
export function countsTowardBalance(type: string, status: string): boolean {
  return type === "payout" ? ["pending", "processing", "paid"].includes(status) : ["pending", "approved", "available", "paid"].includes(status)
}

export type DayDelta = { day: string; amount: number } // UTC day (YYYY-MM-DD) → that day's net change
export type BalanceTrend = {
  // one point per day, oldest first; the last is today's balance
  points: { day: string; total: number }[]
  start: number
  end: number
  // (end − start) / start — null when there was nothing to compare against
  change: number | null
}

const r2 = (v: number) => Math.round(v * 100) / 100
const dayOf = (d: Date) => d.toISOString().slice(0, 10)

// The balance at the end of each of the last `days` days (and `days` days ago,
// as the first point), from the ledger as it stands now. A percentage is only
// given when there was a balance to compare with — never against zero.
export function balanceTrend(deltas: DayDelta[], now: Date, days = 30): BalanceTrend {
  const byDay = new Map<string, number>()
  for (const d of deltas) byDay.set(d.day, (byDay.get(d.day) ?? 0) + d.amount)
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const first = dayOf(new Date(today - days * 86400_000))
  let total = 0
  for (const [day, amount] of byDay) if (day <= first) total += amount
  const points = [{ day: first, total: r2(total) }]
  for (let i = days - 1; i >= 0; i--) {
    const day = dayOf(new Date(today - i * 86400_000))
    total += byDay.get(day) ?? 0
    points.push({ day, total: r2(total) })
  }
  // Rows dated after today (a clock a few minutes apart) still belong to the balance.
  const last = points[points.length - 1]
  for (const [day, amount] of byDay) if (day > last.day) last.total = r2(last.total + amount)
  const start = points[0].total
  const end = last.total
  return { points, start, end, change: start > 0 ? (end - start) / start : null }
}
