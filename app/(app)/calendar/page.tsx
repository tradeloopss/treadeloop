import { getTrades } from "@/app/actions/trades"
import { getAccounts, getActiveAccountIds } from "@/app/actions/accounts"
import { getJournalEntries } from "@/app/actions/journal"
import { computeDayPnl } from "@/lib/day-pnl"
import { PageHeader } from "@/components/page-header"
import { AccountCustomizer } from "@/components/account-customizer"
import { PnlCalendar } from "@/components/pnl-calendar"
import { recordRequestTiming } from "@/lib/telemetry"
import { getT } from "@/lib/i18n/server"

export default async function CalendarPage() {
  const startedAt = Date.now()
  const t = await getT()
  const [rows, entries, accounts, activeAccountIds] = await Promise.all([getTrades(), getJournalEntries(), getAccounts(), getActiveAccountIds()])
  const byDay = computeDayPnl(rows, entries)
  const days = Array.from(byDay.values()).sort((a, b) => (a.date < b.date ? 1 : -1))

  void recordRequestTiming("/calendar", Date.now() - startedAt)
  return (
    <div>
      <PageHeader
        title={t("Calendar")}
        description={t("Daily net P&L — spot your best and worst trading days at a glance")}
        action={<AccountCustomizer accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} activeAccountIds={activeAccountIds} />}
      />
      <div className="p-4 sm:p-6">
        <PnlCalendar days={days} />
      </div>
    </div>
  )
}
