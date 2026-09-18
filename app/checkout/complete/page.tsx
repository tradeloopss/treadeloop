import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { confirmPendingCheckouts } from "@/lib/checkout"
import { getUserPlan } from "@/lib/subscription"
import { ActivatingPlan } from "@/components/activating-plan"

// Whop's checkout redirects here once payment (or the free-trial signup)
// goes through. If the plan can be confirmed right now — the webhook already
// landed, or Whop's API shows the new membership — go straight to the
// dashboard; otherwise show a short "activating" screen that keeps checking.
export default async function CheckoutCompletePage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect(`/sign-in?next=${encodeURIComponent("/checkout/complete")}`)

  await confirmPendingCheckouts(session.user.id)
  if (await getUserPlan(session.user.id)) redirect("/dashboard")

  return <ActivatingPlan />
}
