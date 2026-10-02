import Link from "next/link"
import { requireAdmin } from "@/lib/admin/guard"
import { listTickets } from "@/lib/admin/metrics"
import { AdminPageHeader, EmptyRow, fmtAgo } from "@/components/admin/ui"
import { TicketFlags, TicketStatus } from "@/components/ticket-status"
import { categoryLabel, ticketRef } from "@/lib/support/request"
import { cn } from "@/lib/utils"

const TABS: [string, string][] = [
  ["open", "Needs reply"],
  ["waiting", "Waiting on user"],
  ["closed", "Closed"],
  ["all", "All"],
]

export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  await requireAdmin({ support: ["view"] })
  const { status = "open", q = "" } = await searchParams
  // A search looks through every request, whatever tab is open.
  const tickets = await listTickets(q.trim() || status === "all" ? undefined : status, q)

  return (
    <div>
      <AdminPageHeader title="Support" description="Requests sent from Help & support in the app and from the Contact Support window on the site (with or without an account). Replying emails the sender. Priority requests — from affiliates whose tier includes priority support — are listed first." />
      <div className="p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {TABS.map(([value, label]) => (
              <Link
                key={value}
                href={`?status=${value}`}
                className={cn("rounded-full border px-3 py-1 text-xs", !q.trim() && status === value ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}
              >
                {label}
              </Link>
            ))}
          </div>
          <form className="flex items-center gap-2" role="search">
            <input type="hidden" name="status" value={status} />
            <input name="q" defaultValue={q} placeholder="Ticket, email, name or subject" aria-label="Search requests" className="h-8 w-64 max-w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
            <button type="submit" className="h-8 rounded-lg border px-3 text-sm font-medium hover:bg-muted">
              Search
            </button>
            {q.trim() && (
              <Link href={`?status=${status}`} className="text-xs text-muted-foreground hover:text-foreground">
                Clear
              </Link>
            )}
          </form>
        </div>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b text-start text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Ticket</th>
                <th className="px-3 py-3 font-medium">Request</th>
                <th className="px-3 py-3 font-medium">From</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 text-end font-medium">Messages</th>
                <th className="px-4 py-3 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tickets.map((t) => (
                <tr key={t.id} className="hover:bg-muted/40">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                    <Link href={`/admin/support/${t.id}`} className="hover:text-primary">{ticketRef(t.id)}</Link>
                  </td>
                  <td className="max-w-[320px] px-3 py-3">
                    <Link href={`/admin/support/${t.id}`} className="block truncate font-medium hover:text-primary">{t.subject}</Link>
                    {t.category && <span className="mt-0.5 block text-xs text-muted-foreground">{categoryLabel(t.category)}</span>}
                    <TicketFlags priority={t.priority} kind={t.kind} className="mt-1" />
                  </td>
                  <td className="max-w-[220px] px-3 py-3">
                    {/* someone with an account links to it; without one, the address they gave is all there is */}
                    {t.userId ? (
                      <Link href={`/admin/users/${t.userId}`} className="block truncate hover:text-primary">{t.email ?? t.userId}</Link>
                    ) : (
                      <span className="block truncate">{t.email ?? "—"}</span>
                    )}
                    <span className="block truncate text-xs text-muted-foreground">{t.userId ? t.name : `${t.name ? `${t.name} · ` : ""}No account`}</span>
                  </td>
                  <td className="px-3 py-3"><TicketStatus status={t.status} forStaff /></td>
                  <td className="px-3 py-3 text-end tabular-nums">{t.messages}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtAgo(t.lastMessageAt)}</td>
                </tr>
              ))}
              {tickets.length === 0 && <EmptyRow colSpan={6}>{q.trim() ? "No request matches that search." : "Nothing here."}</EmptyRow>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
