import type React from "react"
import type { Metadata } from "next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { buildTrackingUrl } from "@/lib/affiliates/engine"
import { SITE_URL, getProgram, loadTiers } from "@/lib/affiliates/program"
import { defaultLink, notificationsFor, unreadCounts } from "@/lib/affiliates/queries"
import { v2ToClassic } from "@/lib/affiliates/v2/config"
import { portalVersion } from "@/lib/affiliates/v2/server"
import { PATH_HEADER } from "@/lib/path-header"
import { ImpersonationBanner } from "@/components/impersonation-banner"
import { V2Shell } from "@/components/affiliate/v2/shell"
import { fmtAgo } from "@/components/admin/ui"
import { affiliateHref, appHref } from "@/lib/urls"

export const metadata: Metadata = { title: { default: "Affiliate Dashboard", template: "%s · Affiliate Dashboard V2" } }

// The V2 dashboard (beta). Same guard as the Classic portal; only open to the
// affiliates the admin's rollout includes — anyone else is sent to the
// Classic version of the page they asked for.
export default async function AffiliateV2Layout({ children }: { children: React.ReactNode }) {
  const { user, affiliate } = await requireAffiliate()
  const { config, open } = await portalVersion(affiliate)
  if (!open) {
    const asked = (await headers()).get(PATH_HEADER) ?? "/affiliate/v2"
    redirect(affiliateHref(v2ToClassic(asked.split("?")[0])))
  }
  const [unread, notifications, tiers, program, link] = await Promise.all([unreadCounts(affiliate.id), notificationsFor(affiliate.id, 12), loadTiers(), getProgram(), defaultLink(affiliate.id)])
  const live = tiers.filter((t) => t.enabled)
  const topRate = live.length ? Math.max(...live.map((t) => t.ratePercent)) : program.defaultRate

  return (
    // [data-aff-v2] switches the whole screen to the V2 palette (globals.css).
    <div data-aff-v2 className="v2-page min-h-svh text-foreground">
      {user.impersonating && <ImpersonationBanner userLabel={user.email} />}
      <V2Shell
        affiliate={{ firstName: affiliate.firstName, lastName: affiliate.lastName, email: affiliate.email }}
        features={config.features}
        topRate={topRate}
        referralUrl={buildTrackingUrl({ base: SITE_URL, code: affiliate.code, linkToken: link?.token })}
        notifications={notifications.map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, read: !!n.readAt, at: fmtAgo(n.createdAt) }))}
        unread={unread.notifications}
        announcementsUnread={unread.announcements}
        backToApp={appHref("/dashboard")}
      >
        {children}
      </V2Shell>
    </div>
  )
}
