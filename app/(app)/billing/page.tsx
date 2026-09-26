import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { getBillingOverview, type PlanOption } from "@/lib/billing"
import { trialIpHashFrom } from "@/lib/trial-ip"
import { PLAN_PRICING, renewalPriceFor, type Billing, type PlanTier } from "@/lib/whop"
import { getT } from "@/lib/i18n/server"
import { BillingCenter } from "@/components/billing/billing-center"

export async function generateMetadata() {
  const t = await getT()
  return { title: t("Billing — TradeLoop") }
}

// Several Whop lookups (membership, payments, plan, saved cards) per load.
export const maxDuration = 30

export default async function BillingPage() {
  const h = await headers()
  const session = await auth.api.getSession({ headers: h })
  if (!session?.user) redirect("/sign-in?next=/billing")
  const overview = await getBillingOverview({ id: session.user.id, email: session.user.email, name: session.user.name }, trialIpHashFrom(h))

  // What each plan would charge if chosen now — the same numbers checkout
  // creates (promo included; a switch never gets a second free trial).
  const planOptions: PlanOption[] = (["essential", "pro"] as PlanTier[]).flatMap((plan) =>
    (["monthly", "annual"] as Billing[]).map((billing) => {
      const { amount, billingPeriodDays } = renewalPriceFor(plan, billing, overview.trialEligible)
      const list = billing === "annual" ? PLAN_PRICING[plan].annualPrice * 12 : PLAN_PRICING[plan].monthlyPrice
      return { plan, billing, title: PLAN_PRICING[plan].title, amount, list, periodDays: billingPeriodDays }
    }),
  )

  return <BillingCenter overview={overview} planOptions={planOptions} />
}
