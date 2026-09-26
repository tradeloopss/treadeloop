import { db } from "@/lib/db"
import { subscriptions, user } from "@/lib/db/schema"
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm"

// past_due keeps access during the grace period Whop gives a failed renewal
// before it lapses to canceled/expired.
const ACTIVE_STATUSES = ["active", "trialing", "past_due"]

// A checkout the user has started but Whop hasn't confirmed yet (written by
// lib/checkout.ts). Never grants access by itself — it only remembers which
// Whop plan belongs to which user.
export const PENDING_STATUS = "pending"

// Site owner(s) always get full Pro access, independent of Whop — set in
// .env.local as a comma-separated list.
const OWNER_EMAILS = (process.env.OWNER_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

export function isOwnerEmail(email: string): boolean {
  return OWNER_EMAILS.includes(email.toLowerCase())
}

export function ownerEmails(): string[] {
  return OWNER_EMAILS
}

export async function isOwner(userId: string): Promise<boolean> {
  if (OWNER_EMAILS.length === 0) return false
  const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId))
  return row != null && isOwnerEmail(row.email)
}

// Whether a subscriptions row grants access right now. Admin grants lapse at
// currentPeriodEnd; Whop rows are kept current by the webhook instead, so
// their period end isn't enforced here.
export function rowGrantsAccess(row: { status: string; source: string; currentPeriodEnd: Date | null }): boolean {
  if (!ACTIVE_STATUSES.includes(row.status)) return false
  if (row.source === "admin" && row.currentPeriodEnd && row.currentPeriodEnd.getTime() < Date.now()) return false
  return true
}

// No matching subscription at all (the common case before Whop is fully
// rolled out, or for a free/unpaid user) resolves to null, which every
// gate below treats the same as "essential" — i.e. free-tier limits apply.
export async function getUserPlan(userId: string): Promise<"pro" | "essential" | null> {
  if (await isOwner(userId)) return "pro"
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.updatedAt))
  const active = rows.filter(rowGrantsAccess)
  if (active.some((r) => r.plan === "pro")) return "pro"
  if (active.length > 0) return "essential"
  return null
}

// Whether this person has already had their free trial. Every Whop checkout
// created for a first-time subscriber carries one, so any Whop membership
// that ever existed for them — under this account, under their email in case
// they come back with a new account, or from the same IP the trial was claimed
// from (lib/trial-ip.ts) — means the trial is spent, however it ended. Pending
// rows are checkouts that were never completed, and admin grants aren't trials,
// so neither counts.
export async function hasUsedTrial(userId: string, email: string, ipHash?: string | null): Promise<boolean> {
  const identity = [eq(subscriptions.userId, userId), sql`lower(${subscriptions.email}) = ${email.toLowerCase()}`]
  if (ipHash) identity.push(eq(subscriptions.trialIpHash, ipHash))
  const [row] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.source, "whop"), ne(subscriptions.status, PENDING_STATUS), or(...identity)))
    .limit(1)
  return row != null
}

// Trial-eligibility by IP alone — for a signed-out visitor (the pricing page),
// where there's no account or email to check yet.
export async function ipHasUsedTrial(ipHash: string | null | undefined): Promise<boolean> {
  if (!ipHash) return false
  const [row] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.source, "whop"), ne(subscriptions.status, PENDING_STATUS), eq(subscriptions.trialIpHash, ipHash)))
    .limit(1)
  return row != null
}

export async function isPro(userId: string): Promise<boolean> {
  return (await getUserPlan(userId)) === "pro"
}

export async function requirePro(userId: string, feature: string): Promise<void> {
  if (!(await isPro(userId))) {
    throw new Error(`${feature} is a Pro feature — upgrade at /pricing to unlock it.`)
  }
}
