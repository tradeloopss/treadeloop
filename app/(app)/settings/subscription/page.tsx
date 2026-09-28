import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { getUserPlan } from "@/lib/subscription"
import { SubscriptionSettingsView } from "@/components/settings/pages/subscription-view"

export const metadata = { title: "Subscription" }

export default async function SubscriptionSettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect("/sign-in")
  const plan = await getUserPlan(session.user.id)
  return <SubscriptionSettingsView plan={plan} />
}
