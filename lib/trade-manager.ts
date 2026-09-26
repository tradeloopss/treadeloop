// Pure math for the Trade Manager (open/running positions monitor). Kept
// separate from the server action so it's unit-testable. Open trades have no
// exit price and we don't carry a live market mark, so "running P&L" isn't
// invented here — instead we surface what the trade's own levels tell us:
// risk if the stop is hit, reward if the target is hit, the resulting R:R, and
// the notional at risk. A trade with no stop set simply has null risk (shown as
// "no stop"), never a fabricated number.

export interface OpenTradeInput {
  side: "long" | "short"
  quantity: number
  entryPrice: number
  stopLoss: number | null
  takeProfit: number | null
  contractMultiplier: number
  fees: number
}

export interface OpenTradeMetrics {
  // Loss if the stop is hit (entry→stop distance × size × multiplier), incl.
  // fees. Null when no stop is set.
  riskAmount: number | null
  // Gain if the target is hit. Null when no target is set.
  rewardAmount: number | null
  // reward ÷ risk, when both are known and risk > 0.
  riskReward: number | null
  // Position notional (entry × size × multiplier).
  notional: number
  // True when the stop is on the correct side of entry for the direction
  // (below for a long, above for a short). A stop on the wrong side means the
  // "risk" would actually be a locked gain — flagged rather than shown as risk.
  stopConsistent: boolean
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function openTradeMetrics(t: OpenTradeInput): OpenTradeMetrics {
  const mult = t.contractMultiplier || 1
  const notional = round2(t.entryPrice * t.quantity * mult)

  let riskAmount: number | null = null
  let stopConsistent = true
  if (t.stopLoss != null) {
    const dir = t.side === "long" ? 1 : -1
    // For a long, a valid stop is below entry (entry−stop > 0); for a short, above.
    const signedDistance = (t.entryPrice - t.stopLoss) * dir
    stopConsistent = signedDistance > 0
    riskAmount = round2(Math.abs(t.entryPrice - t.stopLoss) * t.quantity * mult + (t.fees ?? 0))
  }

  let rewardAmount: number | null = null
  if (t.takeProfit != null) {
    rewardAmount = round2(Math.abs(t.takeProfit - t.entryPrice) * t.quantity * mult - (t.fees ?? 0))
  }

  const riskReward = riskAmount != null && rewardAmount != null && riskAmount > 0 ? round2(rewardAmount / riskAmount) : null

  return { riskAmount, rewardAmount, riskReward, notional, stopConsistent }
}

// One open position as the Trade Manager UI renders it (server-shaped, plain
// data — safe to pass to a client component).
export interface OpenTradeView {
  id: number
  accountId: number | null
  accountName: string
  currency: string
  symbol: string
  market: string
  side: "long" | "short"
  quantity: number
  entryPrice: number
  stopLoss: number | null
  takeProfit: number | null
  entryTime: string // ISO
  contractMultiplier: number
  source: string | null
  notes: string | null
  metrics: OpenTradeMetrics
}

export interface TradeManagerData {
  accounts: { id: number; name: string }[]
  trades: OpenTradeView[]
}

export interface OpenTradesSummary {
  count: number
  // Total risk across trades that have a stop (the rest are "unprotected").
  totalRisk: number
  unprotected: number // open trades with no stop set
  longs: number
  shorts: number
}

export function summarizeOpenTrades(metrics: { side: "long" | "short"; riskAmount: number | null }[]): OpenTradesSummary {
  let totalRisk = 0
  let unprotected = 0
  let longs = 0
  let shorts = 0
  for (const m of metrics) {
    if (m.riskAmount != null) totalRisk += m.riskAmount
    else unprotected++
    if (m.side === "long") longs++
    else shorts++
  }
  return { count: metrics.length, totalRisk: round2(totalRisk), unprotected, longs, shorts }
}
