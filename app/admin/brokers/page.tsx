import Link from "next/link"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { getBrokerHealth, getSyncStats, listSyncRuns } from "@/lib/admin/metrics"
import { getRithmicSyncIntervalMs, RITHMIC_SYNC_INTERVAL_OPTIONS } from "@/lib/app-settings"
import { ForceSyncButton, ResyncAllButton, RithmicSyncIntervalControl } from "@/components/admin/row-actions"
import { AdminPageHeader, EmptyRow, Panel, StatePill, StatRow, StatTile, SyncStatus, fmtAgo, fmtNumber, fmtPercent } from "@/components/admin/ui"
import { cn } from "@/lib/utils"

const TRIGGER_LABELS: Record<string, string> = { auto: "Background", manual: "User", admin: "Admin", connect: "On connect" }

export default async function AdminBrokersPage({ searchParams }: { searchParams: Promise<{ runs?: string; q?: string }> }) {
  const admin = await requireAdmin({ brokers: ["view"] })
  const canSync = roleCan(admin.role, { brokers: ["sync"] })
  const { runs: runsView = "error", q = "" } = await searchParams
  const query = q.trim()
  const [health, sync, runs, syncIntervalMs] = await Promise.all([
    getBrokerHealth(),
    getSyncStats(),
    listSyncRuns({ status: runsView === "error" ? "error" : undefined, q: query, limit: 60 }),
    getRithmicSyncIntervalMs(),
  ])
  const problems = health.connections.filter((c) => c.health !== "healthy")
  const rithmicSync = sync.perBroker.find((b) => b.broker === "rithmic")
  const mtSync = sync.perBroker.find((b) => b.broker === "metatrader")
  // The background job runs every 60s; no run for 10 minutes means it isn't.
  const jobAlive = sync.lastAutoRun != null && Date.now() - new Date(sync.lastAutoRun).getTime() < 10 * 60_000
  const rate = (b?: { runs: number; failed: number }) => (b && b.runs ? fmtPercent((b.runs - b.failed) / b.runs) : "—")

  return (
    <div>
      <AdminPageHeader
        title="Broker health"
        description="Every live broker connection and every sync run. Rithmic syncs in the background every 60 seconds, so anything not synced in an hour is stale."
        action={canSync && health.rithmic.total > 0 ? <ResyncAllButton /> : undefined}
      />
      <div className="space-y-6 p-4 sm:p-6">
        <StatRow>
          <StatTile label="Rithmic connections" value={String(health.rithmic.total)} note={`${health.rithmic.healthy} healthy · ${health.rithmic.failing} failing · ${health.rithmic.stale} stale`} />
          <StatTile label="Rithmic sync success, 24h" value={rate(rithmicSync)} note={rithmicSync ? `${fmtNumber(rithmicSync.runs)} runs · ${fmtNumber(rithmicSync.imported)} trades` : "no runs yet"} />
          <StatTile label="MetaTrader connections" value={String(health.metatrader.total)} note={`${health.metatrader.healthy} healthy · ${health.metatrader.failing} failing · ${health.metatrader.stale} stale`} />
          <StatTile label="MetaTrader sync success, 24h" value={rate(mtSync)} note={mtSync ? `${fmtNumber(mtSync.runs)} runs · ${fmtNumber(mtSync.imported)} trades` : "no runs yet"} />
          <StatTile
            label="Background job"
            value={health.rithmic.total === 0 ? "Idle" : jobAlive ? "Running" : "Not running"}
            note={sync.lastAutoRun ? `last run ${fmtAgo(sync.lastAutoRun)}` : "no background runs recorded"}
          />
        </StatRow>
        {sync.rateLimited24h > 0 && (
          <p className="rounded-xl border border-[var(--chart-4)]/40 bg-[var(--chart-4)]/10 px-4 py-3 text-sm">
            {sync.rateLimited24h} sync{sync.rateLimited24h === 1 ? "" : "s"} in the last 24 hours failed with a rate-limit or throttling error from the broker.
          </p>
        )}

        {canSync && (
          <Panel
            title="Rithmic auto-sync period"
            description="How often background sync re-syncs each Rithmic connection. The VPS timer still ticks every 60s — a longer period just syncs each account less often (and eases Rithmic's cloud-IP throttling)."
          >
            <RithmicSyncIntervalControl currentMs={syncIntervalMs} options={RITHMIC_SYNC_INTERVAL_OPTIONS} />
          </Panel>
        )}

        <Panel
          title={problems.length ? `Needs attention (${problems.length})` : "All connections"}
          description="Failing and stale connections are listed first. MetaTrader connections only sync when the user connects or presses Sync, so they can't be forced from here yet."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-start text-xs text-muted-foreground">
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
                    <td className="py-2.5 pe-3">
                      <span className="font-medium">{c.broker === "rithmic" ? "Rithmic" : "MetaTrader"}</span>
                      <span className="block text-xs text-muted-foreground">{c.label}</span>
                    </td>
                    <td className="py-2.5 pe-3">
                      <Link href={`/admin/users/${c.userId}`} className="hover:text-primary">{c.email ?? c.userId}</Link>
                    </td>
                    <td className="py-2.5 pe-3"><SyncStatus status={c.health} /></td>
                    <td className="py-2.5 pe-3 text-muted-foreground">{fmtAgo(c.lastSyncedAt)}{c.lastSyncCount ? ` · ${c.lastSyncCount} trades` : ""}</td>
                    <td className="max-w-[280px] truncate py-2.5 pe-3 text-xs text-muted-foreground" title={c.lastSyncError ?? undefined}>{c.lastSyncError ?? "—"}</td>
                    <td className="py-2.5 text-end">{canSync && c.broker === "rithmic" && <ForceSyncButton connectionId={c.id} />}</td>
                  </tr>
                ))}
                {health.connections.length === 0 && <EmptyRow colSpan={6}>No broker connections yet.</EmptyRow>}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title="Sync runs"
          description="One row per sync attempt: the background job, a user's Sync now, an admin's forced sync, or the first sync on connect. Kept for 14 days."
          action={
            <div className="flex flex-wrap items-center gap-1.5">
              <form method="get" className="flex items-center gap-1.5">
                <input type="hidden" name="runs" value={runsView} />
                <input
                  type="search"
                  name="q"
                  defaultValue={query}
                  placeholder="Search broker or email"
                  className="h-8 w-44 rounded-md border bg-background px-2.5 text-xs"
                />
                <button type="submit" className="rounded-full border px-3 py-1 text-xs hover:bg-muted">
                  Search
                </button>
              </form>
              {[
                ["error", "Failures"],
                ["all", "All"],
              ].map(([value, label]) => (
                <Link
                  key={value}
                  href={`?runs=${value}${query ? `&q=${encodeURIComponent(query)}` : ""}`}
                  className={cn("rounded-full border px-3 py-1 text-xs", runsView === value ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}
                >
                  {label}
                </Link>
              ))}
              {query && (
                <Link href={`?runs=${runsView}`} className="rounded-full border px-3 py-1 text-xs hover:bg-muted">
                  Clear
                </Link>
              )}
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-start text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">When</th>
                  <th className="pb-2 font-medium">Broker</th>
                  <th className="pb-2 font-medium">User</th>
                  <th className="pb-2 font-medium">Trigger</th>
                  <th className="pb-2 font-medium">Result</th>
                  <th className="pb-2 text-end font-medium">Took</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap py-2 pe-3 text-muted-foreground">{fmtAgo(r.createdAt)}</td>
                    <td className="py-2 pe-3">
                      {r.broker === "rithmic" ? "Rithmic" : "MetaTrader"} <span className="text-xs text-muted-foreground">#{r.connectionId}</span>
                    </td>
                    <td className="max-w-[200px] truncate py-2 pe-3">
                      <Link href={`/admin/users/${r.userId}`} className="hover:text-primary">{r.email ?? r.userId}</Link>
                    </td>
                    <td className="py-2 pe-3 text-muted-foreground">{TRIGGER_LABELS[r.trigger] ?? r.trigger}</td>
                    <td className="max-w-[320px] py-2 pe-3">
                      {r.status === "ok" ? (
                        <span>
                          <StatePill state="active">OK</StatePill> <span className="ms-1 text-xs text-muted-foreground">{r.imported ?? 0} new</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <StatePill state="suspended">Error</StatePill>
                          <span className="truncate text-xs text-[var(--loss)]" title={r.error ?? undefined}>{r.error}</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-end tabular-nums text-muted-foreground">
                      {r.durationMs == null ? "—" : r.durationMs < 1000 ? `${r.durationMs} ms` : `${(r.durationMs / 1000).toFixed(1)} s`}
                    </td>
                  </tr>
                ))}
                {runs.length === 0 && <EmptyRow colSpan={6}>{query ? `No syncs match “${query}”.` : runsView === "error" ? "No failed syncs recorded." : "No syncs recorded yet."}</EmptyRow>}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  )
}
