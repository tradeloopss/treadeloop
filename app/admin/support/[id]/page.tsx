import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { getTicket } from "@/lib/admin/metrics"
import { TicketStatus } from "@/components/ticket-status"
import { TicketThread } from "@/components/ticket-thread"
import { StaffReplyForm } from "@/components/admin/staff-reply-form"
import { fmtDate } from "@/components/admin/ui"

export default async function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin({ support: ["view"] })
  const id = Number((await params).id)
  const data = Number.isInteger(id) ? await getTicket(id) : null
  if (!data) notFound()
  const { ticket, messages } = data

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href="/admin/support" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Support
      </Link>
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{ticket.subject}</h1>
        <TicketStatus status={ticket.status} forStaff />
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        From <Link href={`/admin/users/${ticket.userId}`} className="text-foreground hover:text-primary">{ticket.email ?? ticket.userId}</Link> · opened {fmtDate(ticket.createdAt)}
      </p>
      <TicketThread
        viewer="staff"
        messages={messages.map((m) => ({
          id: m.id,
          body: m.body,
          fromStaff: m.fromStaff,
          createdAt: m.createdAt,
          authorLabel: m.fromStaff ? `${m.authorName || m.authorEmail || "Staff"} (staff)` : m.authorName || m.authorEmail || "User",
        }))}
      />
      {roleCan(admin.role, { support: ["reply"] }) && (
        <div className="mt-6 rounded-xl border bg-card p-4">
          <StaffReplyForm ticketId={ticket.id} status={ticket.status} />
        </div>
      )}
    </div>
  )
}
