import type React from "react"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { and, eq, gt, isNull, or } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { announcements } from "@/lib/db/schema"
import { getUserPlan, isOwnerEmail } from "@/lib/subscription"
import { isAdminRole } from "@/lib/admin/roles"
import { DashboardSidebar } from "@/components/dashboard-sidebar"
import { SubscriptionPaywall } from "@/components/subscription-paywall"
import { AnnouncementBanners } from "@/components/announcement-banners"
import { ImpersonationBanner } from "@/components/impersonation-banner"
import { CrispChat } from "@/components/crisp-chat"
import { seedStarterTemplates } from "@/lib/starter-templates"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect("/sign-in")

  // No active subscription (new sign-up, or a trial/plan that lapsed). Rather
  // than bouncing them to /pricing, the app renders behind a blur with the
  // plan picker on top, so they land on their own dashboard and can see what
  // they're subscribing to. The blurred layer is inert — aria-hidden and
  // pointer-events-none — so nothing behind the paywall is clickable or
  // reachable by keyboard.
  const [plan, , live] = await Promise.all([
    getUserPlan(session.user.id),
    // Starter tags/playbooks on the first visit (no-op after that).
    session.session.impersonatedBy ? Promise.resolve() : seedStarterTemplates(session.user.id),
    db
      .select({ id: announcements.id, message: announcements.message, level: announcements.level })
      .from(announcements)
      .where(and(eq(announcements.active, true), or(isNull(announcements.endsAt), gt(announcements.endsAt, new Date())))),
  ])
  const locked = plan === null
  const impersonating = !!session.session.impersonatedBy
  const isAdmin = !impersonating && (isAdminRole(session.user.role) || isOwnerEmail(session.user.email))

  return (
    <div className="flex h-svh flex-col overflow-hidden">
      {impersonating && <ImpersonationBanner userLabel={session.user.email} />}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div
          className={locked ? "pointer-events-none flex h-full min-h-0 flex-1 select-none flex-col blur-[3px] md:flex-row" : "contents"}
          aria-hidden={locked || undefined}
          inert={locked || undefined}
        >
          <DashboardSidebar userName={session.user.name || session.user.email} userImage={session.user.image} isAdmin={isAdmin} />
          <main className="flex-1 overflow-y-auto">
            <AnnouncementBanners items={live} />
            {children}
          </main>
        </div>

        {locked && <SubscriptionPaywall userName={session.user.name || session.user.email} />}
      </div>
      {!impersonating && <CrispChat email={session.user.email} name={session.user.name} />}
    </div>
  )
}
