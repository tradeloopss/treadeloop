import { getTrades } from "@/app/actions/trades"
import { getAccounts, getActiveAccountIds } from "@/app/actions/accounts"
import { getJournalEntries } from "@/app/actions/journal"
import { getPlaybooks } from "@/app/actions/playbooks"
import { tradeDate } from "@/lib/day-pnl"
import { tradingSession } from "@/lib/calc"
import { PageHeader } from "@/components/page-header"
import { AccountCustomizer } from "@/components/account-customizer"
import { PnlCalendar, type CalendarTrade } from "@/components/pnl-calendar"
import { recordRequestTiming } from "@/lib/telemetry"
import { getT } from "@/lib/i18n/server"

export default async function CalendarPage() {
  const startedAt = Date.now()
  const t = await getT()
  const [rows, entries, accounts, activeAccountIds, playbooks] = await Promise.all([
    getTrades(),
    getJournalEntries(),
    getAccounts(),
    getActiveAccountIds(),
    getPlaybooks(),
  ])
  // Only what the calendar aggregates and filters on, so the client payload
  // stays small even for a long trade history.
  const trades: CalendarTrade[] = rows
    .filter((r) => r.status === "closed")
    .map((r) => ({
      date: tradeDate(r),
      pnl: Number(r.pnl),
      r: r.rMultiple == null ? null : Number(r.rMultiple),
      rating: r.rating,
      symbol: r.symbol,
      side: r.side === "short" ? "short" : "long",
      session: tradingSession(r.entryTime),
      playbookId: r.playbookId,
      tags: r.tags ?? [],
    }))
  const noteDates = entries.filter((e) => e.notes).map((e) => e.date)

  void recordRequestTiming("/calendar", Date.now() - startedAt)
  return (
    <div>
      <PageHeader
        title={t("Calendar")}
        description={t("Daily net P&L — spot your best and worst trading days at a glance")}
        action={<AccountCustomizer accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} activeAccountIds={activeAccountIds} />}
      />
      <div className="p-4 sm:p-6">
        <PnlCalendar trades={trades} noteDates={noteDates} playbooks={playbooks.map((p) => ({ id: p.id, name: p.name }))} />
      </div>
    </div>
  )
}
