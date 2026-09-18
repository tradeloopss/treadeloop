import { getTrades } from "@/app/actions/trades"
import { getJournalEntries } from "@/app/actions/journal"
import { computeDayPnl } from "@/lib/day-pnl"
import { PageHeader } from "@/components/page-header"
import { PnlCalendar } from "@/components/pnl-calendar"

export default async function CalendarPage() {
  const [rows, entries] = await Promise.all([getTrades(), getJournalEntries()])
  const byDay = computeDayPnl(rows, entries)
  const days = Array.from(byDay.values()).sort((a, b) => (a.date < b.date ? 1 : -1))

  return (
    <div>
      <PageHeader title="Calendar" description="Daily net P&L — spot your best and worst trading days at a glance" />
      <div className="p-4 sm:p-6">
        <PnlCalendar days={days} />
      </div>
    </div>
  )
}
