import type React from "react"
import { redirect } from "next/navigation"
import { cookies, headers } from "next/headers"
import { and, eq, gt, isNull, or } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { announcements, userSettings } from "@/lib/db/schema"
import { ThemeColorApplier, type AppliedColors } from "@/components/settings/theme-color-applier"
import { getUserPlan, hasUsedTrial, isOwnerEmail } from "@/lib/subscription"
import { trialIpHashFrom } from "@/lib/trial-ip"
import { isAdminRole } from "@/lib/admin/roles"
import { DashboardSidebar } from "@/components/dashboard-sidebar"
import { SubscriptionPaywall } from "@/components/subscription-paywall"
import { AnnouncementBanners } from "@/components/announcement-banners"
import { ImpersonationBanner } from "@/components/impersonation-banner"
import { CrispChat } from "@/components/crisp-chat"
import { seedStarterTemplates } from "@/lib/starter-templates"
import { recordRequestTiming } from "@/lib/telemetry"
import { AffiliateClaim } from "@/components/affiliate/tracker"
import { userHasPerk } from "@/lib/affiliates/perk-access"
import { ATTRIBUTION_COOKIE, attributionSecret, claimable } from "@/lib/affiliates/token"
import { featureAccess } from "@/lib/features/server"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const startedAt = Date.now()
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (!session?.user) redirect("/sign-in")

  // No active subscription (new sign-up, or a trial/plan that lapsed). Rather
  // than bouncing them to /pricing, the app renders behind a blur with the
  // plan picker on top, so they land on their own dashboard and can see what
  // they're subscribing to. The blurred layer is inert — aria-hidden and
  // pointer-events-none — so nothing behind the paywall is clickable or
  // reachable by keyboard.
  const [plan, hasBeta, , live, settingsRow, features] = await Promise.all([
    getUserPlan(session.user.id),
    // Features still in beta are open to affiliates whose tier includes them.
    userHasPerk(session.user.id, "beta"),
    // Starter tags/playbooks on the first visit (no-op after that).
    session.session.impersonatedBy ? Promise.resolve() : seedStarterTemplates(session.user.id),
    db
      .select({ id: announcements.id, message: announcements.message, level: announcements.level })
      .from(announcements)
      .where(and(eq(announcements.active, true), or(isNull(announcements.endsAt), gt(announcements.endsAt, new Date())))),
    // The user's saved theme colors, applied app-wide (Settings → Theme).
    // Never let this take the whole app down (e.g. before the migration runs) —
    // fall back to no custom colors.
    db
      .select({ theme: userSettings.theme })
      .from(userSettings)
      .where(eq(userSettings.userId, session.user.id))
      .limit(1)
      .catch(() => [] as { theme: unknown }[]),
    // Edge Lab and Psychology: who may see them is set in the admin panel.
    featureAccess(),
  ])
  const savedTheme = (settingsRow[0]?.theme ?? null) as { color?: string; win?: string; loss?: string; breakeven?: string } | null
  const themeColors: AppliedColors = savedTheme
    ? { color: savedTheme.color, win: savedTheme.win, loss: savedTheme.loss, breakeven: savedTheme.breakeven }
    : null
  // Someone logged in as a user sees what that user sees: featureAccess gives
  // an impersonating admin no admin rights.
  const insights = { edge_lab: features.can.edge_lab ? features.releases.edge_lab : undefined, psychology: features.can.psychology ? features.releases.psychology : undefined, copy_trading: features.can.copy_trading ? features.releases.copy_trading : undefined }
  const bottomBar = !!(insights.edge_lab || insights.psychology)
  const locked = plan === null
  // Only matters for the paywall: whether to offer the free trial or (once
  // they've had it — by account, email, or IP) a plan that starts today.
  const trialEligible = locked ? !(await hasUsedTrial(session.user.id, session.user.email, trialIpHashFrom(requestHeaders))) : true
  const impersonating = !!session.session.impersonatedBy
  // Server time for this layout's own work (session + plan + announcements).
  // Pages measure themselves the same way via recordRequestTiming.
  void recordRequestTiming("(app) layout", Date.now() - startedAt)
  const isAdmin = !impersonating && (isAdminRole(session.user.role) || isOwnerEmail(session.user.email))
  // A new account that arrived through an affiliate link still carries the
  // signed attribution cookie: let the browser claim it (a server action, so
  // the cookie can be cleared). A no-database check — the cookie is verified
  // and compared with when this account was created.
  const referralToken = impersonating ? undefined : (await cookies()).get(ATTRIBUTION_COOKIE)?.value
  const claimReferral = !!referralToken && process.env.BETTER_AUTH_SECRET != null && claimable(referralToken, session.user.createdAt, attributionSecret())

  return (
    <div className="flex h-svh flex-col overflow-hidden">
      {impersonating && <ImpersonationBanner userLabel={session.user.email} />}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div
          className={locked ? "pointer-events-none flex h-full min-h-0 flex-1 select-none flex-col blur-[3px] md:flex-row" : "contents"}
          aria-hidden={locked || undefined}
          inert={locked || undefined}
        >
          <DashboardSidebar userName={session.user.name || session.user.email} userImage={session.user.image} isAdmin={isAdmin} isPro={plan === "pro"} hasBeta={hasBeta} insights={insights} />
          <main className={bottomBar ? "flex-1 overflow-y-auto pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0" : "flex-1 overflow-y-auto"}>
            <AnnouncementBanners items={live} />
            {children}
          </main>
        </div>

        {locked && <SubscriptionPaywall userName={session.user.name || session.user.email} trialEligible={trialEligible} />}
      </div>
      {!impersonating && <CrispChat email={session.user.email} name={session.user.name} />}
      <ThemeColorApplier initial={themeColors} />
      {claimReferral && <AffiliateClaim />}
    </div>
  )
}
