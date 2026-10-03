import type { Metadata } from "next"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { buildTrackingUrl } from "@/lib/affiliates/engine"
import { SITE_URL, currentRule } from "@/lib/affiliates/program"
import { campaignsWithStats } from "@/lib/affiliates/queries"
import { CampaignCards, NewCampaignButton } from "@/components/affiliate/v2/campaigns"
import { PageFrame } from "@/components/affiliate/v2/ui"

export const metadata: Metadata = { title: "Campaigns" }

export default async function AffiliateV2Campaigns({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const { affiliate } = await requireAffiliate()
  const sp = await searchParams
  const [campaigns, rule] = await Promise.all([campaignsWithStats(affiliate.id), currentRule(affiliate.id)])
  // Active first, then archived; newest first within each.
  const sorted = [...campaigns].sort((a, b) => Number(b.status === "active") - Number(a.status === "active"))
  return (
    <PageFrame title="Campaigns" description="Group your traffic by channel and compare what each brings in." action={<NewCampaignButton autoOpen={sp.new === "1"} />}>
      <CampaignCards
        rateText={`${rule.ratePercent}% commission`}
        campaigns={sorted.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          landingPage: c.landingPage,
          utmSource: c.utmSource,
          utmMedium: c.utmMedium,
          utmCampaign: c.utmCampaign,
          utmContent: c.utmContent,
          status: c.status,
          stats: c.stats,
          url: c.link ? buildTrackingUrl({ base: SITE_URL, code: affiliate.code, landingPage: c.landingPage, linkToken: c.link.token, utm: { source: c.utmSource, medium: c.utmMedium, campaign: c.utmCampaign, content: c.utmContent } }) : null,
        }))}
      />
    </PageFrame>
  )
}
