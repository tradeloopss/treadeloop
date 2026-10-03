import type { Metadata } from "next"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { buildTrackingUrl } from "@/lib/affiliates/engine"
import { SITE_URL } from "@/lib/affiliates/program"
import { defaultLink, publishedResources } from "@/lib/affiliates/queries"
import { ResourcesBrowser } from "@/components/affiliate/resources"
import { PageFrame } from "@/components/affiliate/v2/ui"

export const metadata: Metadata = { title: "Resources" }

export default async function AffiliateV2Resources() {
  const { affiliate } = await requireAffiliate()
  const [resources, link] = await Promise.all([publishedResources(), defaultLink(affiliate.id)])
  return (
    <PageFrame title="Resources" description="Brand assets and ready-to-post copy, with your link filled in.">
      <ResourcesBrowser link={buildTrackingUrl({ base: SITE_URL, code: affiliate.code, linkToken: link?.token })} resources={resources.map((r) => ({ id: r.id, title: r.title, description: r.description, category: r.category, url: r.url, previewUrl: r.previewUrl, content: r.content }))} />
    </PageFrame>
  )
}
