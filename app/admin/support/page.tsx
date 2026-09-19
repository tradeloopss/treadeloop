import Link from "next/link"
import { requireAdmin } from "@/lib/admin/guard"
import { listTickets } from "@/lib/admin/metrics"
import { AdminPageHeader, EmptyRow, fmtAgo } from "@/components/admin/ui"
import { TicketStatus } from "@/components/ticket-status"
import { cn } from "@/lib/utils"

const TABS: [string, string][] = [
  ["open", "Needs reply"],
  ["waiting", "Waiting on user"],
  ["closed", "Closed"],
  ["all", "All"],
]

export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin({ support: ["view"] })
  const { status = "open" } = await searchParams
  const tickets = await listTickets(status === "all" ? undefined : status)

  return (
    <div>
      <AdminPageHeader title="Support" description="Requests users send from Help & support in the app. Replying emails them a link back to the conversation." />
      <div className="p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {TABS.map(([value, label]) => (
            <Link
              key={value}
              href={`?status=${value}`}
              className={cn("rounded-full border px-3 py-1 text-xs", status === value ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}
            >
              {label}
            </Link>
          ))}
        </div>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b text-start text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Request</th>
                <th className="px-3 py-3 font-medium">From</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 text-end font-medium">Messages</th>
                <th className="px-4 py-3 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tickets.map((t) => (
                <tr key={t.id} className="hover:bg-muted/40">
                  <td className="max-w-[320px] px-4 py-3">
                    <Link href={`/admin/support/${t.id}`} className="block truncate font-medium hover:text-primary">{t.subject}</Link>
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-3">
                    <Link href={`/admin/users/${t.userId}`} className="hover:text-primary">{t.email ?? t.userId}</Link>
                  </td>
                  <td className="px-3 py-3"><TicketStatus status={t.status} forStaff /></td>
                  <td className="px-3 py-3 text-end tabular-nums">{t.messages}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtAgo(t.lastMessageAt)}</td>
                </tr>
              ))}
              {tickets.length === 0 && <EmptyRow colSpan={5}>Nothing here.</EmptyRow>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
