"use server"

import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { createCheckout, confirmPendingCheckouts } from "@/lib/checkout"
import { getUserPlan } from "@/lib/subscription"
import { currentWhopMembershipId } from "@/lib/billing"
import type { PlanTier, Billing } from "@/lib/whop"

async function getSession() {
  return auth.api.getSession({ headers: await headers() })
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
  // Already subscribed on Whop: this is a plan switch, and the new
  // membership retires the current one once it's live (lib/checkout.ts).
  const replaces = await currentWhopMembershipId(session.user.id)
  const url = await createCheckout(session.user, plan, billing, replaces)
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
