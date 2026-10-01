import type { Metadata } from "next"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { buildTrackingUrl } from "@/lib/affiliates/engine"
import { SITE_URL } from "@/lib/affiliates/program"
import { linksWithStats } from "@/lib/affiliates/queries"
import { PageHeader } from "@/components/page-header"
import { LinkBuilder, LinksManager } from "@/components/affiliate/links"

export const metadata: Metadata = { title: "Links" }

export default async function AffiliateLinksPage() {
  const { affiliate } = await requireAffiliate()
  const links = await linksWithStats(affiliate.id)
  const main = links.find((l) => l.isDefault) ?? null
  const campaigns = [...new Map(links.filter((l) => l.campaign && l.campaign.status === "active").map((l) => [l.campaign!.id, { id: l.campaign!.id, name: l.campaign!.name }])).values()]

  return (
    <div>
      <PageHeader title="Links" description="Your tracking links, and a builder for tagged ones." />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <LinkBuilder base={SITE_URL} code={affiliate.code} token={main?.token ?? null} />
        <LinksManager
          campaigns={campaigns}
          links={links.map((l) => ({
            id: l.id,
            landingPage: l.landingPage,
            isDefault: l.isDefault,
            status: l.status,
            campaign: l.campaign?.name ?? null,
            stats: { clicks: l.stats.clicks, signups: l.stats.signups, customers: l.stats.customers },
            url: buildTrackingUrl({
              base: SITE_URL,
              code: affiliate.code,
              landingPage: l.landingPage,
              linkToken: l.token,
              utm: l.campaign ? { source: l.campaign.utmSource, medium: l.campaign.utmMedium, campaign: l.campaign.utmCampaign, content: l.campaign.utmContent } : undefined,
            }),
          }))}
        />
      </div>
    </div>
  )
}
