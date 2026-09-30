import Link from "next/link"
import { Plus } from "lucide-react"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { listDrops } from "@/lib/cases/queries"
import { AdminPageHeader } from "@/components/admin/ui"
import { DropsTable } from "@/components/admin/cases/drops-table"

export default async function AdminCasesPage() {
  const admin = await requireAdmin({ cases: ["view"] })
  const canManage = roleCan(admin.role, { cases: ["manage"] })
  const drops = await listDrops()

  return (
    <div>
      <AdminPageHeader
        title="Cases Drops"
        description="Promotional free-case drops — create, publish and track the currently live drop and past ones."
        action={
          canManage ? (
            <Link href="/admin/cases/new" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              <Plus className="size-4" /> Create new drop
            </Link>
          ) : undefined
        }
      />
      <div className="p-4 sm:p-6">
        <DropsTable drops={drops} canManage={canManage} />
      </div>
    </div>
  )
}
