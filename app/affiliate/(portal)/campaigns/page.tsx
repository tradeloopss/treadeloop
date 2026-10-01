import type { Metadata } from "next"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { buildTrackingUrl } from "@/lib/affiliates/engine"
import { SITE_URL } from "@/lib/affiliates/program"
import { campaignsWithStats } from "@/lib/affiliates/queries"
import { PageHeader } from "@/components/page-header"
import { CampaignsManager } from "@/components/affiliate/campaigns"

export const metadata: Metadata = { title: "Campaigns" }

export default async function AffiliateCampaignsPage() {
  const { affiliate } = await requireAffiliate()
  const campaigns = await campaignsWithStats(affiliate.id)
  return (
    <div>
      <PageHeader title="Campaigns" description="Group your traffic by channel and compare what each one brings in." />
      <div className="p-4 sm:p-6">
        <CampaignsManager
          campaigns={campaigns.map((c) => ({
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
      </div>
    </div>
  )
}
