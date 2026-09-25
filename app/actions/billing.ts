"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { getWhopClient } from "@/lib/whop"
import { currentWhopMembershipId, memberAndCardInUse } from "@/lib/billing"

// The Billing page's actions, all on the signed-in user's own Whop
// membership — found server-side from our records, never taken from the
// browser. Results come back as values (Next hides thrown messages in
// production).
type Result = { ok: true } | { ok: false; error: string }

async function userId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user?.id ?? null
}

async function setCancelAtPeriodEnd(cancel: boolean): Promise<Result> {
  const id = await userId()
  if (!id) return { ok: false, error: "Please sign in again." }
  const membershipId = await currentWhopMembershipId(id)
  if (!membershipId) return { ok: false, error: "There's no Whop subscription on this account." }
  try {
    await getWhopClient().memberships.update({ id: membershipId, cancel_at_period_end: cancel })
  } catch (err) {
    console.error("[billing] couldn't update cancel_at_period_end:", err instanceof Error ? err.message : err)
    return { ok: false, error: cancel ? "We couldn't cancel your subscription right now — please try again." : "We couldn't reactivate your subscription right now — please try again." }
  }
  revalidatePath("/billing")
  return { ok: true }
}

// Stops the renewal; access runs to the end of the period already paid for
// (or the trial), and nothing more is charged.
export async function cancelSubscription(): Promise<Result> {
  return setCancelAtPeriodEnd(true)
}

// Undoes a pending cancellation, before the period ends.
export async function reactivateSubscription(): Promise<Result> {
  return setCancelAtPeriodEnd(false)
}

// Removes a saved card from the user's Whop wallet. The card the
// subscription is charged with stays — change it on Whop first.
export async function removePaymentMethod(paymentMethodId: string): Promise<Result> {
  const id = await userId()
  if (!id) return { ok: false, error: "Please sign in again." }
  const membershipId = await currentWhopMembershipId(id)
  if (!membershipId) return { ok: false, error: "There's no Whop subscription on this account." }
  try {
    const client = getWhopClient()
    const { memberId, cardInUse } = await memberAndCardInUse(membershipId)
    if (!memberId) return { ok: false, error: "We couldn't find your saved cards on Whop." }
    if (paymentMethodId === cardInUse) return { ok: false, error: "That card pays for your subscription. Switch to another card on Whop first, then remove it." }
    const owned = (await client.paymentMethods.list({ member_id: memberId })).data.some((pm) => pm.id === paymentMethodId)
    if (!owned) return { ok: false, error: "That card isn't on your account." }
    await client.paymentMethods.deletePaymentMethod({ id: paymentMethodId, member_id: memberId })
  } catch (err) {
    console.error("[billing] couldn't remove a payment method:", err instanceof Error ? err.message : err)
    return { ok: false, error: "We couldn't remove that card right now — please try again." }
  }
  revalidatePath("/billing")
  return { ok: true }
}
