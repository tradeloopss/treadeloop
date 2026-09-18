import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PLAN_PRICING, type PlanTier } from "@/lib/whop"
import { Crown } from "lucide-react"

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
  if (isOwner) {
    return (
      <Card className="max-w-lg p-5">
        <div className="flex items-center gap-2">
          <Crown className="size-4 text-primary" />
          <h2 className="font-medium">Owner access</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account has full Pro access with no billing — this doesn't go through Whop.
        </p>
      </Card>
    )
  }

  if (!subscription) {
    return (
      <Card className="max-w-lg p-5">
        <h2 className="font-medium">Subscription</h2>
        <p className="mt-1 text-sm text-muted-foreground">You don't have an active plan yet.</p>
        <Button render={<Link href="/pricing" />} className="mt-3">
          View plans
        </Button>
      </Card>
    )
  }

  const tier = subscription.plan as PlanTier
  const planName = PLAN_PRICING[tier]?.title ?? subscription.plan
  const statusLabel = STATUS_LABEL[subscription.status] ?? subscription.status

  return (
    <Card className="max-w-lg space-y-4 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium">Subscription</h2>
          <p className="mt-1 text-sm text-muted-foreground">Manage your plan and billing.</p>
        </div>
        <Badge variant={subscription.status === "active" || subscription.status === "trialing" ? "default" : "outline"}>
          {statusLabel}
        </Badge>
      </div>

      <div className="rounded-md border p-4">
        <p className="font-semibold">{planName} plan</p>
        {subscription.currentPeriodEnd && (
          <p className="mt-1 text-sm text-muted-foreground">
            {subscription.status === "trialing" ? "Trial ends" : "Renews"} on{" "}
            {new Date(subscription.currentPeriodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </p>
        )}
      </div>

      <Button render={<Link href="/pricing" />} variant="outline">
        Change plan
      </Button>
    </Card>
  )
}
