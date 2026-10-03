import type { Metadata } from "next"
import Link from "next/link"
import { CircleDollarSign, MousePointerClick, Percent, Sparkles, Target, UserPlus, Users } from "lucide-react"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { rate } from "@/lib/affiliates/engine"
import { breakdown, campaignsWithStats, performance, type BreakdownRow } from "@/lib/affiliates/queries"
import { money, parseRange, pct } from "@/lib/affiliates/types"
import { sourceName } from "@/lib/affiliates/v2/config"
import { affiliateHref } from "@/lib/urls"
import { MetricSwitcher } from "@/components/affiliate/v2/charts"
import { Delta, EmptyState, IconTile, PageFrame, ProgressRow, RangeTabs, V2Card } from "@/components/affiliate/v2/ui"

export const metadata: Metadata = { title: "Analytics" }

const countryName = (code: string) => {
  if (!/^[A-Z]{2}$/.test(code)) return code === "unknown" ? "Unknown" : code === "coupon" ? "Coupon only" : code
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code
  } catch {
    return code
  }
}

function Breakdown({ title, rows, label }: { title: string; rows: BreakdownRow[]; label: (v: string) => string }) {
  const top = Math.max(1, ...rows.map((r) => r.clicks || r.signups))
  return (
    <V2Card title={title} subtitle="Clicks, and how many became customers">
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">Nothing in this period.</p>
      ) : (
        rows.map((r) => <ProgressRow key={r.label} label={label(r.label)} value={r.clicks || r.signups} of={top} valueText={(r.clicks || r.signups).toLocaleString("en-US")} note={`${r.customers} customer${r.customers === 1 ? "" : "s"}`} />)
      )}
    </V2Card>
  )
}

export default async function AffiliateV2Analytics({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
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
  const { current: c, previous: p } = perf
  const conv = rate(c.customers, c.clicks)
  const convBefore = p ? rate(p.customers, p.clicks) : null
  const kpis = [
    { icon: CircleDollarSign, label: "Total earnings", value: money(c.commission), now: c.commission, before: p?.commission },
    { icon: MousePointerClick, label: "Clicks", value: c.clicks.toLocaleString("en-US"), now: c.clicks, before: p?.clicks },
    { icon: UserPlus, label: "Sign-ups", value: c.signups.toLocaleString("en-US"), now: c.signups, before: p?.signups },
    { icon: Sparkles, label: "Trials", value: c.trials.toLocaleString("en-US"), now: c.trials, before: p?.trials },
    { icon: Users, label: "Customers", value: c.customers.toLocaleString("en-US"), now: c.customers, before: p?.customers },
    { icon: Percent, label: "Conversion rate", value: pct(conv), now: conv, before: convBefore },
  ]
  const top = campaigns.filter((x) => x.stats.clicks + x.stats.signups + x.stats.customers > 0).sort((a, b) => b.stats.commission - a.stats.commission || b.stats.clicks - a.stats.clicks).slice(0, 6)
  const titled = (v: string) => (v === "direct" ? "Direct / unknown" : v === "coupon" ? "Coupon only" : sourceName(v))

  return (
    <PageFrame title="Analytics" description="Where your traffic comes from and what it turns into." action={<RangeTabs range={range} path="/affiliate/v2/analytics" />}>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="v2-card flex min-w-0 items-start gap-3 p-4">
            <IconTile icon={k.icon} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">{k.label}</p>
              <p className="truncate text-xl font-semibold tracking-tight tabular-nums">{k.value}</p>
              <Delta now={k.now} before={k.before} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-5">
        <V2Card title="Trend" subtitle="One metric at a time across the selected period." className="lg:col-span-2">
          <MetricSwitcher points={perf.series.points} unit={perf.series.unit} metrics={["commission", "clicks", "signups", "customers"]} height="h-60 sm:h-72" />
        </V2Card>
        <V2Card title="Top campaigns" subtitle="By commission in this period" action={<Link href={affiliateHref("/affiliate/v2/campaigns")} className="text-xs font-medium text-primary hover:underline">All</Link>}>
          {top.length === 0 ? (
            <EmptyState icon={Target} title="No campaign activity" className="py-6">
              Traffic through your main link is counted in the totals.
            </EmptyState>
          ) : (
            <ul className="divide-y">
              {top.map((x) => (
                <li key={x.id}>
                  <Link href={affiliateHref(`/affiliate/v2/campaigns/${x.id}`)} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/40">
                    <IconTile icon={Target} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{x.name}</span>
                      <span className="block text-xs text-muted-foreground">{x.stats.clicks ? pct(rate(x.stats.customers, x.stats.clicks)) : "—"} conversion</span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums">{money(x.stats.commission)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </V2Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:gap-5">
        <Breakdown title="Traffic sources" rows={sources} label={titled} />
        <Breakdown title="Landing pages" rows={landings} label={titled} />
        <Breakdown title="Countries" rows={countries} label={countryName} />
        <Breakdown title="Devices" rows={devices} label={(v) => (v === "coupon" ? "Coupon only" : v.charAt(0).toUpperCase() + v.slice(1))} />
      </div>
    </PageFrame>
  )
}
