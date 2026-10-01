import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliateNotifications, affiliates } from "@/lib/db/schema"
import { emailConfigured, sendEmail } from "@/lib/email"
import { NOTIFICATION_PREFS, type NotificationPref } from "./types"
import { SITE_URL } from "./program"

// In-portal notifications for affiliates, plus an email through the existing
// Resend integration when the affiliate has that kind switched on. Best-effort:
// a notification must never break the money flow that triggered it.

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? SITE_URL).replace(/\/+$/, "")

export function prefEnabled(prefs: Record<string, boolean> | null | undefined, key: NotificationPref): boolean {
  const def = NOTIFICATION_PREFS.find((p) => p.key === key)?.default ?? true
  return prefs && typeof prefs[key] === "boolean" ? prefs[key] : def
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
}): Promise<void> {
  try {
    await db.insert(affiliateNotifications).values({ affiliateId: input.affiliateId, type: input.type, title: input.title, body: input.body ?? null, href: input.href ?? null })
    if (!input.email || !emailConfigured()) return
    const [aff] = await db.select({ email: affiliates.email, firstName: affiliates.firstName, notifications: affiliates.notifications }).from(affiliates).where(eq(affiliates.id, input.affiliateId))
    if (!aff || (input.pref && !prefEnabled(aff.notifications, input.pref))) return
    const link = input.href ? `\n\n${APP_URL}${input.href}` : ""
    await sendEmail({ to: aff.email, subject: `${input.title} — TradeLoop Affiliates`, text: `Hi ${aff.firstName},\n\n${input.body ?? input.title}${link}` })
  } catch (e) {
    console.error("[affiliates] notification failed:", e instanceof Error ? e.message : e)
  }
}
