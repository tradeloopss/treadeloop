// Pure aggregation of closed trades into per-account daily P&L — kept
// separate from the server actions so the grouping logic is unit-testable.

export interface DailyAccountPnlTrade {
  accountId: number | null
  status: string
  pnl: string | number
  exitTime: string | Date | null
  entryTime: string | Date
}

export interface DailyAccountPnl {
  accountId: number
  date: string
  pnl: number
  trades: number
  wins: number
  losses: number
}

export function computeDailyAccountPnl(rows: DailyAccountPnlTrade[], date: string): Map<number, DailyAccountPnl> {
  return computeAccountPnlInRange(rows, date, date)
}

// Same grouping over an inclusive YYYY-MM-DD range, so a weekly certificate
// reuses the daily logic rather than duplicating it. `date` on the result is
// the range start, which is what identifies the period.
export function computeAccountPnlInRange(
  rows: DailyAccountPnlTrade[],
  startDate: string,
  endDate: string,
): Map<number, DailyAccountPnl> {
  const date = startDate
  const byAccount = new Map<number, DailyAccountPnl>()
  for (const t of rows) {
    if (t.status !== "closed" || t.accountId == null) continue
    const day = new Date(t.exitTime ?? t.entryTime).toISOString().slice(0, 10)
    if (day < startDate || day > endDate) continue
    const pnl = Number(t.pnl)
    const existing = byAccount.get(t.accountId) ?? { accountId: t.accountId, date, pnl: 0, trades: 0, wins: 0, losses: 0 }
    existing.pnl += pnl
    existing.trades += 1
    if (pnl > 0) existing.wins += 1
    else if (pnl < 0) existing.losses += 1
    byAccount.set(t.accountId, existing)
  }
  return byAccount
}
