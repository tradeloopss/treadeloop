import { activity, affiliateOps, attention, kpis, payoutOps, revenueOverview, supportCenter, systemHealth, trading, type ActivityCategory, type Capabilities } from "@/lib/admin/command-center"
import { AffiliateOperations, KpiCards, NeedsAttention, PayoutOperations, SupportCenter, SystemHealth, TradingActivity } from "@/components/admin/command/cards"
import { RevenuePanel } from "@/components/admin/command/revenue-panel"
import { RecentActivity } from "@/components/admin/command/recent-activity"
import { RefreshButton, SectionError } from "@/components/admin/command/overview-header"

// The Overview's widgets, each loading its own data inside its own Suspense
// boundary (app/admin/page.tsx): the page streams in as each is ready, and a
// widget whose query fails shows "Unable to load this section" on its own.

async function load<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (e) {
    console.error(`[admin overview] ${name} failed:`, e instanceof Error ? e.message : e)
    return null
  }
}

export async function KpiWidget({ can, days }: { can: Capabilities; days: number }) {
  const items = await load("kpis", () => kpis(can, days))
  return items ? <KpiCards items={items} /> : <SectionError title="Key metrics" />
}

export async function RevenueWidget({ days, className }: { days: number; className?: string }) {
  const data = await load("revenue", () => revenueOverview(days))
  return data ? <RevenuePanel data={data} days={days} className={className} /> : <SectionError title="Revenue & growth" className={className} />
}

export async function AttentionWidget({ can, className }: { can: Capabilities; className?: string }) {
  const items = await load("attention", () => attention(can))
  // A role with no queues of its own (Content) doesn't get an empty card.
  if (items && items.length === 0) return null
  return items ? <NeedsAttention items={items} className={className} /> : <SectionError title="Needs attention" className={className} />
}

export async function ActivityWidget({ can, className }: { can: Capabilities; className?: string }) {
  const items = await load("activity", () => activity(can, 30))
  const categories: ActivityCategory[] = (["users", "payments", "support", "trading", "security"] as const).filter((c) =>
    c === "users" ? can.users || can.affiliates : c === "payments" ? can.billing || can.affiliates : c === "support" ? can.support : c === "trading" ? can.brokers : can.security
  )
  return items ? <RecentActivity items={items} categories={categories} className={className} /> : <SectionError title="Recent activity" className={className} />
}

export async function TradingWidget({ can, days }: { can: Capabilities; days: number }) {
  const data = await load("trading", () => trading(days))
  return data ? <TradingActivity data={data} days={days} href={can.analytics ? "/admin/analytics" : null} /> : <SectionError title="Trading activity" />
}

export async function AffiliateWidget({ days }: { days: number }) {
  const data = await load("affiliates", () => affiliateOps(days))
  return data ? <AffiliateOperations data={data} days={days} /> : <SectionError title="Affiliate operations" />
}

export async function PayoutWidget({ days }: { days: number }) {
  const data = await load("payouts", () => payoutOps(days))
  return data ? <PayoutOperations data={data} /> : <SectionError title="Payout operations" />
}

export async function SupportWidget({ days }: { days: number }) {
  const data = await load("support", () => supportCenter(days))
  return data ? <SupportCenter data={data} days={days} /> : <SectionError title="Support center" />
}

export async function HealthWidget() {
  const data = await load("health", () => systemHealth())
  return data ? <SystemHealth checks={data.checks} checkedAt={data.checkedAt} refresh={<RefreshButton />} /> : <SectionError title="System health" />
}
