// Pure trade math for the replay engine — every figure the UI shows comes from
// here so a number can't drift between the panel, the details drawer and the
// rules card. Money is in account currency; `mult` is the contract multiplier
// (a 1.0-price move on one lot = mult dollars).
import type { ReplayTrade, Side } from "@/lib/replay/types"

export function pnl(side: Side, entry: number, price: number, size: number, mult: number): number {
  const dir = side === "long" ? 1 : -1
  return (price - entry) * dir * size * mult
}

// Risk if the stop is hit (0 when there's no stop).
export function riskAmount(side: Side, entry: number, sl: number | null, size: number, mult: number): number {
  if (sl == null) return 0
  return Math.abs(entry - sl) * size * mult
}

// Reward if the target is hit (0 when there's no target).
export function rewardAmount(side: Side, entry: number, tp: number | null, size: number, mult: number): number {
  if (tp == null) return 0
  return Math.abs(tp - entry) * size * mult
}

export function riskReward(risk: number, reward: number): number | null {
  if (risk <= 0 || reward <= 0) return null
  return reward / risk
}

export function riskPct(risk: number, balance: number): number {
  if (balance <= 0) return 0
  return (risk / balance) * 100
}

export function pips(a: number, b: number, pip: number): number {
  if (pip <= 0) return 0
  return Math.abs(a - b) / pip
}

// Whether this candle's range crossed the stop or target for an open trade —
// the replay engine calls this each time a new candle is revealed. SL is
// checked before TP (worst case first), matching how a broker fills a gap.
export function hitLevel(t: ReplayTrade, high: number, low: number): { price: number; reason: "sl" | "tp" } | null {
  if (t.side === "long") {
    if (t.stopLoss != null && low <= t.stopLoss) return { price: t.stopLoss, reason: "sl" }
    if (t.takeProfit != null && high >= t.takeProfit) return { price: t.takeProfit, reason: "tp" }
  } else {
    if (t.stopLoss != null && high >= t.stopLoss) return { price: t.stopLoss, reason: "sl" }
    if (t.takeProfit != null && low <= t.takeProfit) return { price: t.takeProfit, reason: "tp" }
  }
  return null
}

// Realized P&L of a whole set of closed trades on a given calendar day (market
// time). Used for the daily-loss rule.
export function realizedOnDay(trades: ReplayTrade[], dayKey: string): number {
  return trades
    .filter((t) => t.status === "closed" && dayKeyOf(t.exitTime ?? t.entryTime) === dayKey)
    .reduce((s, t) => s + (t.pnl ?? 0), 0)
}

export function dayKeyOf(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10)
}

export function fmtMoney(n: number, currency = "USD"): string {
  const sign = n < 0 ? "-" : ""
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.replace("$", currency === "USD" ? "$" : `${currency} `)
}

export function fmtSigned(n: number): string {
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
