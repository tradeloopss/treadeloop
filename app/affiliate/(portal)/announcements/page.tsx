import type { Metadata } from "next"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { announcementsFor } from "@/lib/affiliates/queries"
import { PageHeader } from "@/components/page-header"
import { AnnouncementsList } from "@/components/affiliate/announcements"

export const metadata: Metadata = { title: "Announcements" }

export default async function AffiliateAnnouncementsPage() {
  const { affiliate } = await requireAffiliate()
  const items = await announcementsFor(affiliate.id)
  return (
    <div>
      <PageHeader title="Announcements" description="News about the program, promotions and product updates." />
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <AnnouncementsList items={items.map((a) => ({ id: a.id, title: a.title, category: a.category, summary: a.summary, content: a.content, publishedAt: (a.publishedAt ?? new Date()).toISOString(), read: !!a.readAt }))} />
      </div>
    </div>
  )
}
