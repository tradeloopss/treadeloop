import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { getDropDetail, type AdminDropRow } from "@/lib/cases/queries"
import { AdminPageHeader, Panel, StatTile, StatRow, StatePill } from "@/components/admin/ui"
import { RowActions } from "@/components/admin/cases/drops-table"
import { ClaimsTable } from "@/components/admin/cases/claims-table"

export default async function DropDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin({ cases: ["view"] })
  const canManage = roleCan(admin.role, { cases: ["manage"] })
  const { id } = await params
  const detail = await getDropDetail(Number(id))
  if (!detail) notFound()

  const { drop, rewards, stats, claims } = detail
  const row: AdminDropRow = {
    id: drop.id,
    name: drop.name,
    status: drop.status as AdminDropRow["status"],
    totalCases: drop.totalCases,
    claimedCases: drop.claimedCases,
    remaining: stats.remaining,
    startAt: drop.startAt,
    endAt: drop.endAt,
    createdAt: drop.createdAt,
  }

  return (
    <div>
      <AdminPageHeader
        title={drop.name}
        description={drop.description ?? undefined}
        action={
          <div className="flex items-center gap-3">
            <StatePill state={drop.status === "active" ? "active" : "inactive"}>{drop.status}</StatePill>
            <RowActions drop={row} canManage={canManage} />
          </div>
        }
      />

      <div className="space-y-6 p-4 sm:p-6">
        <StatRow>
          <StatTile label="Total cases" value={String(stats.total)} />
          <StatTile label="Claimed" value={String(stats.claimed)} note={`${stats.claimRate}% claim rate`} />
          <StatTile label="Remaining" value={String(stats.remaining)} />
          <StatTile label="Active prizes" value={String(stats.activePrizes)} />
          <StatTile label="Used" value={String(stats.usedPrizes)} />
          <StatTile label="Expired" value={String(stats.expiredPrizes)} note={stats.revokedPrizes ? `${stats.revokedPrizes} revoked` : undefined} />
          <StatTile label="Claims today" value={String(stats.claimsToday)} note={`${stats.claims24h} in 24h`} />
        </StatRow>

        <Panel title="Reward breakdown" description="How each reward is being claimed.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-start font-medium">Reward</th>
                  <th className="px-2 py-2 text-start font-medium">Type</th>
                  <th className="px-2 py-2 text-end font-medium">Probability</th>
                  <th className="px-2 py-2 text-end font-medium">Total</th>
                  <th className="px-2 py-2 text-end font-medium">Claimed</th>
                  <th className="px-2 py-2 text-end font-medium">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rewards.map((r) => (
                  <tr key={r.id}>
                    <td className="px-2 py-2 font-medium">{r.name}</td>
                    <td className="px-2 py-2 text-muted-foreground">{r.type.replace("_", " ")}</td>
                    <td className="px-2 py-2 text-end tabular-nums">{r.probability}%</td>
                    <td className="px-2 py-2 text-end tabular-nums">{r.quantity}</td>
                    <td className="px-2 py-2 text-end tabular-nums">{r.claimed}</td>
                    <td className="px-2 py-2 text-end tabular-nums">{r.remaining}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Claims" description="Everyone who claimed a case from this drop.">
          <ClaimsTable dropId={drop.id} claims={claims} canManage={canManage} />
        </Panel>
      </div>
    </div>
  )
}
