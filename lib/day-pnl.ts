export interface DayPnl {
  date: string // YYYY-MM-DD
  pnl: number
  trades: number
  wins: number
  hasNote?: boolean
}

export interface DayPnlTrade {
  status: string
  pnl: string | number
  exitTime: string | Date | null
  entryTime: string | Date
}

export interface DayPnlEntry {
  date: string
  notes: string | null
}

// The day a closed trade counts toward: its exit date (entry date if it has
// none), in UTC. Shared so every view buckets trades onto the same days.
export function tradeDate(t: Pick<DayPnlTrade, "exitTime" | "entryTime">): string {
  return new Date(t.exitTime ?? t.entryTime).toISOString().slice(0, 10)
}

export function computeDayPnl(rows: DayPnlTrade[], entries: DayPnlEntry[] = []): Map<string, DayPnl> {
  const byDay = new Map<string, DayPnl>()
  for (const t of rows) {
    if (t.status !== "closed") continue
    const date = tradeDate(t)
    const existing = byDay.get(date) ?? { date, pnl: 0, trades: 0, wins: 0 }
    existing.pnl += Number(t.pnl)
    existing.trades += 1
    if (Number(t.pnl) > 0) existing.wins += 1
    byDay.set(date, existing)
  }

  for (const e of entries) {
    if (!e.notes) continue
    const existing = byDay.get(e.date)
    if (existing) existing.hasNote = true
  }

  return byDay
}
