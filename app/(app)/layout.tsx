import type React from "react"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { getUserPlan } from "@/lib/subscription"
import { DashboardSidebar } from "@/components/dashboard-sidebar"
import { SubscriptionPaywall } from "@/components/subscription-paywall"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect("/sign-in")

  // No active subscription (new sign-up, or a trial/plan that lapsed). Rather
  // than bouncing them to /pricing, the app renders behind a blur with the
  // plan picker on top, so they land on their own dashboard and can see what
  // they're subscribing to. The blurred layer is inert — aria-hidden and
  // pointer-events-none — so nothing behind the paywall is clickable or
  // reachable by keyboard.
  const plan = await getUserPlan(session.user.id)
  const locked = plan === null

  return (
    <div className="flex h-svh flex-col overflow-hidden md:flex-row">
      <div
        className={locked ? "pointer-events-none flex h-full select-none flex-col blur-[3px] md:flex-row" : "contents"}
        aria-hidden={locked || undefined}
        inert={locked || undefined}
      >
        <DashboardSidebar userName={session.user.name || session.user.email} userImage={session.user.image} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      {locked && <SubscriptionPaywall userName={session.user.name || session.user.email} />}
    </div>
  )
}
