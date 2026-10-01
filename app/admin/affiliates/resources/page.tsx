import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { resourcesAll } from "@/lib/affiliates/admin-queries"
import { AdminPageHeader } from "@/components/admin/ui"
import { ResourcesAdmin } from "@/components/admin/affiliates/content-editors"

export default async function AdminAffiliateResourcesPage() {
  const admin = await requireAdmin({ affiliates: ["view"] })
  const resources = await resourcesAll()
  return (
    <div>
      <AdminPageHeader title="Resources" description="Brand assets and copy shown on every affiliate's Resources page." />
      <div className="p-4 sm:p-6">
        <ResourcesAdmin canManage={roleCan(admin.role, { affiliates: ["manage"] })} resources={resources.map((r) => ({ id: r.id, title: r.title, description: r.description, category: r.category, url: r.url, previewUrl: r.previewUrl, content: r.content, published: r.published, sortOrder: r.sortOrder }))} />
      </div>
    </div>
  )
}
