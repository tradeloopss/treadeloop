import { analyze, type TradeStat } from "@/lib/calc"

export type ScoreAxis = { label: string; score: number }

export type TradingScore = {
  overall: number
  axes: ScoreAxis[]
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

// Maps a ratio-like metric to 0-100 where 1.0 (breakeven) sits at 50 and the
// score approaches 100 as the ratio climbs past 2x. Shared by profit factor,
// payoff ratio, and recovery factor, which all have the same "1.0 = breakeven"
// shape.
function ratioScore(ratio: number): number {
  if (!Number.isFinite(ratio)) return 100
  if (ratio <= 0) return 0
  if (ratio <= 1) return ratio * 50
  return clamp(50 + (ratio - 1) * 50, 0, 100)
}

// A composite "trading health" score computed transparently from this app's
// own numbers — not a reverse-engineered copy of any third-party formula.
// Each axis independently rewards discipline and risk control, not just raw
// profit, so it can highlight a well-run losing period or a lucky reckless one.
export function computeTradingScore(trades: TradeStat[]): TradingScore {
  const closed = trades.filter((t) => t.status === "closed")
  const a = analyze(trades)

  const winPct = clamp(a.winRate, 0, 100)
  const profitFactorScore = ratioScore(a.profitFactor)

  const payoff = a.avgLoss !== 0 ? a.avgWin / Math.abs(a.avgLoss) : a.avgWin > 0 ? 2 : 0
  const payoffScore = ratioScore(payoff)

  const recoveryFactor = a.maxDrawdown > 0 ? a.netPnl / a.maxDrawdown : a.netPnl > 0 ? 2 : 0
  const recoveryScore = ratioScore(recoveryFactor)

  // How big the worst peak-to-trough dip was relative to gross profit earned —
  // a $500 drawdown means something different next to $5,000 gross profit than
  // next to $600.
  const grossProfit = a.avgWin * a.wins
  const drawdownRatio = grossProfit > 0 ? a.maxDrawdown / grossProfit : a.maxDrawdown > 0 ? 1 : 0
  const drawdownScore = clamp(100 - drawdownRatio * 100, 0, 100)

  // Consistency: what share of total profit came from a single best day. A
  // score that leans entirely on one outlier day is fragile even if net P&L
  // looks fine.
  const byDay = new Map<string, number>()
  for (const t of closed) {
    const day = new Date(t.exitTime ?? t.entryTime).toISOString().slice(0, 10)
    byDay.set(day, (byDay.get(day) ?? 0) + t.pnl)
  }
  const dayPnls = Array.from(byDay.values())
  const totalPositive = dayPnls.filter((p) => p > 0).reduce((s, p) => s + p, 0)
  const bestDay = Math.max(0, ...dayPnls)
  const concentration = totalPositive > 0 ? bestDay / totalPositive : 0
  const consistencyScore = clamp(100 - concentration * 100, 0, 100)

  const axes: ScoreAxis[] = [
    { label: "Win %", score: winPct },
    { label: "Profit factor", score: profitFactorScore },
    { label: "Avg win/loss", score: payoffScore },
    { label: "Recovery factor", score: recoveryScore },
    { label: "Max drawdown", score: drawdownScore },
    { label: "Consistency", score: consistencyScore },
  ]

  const overall = closed.length > 0 ? axes.reduce((s, ax) => s + ax.score, 0) / axes.length : 0

  return { overall, axes }
}
