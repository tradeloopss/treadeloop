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
      <AdminPageHeader title="Tiers" description="What the program pays, and unlocks, as the number of paying customers an affiliate has referred grows." />
      <div className="flex flex-col gap-3 p-4 sm:p-6">
        <TiersEditor tiers={tiers} canManage={canManage} />
        <p className="text-xs text-muted-foreground">
          An affiliate sits in the highest enabled tier whose customer count they&apos;ve reached, unless a manual tier is set on their page. A tier that asks for one customer is where everyone starts. With no tier that applies, they earn the program default ({program.defaultRate}%). A tier change affects payments from then on — commissions already recorded keep their rate.
        </p>
        <p className="text-xs text-muted-foreground">
          A tier with &quot;for the first N months&quot; pays its rate on a customer&apos;s payments during those months, counted from that customer&apos;s first payment, and the &quot;then&quot; rate on every payment after. The rate of a payment is decided by the tier the affiliate is in when it is made. What a tier unlocks is given when it is reached and is not taken back: a personal code keeps working, and a free-forever account stays until you revoke it on the user&apos;s page.
        </p>
      </div>
    </div>
  )
}
