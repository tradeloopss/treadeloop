import type { Metadata } from "next"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { buildTrackingUrl } from "@/lib/affiliates/engine"
import { SITE_URL } from "@/lib/affiliates/program"
import { linksWithStats } from "@/lib/affiliates/queries"
import { LANDING_PAGES } from "@/lib/affiliates/types"
import { LinkCards, NewSmartLinkButton } from "@/components/affiliate/v2/links"
import { PageFrame } from "@/components/affiliate/v2/ui"

export const metadata: Metadata = { title: "Links" }

export default async function AffiliateV2Links({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const { affiliate } = await requireAffiliate()
  const sp = await searchParams
  const links = await linksWithStats(affiliate.id)
  const landing = (path: string) => LANDING_PAGES.find((p) => p.path === path)?.label ?? path
  return (
    <PageFrame title="Smart links" description="Tracking links for every channel, with their results." action={<NewSmartLinkButton autoOpen={sp.new === "1"} />}>
      <LinkCards
        links={links.map((l) => {
          const c = l.campaign
          return {
            id: l.id,
            url: buildTrackingUrl({ base: SITE_URL, code: affiliate.code, landingPage: l.landingPage, linkToken: l.token, utm: c ? { source: c.utmSource, medium: c.utmMedium, campaign: c.utmCampaign, content: c.utmContent } : undefined }),
            label: c?.name ?? (l.isDefault ? "Your referral link" : `${landing(l.landingPage)} link`),
            channel: c?.utmSource ?? null,
            landing: landing(l.landingPage),
            isDefault: l.isDefault,
            status: l.status,
            campaign: c ? { id: c.id, name: c.name, description: c.description, landingPage: c.landingPage, utmSource: c.utmSource, utmMedium: c.utmMedium, utmCampaign: c.utmCampaign, utmContent: c.utmContent, status: c.status, url: null, stats: l.stats } : null,
            stats: l.stats,
          }
        })}
      />
    </PageFrame>
  )
}
