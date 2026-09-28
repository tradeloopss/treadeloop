"use client"

import Link from "next/link"
import { CreditCard, ArrowUpRight } from "lucide-react"
import { SettingsHeader, Panel } from "@/components/settings/chrome"
import { Button } from "@/components/ui/button"
import { useT } from "@/components/locale-provider"

const PLAN_LABEL: Record<string, string> = { pro: "Pro", essential: "Essential" }

export function SubscriptionSettingsView({ plan }: { plan: "pro" | "essential" | null }) {
  const t = useT()
  return (
    <div className="space-y-6">
      <SettingsHeader icon={CreditCard} title={t("Subscription")} />
      <Panel title={t("Plan")}>
        <div className="flex flex-wrap items-center justify-between gap-4 px-2 py-3">
          <div className="flex items-center gap-3">
            <span
              className={
                plan === "pro"
                  ? "rounded-md bg-primary/15 px-2.5 py-1 text-sm font-semibold text-primary"
                  : "rounded-md bg-muted px-2.5 py-1 text-sm font-semibold text-foreground"
              }
            >
              {plan ? t(PLAN_LABEL[plan] ?? plan) : t("No active plan")}
            </span>
            <p className="text-sm text-muted-foreground">
              {plan === "pro"
                ? t("You're on Pro — every feature unlocked.")
                : plan === "essential"
                  ? t("You're on Essential. Upgrade to Pro for unlimited features.")
                  : t("Start a plan to unlock TradeLoop.")}
            </p>
          </div>
          <Button size="sm" render={<Link href="/billing" />}>
            {t("Manage subscription")}
            <ArrowUpRight className="size-3.5" />
          </Button>
        </div>
        <p className="px-2 pb-2 text-xs text-muted-foreground">
          {t("View invoices, change plan, update payment method and cancel on the Billing page.")}
        </p>
      </Panel>
    </div>
  )
}
