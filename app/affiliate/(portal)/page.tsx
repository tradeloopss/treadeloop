import type { Metadata } from "next"
import Link from "next/link"
import { CircleDollarSign, Hourglass, MousePointerClick, Target, UserPlus, Users, Wallet } from "lucide-react"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { balancesFor, releaseHolds } from "@/lib/affiliates/commissions"
import { ensurePermanentCoupon } from "@/lib/affiliates/coupons"
import { buildTrackingUrl, rate, tierFor } from "@/lib/affiliates/engine"
import { SITE_URL, currentRule, getProgram, loadTiers, paidCustomerCount } from "@/lib/affiliates/program"
import { campaignsWithStats, defaultLink, performance, recentReferrals } from "@/lib/affiliates/queries"
import { count, money, parseRange, pct } from "@/lib/affiliates/types"
import { PageHeader } from "@/components/page-header"
import { BarList, Panel } from "@/components/admin/ui"
import { Empty, Kpi, KpiGrid, RangeTabs, StatusBadge, TableShell, THead, fmtDay, primaryLinkClass, tdClass, thClass } from "@/components/affiliate/ui"
import { PerformanceChart } from "@/components/affiliate/performance-chart"
import { ReferralLinkCard } from "@/components/affiliate/link-card"
import { affiliateHref } from "@/lib/urls"

export const metadata: Metadata = { title: "Overview" }

export default async function AffiliateOverviewPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { affiliate } = await requireAffiliate()
  const range = parseRange((await searchParams).range)
  // Clear anything whose hold has passed before reading the balance, so the
  // numbers never wait on the daily job.
  await releaseHolds({ affiliateId: affiliate.id })
  const [perf, balances, program, rule, tiers, customers, link, campaigns, recent] = await Promise.all([
    performance(affiliate.id, range, affiliate.createdAt),
    balancesFor(affiliate.id),
    getProgram(),
    currentRule(affiliate.id),
    loadTiers(),
    paidCustomerCount(affiliate.id),
    defaultLink(affiliate.id),
    campaignsWithStats(affiliate.id, null),
    recentReferrals(affiliate.id, 6),
  ])
  const { current, previous } = perf
  // Their permanent discount code. Created on the spot for anyone who was
  // approved before these existed; a failure here must not break the page.
  const permanent = await ensurePermanentCoupon(affiliate.id).catch(() => null)
  const url = buildTrackingUrl({ base: SITE_URL, code: affiliate.code, linkToken: link?.token })
  const tier = tierFor(tiers, customers, affiliate.tierId)
  const next = tiers.filter((t) => t.enabled && t.minCustomers > customers).sort((a, b) => a.minCustomers - b.minCustomers)[0]
  const topCampaigns = campaigns
    .filter((c) => c.status === "active")
    .sort((a, b) => b.stats.commission - a.stats.commission || b.stats.clicks - a.stats.clicks)
    .slice(0, 5)

  return (
    <div>
      <PageHeader title={`Welcome back, ${affiliate.firstName}`} description="How your referrals are performing." action={<RangeTabs range={range} />} />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <KpiGrid>
          <Kpi label="Available to withdraw" value={money(balances.available)} icon={Wallet} note={balances.processing > 0 ? `${money(balances.processing)} being paid out` : `Minimum payout ${money(program.minPayout)}`} />
          <Kpi label="Pending commission" value={money(balances.pending)} icon={Hourglass} note={`Clears after ${program.holdDays} days`} />
          <Kpi label="Lifetime earned" value={money(balances.lifetimeEarned)} icon={CircleDollarSign} note={`${money(balances.lifetimePaid)} paid out`} />
          <Kpi label="Paying customers" value={count(customers)} icon={Users} note={tier ? `${tier.name} tier · ${rule.ratePercent}%` : `${rule.ratePercent}% commission`} />
        </KpiGrid>

        <ReferralLinkCard url={url} code={affiliate.code} rate={rule.ratePercent} cookieDays={program.cookieDays} coupon={permanent && permanent.status === "active" ? { code: permanent.code, percent: Number(permanent.discountValue), months: permanent.durationMonths } : null} />

        <KpiGrid>
          <Kpi label="Clicks" value={count(current.clicks)} icon={MousePointerClick} current={current.clicks} previous={previous?.clicks ?? null} />
          <Kpi label="Sign-ups" value={count(current.signups)} icon={UserPlus} current={current.signups} previous={previous?.signups ?? null} />
          <Kpi label="New customers" value={count(current.customers)} icon={Target} current={current.customers} previous={previous?.customers ?? null} />
          <Kpi label="Commission earned" value={money(current.commission)} icon={CircleDollarSign} current={current.commission} previous={previous?.commission ?? null} />
        </KpiGrid>

        <div className="grid gap-4 xl:grid-cols-3">
          <Panel title="Performance" description="Switch the metric to compare how the period went." className="xl:col-span-2">
            <PerformanceChart points={perf.series.points} unit={perf.series.unit} />
          </Panel>
          <Panel title="Conversion funnel" description={`Click → customer: ${pct(rate(current.customers, current.clicks))}`}>
            {current.clicks + current.signups === 0 ? (
              <Empty title="No traffic in this period">Share your link to start seeing clicks here.</Empty>
            ) : (
              <BarList
                unit="visitors"
                total={Math.max(current.clicks, current.signups)}
                items={[
                  { label: "Clicks", value: current.clicks },
                  { label: "Sign-ups", value: current.signups },
                  { label: "Trials started", value: current.trials },
                  { label: "Paying customers", value: current.customers },
                ]}
              />
            )}
          </Panel>
        </div>

        {next && (
          <section className="rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">
                {next.minCustomers - customers} more paying customer{next.minCustomers - customers === 1 ? "" : "s"} to reach {next.name}
              </h2>
              <p className="text-xs text-muted-foreground">
                {next.name} pays {next.ratePercent}%{tier ? ` · you're on ${tier.name} (${tier.ratePercent}%)` : ""}
              </p>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={next.minCustomers} aria-valuenow={customers} aria-label={`Progress to ${next.name}`}>
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (customers / next.minCustomers) * 100)}%` }} />
            </div>
            <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">
              {customers} / {next.minCustomers} paying customers
            </p>
          </section>
        )}

        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Top campaigns" description="All time, by commission." action={<Link href={affiliateHref("/affiliate/campaigns")} className="text-xs font-medium text-primary hover:underline">All campaigns</Link>}>
            {topCampaigns.length === 0 ? (
              <Empty icon={Target} title="No campaigns yet" action={<Link href={affiliateHref("/affiliate/campaigns")} className={primaryLinkClass}>Create a campaign</Link>}>
                Give each channel its own link to see which one converts.
              </Empty>
            ) : (
              <TableShell className="border-0">
                <THead>
                  <tr>
                    <th className={thClass}>Campaign</th>
                    <th className={`${thClass} text-end`}>Clicks</th>
                    <th className={`${thClass} text-end`}>Customers</th>
                    <th className={`${thClass} text-end`}>Commission</th>
                  </tr>
                </THead>
                <tbody className="divide-y">
                  {topCampaigns.map((c) => (
                    <tr key={c.id}>
                      <td className={`${tdClass} font-medium`}>{c.name}</td>
                      <td className={`${tdClass} text-end tabular-nums`}>{count(c.stats.clicks)}</td>
                      <td className={`${tdClass} text-end tabular-nums`}>{count(c.stats.customers)}</td>
                      <td className={`${tdClass} text-end tabular-nums`}>{money(c.stats.commission)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Panel>

          <Panel title="Recent referrals" action={<Link href={affiliateHref("/affiliate/referrals")} className="text-xs font-medium text-primary hover:underline">All referrals</Link>}>
            {recent.length === 0 ? (
              <Empty icon={Users} title="No referrals yet">When someone signs up through your link they&apos;ll appear here.</Empty>
            ) : (
              <TableShell className="border-0">
                <THead>
                  <tr>
                    <th className={thClass}>Referral</th>
                    <th className={thClass}>Status</th>
                    <th className={thClass}>Signed up</th>
                    <th className={`${thClass} text-end`}>Commission</th>
                  </tr>
                </THead>
                <tbody className="divide-y">
                  {recent.map((r) => (
                    <tr key={r.id}>
                      <td className={`${tdClass} font-mono text-xs`}>{r.publicId}</td>
                      <td className={tdClass}>
                        <StatusBadge status={r.status} />
                      </td>
                      <td className={`${tdClass} text-muted-foreground`}>{fmtDay(r.createdAt)}</td>
                      <td className={`${tdClass} text-end tabular-nums`}>{money(r.commission)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
