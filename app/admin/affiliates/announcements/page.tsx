import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { announcementsAll } from "@/lib/affiliates/admin-queries"
import { AdminPageHeader } from "@/components/admin/ui"
import { AnnouncementsAdmin } from "@/components/admin/affiliates/content-editors"

export default async function AdminAffiliateAnnouncementsPage() {
  const admin = await requireAdmin({ affiliates: ["view"] })
  const announcements = await announcementsAll()
  return (
    <div>
      <AdminPageHeader title="Announcements" description="News for affiliates. Separate from the in-app announcement banners." />
      <div className="p-4 sm:p-6">
        <AnnouncementsAdmin canManage={roleCan(admin.role, { affiliates: ["manage"] })} announcements={announcements.map((a) => ({ id: a.id, title: a.title, category: a.category, summary: a.summary, content: a.content, published: a.published, publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null }))} />
      </div>
    </div>
  )
}
