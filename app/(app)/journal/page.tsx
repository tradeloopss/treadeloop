import { getTrades } from "@/app/actions/trades"
import { getJournalEntries } from "@/app/actions/journal"
import { getAccounts, getActiveAccountIds } from "@/app/actions/accounts"
import { formatCurrency } from "@/lib/calc"
import { PageHeader } from "@/components/page-header"
import { JournalList, type JournalTrade, type JournalDayEntry } from "@/components/journal-list"
import { StatCard } from "@/components/stat-card"
import { recordRequestTiming } from "@/lib/telemetry"

export default async function JournalPage() {
  const startedAt = Date.now()
  const [rows, entries, accounts, activeAccountIds] = await Promise.all([
    getTrades(),
    getJournalEntries(),
    getAccounts(),
    getActiveAccountIds(),
  ])

  const trades: JournalTrade[] = rows.map((t) => ({
    id: t.id,
    symbol: t.symbol,
    market: t.market,
    status: t.status,
    pnl: t.pnl,
    entryTime: typeof t.entryTime === "string" ? t.entryTime : t.entryTime.toISOString(),
    exitTime: t.exitTime ? (typeof t.exitTime === "string" ? t.exitTime : t.exitTime.toISOString()) : null,
    tags: t.tags,
    externalId: t.externalId,
  }))

  const entriesByDay: Record<string, JournalDayEntry> = {}
  for (const e of entries) {
    entriesByDay[e.date] = { autoSummary: e.autoSummary, notes: e.notes, mood: e.mood }
  }

  const closed = rows.filter((t) => t.status === "closed")
  const wins = closed.filter((t) => Number(t.pnl) > 0).length
  const losses = closed.filter((t) => Number(t.pnl) < 0).length
  const breakevens = closed.filter((t) => Number(t.pnl) === 0).length
  const totalPnl = closed.reduce((sum, t) => sum + Number(t.pnl), 0)

  void recordRequestTiming("/journal", Date.now() - startedAt)
  return (
    <div>
      <PageHeader
        title="Journal"
        description="Automated daily summaries generated from your trades, plus your own reflections"
      />
      <div className="space-y-5 p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Total Trades" value={rows.length} />
          <StatCard label="Wins" value={wins} tone="gain" />
          <StatCard label="Losses" value={losses} tone="loss" />
          <StatCard label="Breakevens" value={breakevens} />
          <StatCard
            label="Total P&L"
            value={`${totalPnl >= 0 ? "+" : ""}${formatCurrency(totalPnl)}`}
            tone={totalPnl > 0 ? "gain" : totalPnl < 0 ? "loss" : "neutral"}
          />
        </div>

        <JournalList
          trades={trades}
          entriesByDay={entriesByDay}
          accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
          activeAccountIds={activeAccountIds}
        />
      </div>
    </div>
  )
}
