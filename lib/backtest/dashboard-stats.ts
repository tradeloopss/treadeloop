// Aggregate stats for the Backtesting Dashboard, computed over every backtest
// trade (across all sessions). Pure and framework-free so it's unit-testable
// and the server action just fetches rows and calls it. Where the metric
// already exists in lib/calc.ts's analyze() the shape lines up; the day-based,
// monthly, streak, hold-time and drawdown-shape stats are added here.
export interface DashTrade {
  pnl: number
  side: string // "long" | "short"
  entryTime: string | Date
  exitTime: string | Date | null
  rMultiple: number | null
  symbol: string
}

export interface DashSession {
  createdAt: string | Date
  updatedAt: string | Date
  rangeStart: string | Date
  rangeEnd: string | Date
}

export interface MonthCell {
  pnl: number
  trades: number
  wins: number
}
export interface YearRow {
  year: number
  months: MonthCell[] // length 12
  total: MonthCell
}

export interface BacktestDashboard {
  netPnl: number
  totalTrades: number
  wins: number
  losses: number
  breakeven: number
  tradeWinRate: number
  dayWinRate: number
  winningDays: number
  losingDays: number
  breakevenDays: number
  avgWin: number
  avgLoss: number
  winLossRatio: number
  profitFactor: number
  longCount: number
  shortCount: number
  avgRMultiple: number
  avgHoldMinutes: number
  maxConsecWinDays: number
  maxConsecLoseDays: number
  timeSpentMinutes: number
  totalDataMonths: number
  tradeExpectancy: number
  maxDrawdown: number
  avgDrawdown: number
  bySymbol: { symbol: string; trades: number; pnl: number; winRate: number }[]
  years: YearRow[]
  equity: { date: string; equity: number }[]
}

const ms = (d: string | Date) => new Date(d).getTime()
const dayKey = (d: string | Date) => new Date(d).toISOString().slice(0, 10)

export function computeBacktestDashboard(trades: DashTrade[], sessions: DashSession[], startingEquity = 0): BacktestDashboard {
  const closed = trades.filter((t) => t.exitTime != null)
  const sorted = [...closed].sort((a, b) => ms(a.exitTime as string) - ms(b.exitTime as string))
  const pnls = sorted.map((t) => t.pnl)

  const wins = pnls.filter((p) => p > 0)
  const losses = pnls.filter((p) => p < 0)
  const breakeven = pnls.filter((p) => p === 0).length
  const grossProfit = wins.reduce((a, b) => a + b, 0)
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0))
  const netPnl = pnls.reduce((a, b) => a + b, 0)
  const avgWin = wins.length ? grossProfit / wins.length : 0
  const avgLoss = losses.length ? -grossLoss / losses.length : 0

  // Per-day aggregation → day win rate + winning/losing-day streaks.
  const dayMap = new Map<string, number>()
  for (const t of sorted) dayMap.set(dayKey(t.exitTime as string), (dayMap.get(dayKey(t.exitTime as string)) ?? 0) + t.pnl)
  const days = [...dayMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  const winningDays = days.filter(([, p]) => p > 0).length
  const losingDays = days.filter(([, p]) => p < 0).length
  const breakevenDays = days.filter(([, p]) => p === 0).length
  let maxWinStreak = 0, maxLoseStreak = 0, curWin = 0, curLose = 0
  for (const [, p] of days) {
    if (p > 0) { curWin++; curLose = 0 } else if (p < 0) { curLose++; curWin = 0 } else { curWin = 0; curLose = 0 }
    maxWinStreak = Math.max(maxWinStreak, curWin)
    maxLoseStreak = Math.max(maxLoseStreak, curLose)
  }

  // Equity curve + drawdown shape.
  let equity = startingEquity
  let peak = startingEquity
  let maxDd = 0
  const equityPoints: { date: string; equity: number }[] = []
  const ddDepths: number[] = []
  let curDd = 0
  for (const t of sorted) {
    equity += t.pnl
    equityPoints.push({ date: new Date(t.exitTime as string).toISOString(), equity })
    if (equity > peak) {
      if (curDd > 0) ddDepths.push(curDd)
      peak = equity
      curDd = 0
    } else {
      curDd = peak - equity
      maxDd = Math.max(maxDd, curDd)
    }
  }
  if (curDd > 0) ddDepths.push(curDd)
  const avgDrawdown = ddDepths.length ? ddDepths.reduce((a, b) => a + b, 0) / ddDepths.length : 0

  // Monthly grid by year.
  const yearMap = new Map<number, YearRow>()
  for (const t of sorted) {
    const d = new Date(t.exitTime as string)
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth()
    let row = yearMap.get(y)
    if (!row) {
      row = { year: y, months: Array.from({ length: 12 }, () => ({ pnl: 0, trades: 0, wins: 0 })), total: { pnl: 0, trades: 0, wins: 0 } }
      yearMap.set(y, row)
    }
    const win = t.pnl > 0 ? 1 : 0
    row.months[m].pnl += t.pnl
    row.months[m].trades += 1
    row.months[m].wins += win
    row.total.pnl += t.pnl
    row.total.trades += 1
    row.total.wins += win
  }
  const years = [...yearMap.values()].sort((a, b) => b.year - a.year)

  // Per-symbol breakdown.
  const symMap = new Map<string, { trades: number; pnl: number; wins: number }>()
  for (const t of sorted) {
    const s = symMap.get(t.symbol) ?? { trades: 0, pnl: 0, wins: 0 }
    s.trades += 1
    s.pnl += t.pnl
    if (t.pnl > 0) s.wins += 1
    symMap.set(t.symbol, s)
  }
  const bySymbol = [...symMap.entries()]
    .map(([symbol, s]) => ({ symbol, trades: s.trades, pnl: s.pnl, winRate: s.trades ? (s.wins / s.trades) * 100 : 0 }))
    .sort((a, b) => b.pnl - a.pnl)

  // Hold time + R.
  const holds = sorted.filter((t) => t.exitTime).map((t) => (ms(t.exitTime as string) - ms(t.entryTime)) / 60000).filter((n) => n >= 0)
  const avgHoldMinutes = holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length : 0
  const rs = sorted.map((t) => t.rMultiple).filter((r): r is number => r != null)
  const avgRMultiple = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0

  // Session-derived: time spent + data covered.
  const timeSpentMinutes = sessions.reduce((sum, s) => sum + Math.max(0, ms(s.updatedAt) - ms(s.createdAt)) / 60000, 0)
  const totalDataMonths = sessions.reduce((sum, s) => sum + Math.max(0, ms(s.rangeEnd) - ms(s.rangeStart)) / (86400000 * 30.4375), 0)

  return {
    netPnl,
    totalTrades: sorted.length,
    wins: wins.length,
    losses: losses.length,
    breakeven,
    tradeWinRate: sorted.length ? (wins.length / sorted.length) * 100 : 0,
    dayWinRate: days.length ? (winningDays / days.length) * 100 : 0,
    winningDays,
    losingDays,
    breakevenDays,
    avgWin,
    avgLoss,
    winLossRatio: avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : avgWin > 0 ? Infinity : 0,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    longCount: sorted.filter((t) => t.side === "long").length,
    shortCount: sorted.filter((t) => t.side === "short").length,
    avgRMultiple,
    avgHoldMinutes,
    maxConsecWinDays: maxWinStreak,
    maxConsecLoseDays: maxLoseStreak,
    timeSpentMinutes,
    totalDataMonths,
    tradeExpectancy: sorted.length ? netPnl / sorted.length : 0,
    maxDrawdown: maxDd,
    avgDrawdown,
    bySymbol,
    years,
    equity: equityPoints,
  }
}
