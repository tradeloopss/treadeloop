"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { and, eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { supportMessages, supportTickets } from "@/lib/db/schema"

async function currentUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user
}

function clean(text: string, max: number, what: string) {
  const value = text.trim()
  if (!value) throw new Error(`Write a ${what} first.`)
  if (value.length > max) throw new Error(`Keep the ${what} under ${max} characters.`)
  return value
}

export async function createTicket(subject: string, body: string): Promise<{ error: string } | void> {
  let ticketId: number
  try {
    const user = await currentUser()
    const [ticket] = await db
      .insert(supportTickets)
      .values({ userId: user.id, subject: clean(subject, 140, "subject") })
      .returning({ id: supportTickets.id })
    await db.insert(supportMessages).values({ ticketId: ticket.id, authorId: user.id, body: clean(body, 5000, "message") })
    ticketId = ticket.id
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't send that." }
  }
  revalidatePath("/support")
  redirect(`/support/${ticketId}`)
}

export async function replyToMyTicket(ticketId: number, body: string): Promise<{ error: string } | { ok: true }> {
  try {
    const user = await currentUser()
    const [ticket] = await db
      .select()
      .from(supportTickets)
      .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, user.id)))
    if (!ticket) throw new Error("Request not found")
    await db.insert(supportMessages).values({ ticketId, authorId: user.id, body: clean(body, 5000, "message") })
    // A reply from the user puts it back in the staff queue, even if closed.
    await db.update(supportTickets).set({ status: "open", lastMessageAt: new Date() }).where(eq(supportTickets.id, ticketId))
    revalidatePath(`/support/${ticketId}`)
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't send that." }
  }
}
