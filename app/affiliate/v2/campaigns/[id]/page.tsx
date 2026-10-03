import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, CircleDollarSign, DollarSign, MousePointerClick, Percent, Sparkles, UserPlus, Users } from "lucide-react"
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliateLinks } from "@/lib/db/schema"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { buildTrackingUrl, rate } from "@/lib/affiliates/engine"
import { SITE_URL } from "@/lib/affiliates/program"
import { money, parseRange, pct, rangeStart } from "@/lib/affiliates/types"
import { campaignDetail } from "@/lib/affiliates/v2/server"
import { affiliateHref } from "@/lib/urls"
import { MetricSwitcher } from "@/components/affiliate/v2/charts"
import { EditCampaignButton } from "@/components/affiliate/v2/campaigns"
import { ReferralLinkActions } from "@/components/affiliate/v2/referral-link"
import { IconTile, PageFrame, RangeTabs, StatusChip, V2Card, ghostBtnClass } from "@/components/affiliate/v2/ui"

export const metadata: Metadata = { title: "Campaign" }

export default async function AffiliateV2Campaign({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ range?: string }> }) {
  const { affiliate } = await requireAffiliate()
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()
  const range = parseRange((await searchParams).range)
  // Only ever this affiliate's own campaign: campaignDetail is scoped to them.
  const data = await campaignDetail(affiliate.id, id, rangeStart(range))
  if (!data) notFound()
  const { campaign: c, totals: t, series } = data
  const [link] = await db.select().from(affiliateLinks).where(and(eq(affiliateLinks.affiliateId, affiliate.id), eq(affiliateLinks.campaignId, c.id), eq(affiliateLinks.status, "active"))).limit(1)
  const url = link ? buildTrackingUrl({ base: SITE_URL, code: affiliate.code, landingPage: c.landingPage, linkToken: link.token, utm: { source: c.utmSource, medium: c.utmMedium, campaign: c.utmCampaign, content: c.utmContent } }) : null
  const kpis = [
    { icon: MousePointerClick, label: "Clicks", value: t.clicks.toLocaleString("en-US") },
    { icon: UserPlus, label: "Sign-ups", value: t.signups.toLocaleString("en-US") },
    { icon: Sparkles, label: "Trials", value: t.trials.toLocaleString("en-US") },
    { icon: Users, label: "Customers", value: t.customers.toLocaleString("en-US") },
    { icon: Percent, label: "Conversion", value: t.clicks ? pct(rate(t.customers, t.clicks)) : "—" },
    { icon: DollarSign, label: "Revenue", value: money(t.revenue) },
    { icon: CircleDollarSign, label: "Commission", value: money(t.commission) },
  ]

  return (
    <PageFrame
      title={c.name}
      description="Campaign detail"
      action={
        <>
          <Link href={affiliateHref("/affiliate/v2/campaigns")} className={ghostBtnClass}>
            <ArrowLeft className="size-4" aria-hidden /> All campaigns
          </Link>
          <EditCampaignButton campaign={{ id: c.id, name: c.name, description: c.description, landingPage: c.landingPage, utmSource: c.utmSource, utmMedium: c.utmMedium, utmCampaign: c.utmCampaign, utmContent: c.utmContent, status: c.status, url, stats: { clicks: t.clicks, signups: t.signups, customers: t.customers, revenue: t.revenue, commission: t.commission } }} />
        </>
      }
    >
      <section className="v2-card-glow flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-primary uppercase">
            Campaign <StatusChip status={c.status} />
          </p>
          <h2 className="mt-1 truncate text-2xl font-bold tracking-tight">{c.name}</h2>
          {c.description && <p className="mt-1 max-w-xl text-sm text-muted-foreground">{c.description}</p>}
        </div>
        {url && <ReferralLinkActions url={url} className="lg:w-[420px]" />}
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-7">
        {kpis.map((k) => (
          <div key={k.label} className="v2-card flex min-w-0 items-center gap-3 p-4">
            <IconTile icon={k.icon} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">{k.label}</p>
              <p className="truncate text-lg font-semibold tabular-nums">{k.value}</p>
            </div>
          </div>
        ))}
      </div>

      <V2Card title="Performance" subtitle="This campaign over the selected period." action={<RangeTabs range={range} path={`/affiliate/v2/campaigns/${c.id}`} className="max-sm:hidden" />}>
        <RangeTabs range={range} path={`/affiliate/v2/campaigns/${c.id}`} className="mb-3 self-start sm:hidden" />
        <MetricSwitcher points={series.points} unit={series.unit} metrics={["commission", "clicks", "signups", "customers", "revenue"]} height="h-60 sm:h-72" />
      </V2Card>
    </PageFrame>
  )
}
