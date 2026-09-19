import { formatCurrency } from "@/lib/calc"
import type { TFunction } from "@/lib/i18n"

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
// avoid drawing conclusions from 1-2 trades. Every sentence goes through
// `t` so the findings come out in the reader's language; the default is
// the English they're written in.
export function generateFindings(trades: InsightTrade[], t: TFunction = (key, vars) => fill(key, vars)): Finding[] {
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
        title: t("{symbol} is working", { symbol: best.symbol }),
        detail: t("+{pnl} across {n} trades — your best symbol this period.", { pnl: formatCurrency(best.pnl), n: best.count }),
      })
    }
    if (worst.pnl < 0 && worst.symbol !== best.symbol) {
      findings.push({
        type: "weakness",
        title: t("{symbol} is bleeding money", { symbol: worst.symbol }),
        detail: t("{pnl} across {n} trades — worth asking whether this setup is actually working for you.", { pnl: formatCurrency(worst.pnl), n: worst.count }),
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
        title: t("{day}s are costly", { day: t(WEEKDAY_NAMES[worstDay.day]) }),
        detail: t("{pnl} net across {n} trades on {day}s this period.", { pnl: formatCurrency(worstDay.pnl), n: worstDay.count, day: t(WEEKDAY_NAMES[worstDay.day]) }),
      })
    }
    if (bestDay.pnl > 0 && bestDay.day !== worstDay.day) {
      findings.push({
        type: "strength",
        title: t("{day}s are strong", { day: t(WEEKDAY_NAMES[bestDay.day]) }),
        detail: t("+{pnl} net across {n} trades — your best day of the week.", { pnl: formatCurrency(bestDay.pnl), n: bestDay.count }),
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
        title: weakerSide === "long" ? t("Longs are your weak side") : t("Shorts are your weak side"),
        detail: t("{side} win rate is {strong}% vs {weak}% on {weakSide}.", {
          side: strongerSide === "long" ? t("Long") : t("Short"),
          strong: (strongerRate * 100).toFixed(0),
          weak: (weakerRate * 100).toFixed(0),
          weakSide: weakerSide === "long" ? t("longs") : t("shorts"),
        }),
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
        title: t("\"{mistake}\" is your costliest habit", { mistake: worstMistake.mistake }),
        detail: worstMistake.count === 1
          ? t("Flagged on 1 trade, netting {pnl}.", { pnl: formatCurrency(worstMistake.pnl) })
          : t("Flagged on {n} trades, netting {pnl}.", { n: worstMistake.count, pnl: formatCurrency(worstMistake.pnl) }),
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
        title: t("Possible revenge trading"),
        detail: t("Win rate drops to {after}% on trades taken the same day right after a loss, vs {baseline}% otherwise.", { after: (afterLossRate * 100).toFixed(0), baseline: (baselineRate * 100).toFixed(0) }),
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
        title: t("Your self-grading is well-calibrated"),
        detail: t("Trades you rated 4-5★ won {high}% of the time vs {low}% for 1-2★ — trust your gut on execution quality.", { high: (highRate * 100).toFixed(0), low: (lowRate * 100).toFixed(0) }),
      })
    } else if (highRate - lowRate < 0.1) {
      findings.push({
        type: "neutral",
        title: t("Self-ratings aren't tracking results yet"),
        detail: t("Trades you rated 4-5★ won {high}% of the time vs {low}% for 1-2★ — your execution grading may need recalibrating.", { high: (highRate * 100).toFixed(0), low: (lowRate * 100).toFixed(0) }),
      })
    }
  }

  return findings
}

// The English text with its placeholders filled — what t() does when there
// is no dictionary.
function fill(key: string, vars?: Record<string, string | number>): string {
  return vars ? key.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : key
}
