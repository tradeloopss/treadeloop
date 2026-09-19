"use client"

import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PLAN_PRICING, type PlanTier } from "@/lib/whop"
import { Crown } from "lucide-react"
import { useIntlLocale, useT } from "@/components/locale-provider"

export interface SubscriptionInfo {
  plan: string
  status: string
  currentPeriodEnd: Date | null
}

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Free trial",
  past_due: "Payment past due",
  canceled: "Canceled",
  expired: "Expired",
}

export function SubscriptionPanel({
  subscription,
  isOwner,
}: {
  subscription: SubscriptionInfo | null
  isOwner: boolean
}) {
  const t = useT()
  const dateLocale = useIntlLocale()
  if (isOwner) {
    return (
      <Card className="max-w-lg p-5">
        <div className="flex items-center gap-2">
          <Crown className="size-4 text-primary" />
          <h2 className="font-medium">{t("Owner access")}</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Your account has full Pro access with no billing — this doesn't go through Whop.")}
        </p>
      </Card>
    )
  }

  if (!subscription) {
    return (
      <Card className="max-w-lg p-5">
        <h2 className="font-medium">{t("Subscription")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("You don't have an active plan yet.")}</p>
        <Button render={<Link href="/pricing" />} className="mt-3">
          {t("View plans")}
        </Button>
      </Card>
    )
  }

  const tier = subscription.plan as PlanTier
  const planName = PLAN_PRICING[tier]?.title ?? subscription.plan
  const statusLabel = t(STATUS_LABEL[subscription.status] ?? subscription.status)

  return (
    <Card className="max-w-lg space-y-4 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium">{t("Subscription")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("Manage your plan and billing.")}</p>
        </div>
        <Badge variant={subscription.status === "active" || subscription.status === "trialing" ? "default" : "outline"}>
          {statusLabel}
        </Badge>
      </div>

      <div className="rounded-md border p-4">
        <p className="font-semibold">{t("{plan} plan", { plan: planName })}</p>
        {subscription.currentPeriodEnd && (
          <p className="mt-1 text-sm text-muted-foreground">
            {t(subscription.status === "trialing" ? "Trial ends on {date}" : "Renews on {date}", {
              date: new Date(subscription.currentPeriodEnd).toLocaleDateString(dateLocale, { month: "long", day: "numeric", year: "numeric" }),
            })}
          </p>
        )}
      </div>

      <Button render={<Link href="/pricing" />} variant="outline">
        {t("Change plan")}
      </Button>
    </Card>
  )
}
