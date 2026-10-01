import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliateNotifications, affiliates } from "@/lib/db/schema"
import { emailConfigured, sendEmail } from "@/lib/email"
import { generalNotice } from "@/lib/emails/affiliate-emails"
import type { EmailDoc, Sender } from "@/lib/emails/layout"
import { deliver } from "@/lib/emails/outbox"
import { NOTIFICATION_PREFS, type NotificationPref } from "./types"
import { SITE_URL } from "./program"

// In-portal notifications for affiliates, plus an email through the existing
// Resend integration when the affiliate has that kind switched on. Best-effort:
// a notification must never break the money flow that triggered it.
//
// Emails go out in the TradeLoop layout, from the program's own senders
// (TradeLoop Affiliates / TradeLoop Payments — never the site's no-reply), and
// through the outbox, which sends each event once and retries a failed delivery.

// Who an email is being written to.
export type MailRecipient = { id: number; firstName: string; lastName: string; email: string; code: string; onboarded: boolean }
// A specific template for this event. `key` identifies the event, so it can
// never be emailed twice.
export type Mail = { key: string; build: (to: MailRecipient) => EmailDoc }

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? SITE_URL).replace(/\/+$/, "")

export function prefEnabled(prefs: Record<string, boolean> | null | undefined, key: NotificationPref): boolean {
  const def = NOTIFICATION_PREFS.find((p) => p.key === key)?.default ?? true
  return prefs && typeof prefs[key] === "boolean" ? prefs[key] : def
}

// A heads-up to the site owners (OWNER_EMAILS) when the money side needs a
// person: the payout wallet is short, or an automatic send gave up.
// Best-effort, like every notification.
export async function notifyOwners(subject: string, text: string): Promise<void> {
  try {
    if (!emailConfigured()) return
    const owners = (process.env.OWNER_EMAILS ?? "").split(",").map((e) => e.trim()).filter((e) => e.includes("@"))
    for (const to of owners.slice(0, 5)) await sendEmail({ to, subject: `${subject} — TradeLoop Affiliates`, text: `${text}\n\n${APP_URL}/admin/affiliates/payouts` })
  } catch (e) {
    console.error("[affiliates] owner notification failed:", e instanceof Error ? e.message : e)
  }
}

export async function notifyAffiliate(input: {
  affiliateId: number
  type: string
  title: string
  body?: string
  href?: string
  // which preference gates the email; omit for emails that always send
  // (application decisions, payout failures)
  pref?: NotificationPref
  email?: boolean
  // The template for this event. Without one the email is the notification's
  // own title and body in the standard layout.
  mail?: Mail | null
  // Who that plain notice comes from (money matters → payments).
  sender?: Sender
}): Promise<void> {
  try {
    const [note] = await db.insert(affiliateNotifications).values({ affiliateId: input.affiliateId, type: input.type, title: input.title, body: input.body ?? null, href: input.href ?? null }).returning({ id: affiliateNotifications.id })
    if (!input.email || !emailConfigured()) return
    const [aff] = await db.select({ id: affiliates.id, email: affiliates.email, firstName: affiliates.firstName, lastName: affiliates.lastName, code: affiliates.code, onboardedAt: affiliates.onboardedAt, notifications: affiliates.notifications }).from(affiliates).where(eq(affiliates.id, input.affiliateId))
    if (!aff || (input.pref && !prefEnabled(aff.notifications, input.pref))) return
    const to: MailRecipient = { id: aff.id, firstName: aff.firstName, lastName: aff.lastName, email: aff.email, code: aff.code, onboarded: !!aff.onboardedAt }
    const doc = input.mail ? input.mail.build(to) : generalNotice({ firstName: aff.firstName, sender: input.sender ?? "affiliate", title: input.title, body: input.body ?? input.title, href: input.href })
    await deliver({ key: input.mail?.key ?? `notice:${note.id}`, to: aff.email, doc, affiliateId: aff.id })
  } catch (e) {
    console.error("[affiliates] notification failed:", e instanceof Error ? e.message : e)
  }
}
