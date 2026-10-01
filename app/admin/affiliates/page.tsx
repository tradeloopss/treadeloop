import Link from "next/link"
import { Download, Handshake } from "lucide-react"
import { requireAdmin } from "@/lib/admin/guard"
import { affiliatesPage, programOverview } from "@/lib/affiliates/admin-queries"
import { rate } from "@/lib/affiliates/engine"
import { PAGE_SIZE } from "@/lib/affiliates/queries"
import { count, money, parseRange, pct } from "@/lib/affiliates/types"
import { AdminPageHeader, FilterSelect, Pager, Panel } from "@/components/admin/ui"
import { Empty, Kpi, KpiGrid, RangeTabs, StatusBadge, TableShell, THead, fmtDay, linkButtonClass, tdClass, thClass } from "@/components/affiliate/ui"
import { PerformanceChart } from "@/components/affiliate/performance-chart"

const STATUSES: [string, string][] = [["", "All statuses"], ["approved", "Active"], ["applications", "Applications"], ["suspended", "Suspended"], ["rejected", "Rejected"]]

export default async function AdminAffiliatesPage({ searchParams }: { searchParams: Promise<{ range?: string; q?: string; status?: string; page?: string }> }) {
  await requireAdmin({ affiliates: ["view"] })
  const sp = await searchParams
  const range = parseRange(sp.range)
  const filters = { q: sp.q?.trim().slice(0, 80) || undefined, status: STATUSES.some(([v]) => v && v === sp.status) ? sp.status : undefined, page: Math.max(1, Number(sp.page) || 1) }
  const [overview, list] = await Promise.all([programOverview(range), affiliatesPage(filters)])
  const { current, previous } = overview
  const exportQuery = new URLSearchParams(Object.entries({ q: filters.q, status: filters.status }).filter(([, v]) => v) as [string, string][]).toString()

  return (
    <div>
      <AdminPageHeader title="Affiliate program" description="Partners, the revenue they bring in and what they're owed." action={<RangeTabs range={range} params={{ q: filters.q, status: filters.status }} />} />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <KpiGrid>
          <Kpi label="Active affiliates" value={count(overview.affiliates.approved)} note={`${overview.affiliates.pending} application${overview.affiliates.pending === 1 ? "" : "s"} waiting`} />
          <Kpi label="Referred revenue" value={money(current.revenue)} current={current.revenue} previous={previous?.revenue ?? null} />
          <Kpi label="Commission generated" value={money(current.commission)} current={current.commission} previous={previous?.commission ?? null} />
          <Kpi label="New paying customers" value={count(current.customers)} current={current.customers} previous={previous?.customers ?? null} />
          <Kpi label="Clicks" value={count(current.clicks)} current={current.clicks} previous={previous?.clicks ?? null} />
          <Kpi label="Sign-ups" value={count(current.signups)} current={current.signups} previous={previous?.signups ?? null} />
          <Kpi label="Click → customer" value={pct(rate(current.customers, current.clicks))} note={`Commission is ${pct(rate(current.commission, current.revenue))} of referred revenue`} />
          <Kpi label="Payouts waiting" value={money(overview.payoutQueue.total)} note={<Link href="/admin/affiliates/payouts" className="font-medium text-primary hover:underline">{overview.payoutQueue.count} to process</Link>} />
        </KpiGrid>

        <div className="grid gap-4 xl:grid-cols-3">
          <Panel title="Program performance" className="xl:col-span-2">
            <PerformanceChart points={overview.series.points} unit={overview.series.unit} metrics={["revenue", "commission", "clicks", "signups", "customers"]} initial="revenue" />
          </Panel>
          <div className="flex flex-col gap-4">
            <Panel title="What the program owes" description="Derived from the ledger, all time.">
              <dl className="divide-y text-sm">
                {[
                  ["In the holding period", overview.ledger.pending],
                  ["Available to withdraw", overview.ledger.available],
                  ["Paid out", overview.ledger.paid],
                  ["Earned in total", overview.ledger.earned],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex items-center justify-between py-2">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="tabular-nums font-medium">{money(value as number)}</dd>
                  </div>
                ))}
              </dl>
              {overview.openSignals > 0 && (
                <Link href="/admin/affiliates/fraud" className="mt-3 block rounded-lg bg-[var(--chart-4)]/12 px-3 py-2 text-sm text-[var(--chart-4)] hover:underline">
                  {overview.openSignals} risk signal{overview.openSignals === 1 ? "" : "s"} to review
                </Link>
              )}
            </Panel>
            <Panel title="Top affiliates" description="By commission in this period.">
              {overview.top.length === 0 ? (
                <p className="text-sm text-muted-foreground">No commissions in this period.</p>
              ) : (
                <ol className="space-y-2 text-sm">
                  {overview.top.map((t, i) => (
                    <li key={t.id} className="flex items-center justify-between gap-3">
                      <Link href={`/admin/affiliates/${t.id}`} className="min-w-0 truncate hover:underline">
                        <span className="me-2 tabular-nums text-muted-foreground">{i + 1}.</span>
                        {t.name}
                      </Link>
                      <span className="tabular-nums font-medium">{money(t.commission)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          </div>
        </div>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-sm font-semibold">Affiliates</h2>
            <div className="flex flex-wrap items-end gap-3">
              <form className="flex flex-wrap items-end gap-3" method="get">
                <input type="hidden" name="range" value={range} />
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Search
                  <input name="q" defaultValue={filters.q ?? ""} placeholder="Name, email or code" className="h-9 w-56 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
                </label>
                <FilterSelect name="status" label="Status" defaultValue={filters.status} options={STATUSES} />
                <button type="submit" className="h-9 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                  Apply
                </button>
              </form>
              <a href={`/admin/affiliates/export/affiliates${exportQuery ? `?${exportQuery}` : ""}`} className={linkButtonClass}>
                <Download className="size-4" aria-hidden /> Export
              </a>
            </div>
          </div>

          {list.rows.length === 0 ? (
            <div className="rounded-xl border bg-card">
              <Empty icon={Handshake} title={filters.q || filters.status ? "No affiliates match" : "No affiliates yet"}>
                {filters.q || filters.status ? "Try a different search or status." : "Applications appear under the Applications tab as people apply at /affiliate/apply."}
              </Empty>
            </div>
          ) : (
            <TableShell>
              <THead>
                <tr>
                  <th className={thClass}>Affiliate</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}>Tier</th>
                  <th className={`${thClass} text-end`}>Clicks</th>
                  <th className={`${thClass} text-end`}>Referrals</th>
                  <th className={`${thClass} text-end`}>Customers</th>
                  <th className={`${thClass} text-end`}>Revenue</th>
                  <th className={`${thClass} text-end`}>Earned</th>
                  <th className={`${thClass} text-end`}>Available</th>
                  <th className={thClass}>Joined</th>
                </tr>
              </THead>
              <tbody className="divide-y">
                {list.rows.map((a) => (
                  <tr key={a.id} className="hover:bg-muted/30">
                    <td className={tdClass}>
                      <Link href={`/admin/affiliates/${a.id}`} className="font-medium hover:underline">
                        {a.firstName} {a.lastName}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {a.email} · <span className="font-mono">{a.code}</span>
                      </p>
                    </td>
                    <td className={tdClass}>
                      <StatusBadge status={a.status} label={a.status === "approved" ? "Active" : undefined} />
                      {(a.fraudLock || a.payoutHold) && <span className="mt-1 block text-[11px] text-[var(--chart-4)]">{a.fraudLock ? "Fraud lock" : "Payout hold"}</span>}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>{a.tier ? `${a.tier.name} · ${a.tier.ratePercent}%` : "—"}</td>
                    <td className={`${tdClass} text-end tabular-nums`}>{count(a.stats.clicks)}</td>
                    <td className={`${tdClass} text-end tabular-nums`}>{count(a.stats.referrals)}</td>
                    <td className={`${tdClass} text-end tabular-nums`}>{count(a.stats.customers)}</td>
                    <td className={`${tdClass} text-end tabular-nums`}>{money(a.stats.revenue)}</td>
                    <td className={`${tdClass} text-end tabular-nums`}>{money(a.balances.lifetimeEarned)}</td>
                    <td className={`${tdClass} text-end tabular-nums font-medium`}>{money(a.balances.available)}</td>
                    <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>{fmtDay(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
          {list.total > PAGE_SIZE && <Pager page={list.page} total={list.total} pageSize={PAGE_SIZE} params={{ range, q: filters.q, status: filters.status }} />}
        </section>
      </div>
    </div>
  )
}
