import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { getTicket } from "@/lib/admin/metrics"
import { TicketFlags, TicketStatus } from "@/components/ticket-status"
import { TicketThread } from "@/components/ticket-thread"
import { StaffReplyForm } from "@/components/admin/staff-reply-form"
import { fmtDate } from "@/components/admin/ui"
import { categoryLabel, ticketRef } from "@/lib/support/request"

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
      <p className="mb-1 font-mono text-xs text-muted-foreground">{ticketRef(ticket.id)}</p>
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{ticket.subject}</h1>
        <TicketStatus status={ticket.status} forStaff />
        <TicketFlags priority={ticket.priority} kind={ticket.kind} />
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        From{" "}
        {ticket.userId ? (
          <Link href={`/admin/users/${ticket.userId}`} className="text-foreground hover:text-primary">{ticket.email ?? ticket.userId}</Link>
        ) : (
          <span className="text-foreground">{ticket.name ? `${ticket.name} <${ticket.email}>` : ticket.email}</span>
        )}
        {!ticket.userId && " (no account — your reply is emailed to them)"} · opened {fmtDate(ticket.createdAt)}
        {ticket.category && ` · ${categoryLabel(ticket.category)}`}
        {ticket.page && (
          <>
            {" "}· sent from <span className="font-mono text-xs">{ticket.page}</span>
          </>
        )}
      </p>
      <TicketThread
        viewer="staff"
        messages={messages.map((m) => ({
          id: m.id,
          body: m.body,
          fromStaff: m.fromStaff,
          createdAt: m.createdAt,
          authorLabel: m.fromStaff ? `${m.authorName || m.authorEmail || "Staff"} (staff)` : m.authorName || m.authorEmail || ticket.name || ticket.email || "User",
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
