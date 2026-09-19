import Link from "next/link"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { getBrokerHealth } from "@/lib/admin/metrics"
import { ForceSyncButton } from "@/components/admin/row-actions"
import { AdminPageHeader, EmptyRow, Panel, StatRow, StatTile, SyncStatus, fmtAgo } from "@/components/admin/ui"

export default async function AdminBrokersPage() {
  const admin = await requireAdmin({ brokers: ["view"] })
  const canSync = roleCan(admin.role, { brokers: ["sync"] })
  const health = await getBrokerHealth()
  const problems = health.connections.filter((c) => c.health !== "healthy")

  return (
    <div>
      <AdminPageHeader
        title="Broker health"
        description="Every live broker connection. Rithmic syncs in the background every 60 seconds, so anything not synced in an hour is stale."
      />
      <div className="space-y-6 p-4 sm:p-6">
        <StatRow>
          <StatTile label="Rithmic connections" value={String(health.rithmic.total)} note={`${health.rithmic.healthy} healthy`} />
          <StatTile label="Rithmic failing" value={String(health.rithmic.failing)} note={`${health.rithmic.stale} stale · ${health.rithmic.never} never synced`} />
          <StatTile label="MetaTrader connections" value={String(health.metatrader.total)} note={`${health.metatrader.healthy} healthy`} />
          <StatTile label="MetaTrader failing" value={String(health.metatrader.failing)} note={`${health.metatrader.stale} stale · ${health.metatrader.never} never synced`} />
        </StatRow>

        <Panel
          title={problems.length ? `Needs attention (${problems.length})` : "All connections"}
          description="Failing and stale connections are listed first. MetaTrader connections only sync when the user connects or presses Sync, so they can't be forced from here yet."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Broker</th>
                  <th className="pb-2 font-medium">User</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Last sync</th>
                  <th className="pb-2 font-medium">Last error</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {[...problems, ...health.connections.filter((c) => c.health === "healthy")].map((c) => (
                  <tr key={`${c.broker}${c.id}`}>
                    <td className="py-2.5 pr-3">
                      <span className="font-medium">{c.broker === "rithmic" ? "Rithmic" : "MetaTrader"}</span>
                      <span className="block text-xs text-muted-foreground">{c.label}</span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <Link href={`/admin/users/${c.userId}`} className="hover:text-primary">{c.email ?? c.userId}</Link>
                    </td>
                    <td className="py-2.5 pr-3"><SyncStatus status={c.health} /></td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{fmtAgo(c.lastSyncedAt)}{c.lastSyncCount ? ` · ${c.lastSyncCount} trades` : ""}</td>
                    <td className="max-w-[280px] truncate py-2.5 pr-3 text-xs text-muted-foreground" title={c.lastSyncError ?? undefined}>{c.lastSyncError ?? "—"}</td>
                    <td className="py-2.5 text-right">{canSync && c.broker === "rithmic" && <ForceSyncButton connectionId={c.id} />}</td>
                  </tr>
                ))}
                {health.connections.length === 0 && <EmptyRow colSpan={6}>No broker connections yet.</EmptyRow>}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  )
}
