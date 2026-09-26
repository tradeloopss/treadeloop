import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { createCheckout } from "@/lib/checkout"
import { getUserPlan, hasUsedTrial } from "@/lib/subscription"
import { trialIpHashFrom } from "@/lib/trial-ip"
import type { PlanTier, Billing } from "@/lib/whop"

// Where a visitor who picked a plan while signed out lands after signing
// up (startCheckout sends them to /sign-up?next=/checkout?plan=…): picks the
// chosen plan back up and forwards straight to Whop's checkout page.
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; billing?: string }>
}) {
  const { plan, billing } = await searchParams
  if ((plan !== "essential" && plan !== "pro") || (billing !== "monthly" && billing !== "annual")) {
    redirect("/pricing")
  }

  const h = await headers()
  const session = await auth.api.getSession({ headers: h })
  if (!session?.user) {
    redirect(`/sign-up?next=${encodeURIComponent(`/checkout?plan=${plan}&billing=${billing}`)}`)
  }
  // Already subscribed (e.g. signed in to an existing account) — don't sell
  // them a second plan.
  if (await getUserPlan(session.user.id)) redirect("/dashboard")
  // They picked this plan while signed out, when the page promised a free
  // trial it couldn't know they'd already had — by their account, email, or
  // this IP. Rather than send them to a checkout that charges today, show them
  // the plans as they actually are.
  const ipHash = trialIpHashFrom(h)
  if (await hasUsedTrial(session.user.id, session.user.email, ipHash)) redirect("/pricing")

  redirect(await createCheckout(session.user, plan as PlanTier, billing as Billing, null, ipHash))
}
