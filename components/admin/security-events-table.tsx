import type React from "react"
import Link from "next/link"
import { SECURITY_EVENT_LABELS } from "@/lib/security"
import type { SecurityEventRow } from "@/lib/admin/metrics"
import { fmtDateTime } from "@/components/admin/ui"
import { cn } from "@/lib/utils"

const BAD = new Set(["sign_in_failed", "sign_in_blocked", "two_factor_failed", "password_reset_failed", "password_change_failed", "two_factor_disabled"])

function describe(row: SecurityEventRow) {
  const d = row.details ?? {}
  const parts: string[] = []
  if (typeof d.method === "string") parts.push(`via ${d.method}`)
  if (d.newIp === true) parts.push("new IP")
  if (typeof d.reason === "string" && d.reason) parts.push(d.reason)
  return parts.join(" · ")
}

export function SecurityEventsTable({ rows, empty, showUser = true }: { rows: SecurityEventRow[]; empty: React.ReactNode; showUser?: boolean }) {
  return (
    <table className="w-full min-w-[720px] text-sm">
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="px-4 py-3 font-medium">When</th>
          <th className="px-3 py-3 font-medium">Event</th>
          {showUser && <th className="px-3 py-3 font-medium">Account</th>}
          <th className="px-3 py-3 font-medium">IP</th>
          <th className="px-4 py-3 font-medium">Details</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{fmtDateTime(r.createdAt)}</td>
            <td className={cn("px-3 py-2.5 font-medium", BAD.has(r.type) && "text-[var(--loss)]")}>{SECURITY_EVENT_LABELS[r.type] ?? r.type}</td>
            {showUser && (
              <td className="max-w-[220px] truncate px-3 py-2.5">
                {r.userId ? <Link href={`/admin/users/${r.userId}`} className="hover:text-primary">{r.email ?? r.userId}</Link> : r.email ?? "—"}
              </td>
            )}
            <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{r.ipAddress ?? "—"}</td>
            <td className="max-w-[260px] truncate px-4 py-2.5 text-xs text-muted-foreground" title={r.userAgent ?? undefined}>{describe(r) || "—"}</td>
          </tr>
        ))}
        {rows.length === 0 && empty}
      </tbody>
    </table>
  )
}
