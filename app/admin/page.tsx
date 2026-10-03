import { Suspense } from "react"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { getAdminPrefs } from "@/lib/admin/preferences"
import { capabilities } from "@/lib/admin/command-center"
import { RANGE_DAYS, parseRange } from "@/lib/admin/command-center-rules"
import { LegacyOverview } from "@/components/admin/legacy-overview"
import { OverviewHeader } from "@/components/admin/command/overview-header"
import { OverviewLayout } from "@/components/admin/command/overview-layout"
import { CardSkeleton, HealthSkeleton, KpiSkeleton } from "@/components/admin/command/cards"
import { ActivityWidget, AffiliateWidget, AttentionWidget, HealthWidget, KpiWidget, PayoutWidget, RevenueWidget, SupportWidget, TradingWidget } from "@/components/admin/command/widgets"

export default async function AdminOverviewPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const admin = await requireAdmin({ user: ["list"] })
  const prefs = await getAdminPrefs(admin.id)
  if (prefs.dashboard === "legacy") return <LegacyOverview canBilling={roleCan(admin.role, { billing: ["view"] })} />

  // The command center. What it shows follows the admin's role: a widget
  // whose page they can't open isn't rendered at all. Each widget loads on its
  // own, behind its own skeleton.
  const range = parseRange((await searchParams).range)
  const days = RANGE_DAYS[range]
  const can = capabilities(admin.role)
  const kpiCount = 3 + Number(can.billing) + Number(can.affiliates)

  const ops = [
    (can.analytics || can.brokers) && (
      <Suspense key={`trading-${range}`} fallback={<CardSkeleton title="Trading activity" rows={3} />}>
        <TradingWidget can={can} days={days} />
      </Suspense>
    ),
    can.affiliates && (
      <Suspense key={`aff-${range}`} fallback={<CardSkeleton title="Affiliate operations" rows={4} />}>
        <AffiliateWidget days={days} />
      </Suspense>
    ),
    can.affiliates && (
      <Suspense key={`payouts-${range}`} fallback={<CardSkeleton title="Payout operations" rows={6} />}>
        <PayoutWidget days={days} />
      </Suspense>
    ),
    can.support && (
      <Suspense key={`support-${range}`} fallback={<CardSkeleton title="Support center" rows={3} />}>
        <SupportWidget days={days} />
      </Suspense>
    ),
  ].filter((x): x is React.JSX.Element => !!x)

  return (
    <OverviewLayout
      header={<OverviewHeader range={range} />}
      kpis={
        <Suspense key={`kpi-${range}`} fallback={<KpiSkeleton count={kpiCount} />}>
          <KpiWidget can={can} days={days} />
        </Suspense>
      }
      attention={(className) => (
        <Suspense fallback={<CardSkeleton title="Needs attention" rows={5} className={className} />}>
          <AttentionWidget can={can} className={className} />
        </Suspense>
      )}
      revenue={
        can.billing
          ? (className) => (
              <Suspense key={`rev-${range}`} fallback={<CardSkeleton title="Revenue & growth" rows={1} chart className={className} />}>
                <RevenueWidget days={days} className={className} />
              </Suspense>
            )
          : null
      }
      activity={(className) => (
        <Suspense fallback={<CardSkeleton title="Recent activity" rows={6} className={className} />}>
          <ActivityWidget can={can} className={className} />
        </Suspense>
      )}
      ops={ops}
      health={
        can.security ? (
          <Suspense fallback={<HealthSkeleton />}>
            <HealthWidget />
          </Suspense>
        ) : null
      }
    />
  )
}
