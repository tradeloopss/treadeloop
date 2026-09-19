import Link from "next/link"
import { notFound } from "next/navigation"
import { headers } from "next/headers"
import { and, asc, eq } from "drizzle-orm"
import { ArrowLeft } from "lucide-react"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { supportMessages, supportTickets } from "@/lib/db/schema"
import { Card } from "@/components/ui/card"
import { TicketReplyForm } from "@/components/support-forms"
import { TicketStatus } from "@/components/ticket-status"
import { TicketThread } from "@/components/ticket-thread"

export default async function SupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  const id = Number((await params).id)
  if (!session || !Number.isInteger(id)) notFound()
  const [ticket] = await db
    .select()
    .from(supportTickets)
    .where(and(eq(supportTickets.id, id), eq(supportTickets.userId, session.user.id)))
  if (!ticket) notFound()
  const messages = await db.select().from(supportMessages).where(eq(supportMessages.ticketId, id)).orderBy(asc(supportMessages.createdAt))

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href="/support" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All requests
      </Link>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{ticket.subject}</h1>
        <TicketStatus status={ticket.status} forStaff={false} />
      </div>
      <TicketThread
        viewer="user"
        messages={messages.map((m) => ({ ...m, authorLabel: m.fromStaff ? "TradeLoop support" : "You" }))}
      />
      <Card className="mt-6 gap-0 p-4">
        <TicketReplyForm ticketId={ticket.id} closed={ticket.status === "closed"} />
      </Card>
    </div>
  )
}
