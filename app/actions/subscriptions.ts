"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { subscriptions } from "@/lib/db/schema"
import { and, desc, eq, ne } from "drizzle-orm"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { createCheckout, confirmPendingCheckouts, PENDING_STATUS } from "@/lib/checkout"
import { getUserPlan } from "@/lib/subscription"
import type { PlanTier, Billing } from "@/lib/whop"

async function getSession() {
  return auth.api.getSession({ headers: await headers() })
}

export async function getMySubscription() {
  const session = await getSession()
  if (!session?.user) return null
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, session.user.id), ne(subscriptions.status, PENDING_STATUS)))
    .orderBy(desc(subscriptions.updatedAt))
  return row ?? null
}

// A purchase has to belong to an account the moment it's made, or there's
// nobody to unlock when the buyer comes back — so a signed-out visitor
// (e.g. on /pricing) signs up first and lands on /checkout, which picks the
// same plan up and sends them on to Whop.
export async function startCheckout(plan: PlanTier, billing: Billing) {
  const session = await getSession()
  if (!session?.user) {
    redirect(`/sign-up?next=${encodeURIComponent(`/checkout?plan=${plan}&billing=${billing}`)}`)
  }
  const url = await createCheckout(session.user, plan, billing)
  redirect(url)
}

// Polled by /checkout/complete until the plan is live, whichever of the
// direct Whop lookup or the webhook gets there first.
export async function checkActivation(): Promise<boolean> {
  const session = await getSession()
  if (!session?.user) return false
  await confirmPendingCheckouts(session.user.id)
  return (await getUserPlan(session.user.id)) !== null
}
