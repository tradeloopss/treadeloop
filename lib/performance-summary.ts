// Weekday-level performance breakdown for the dashboard's "Performance
// Summary" widget — which day of the week trades best/worst, which is
// traded most, and which has the best win rate.
export interface PerformanceTrade {
  pnl: number
  entryTime: string | Date
  exitTime?: string | Date | null
  status: string
}

export interface DayStat {
  day: string
  trades: number
  netPnl: number
  winRate: number
}

export interface PerformanceSummary {
  bestDay: DayStat | null
  leastDay: DayStat | null
  mostActiveDay: DayStat | null
  bestWinRateDay: DayStat | null
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

export function computePerformanceSummary(trades: PerformanceTrade[]): PerformanceSummary {
  const closed = trades.filter((t) => t.status === "closed")
  const byWeekday = new Map<number, PerformanceTrade[]>()
  for (const t of closed) {
    const d = new Date(t.exitTime ?? t.entryTime).getDay()
    if (!byWeekday.has(d)) byWeekday.set(d, [])
    byWeekday.get(d)!.push(t)
  }

  const stats: DayStat[] = Array.from(byWeekday.entries()).map(([day, list]) => ({
    day: WEEKDAY_NAMES[day],
    trades: list.length,
    netPnl: list.reduce((s, t) => s + t.pnl, 0),
    winRate: (list.filter((t) => t.pnl > 0).length / list.length) * 100,
  }))

  if (stats.length === 0) {
    return { bestDay: null, leastDay: null, mostActiveDay: null, bestWinRateDay: null }
  }

  return {
    bestDay: stats.reduce((a, b) => (b.netPnl > a.netPnl ? b : a)),
    leastDay: stats.reduce((a, b) => (b.netPnl < a.netPnl ? b : a)),
    mostActiveDay: stats.reduce((a, b) => (b.trades > a.trades ? b : a)),
    bestWinRateDay: stats.reduce((a, b) => (b.winRate > a.winRate ? b : a)),
  }
}
