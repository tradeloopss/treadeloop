import { db } from "@/lib/db"
import { subscriptions, user } from "@/lib/db/schema"
import { desc, eq, inArray } from "drizzle-orm"

// past_due keeps access during the grace period Whop gives a failed renewal
// before it lapses to canceled/expired.
const ACTIVE_STATUSES = ["active", "trialing", "past_due"]

// Site owner(s) always get full Pro access, independent of Whop — set in
// .env.local as a comma-separated list.
const OWNER_EMAILS = (process.env.OWNER_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

export async function isOwner(userId: string): Promise<boolean> {
  if (OWNER_EMAILS.length === 0) return false
  const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId))
  return row != null && OWNER_EMAILS.includes(row.email.toLowerCase())
}

// No matching subscription at all (the common case before Whop is fully
// rolled out, or for a free/unpaid user) resolves to null, which every
// gate below treats the same as "essential" — i.e. free-tier limits apply.
export async function getUserPlan(userId: string): Promise<"pro" | "essential" | null> {
  if (await isOwner(userId)) return "pro"
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.updatedAt))
  const active = rows.filter((r) => ACTIVE_STATUSES.includes(r.status))
  if (active.some((r) => r.plan === "pro")) return "pro"
  if (active.length > 0) return "essential"
  return null
}

export async function isPro(userId: string): Promise<boolean> {
  return (await getUserPlan(userId)) === "pro"
}

export async function requirePro(userId: string, feature: string): Promise<void> {
  if (!(await isPro(userId))) {
    throw new Error(`${feature} is a Pro feature — upgrade at /pricing to unlock it.`)
  }
}
