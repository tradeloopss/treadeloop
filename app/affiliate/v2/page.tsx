import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Hourglass, Trophy, Users, Wallet } from "lucide-react"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { balancesFor, releaseHolds } from "@/lib/affiliates/commissions"
import { buildTrackingUrl, tierFor, tierRateText } from "@/lib/affiliates/engine"
import { SITE_URL, currentRule, getProgram, loadTiers, paidCustomerCount } from "@/lib/affiliates/program"
import { breakdown, defaultLink, linksWithStats, notificationsFor, performance } from "@/lib/affiliates/queries"
import { LANDING_PAGES, money, parseRange } from "@/lib/affiliates/types"
import { achievements, insights, monthlyGoals } from "@/lib/affiliates/v2/config"
import { achievementStats, getV2Config, monthProgress, nextRelease } from "@/lib/affiliates/v2/server"
import { affiliateHref } from "@/lib/urls"
import { AchievementsPreview, ActivityList, CommissionBreakdown, ConversionFunnel, GoalsCard, HeroBanner, TierProgress, TodaysFocus, WalletPreview } from "@/components/affiliate/v2/dashboard"
import { GlowChart, MetricSwitcher } from "@/components/affiliate/v2/charts"
import { ReferralLinkActions } from "@/components/affiliate/v2/referral-link"
import { MetricCard, RangeTabs, V2Card, btnClass } from "@/components/affiliate/v2/ui"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Dashboard" }

export default async function AffiliateV2Dashboard({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { affiliate } = await requireAffiliate()
  const range = parseRange((await searchParams).range)
  // Clear anything whose hold has passed first, so the balances never wait on the daily job.
  await releaseHolds({ affiliateId: affiliate.id })
  const [perf, balances, program, rule, tiers, customers, link, notes, release, month, stats, links, config] = await Promise.all([
    performance(affiliate.id, range, affiliate.createdAt),
    balancesFor(affiliate.id),
    getProgram(),
    currentRule(affiliate.id),
    loadTiers(),
    paidCustomerCount(affiliate.id),
    defaultLink(affiliate.id),
    notificationsFor(affiliate.id, 8),
    nextRelease(affiliate.id),
    monthProgress(affiliate.id),
    achievementStats(affiliate.id),
    linksWithStats(affiliate.id),
    getV2Config(),
  ])
  const sources = await breakdown(affiliate.id, perf.start, "source", 12)
  const { current, previous } = perf
  const url = buildTrackingUrl({ base: SITE_URL, code: affiliate.code, linkToken: link?.token })
  const tier = tierFor(tiers, customers, affiliate.tierId)
  const live = tiers.filter((t) => t.enabled).sort((a, b) => a.minCustomers - b.minCustomers)
  const nextTier = live.find((t) => t.minCustomers > Math.max(customers, 1)) ?? null
  const paid = tier && rule.source === "tier" ? tierRateText(tier) : `${rule.ratePercent}%`
  const best = [...links].filter((l) => l.status === "active").sort((a, b) => b.stats.customers - a.stats.customers || b.stats.signups - a.stats.signups)[0]
  const linkLabel = (l: (typeof links)[number]) => l.campaign?.name ?? (l.isDefault ? "your main link" : (LANDING_PAGES.find((p) => p.path === l.landingPage)?.label ?? l.landingPage))
  const focus = insights(
    {
      nextRelease: release,
      nextTier: nextTier ? { name: nextTier.name, needed: nextTier.minCustomers - customers } : null,
      sources: sources.map((s) => ({ label: s.label, customers: s.customers, signups: s.signups })),
      current: { clicks: current.clicks, customers: current.customers },
      previous: previous ? { clicks: previous.clicks, customers: previous.customers } : null,
      bestLink: best ? { label: linkLabel(best), customers: best.stats.customers } : null,
      linkCount: links.filter((l) => l.status === "active").length,
    },
    new Date()
  )
  const goals = monthlyGoals(config.goals, month, new Date())
  const badges = achievements({ ...stats, lifetimeEarned: balances.lifetimeEarned }, live.map((t) => ({ id: t.id, name: t.name, minCustomers: t.minCustomers, style: t.style ?? "plain" })))
  const withdrawHref = config.features.wallet ? "/affiliate/v2/wallet?withdraw=1" : "/affiliate/v2/payouts?withdraw=1"
  const funnel = { clicks: current.clicks, signups: current.signups, trials: current.trials, customers: current.customers }
  const activity = notes.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, href: n.href, at: n.createdAt.toISOString() }))
  const periodTotal = Math.round(perf.series.points.reduce((s, p) => s + p.commission, 0) * 100) / 100

  return (
    <div className="mx-auto w-full max-w-[1720px] p-4 sm:p-5 lg:p-6 2xl:grid 2xl:grid-cols-[minmax(0,1fr)_340px] 2xl:items-start 2xl:gap-5">
      <div className="min-w-0 space-y-4 lg:space-y-5">
        <div className="md:hidden">
          <h1 className="text-xl font-semibold tracking-tight">Welcome back, {affiliate.firstName} 👋</h1>
          <p className="text-sm text-muted-foreground">Here&apos;s your affiliate performance.</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3 lg:gap-5">
          <div className="order-2 min-w-0 lg:order-1 lg:col-span-2">
            <HeroBanner rateText={`${rule.ratePercent}%`} url={url} />
          </div>
          <div className="order-1 min-w-0 lg:order-2">
            <TodaysFocus firstName={affiliate.firstName} items={focus} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <MetricCard
            icon={Wallet}
            label="Available balance"
            value={money(balances.available)}
            className="col-span-2 sm:col-span-1"
            sub={balances.processing > 0 ? `${money(balances.processing)} being paid out` : `Minimum payout ${money(program.minPayout)}`}
            action={
              <Link href={affiliateHref(withdrawHref)} className={cn(btnClass, "h-8 w-full text-xs sm:w-auto")}>
                Withdraw Now <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            }
          />
          <MetricCard icon={Hourglass} label="Pending commission" value={money(balances.pending)} sub={`Clears after ${program.holdDays} days`} />
          <MetricCard icon={Trophy} label="Lifetime earned" value={money(balances.lifetimeEarned)} sub={`${money(balances.lifetimePaid)} paid out`} />
          <MetricCard icon={Users} label="Paying customers" value={customers.toLocaleString("en-US")} sub={tier ? `${tier.name} tier · ${paid}` : `${paid} commission`} className="col-span-2 sm:col-span-1" />
        </div>

        <div className="grid gap-4 lg:grid-cols-3 lg:gap-5">
          <V2Card
            title="Earnings overview"
            subtitle={
              <>
                <span className="font-semibold text-foreground tabular-nums">{money(periodTotal)}</span> commission in this period
              </>
            }
            action={<RangeTabs range={range} path="/affiliate/v2" className="max-sm:hidden" />}
            className="lg:col-span-2"
          >
            <RangeTabs range={range} path="/affiliate/v2" className="mb-3 self-start sm:hidden" />
            <GlowChart points={perf.series.points} unit={perf.series.unit} metric="commission" height="h-56 sm:h-64" />
          </V2Card>
          <CommissionBreakdown t={funnel} />
        </div>

        <V2Card title="Your referral link" subtitle={`Earn commission on every payment from customers who sign up within ${program.cookieDays} days of clicking it.`}>
          <ReferralLinkActions url={url} />
        </V2Card>

        <div className="grid gap-4 lg:grid-cols-3 lg:gap-5">
          <V2Card title="Performance" subtitle="Switch the metric to compare how the period went.">
            <MetricSwitcher points={perf.series.points} unit={perf.series.unit} height="h-40" />
          </V2Card>
          <ConversionFunnel t={funnel} />
          <WalletPreview available={balances.available} pending={balances.pending} lifetime={balances.lifetimeEarned} walletHref={config.features.wallet ? "/affiliate/v2/wallet" : "/affiliate/v2/payouts"} withdrawHref={withdrawHref} />
        </div>

        {live.length > 0 && (
          <TierProgress
            tiers={live.map((t) => ({ id: t.id, name: t.name, minCustomers: t.minCustomers, rateText: tierRateText(t), style: t.style ?? "plain" }))}
            currentId={tier?.id ?? null}
            customers={customers}
            next={nextTier ? { id: nextTier.id, name: nextTier.name, minCustomers: nextTier.minCustomers, rateText: tierRateText(nextTier), style: nextTier.style ?? "plain" } : null}
          />
        )}
      </div>

      {/* Beside the dashboard on wide screens; below it otherwise. */}
      <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:mt-0 2xl:flex 2xl:flex-col 2xl:gap-5">
        <ActivityList items={activity} />
        {config.features.goals && <GoalsCard goal={goals.goal} challenges={goals.challenges} />}
        {config.features.achievements && <AchievementsPreview items={badges} />}
      </div>
    </div>
  )
}
