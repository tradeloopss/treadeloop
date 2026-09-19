import Link from "next/link"
import { requireAdmin } from "@/lib/admin/guard"
import { ACTION_LABELS } from "@/lib/admin/audit"
import { listAudit, PAGE_SIZE } from "@/lib/admin/metrics"
import { AdminPageHeader, EmptyRow, FilterSelect, Pager, fmtDateTime } from "@/components/admin/ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

function describe(details: Record<string, unknown> | null) {
  if (!details) return ""
  return Object.entries(details)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ")
}

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<{ actor?: string; action?: string; page?: string }> }) {
  await requireAdmin({ audit: ["view"] })
  const sp = await searchParams
  const action = sp.action && sp.action in ACTION_LABELS ? sp.action : undefined
  const { rows, total, page } = await listAudit({ actor: sp.actor?.trim() || undefined, action, page: Number(sp.page) || 1 })

  return (
    <div>
      <AdminPageHeader title="Audit log" description="Every action taken in the admin panel, who took it and from where. Entries can't be edited or deleted." />
      <div className="p-4 sm:p-6">
        <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Admin email
            <Input name="actor" defaultValue={sp.actor} className="h-9" />
          </label>
          <FilterSelect label="Action" name="action" defaultValue={action} options={[["", "Any"], ...Object.entries(ACTION_LABELS)]} />
          <Button type="submit" className="h-9">Apply</Button>
        </form>
        <div className="mt-4 overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-3 py-3 font-medium">Admin</th>
                <th className="px-3 py-3 font-medium">Action</th>
                <th className="px-3 py-3 font-medium">User</th>
                <th className="px-3 py-3 font-medium">Details</th>
                <th className="px-4 py-3 font-medium">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{fmtDateTime(a.createdAt)}</td>
                  <td className="px-3 py-3">{a.actorEmail}</td>
                  <td className="px-3 py-3 font-medium">{ACTION_LABELS[a.action] ?? a.action}</td>
                  <td className="px-3 py-3">
                    {a.targetUserId ? (
                      <Link href={`/admin/users/${a.targetUserId}`} className="hover:text-primary">{a.targetEmail ?? a.targetUserId}</Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="max-w-[320px] truncate px-3 py-3 text-xs text-muted-foreground" title={describe(a.details)}>{describe(a.details) || "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{a.ipAddress ?? "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && <EmptyRow colSpan={6}>No admin actions recorded yet.</EmptyRow>}
            </tbody>
          </table>
        </div>
        <Pager page={page} total={total} pageSize={PAGE_SIZE} params={{ actor: sp.actor, action }} />
      </div>
    </div>
  )
}
