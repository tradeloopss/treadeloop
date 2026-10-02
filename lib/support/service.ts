import { and, eq, gte, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { supportMessages, supportTickets } from "@/lib/db/schema"
import { deliver, type Delivery } from "@/lib/emails/outbox"
import { supportInbox } from "@/lib/emails/policy"
import { supportReply, supportRequestNotification, supportRequestReceived, type SupportMailFacts } from "@/lib/emails/support-emails"
import { userHasPerk } from "@/lib/affiliates/perk-access"
import { getUserPlan } from "@/lib/subscription"
import { categoryLabel, looksAutomated, rateLimited, readSupportRequest, ticketRef, ticketSubject, type SupportField, type SupportInput } from "./request"

// Support requests from the Contact Support window. A request becomes a ticket
// in the existing support desk (support_tickets + support_messages, answered
// from /admin/support); the team is told at the support inbox and the sender
// gets a confirmation — both through the email outbox, so a provider that is
// down delays the emails and never loses the ticket.
//
// Works with or without an account. With one, the ticket belongs to the
// account (it shows under Support in the app) and is answered to the account's
// email, whatever was typed. Without one, it is answered to the email given.

export type SupportSender = { id: string; email: string; name: string | null }
export type SupportResult = { ok: true; ticketId: number; ref: string; email: string; signedIn: boolean } | { ok: false; error: string; field?: SupportField; limited?: boolean }

const GENERIC = "We couldn't send your message right now. Please try again."
const LIMITED = "Please wait before sending another message. For security and abuse prevention, support requests are temporarily limited."

const HOUR = 3_600_000
const count = sql<number>`count(*)::int`

// How many requests this sender — by account or email, and by network — has
// made in the last hour and day.
async function recentCounts(who: { userId: string | null; email: string; ipHash: string | null }, now: Date) {
  const mine = who.userId ? eq(supportTickets.userId, who.userId) : eq(supportTickets.email, who.email)
  const since = (ms: number) => gte(supportTickets.createdAt, new Date(now.getTime() - ms))
  const one = async (...where: Parameters<typeof and>) => (await db.select({ n: count }).from(supportTickets).where(and(...where)))[0]?.n ?? 0
  const [hour, day, ipHour, ipDay] = await Promise.all([
    one(mine, since(HOUR)),
    one(mine, since(24 * HOUR)),
    who.ipHash ? one(eq(supportTickets.ipHash, who.ipHash), since(HOUR)) : 0,
    who.ipHash ? one(eq(supportTickets.ipHash, who.ipHash), since(24 * HOUR)) : 0,
  ])
  return { hour, day, ipHour, ipDay }
}

export async function createSupportRequest(input: SupportInput, ctx: { user: SupportSender | null; ipHash: string | null; now?: Date }): Promise<SupportResult> {
  // Nothing is created for a form a person didn't fill in — and it isn't told why.
  if (looksAutomated(input)) return { ok: false, error: GENERIC }
  // The account's own email is the one answered, whatever the form says.
  const parsed = readSupportRequest(ctx.user ? { ...input, email: ctx.user.email } : input)
  if (!parsed.ok) return { ok: false, error: parsed.error, field: parsed.field }
  const req = parsed.value
  const now = ctx.now ?? new Date()
  const name = req.name ?? ctx.user?.name?.trim() ?? null

  if (rateLimited(await recentCounts({ userId: ctx.user?.id ?? null, email: req.email, ipHash: ctx.ipHash }, now))) return { ok: false, error: LIMITED, limited: true }

  // Answered first for an affiliate whose tier includes priority support.
  const priority = ctx.user ? await userHasPerk(ctx.user.id, "prioritySupport") : false
  const ticket = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(supportTickets)
      .values({ userId: ctx.user?.id ?? null, email: req.email, name, category: req.category, page: req.page, ipHash: ctx.ipHash, subject: ticketSubject(req.category, req.message), priority, kind: req.category === "feature" ? "feature_request" : "support", createdAt: now, lastMessageAt: now })
      .returning({ id: supportTickets.id })
    await tx.insert(supportMessages).values({ ticketId: row.id, authorId: ctx.user?.id ?? "guest", body: req.message, createdAt: now })
    return row
  })

  // The ticket exists from here on. The emails are best-effort on top of it:
  // whatever goes wrong with them, the sender still gets their ticket number.
  const ref = ticketRef(ticket.id)
  const facts: SupportMailFacts = { ticketId: ticket.id, ref, category: categoryLabel(req.category), message: req.message, name, email: req.email, signedIn: !!ctx.user, submittedAt: now }
  try {
    const plan = ctx.user ? await getUserPlan(ctx.user.id).catch(() => null) : null
    const account = ctx.user ? `TradeLoop account${plan ? ` · ${plan === "pro" ? "Pro" : "Essential"} plan` : " · no active plan"}` : null
    await deliver({ key: `support_new:${ticket.id}`, to: supportInbox(), replyTo: req.email, doc: supportRequestNotification({ ...facts, account, page: req.page, priority }) })
    await deliver({ key: `support_received:${ticket.id}`, to: req.email, doc: supportRequestReceived(facts) })
  } catch (e) {
    console.error("[support] emails for", ref, "couldn't be queued:", e instanceof Error ? e.message : e)
  }
  return { ok: true, ticketId: ticket.id, ref, email: req.email, signedIn: !!ctx.user }
}

// The team's reply, emailed to whoever the ticket is answered to. Once per
// reply (the outbox key is the reply's own id).
export async function emailSupportReply(input: { ticketId: number; messageId: number; subject: string; reply: string; to: string; name: string | null; signedIn: boolean }): Promise<Delivery> {
  return deliver({ key: `support_reply:${input.messageId}`, to: input.to, doc: supportReply({ ticketId: input.ticketId, ref: ticketRef(input.ticketId), subject: input.subject, reply: input.reply, name: input.name, signedIn: input.signedIn }) })
}
