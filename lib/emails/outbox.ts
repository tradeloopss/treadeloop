import { and, eq, inArray, lt, lte, or, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { emailEvents } from "@/lib/db/schema"
import { emailConfigured, sendEmail } from "@/lib/email"
import { renderEmail, type EmailDoc } from "./layout"
import { MAX_EMAIL_ATTEMPTS, retryDelayMs, senderAddress } from "./policy"

// Delivery of the transactional emails: each event is emailed ONCE, a delivery
// the provider didn't take is retried with a growing delay, and what finally
// happened is on record (email_events).
//
// Email state is separate from what the email is about: a payout that was
// sent stays sent whether or not its email could be delivered.

export { MAX_EMAIL_ATTEMPTS, retryDelayMs, senderAddress }

// A delivery claimed but never finished (the process died mid-send) is
// picked up again after this long.
const STUCK_MS = 10 * 60_000

type Row = typeof emailEvents.$inferSelect

// One attempt for a row this caller has claimed.
async function attempt(row: Pick<Row, "id" | "key" | "sender" | "recipient" | "subject" | "html" | "text" | "attempts" | "replyTo">): Promise<"sent" | "queued" | "failed"> {
  try {
    // The provider is given the event's key too, so even a retry of a send
    // whose answer was lost can't deliver a second copy.
    await sendEmail({ to: row.recipient, from: row.sender, replyTo: row.replyTo, subject: row.subject, text: row.text, html: row.html, idempotencyKey: row.key })
    await db.update(emailEvents).set({ status: "sent", sentAt: new Date(), lastError: null }).where(eq(emailEvents.id, row.id))
    return "sent"
  } catch (e) {
    const message = (e instanceof Error ? e.message : "The email provider couldn't be reached.").slice(0, 300)
    const giveUp = row.attempts >= MAX_EMAIL_ATTEMPTS
    await db
      .update(emailEvents)
      .set({ status: giveUp ? "failed" : "queued", lastError: message, nextAttemptAt: new Date(Date.now() + retryDelayMs(row.attempts)) })
      .where(eq(emailEvents.id, row.id))
    if (giveUp) console.error("[emails] gave up on", row.key, message)
    return giveUp ? "failed" : "queued"
  }
}

export type Delivery = "sent" | "queued" | "failed" | "duplicate" | "skipped"

// Emails one event. `key` identifies the event ("payout_sent:42"); the unique
// index on it is what makes a second call — a retried job, two workers, a
// double click — send nothing.
export async function deliver(input: { key: string; to: string; doc: EmailDoc; affiliateId?: number | null; replyTo?: string | null }): Promise<Delivery> {
  if (!emailConfigured()) return "skipped"
  const { html, text } = renderEmail(input.doc)
  const [row] = await db
    .insert(emailEvents)
    .values({ key: input.key.slice(0, 200), template: input.doc.template, sender: senderAddress(input.doc.sender), recipient: input.to, subject: input.doc.subject, html, text, status: "sending", attempts: 1, affiliateId: input.affiliateId ?? null, replyTo: input.replyTo ?? null })
    .onConflictDoNothing({ target: emailEvents.key })
    .returning()
  if (!row) return "duplicate"
  return attempt(row)
}

// An email that is only worth sending NOW — a verification code. One attempt,
// never retried (a code that arrives twenty minutes late is useless), and its
// body is not kept: the record says that it was sent, to whom and when, not
// what the code was.
export async function deliverNow(input: { key: string; to: string; doc: EmailDoc; affiliateId?: number | null }): Promise<"sent" | "failed" | "skipped"> {
  if (!emailConfigured()) return "skipped"
  const { html, text } = renderEmail(input.doc)
  const sender = senderAddress(input.doc.sender)
  let error: string | null = null
  try {
    await sendEmail({ to: input.to, from: sender, subject: input.doc.subject, text, html, idempotencyKey: input.key })
  } catch (e) {
    error = (e instanceof Error ? e.message : "The email provider couldn't be reached.").slice(0, 300)
  }
  try {
    await db
      .insert(emailEvents)
      .values({ key: input.key.slice(0, 200), template: input.doc.template, sender, recipient: input.to, subject: input.doc.subject, html: "", text: "", status: error ? "failed" : "sent", attempts: 1, lastError: error, sentAt: error ? null : new Date(), affiliateId: input.affiliateId ?? null })
      .onConflictDoNothing({ target: emailEvents.key })
  } catch (e) {
    // the record is a courtesy; the delivery already happened (or didn't)
    console.error("[emails] couldn't record", input.key, e instanceof Error ? e.message : e)
  }
  return error ? "failed" : "sent"
}

// The worker's pass: deliveries whose retry time has come, and ones left
// half-done. Each is claimed with a conditional update, so two workers never
// send the same row.
export async function retryDueEmails(limit = 25): Promise<{ tried: number; sent: number; failed: number }> {
  if (!emailConfigured()) return { tried: 0, sent: 0, failed: 0 }
  const now = new Date()
  const due = await db
    .select({ id: emailEvents.id, status: emailEvents.status, attempts: emailEvents.attempts })
    .from(emailEvents)
    .where(or(and(eq(emailEvents.status, "queued"), lte(emailEvents.nextAttemptAt, now)), and(eq(emailEvents.status, "sending"), lt(emailEvents.createdAt, new Date(now.getTime() - STUCK_MS)), lt(emailEvents.nextAttemptAt, new Date(now.getTime() - STUCK_MS)))))
    .orderBy(emailEvents.nextAttemptAt)
    .limit(limit)
  let sent = 0
  let failed = 0
  for (const d of due) {
    const [claimed] = await db
      .update(emailEvents)
      .set({ status: "sending", attempts: d.attempts + 1, nextAttemptAt: now })
      .where(and(eq(emailEvents.id, d.id), eq(emailEvents.status, d.status), eq(emailEvents.attempts, d.attempts)))
      .returning()
    if (!claimed) continue
    const result = await attempt(claimed)
    if (result === "sent") sent++
    if (result === "failed") failed++
  }
  return { tried: due.length, sent, failed }
}

// The bodies are only needed while a delivery can still be retried. Finished
// rows keep their record (who, what, when, result) and drop the HTML after 60 days.
export async function pruneEmailEvents(): Promise<number> {
  const rows = await db
    .update(emailEvents)
    .set({ html: "", text: "" })
    .where(and(inArray(emailEvents.status, ["sent", "failed"]), lt(emailEvents.createdAt, new Date(Date.now() - 60 * 86_400_000)), sql`${emailEvents.html} <> ''`))
    .returning({ id: emailEvents.id })
  return rows.length
}

export async function recentEmailEvents(limit = 40) {
  return db
    .select({ id: emailEvents.id, key: emailEvents.key, template: emailEvents.template, sender: emailEvents.sender, recipient: emailEvents.recipient, subject: emailEvents.subject, status: emailEvents.status, attempts: emailEvents.attempts, lastError: emailEvents.lastError, createdAt: emailEvents.createdAt, sentAt: emailEvents.sentAt })
    .from(emailEvents)
    .orderBy(sql`${emailEvents.id} desc`)
    .limit(limit)
}
