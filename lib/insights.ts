import { formatCurrency } from "@/lib/calc"

export type Finding = {
  type: "strength" | "weakness" | "neutral"
  title: string
  detail: string
}

export type InsightTrade = {
  symbol: string
  side: "long" | "short"
  pnl: number
  mistakes: string[]
  rating: number | null
  entryTime: Date
  exitTime: Date | null
  status: "open" | "closed"
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

// Rule-based pattern detection over a set of trades (typically one week or
// month). Deterministic and API-free by design — every finding cites a real
// number computed from the trades themselves, so it stays trustworthy even
// without an AI layer on top. Needs a minimum sample size per comparison to
// avoid drawing conclusions from 1-2 trades.
export function generateFindings(trades: InsightTrade[]): Finding[] {
  const closed = trades.filter((t) => t.status === "closed")
  if (closed.length < 3) return []

  const findings: Finding[] = []
  const winRate = (list: InsightTrade[]) => list.filter((t) => t.pnl > 0).length / list.length

  // Best/worst symbol (2+ trades each, and only when they're not the same one).
  const bySymbol = new Map<string, InsightTrade[]>()
  for (const t of closed) {
    if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, [])
    bySymbol.get(t.symbol)!.push(t)
  }
  const symbolEntries = Array.from(bySymbol.entries())
    .filter(([, list]) => list.length >= 2)
    .map(([symbol, list]) => ({ symbol, pnl: list.reduce((s, t) => s + t.pnl, 0), count: list.length }))
  if (symbolEntries.length >= 2) {
    const best = symbolEntries.reduce((a, b) => (b.pnl > a.pnl ? b : a))
    const worst = symbolEntries.reduce((a, b) => (b.pnl < a.pnl ? b : a))
    if (best.pnl > 0) {
      findings.push({
        type: "strength",
        title: `${best.symbol} is working`,
        detail: `+${formatCurrency(best.pnl)} across ${best.count} trades — your best symbol this period.`,
      })
    }
    if (worst.pnl < 0 && worst.symbol !== best.symbol) {
      findings.push({
        type: "weakness",
        title: `${worst.symbol} is bleeding money`,
        detail: `${formatCurrency(worst.pnl)} across ${worst.count} trades — worth asking whether this setup is actually working for you.`,
      })
    }
  }

  // Best/worst day of week (2+ trades on that weekday).
  const byWeekday = new Map<number, InsightTrade[]>()
  for (const t of closed) {
    const d = (t.exitTime ?? t.entryTime).getDay()
    if (!byWeekday.has(d)) byWeekday.set(d, [])
    byWeekday.get(d)!.push(t)
  }
  const weekdayEntries = Array.from(byWeekday.entries())
    .filter(([, list]) => list.length >= 2)
    .map(([day, list]) => ({ day, pnl: list.reduce((s, t) => s + t.pnl, 0), count: list.length }))
  if (weekdayEntries.length >= 2) {
    const worstDay = weekdayEntries.reduce((a, b) => (b.pnl < a.pnl ? b : a))
    const bestDay = weekdayEntries.reduce((a, b) => (b.pnl > a.pnl ? b : a))
    if (worstDay.pnl < 0 && worstDay.day !== bestDay.day) {
      findings.push({
        type: "weakness",
        title: `${WEEKDAY_NAMES[worstDay.day]}s are costly`,
        detail: `${formatCurrency(worstDay.pnl)} net across ${worstDay.count} trades on ${WEEKDAY_NAMES[worstDay.day]}s this period.`,
      })
    }
    if (bestDay.pnl > 0 && bestDay.day !== worstDay.day) {
      findings.push({
        type: "strength",
        title: `${WEEKDAY_NAMES[bestDay.day]}s are strong`,
        detail: `+${formatCurrency(bestDay.pnl)} net across ${bestDay.count} trades — your best day of the week.`,
      })
    }
  }

  // Long vs short win rate gap.
  const longs = closed.filter((t) => t.side === "long")
  const shorts = closed.filter((t) => t.side === "short")
  if (longs.length >= 3 && shorts.length >= 3) {
    const longRate = winRate(longs)
    const shortRate = winRate(shorts)
    if (Math.abs(longRate - shortRate) >= 0.2) {
      const strongerSide = longRate > shortRate ? "long" : "short"
      const weakerSide = strongerSide === "long" ? "short" : "long"
      const strongerRate = strongerSide === "long" ? longRate : shortRate
      const weakerRate = strongerSide === "long" ? shortRate : longRate
      findings.push({
        type: "weakness",
        title: `${weakerSide === "long" ? "Longs" : "Shorts"} are your weak side`,
        detail: `${strongerSide === "long" ? "Long" : "Short"} win rate is ${(strongerRate * 100).toFixed(0)}% vs ${(weakerRate * 100).toFixed(0)}% on ${weakerSide}s.`,
      })
    }
  }

  // Costliest recurring mistake tag.
  const byMistake = new Map<string, InsightTrade[]>()
  for (const t of closed) {
    for (const m of t.mistakes) {
      if (!byMistake.has(m)) byMistake.set(m, [])
      byMistake.get(m)!.push(t)
    }
  }
  if (byMistake.size > 0) {
    const mistakeEntries = Array.from(byMistake.entries()).map(([mistake, list]) => ({
      mistake,
      pnl: list.reduce((s, t) => s + t.pnl, 0),
      count: list.length,
    }))
    const worstMistake = mistakeEntries.reduce((a, b) => (b.pnl < a.pnl ? b : a))
    if (worstMistake.pnl < 0) {
      findings.push({
        type: "weakness",
        title: `"${worstMistake.mistake}" is your costliest habit`,
        detail: `Flagged on ${worstMistake.count} trade${worstMistake.count === 1 ? "" : "s"}, netting ${formatCurrency(worstMistake.pnl)}.`,
      })
    }
  }

  // Same-day trade right after a loss — a revenge-trading signal.
  const sorted = [...closed].sort((a, b) => a.entryTime.getTime() - b.entryTime.getTime())
  const afterLoss: InsightTrade[] = []
  const baseline: InsightTrade[] = []
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    const sameDay = prev.exitTime != null && prev.exitTime.toDateString() === cur.entryTime.toDateString()
    if (prev.pnl < 0 && sameDay) afterLoss.push(cur)
    else baseline.push(cur)
  }
  if (afterLoss.length >= 3 && baseline.length >= 3) {
    const afterLossRate = winRate(afterLoss)
    const baselineRate = winRate(baseline)
    if (baselineRate - afterLossRate >= 0.15) {
      findings.push({
        type: "weakness",
        title: "Possible revenge trading",
        detail: `Win rate drops to ${(afterLossRate * 100).toFixed(0)}% on trades taken the same day right after a loss, vs ${(baselineRate * 100).toFixed(0)}% otherwise.`,
      })
    }
  }

  // Whether self-ratings actually track outcomes.
  const rated = closed.filter((t) => t.rating != null)
  const highRated = rated.filter((t) => t.rating! >= 4)
  const lowRated = rated.filter((t) => t.rating! <= 2)
  if (highRated.length >= 2 && lowRated.length >= 2) {
    const highRate = winRate(highRated)
    const lowRate = winRate(lowRated)
    if (highRate - lowRate >= 0.2) {
      findings.push({
        type: "strength",
        title: "Your self-grading is well-calibrated",
        detail: `Trades you rated 4-5★ won ${(highRate * 100).toFixed(0)}% of the time vs ${(lowRate * 100).toFixed(0)}% for 1-2★ — trust your gut on execution quality.`,
      })
    } else if (highRate - lowRate < 0.1) {
      findings.push({
        type: "neutral",
        title: "Self-ratings aren't tracking results yet",
        detail: `Trades you rated 4-5★ won ${(highRate * 100).toFixed(0)}% of the time vs ${(lowRate * 100).toFixed(0)}% for 1-2★ — your execution grading may need recalibrating.`,
      })
    }
  }

  return findings
}
