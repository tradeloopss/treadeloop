import type { Metadata } from "next"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { buildTrackingUrl } from "@/lib/affiliates/engine"
import { SITE_URL } from "@/lib/affiliates/program"
import { defaultLink, publishedResources } from "@/lib/affiliates/queries"
import { PageHeader } from "@/components/page-header"
import { ResourcesBrowser } from "@/components/affiliate/resources"

export const metadata: Metadata = { title: "Resources" }

export default async function AffiliateResourcesPage() {
  const { affiliate } = await requireAffiliate()
  const [resources, link] = await Promise.all([publishedResources(), defaultLink(affiliate.id)])
  return (
    <div>
      <PageHeader title="Resources" description="Brand assets and ready-to-post copy. Your referral link is already filled in." />
      <div className="p-4 sm:p-6">
        <ResourcesBrowser link={buildTrackingUrl({ base: SITE_URL, code: affiliate.code, linkToken: link?.token })} resources={resources.map((r) => ({ id: r.id, title: r.title, description: r.description, category: r.category, url: r.url, previewUrl: r.previewUrl, content: r.content }))} />
      </div>
    </div>
  )
}
