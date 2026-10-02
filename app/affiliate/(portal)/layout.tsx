import type React from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { couponAccess } from "@/lib/affiliates/engine"
import { currentRule, getProgram } from "@/lib/affiliates/program"
import { notificationsFor, unreadCounts } from "@/lib/affiliates/queries"
import { BrandMark } from "@/components/brand-mark"
import { ImpersonationBanner } from "@/components/impersonation-banner"
import { NotificationsMenu, PortalNav, type PortalNavItem } from "@/components/affiliate/portal-nav"
import { fmtAgo } from "@/components/admin/ui"
import { affiliateHref, appHref } from "@/lib/urls"

export default async function AffiliatePortalLayout({ children }: { children: React.ReactNode }) {
  const { user, affiliate } = await requireAffiliate()
  const [unread, notifications, rule, program] = await Promise.all([unreadCounts(affiliate.id), notificationsFor(affiliate.id, 12), currentRule(affiliate.id), getProgram()])
  // The Coupons section is open only for affiliates an admin opened it for.
  const coupons = couponAccess(affiliate, program).enabled

  const items: PortalNavItem[] = [
    { href: "/affiliate", label: "Overview", icon: "overview" },
    { href: "/affiliate/analytics", label: "Analytics", icon: "analytics" },
    { href: "/affiliate/referrals", label: "Referrals", icon: "referrals" },
    { href: "/affiliate/campaigns", label: "Campaigns", icon: "campaigns" },
    { href: "/affiliate/links", label: "Links", icon: "links" },
    ...(coupons ? [{ href: "/affiliate/coupons", label: "Coupons", icon: "coupons" } as PortalNavItem] : []),
    { href: "/affiliate/earnings", label: "Earnings", icon: "earnings" },
    { href: "/affiliate/payouts", label: "Payouts", icon: "payouts" },
    { href: "/affiliate/resources", label: "Resources", icon: "resources" },
    { href: "/affiliate/announcements", label: "Announcements", icon: "announcements", badge: unread.announcements || undefined },
    { href: "/affiliate/support", label: "Support", icon: "support" },
    { href: "/affiliate/settings", label: "Settings", icon: "settings" },
  ]

  return (
    <div className="flex min-h-svh flex-col bg-background">
      {user.impersonating && <ImpersonationBanner userLabel={user.email} />}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="shrink-0 border-b bg-sidebar md:sticky md:top-0 md:h-svh md:w-60 md:border-e md:border-b-0">
          <div className="flex items-center justify-between gap-2 px-5 pt-5 md:pb-2">
            <Link href={affiliateHref("/affiliate")} className="flex items-center gap-2">
              <BrandMark className="size-7" />
              <span className="font-semibold tracking-tight">Affiliates</span>
            </Link>
            <NotificationsMenu
              unread={unread.notifications}
              items={notifications.map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, read: !!n.readAt, at: fmtAgo(n.createdAt) }))}
            />
          </div>
          <PortalNav items={items} />
          <div className="hidden px-3 pb-4 md:absolute md:bottom-0 md:block md:w-60">
            <div className="mb-2 rounded-lg border bg-background/60 px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Your commission</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">
                {rule.ratePercent}%{rule.tier ? <span className="ms-1.5 font-normal text-muted-foreground">· {rule.tier.name}</span> : null}
              </p>
            </div>
            <Link href={appHref("/dashboard")} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
              <ArrowLeft className="size-4 rtl:rotate-180" /> Back to app
            </Link>
            <p className="truncate px-3 pt-1 text-xs text-muted-foreground" title={user.email}>
              {user.email}
            </p>
          </div>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
