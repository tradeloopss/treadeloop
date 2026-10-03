import type { Metadata } from "next"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { announcementsFor } from "@/lib/affiliates/queries"
import { AnnouncementsList } from "@/components/affiliate/announcements"
import { PageFrame } from "@/components/affiliate/v2/ui"

export const metadata: Metadata = { title: "Announcements" }

export default async function AffiliateV2Announcements() {
  const { affiliate } = await requireAffiliate()
  const items = await announcementsFor(affiliate.id)
  return (
    <PageFrame title="Announcements" description="News about the program, promotions and product updates." className="max-w-4xl">
      <AnnouncementsList items={items.map((a) => ({ id: a.id, title: a.title, category: a.category, summary: a.summary, content: a.content, publishedAt: (a.publishedAt ?? new Date()).toISOString(), read: !!a.readAt }))} />
    </PageFrame>
  )
}
