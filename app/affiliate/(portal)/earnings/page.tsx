import type { Metadata } from "next"
import Link from "next/link"
import { CircleDollarSign, Download } from "lucide-react"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { balancesFor, releaseHolds } from "@/lib/affiliates/commissions"
import { currentRule, getProgram } from "@/lib/affiliates/program"
import { PAGE_SIZE, ledgerPage, monthlyStatements } from "@/lib/affiliates/queries"
import { money, signedMoney } from "@/lib/affiliates/types"
import { PageHeader } from "@/components/page-header"
import { FilterSelect, Pager, Panel } from "@/components/admin/ui"
import { Empty, Kpi, KpiGrid, LEDGER_TYPE_LABELS, StatusBadge, TableShell, THead, fmtDay, linkButtonClass, primaryLinkClass, tdClass, thClass } from "@/components/affiliate/ui"
import { affiliateHref } from "@/lib/urls"

export const metadata: Metadata = { title: "Earnings" }

const TYPES: [string, string][] = [["", "All types"], ["subscription", "Commissions"], ["bonus", "Bonuses"], ["adjustment", "Adjustments"], ["refund", "Refund reversals"], ["reversal", "Reversals"], ["payout", "Payouts"]]
const STATUSES: [string, string][] = [["", "All statuses"], ["pending", "Pending"], ["approved", "Approved"], ["available", "Available"], ["paid", "Paid"], ["refunded", "Refunded"], ["reversed", "Reversed"], ["cancelled", "Cancelled"]]
const RULE_LABELS: Record<string, string> = { affiliate: "Custom rate", campaign: "Campaign rate", coupon: "Coupon rate", tier: "Tier rate", default: "Standard rate" }

const STEPS = [
  { status: "pending", title: "Pending", body: (d: number) => `A customer paid. The commission waits ${d} days in case of a refund.` },
  { status: "approved", title: "Approved", body: () => "The hold has passed and the commission is confirmed." },
  { status: "available", title: "Available", body: () => "Ready to withdraw from the Payouts page." },
  { status: "paid", title: "Paid", body: () => "Sent to you in a payout." },
] as const

export default async function AffiliateEarningsPage({ searchParams }: { searchParams: Promise<{ type?: string; status?: string; page?: string }> }) {
  const { affiliate } = await requireAffiliate()
  const sp = await searchParams
  const filters = {
    type: TYPES.some(([v]) => v && v === sp.type) ? sp.type : undefined,
    status: STATUSES.some(([v]) => v && v === sp.status) ? sp.status : undefined,
    page: Math.max(1, Number(sp.page) || 1),
  }
  await releaseHolds({ affiliateId: affiliate.id })
  const [balances, ledger, statements, program, rule] = await Promise.all([balancesFor(affiliate.id), ledgerPage(affiliate.id, filters), monthlyStatements(affiliate.id), getProgram(), currentRule(affiliate.id)])
  const filtered = !!(filters.type || filters.status)
  const exportQuery = new URLSearchParams(Object.entries({ type: filters.type, status: filters.status }).filter(([, v]) => v) as [string, string][]).toString()

  return (
    <div>
      <PageHeader
        title="Earnings"
        description="Every commission, reversal and payout — your balance is the sum of this ledger."
        action={
          <a href={affiliateHref(`/affiliate/export/commissions${exportQuery ? `?${exportQuery}` : ""}`)} className={linkButtonClass}>
            <Download className="size-4" aria-hidden /> Export CSV
          </a>
        }
      />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <KpiGrid>
          <Kpi label="Available" value={money(balances.available)} note={balances.available >= program.minPayout ? <Link href={affiliateHref("/affiliate/payouts")} className="font-medium text-primary hover:underline">Request a payout</Link> : `Minimum payout ${money(program.minPayout)}`} />
          <Kpi label="Pending" value={money(balances.pending)} note={`In the ${program.holdDays}-day hold`} />
          <Kpi label="Lifetime earned" value={money(balances.lifetimeEarned)} note={`${rule.ratePercent}% ${program.commissionType === "recurring" ? (rule.durationMonths ? `for ${rule.durationMonths} months per customer` : "on every payment") : "on the first payment"}`} />
          <Kpi label="Paid out" value={money(balances.lifetimePaid)} note={balances.processing > 0 ? `${money(balances.processing)} in progress` : "All time"} />
        </KpiGrid>

        <Panel title="How a commission moves" description={program.refundReversal ? "If the customer's payment is refunded or disputed, its commission is reversed." : "Disputed payments have their commission reversed."}>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.status} className="rounded-lg border px-3 py-2.5">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[11px] tabular-nums text-muted-foreground">{i + 1}</span>
                  {s.title}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{s.body(program.holdDays)}</p>
              </li>
            ))}
          </ol>
        </Panel>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-sm font-semibold">Commission ledger</h2>
            <form className="flex flex-wrap items-end gap-3" method="get">
              <FilterSelect name="type" label="Type" defaultValue={filters.type} options={TYPES} />
              <FilterSelect name="status" label="Status" defaultValue={filters.status} options={STATUSES} />
              <button type="submit" className="h-9 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                Apply
              </button>
              {filtered && (
                <Link href={affiliateHref("/affiliate/earnings")} className="h-9 content-center text-sm text-muted-foreground hover:text-foreground">
                  Clear
                </Link>
              )}
            </form>
          </div>
          {ledger.rows.length === 0 ? (
            <div className="rounded-xl border bg-card">
              <Empty icon={CircleDollarSign} title={filtered ? "Nothing matches these filters" : "No earnings yet"} action={filtered ? undefined : <Link href={affiliateHref("/affiliate/links")} className={primaryLinkClass}>Get your link</Link>}>
                {filtered ? "Try a different type or status." : "Your first commission appears here as soon as a referred customer pays."}
              </Empty>
            </div>
          ) : (
            <TableShell>
              <THead>
                <tr>
                  <th className={thClass}>Date</th>
                  <th className={thClass}>Type</th>
                  <th className={thClass}>Referral</th>
                  <th className={thClass}>Detail</th>
                  <th className={thClass}>Status</th>
                  <th className={`${thClass} text-end`}>Amount</th>
                </tr>
              </THead>
              <tbody className="divide-y">
                {ledger.rows.map((r) => (
                  <tr key={r.id}>
                    <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>{fmtDay(r.createdAt)}</td>
                    <td className={`${tdClass} whitespace-nowrap`}>{LEDGER_TYPE_LABELS[r.type] ?? r.type}</td>
                    <td className={`${tdClass} font-mono text-xs`}>{r.referral ?? "—"}</td>
                    <td className={`${tdClass} text-xs text-muted-foreground`}>
                      {r.type === "subscription" && r.baseAmount != null ? (
                        <>
                          {r.ratePercent}% of {money(r.baseAmount)}
                          {r.ruleSource && ` · ${RULE_LABELS[r.ruleSource] ?? r.ruleSource}`}
                          {r.status === "pending" && r.holdUntil && <span className="block">Clears {fmtDay(r.holdUntil)}</span>}
                        </>
                      ) : (
                        (r.note ?? "—")
                      )}
                    </td>
                    <td className={tdClass}>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-end tabular-nums font-medium ${r.amount < 0 ? "text-[var(--loss)]" : ""}`}>{signedMoney(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
          {ledger.total > PAGE_SIZE && <Pager page={ledger.page} total={ledger.total} pageSize={PAGE_SIZE} params={{ type: filters.type, status: filters.status }} />}
        </section>

        <Panel title="Monthly statements" description="The last 12 months, by the month each entry was recorded.">
          {statements.length === 0 ? (
            <Empty title="No statements yet">A month appears here once it has activity.</Empty>
          ) : (
            <TableShell className="border-0">
              <THead>
                <tr>
                  <th className={thClass}>Month</th>
                  <th className={`${thClass} text-end`}>Earned</th>
                  <th className={`${thClass} text-end`}>Reversed / deducted</th>
                  <th className={`${thClass} text-end`}>Net</th>
                  <th className={`${thClass} text-end`}>Paid out</th>
                </tr>
              </THead>
              <tbody className="divide-y">
                {statements.map((s) => (
                  <tr key={s.month}>
                    <td className={`${tdClass} font-medium`}>{new Date(`${s.month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</td>
                    <td className={`${tdClass} text-end tabular-nums`}>{money(s.earned)}</td>
                    <td className={`${tdClass} text-end tabular-nums ${s.reversed < 0 ? "text-[var(--loss)]" : ""}`}>{s.reversed ? signedMoney(s.reversed) : money(0)}</td>
                    <td className={`${tdClass} text-end tabular-nums font-medium`}>{money(s.earned + s.reversed)}</td>
                    <td className={`${tdClass} text-end tabular-nums`}>{money(s.paid)}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </Panel>
      </div>
    </div>
  )
}
