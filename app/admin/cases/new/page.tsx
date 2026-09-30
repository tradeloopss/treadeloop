import { requireAdmin } from "@/lib/admin/guard"
import { AdminPageHeader } from "@/components/admin/ui"
import { DropForm } from "@/components/admin/cases/drop-form"

export default async function NewDropPage() {
  await requireAdmin({ cases: ["manage"] })
  return (
    <div>
      <AdminPageHeader title="Create a Cases Drop" description="Configure the cases and rewards. Save as a draft to preview, or publish to go live." />
      <div className="p-4 sm:p-6">
        <DropForm />
      </div>
    </div>
  )
}
