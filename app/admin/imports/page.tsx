import Link from "next/link"
import { Download } from "lucide-react"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { getImportStats, listImports } from "@/lib/admin/metrics"
import { DismissImportButton, RetryImportButton } from "@/components/admin/row-actions"
import { AdminPageHeader, EmptyRow, Panel, StatePill, StatRow, StatTile, fmtAgo, fmtBytes, fmtNumber, fmtPercent } from "@/components/admin/ui"
import { cn } from "@/lib/utils"

export default async function AdminImportsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const admin = await requireAdmin({ brokers: ["view"] })
  const canAct = roleCan(admin.role, { brokers: ["sync"] })
  const { view = "failed" } = await searchParams
  const [stats, rows] = await Promise.all([getImportStats(), listImports({ failedOnly: view === "failed", limit: 100 })])

  return (
    <div>
      <AdminPageHeader
        title="File imports"
        description="Every CSV or report a user has imported. A failed import keeps its file, so you can see what the broker exported and re-run it once the parser handles it."
      />
      <div className="space-y-6 p-4 sm:p-6">
        <StatRow>
          <StatTile label="Imports, 7 days" value={fmtNumber(stats.total7d)} note={`${fmtNumber(stats.trades7d)} trades imported`} />
          <StatTile label="Failed, 7 days" value={fmtNumber(stats.failed7d)} note={stats.total7d ? `${fmtPercent(stats.failed7d / stats.total7d)} failure rate` : undefined} />
          <StatTile label="Needs attention" value={fmtNumber(stats.openFailures)} note="failed and not yet handled" />
        </StatRow>

        <Panel title="By broker format, last 30 days" description="A format whose failures climb usually means the broker changed its export columns.">
          <ul className="divide-y text-sm">
            {stats.bySource.map((s) => (
              <li key={s.source} className="flex items-center justify-between gap-3 py-2">
                <span className={cn(s.source === "Unrecognized" && "text-muted-foreground")}>{s.source}</span>
                <span className="tabular-nums text-muted-foreground">
                  {s.total} import{s.total === "1" ? "" : "s"} · <span className={Number(s.failed) > 0 ? "text-[var(--loss)]" : ""}>{s.failed} failed</span>
                </span>
              </li>
            ))}
            {stats.bySource.length === 0 && <li className="py-6 text-center text-muted-foreground">No imports in the last 30 days.</li>}
          </ul>
        </Panel>

        <Panel
          title={view === "failed" ? "Failed imports" : "Recent imports"}
          action={
            <div className="flex gap-1.5">
              {[
                ["failed", "Needs attention"],
                ["all", "All recent"],
              ].map(([value, label]) => (
                <Link key={value} href={`?view=${value}`} className={cn("rounded-full border px-3 py-1 text-xs", view === value ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
                  {label}
                </Link>
              ))}
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">When</th>
                  <th className="pb-2 font-medium">User</th>
                  <th className="pb-2 font-medium">File</th>
                  <th className="pb-2 font-medium">Result</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap py-2.5 pr-3 text-muted-foreground">{fmtAgo(r.createdAt)}</td>
                    <td className="max-w-[200px] truncate py-2.5 pr-3">
                      <Link href={`/admin/users/${r.userId}`} className="hover:text-primary">{r.email ?? r.userId}</Link>
                    </td>
                    <td className="max-w-[280px] py-2.5 pr-3">
                      <span className="block truncate" title={r.fileName ?? undefined}>{r.fileName ?? "—"}</span>
                      <span className="block text-xs text-muted-foreground">
                        {r.source ?? "Unrecognized format"} · {fmtBytes(r.fileSize)}
                        {r.retryOf ? ` · retry of #${r.retryOf}` : ""}
                      </span>
                      {r.header && r.status === "failed" && (
                        <code className="mt-1 block truncate text-[11px] text-muted-foreground" title={r.header}>
                          {r.header}
                        </code>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      {r.status === "imported" ? (
                        <span>
                          <StatePill state="active">Imported</StatePill>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {r.imported} new · {r.duplicates} duplicates · {r.totalRows} rows
                          </span>
                        </span>
                      ) : (
                        <span>
                          <StatePill state={r.resolvedAt ? "inactive" : "suspended"}>{r.resolvedAt ? "Handled" : "Failed"}</StatePill>
                          <span className="ml-2 text-xs text-[var(--loss)]">{r.error}</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex justify-end gap-1.5">
                        {r.hasFile && (
                          <a href={`/admin/imports/${r.id}/file`} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs hover:bg-muted" title="Download the uploaded file">
                            <Download className="size-3.5" /> File
                          </a>
                        )}
                        {canAct && r.status === "failed" && !r.resolvedAt && r.hasFile && <RetryImportButton importId={r.id} />}
                        {canAct && r.status === "failed" && !r.resolvedAt && <DismissImportButton importId={r.id} />}
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <EmptyRow colSpan={5}>{view === "failed" ? "No failed imports waiting." : "No imports yet."}</EmptyRow>}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  )
}
