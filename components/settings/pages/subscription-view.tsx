"use client"

import { CreditCard } from "lucide-react"
import type { BillingOverview, PlanOption } from "@/lib/billing"
import { BillingCenter } from "@/components/billing/billing-center"
import { SettingsHeader } from "@/components/settings/chrome"
import { useT } from "@/components/locale-provider"

// The real Billing experience, hosted inside the Settings shell so Subscription
// behaves exactly like the Billing page (plan, price, invoices, payment method).
export function SubscriptionSettingsView({ overview, planOptions }: { overview: BillingOverview; planOptions: PlanOption[] }) {
  const t = useT()
  return (
    <div className="space-y-6">
      <SettingsHeader icon={CreditCard} title={t("Subscription")} />
      <BillingCenter overview={overview} planOptions={planOptions} />
    </div>
  )
}
