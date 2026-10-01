import type { Metadata } from "next"
import { ChartLine } from "lucide-react"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { rate } from "@/lib/affiliates/engine"
import { breakdown, campaignsWithStats, performance, type BreakdownRow } from "@/lib/affiliates/queries"
import { count, money, parseRange, pct } from "@/lib/affiliates/types"
import { PageHeader } from "@/components/page-header"
import { Panel } from "@/components/admin/ui"
import { Empty, Kpi, KpiGrid, RangeTabs, TableShell, THead, tdClass, thClass } from "@/components/affiliate/ui"
import { PerformanceChart } from "@/components/affiliate/performance-chart"

export const metadata: Metadata = { title: "Analytics" }

const countryName = (code: string) => {
  if (!/^[A-Z]{2}$/.test(code)) return code === "unknown" ? "Unknown" : code
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code
  } catch {
    return code
  }
}
const titled = (v: string) => (v === "direct" ? "Direct / unknown" : v === "coupon" ? "Coupon only" : v === "unknown" ? "Unknown" : v)

function BreakdownTable({ title, description, first, rows, label = titled }: { title: string; description: string; first: string; rows: BreakdownRow[]; label?: (v: string) => string }) {
  return (
    <Panel title={title} description={description}>
      {rows.length === 0 ? (
        <Empty title="Nothing in this period" />
      ) : (
        <TableShell className="border-0">
          <THead>
            <tr>
              <th className={thClass}>{first}</th>
              <th className={`${thClass} text-end`}>Clicks</th>
              <th className={`${thClass} text-end`}>Sign-ups</th>
              <th className={`${thClass} text-end`}>Customers</th>
              <th className={`${thClass} text-end`}>Conv.</th>
            </tr>
          </THead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.label}>
                <td className={`${tdClass} max-w-48 truncate font-medium`} title={label(r.label)}>
                  {label(r.label)}
                </td>
                <td className={`${tdClass} text-end tabular-nums`}>{count(r.clicks)}</td>
                <td className={`${tdClass} text-end tabular-nums`}>{count(r.signups)}</td>
                <td className={`${tdClass} text-end tabular-nums`}>{count(r.customers)}</td>
                <td className={`${tdClass} text-end tabular-nums text-muted-foreground`}>{r.clicks ? pct(rate(r.customers, r.clicks)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </Panel>
  )
}

export default async function AffiliateAnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { affiliate } = await requireAffiliate()
  const range = parseRange((await searchParams).range)
  const perf = await performance(affiliate.id, range, affiliate.createdAt)
  const [sources, devices, countries, landings, campaigns] = await Promise.all([
    breakdown(affiliate.id, perf.start, "source"),
    breakdown(affiliate.id, perf.start, "device"),
    breakdown(affiliate.id, perf.start, "country"),
    breakdown(affiliate.id, perf.start, "landing"),
    campaignsWithStats(affiliate.id, perf.start),
  ])
  const { current, previous } = perf
  const active = campaigns.filter((c) => c.stats.clicks + c.stats.signups + c.stats.customers > 0).sort((a, b) => b.stats.commission - a.stats.commission || b.stats.clicks - a.stats.clicks)

  return (
    <div>
      <PageHeader title="Analytics" description="Where your traffic comes from and what it turns into." action={<RangeTabs range={range} />} />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <KpiGrid>
          <Kpi label="Clicks" value={count(current.clicks)} current={current.clicks} previous={previous?.clicks ?? null} />
          <Kpi label="Sign-ups" value={count(current.signups)} current={current.signups} previous={previous?.signups ?? null} />
          <Kpi label="New customers" value={count(current.customers)} current={current.customers} previous={previous?.customers ?? null} />
          <Kpi label="Commission" value={money(current.commission)} current={current.commission} previous={previous?.commission ?? null} />
          <Kpi label="Click → sign-up" value={pct(rate(current.signups, current.clicks))} note="Share of clicks that created an account" />
          <Kpi label="Sign-up → customer" value={pct(rate(current.customers, current.signups))} note="Share of sign-ups that paid" />
          <Kpi label="Earnings per click" value={money(rate(current.commission, current.clicks))} note="Commission ÷ clicks" />
          <Kpi label="Customer revenue" value={money(current.revenue)} current={current.revenue} previous={previous?.revenue ?? null} />
        </KpiGrid>

        <Panel title="Trend" description="One metric at a time across the selected period.">
          <PerformanceChart points={perf.series.points} unit={perf.series.unit} metrics={["clicks", "signups", "customers", "commission", "revenue"]} initial="clicks" />
        </Panel>

        <Panel title="Campaigns" description="Performance of each campaign in this period.">
          {active.length === 0 ? (
            <Empty icon={ChartLine} title="No campaign activity in this period">Traffic through your main link is counted in the totals above.</Empty>
          ) : (
            <TableShell className="border-0">
              <THead>
                <tr>
                  <th className={thClass}>Campaign</th>
                  <th className={`${thClass} text-end`}>Clicks</th>
                  <th className={`${thClass} text-end`}>Sign-ups</th>
                  <th className={`${thClass} text-end`}>Customers</th>
                  <th className={`${thClass} text-end`}>Revenue</th>
                  <th className={`${thClass} text-end`}>Commission</th>
                </tr>
              </THead>
              <tbody className="divide-y">
                {active.map((c) => (
                  <tr key={c.id}>
                    <td className={`${tdClass} font-medium`}>{c.name}</td>
                    <td className={`${tdClass} text-end tabular-nums`}>{count(c.stats.clicks)}</td>
                    <td className={`${tdClass} text-end tabular-nums`}>{count(c.stats.signups)}</td>
                    <td className={`${tdClass} text-end tabular-nums`}>{count(c.stats.customers)}</td>
                    <td className={`${tdClass} text-end tabular-nums`}>{money(c.stats.revenue)}</td>
                    <td className={`${tdClass} text-end tabular-nums`}>{money(c.stats.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </Panel>

        <div className="grid gap-4 xl:grid-cols-2">
          <BreakdownTable title="Traffic sources" description="By UTM source, or the referring site." first="Source" rows={sources} />
          <BreakdownTable title="Landing pages" description="Where visitors arrived." first="Page" rows={landings} />
          <BreakdownTable title="Countries" description="Based on the visitor's location." first="Country" rows={countries} label={(v) => (v === "coupon" ? "Coupon only" : countryName(v))} />
          <BreakdownTable title="Devices" description="Desktop, mobile or tablet." first="Device" rows={devices} label={(v) => (v === "coupon" ? "Coupon only" : v.charAt(0).toUpperCase() + v.slice(1))} />
        </div>
      </div>
    </div>
  )
}
