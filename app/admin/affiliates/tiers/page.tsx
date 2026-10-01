import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { tiersWithCounts } from "@/lib/affiliates/admin-queries"
import { getProgram } from "@/lib/affiliates/program"
import { AdminPageHeader } from "@/components/admin/ui"
import { TiersEditor } from "@/components/admin/affiliates/program-form"

export default async function AdminAffiliateTiersPage() {
  const admin = await requireAdmin({ affiliates: ["view"] })
  const canManage = roleCan(admin.role, { affiliates: ["manage"] })
  const [tiers, program] = await Promise.all([tiersWithCounts(), getProgram()])

  return (
    <div>
      <AdminPageHeader title="Tiers" description="Commission rates that step up with the number of paying customers an affiliate has referred." />
      <div className="flex flex-col gap-3 p-4 sm:p-6">
        <TiersEditor tiers={tiers} canManage={canManage} />
        <p className="text-xs text-muted-foreground">
          An affiliate sits in the highest enabled tier whose customer count they&apos;ve reached, unless a manual tier is set on their page. With no tier that applies, they earn the program default ({program.defaultRate}%). A tier change affects payments from then on — commissions already recorded keep their rate.
        </p>
      </div>
    </div>
  )
}
