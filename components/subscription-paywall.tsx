"use client"

import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import { PricingPlans } from "@/components/pricing-plans"
import { Button } from "@/components/ui/button"
import { LogOut, Lock } from "lucide-react"
import { useT } from "@/components/locale-provider"

// Shown over a blurred dashboard for a signed-in user with no active plan.
// They can subscribe without leaving the page, or sign out — those are the
// only two things reachable, since the app behind is inert. trialEligible
// is false once they've had their free trial (a lapsed trial is the common
// way to end up here), and the copy then sells the plan as starting today.
export function SubscriptionPaywall({ userName, trialEligible = true }: { userName: string; trialEligible?: boolean }) {
  const router = useRouter()
  const t = useT()

  async function onSignOut() {
    await authClient.signOut()
    router.push("/sign-in")
    router.refresh()
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background/70 backdrop-blur-sm">
      <div className="flex min-h-full items-start justify-center p-4 py-10">
        <div className="w-full max-w-4xl rounded-2xl border bg-card p-6 shadow-2xl sm:p-8">
          <div className="flex flex-col items-center text-center">
            <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Lock className="size-6" />
            </span>
            <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
              {trialEligible ? t("Start your free trial to unlock TradeLoop") : t("Choose a plan to unlock TradeLoop")}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              {trialEligible
                ? t("Welcome, {name}. Your account is ready — pick a plan to open your journal. No charge today, and you can cancel any time before the trial ends.", { name: userName })
                : t("Welcome back, {name}. Your free trial has been used, so your plan starts the moment you subscribe — your journal and everything in it is right where you left it. Cancel any time.", { name: userName })}
            </p>
          </div>

          <PricingPlans trialEligible={trialEligible} />

          <div className="mt-8 flex flex-col items-center gap-3 border-t pt-6">
            <p className="text-xs text-muted-foreground">
              {t("Not ready yet? Your account stays exactly as it is. Questions or billing trouble?")}{" "}
              <a href="/support" className="font-medium text-primary hover:underline">
                {t("Contact support")}
              </a>
            </p>
            <Button variant="outline" onClick={onSignOut}>
              <LogOut className="size-4" />
              {t("Log out")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
