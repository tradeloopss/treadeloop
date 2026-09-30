import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/admin/guard"
import { getDropDetail } from "@/lib/cases/queries"
import { AdminPageHeader } from "@/components/admin/ui"
import { DropForm, type DropFormValues } from "@/components/admin/cases/drop-form"

function toLocalInput(d: Date | null): string {
  if (!d) return ""
  return new Date(d).toISOString().slice(0, 16)
}

export default async function EditDropPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin({ cases: ["manage"] })
  const { id } = await params
  const detail = await getDropDetail(Number(id))
  if (!detail) notFound()

  const values: DropFormValues = {
    id: detail.drop.id,
    name: detail.drop.name,
    description: detail.drop.description ?? "",
    totalCases: detail.drop.totalCases,
    prizeExpirationDays: detail.drop.prizeExpirationDays,
    startAt: toLocalInput(detail.drop.startAt),
    endAt: toLocalInput(detail.drop.endAt),
    rewards: detail.rewards.map((r) => ({
      name: r.name,
      type: r.type as DropFormValues["rewards"][number]["type"],
      discountPercent: r.discountPercent,
      subscriptionPlan: r.subscriptionPlan,
      subscriptionMonths: r.subscriptionMonths,
      quantity: r.quantity,
      probability: r.probability,
    })),
    locked: detail.drop.claimedCases > 0,
  }

  return (
    <div>
      <AdminPageHeader title={`Edit — ${detail.drop.name}`} description="Update the drop. Rewards lock once anyone has claimed." />
      <div className="p-4 sm:p-6">
        <DropForm initial={values} />
      </div>
    </div>
  )
}
