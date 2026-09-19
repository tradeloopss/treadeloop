import Link from "next/link"
import { headers } from "next/headers"
import { desc, eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { supportTickets } from "@/lib/db/schema"
import { Card } from "@/components/ui/card"
import { NewTicketForm } from "@/components/support-forms"
import { TicketStatus } from "@/components/ticket-status"

export default async function SupportPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const tickets = session
    ? await db.select().from(supportTickets).where(eq(supportTickets.userId, session.user.id)).orderBy(desc(supportTickets.lastMessageAt))
    : []

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <h1 className="text-xl font-semibold tracking-tight">Support</h1>
      <p className="mt-1 text-sm text-muted-foreground">Ask us anything — replies show up here and in your email.</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="gap-0 p-5">
          <h2 className="mb-4 font-medium">New request</h2>
          <NewTicketForm />
        </Card>
        <Card className="gap-0 p-5">
          <h2 className="mb-3 font-medium">Your requests</h2>
          {tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No requests yet.</p>
          ) : (
            <ul className="divide-y">
              {tickets.map((t) => (
                <li key={t.id}>
                  <Link href={`/support/${t.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-primary">
                    <span className="min-w-0 truncate text-sm">{t.subject}</span>
                    <TicketStatus status={t.status} forStaff={false} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
