import { getTrades } from "@/app/actions/trades"
import { getJournalEntries } from "@/app/actions/journal"
import { computeDayPnl } from "@/lib/day-pnl"
import { PageHeader } from "@/components/page-header"
import { PnlCalendar } from "@/components/pnl-calendar"
import { recordRequestTiming } from "@/lib/telemetry"
import { getT } from "@/lib/i18n/server"

export default async function CalendarPage() {
  const startedAt = Date.now()
  const t = await getT()
  const [rows, entries] = await Promise.all([getTrades(), getJournalEntries()])
  const byDay = computeDayPnl(rows, entries)
  const days = Array.from(byDay.values()).sort((a, b) => (a.date < b.date ? 1 : -1))

  void recordRequestTiming("/calendar", Date.now() - startedAt)
  return (
    <div>
      <PageHeader title={t("Calendar")} description={t("Daily net P&L — spot your best and worst trading days at a glance")} />
      <div className="p-4 sm:p-6">
        <PnlCalendar days={days} />
      </div>
    </div>
  )
}
