import type { Metadata } from "next"
import Link from "next/link"
import { ChevronRight, FileText, LifeBuoy, ShieldCheck, Wallet } from "lucide-react"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { publicName, getV2Config } from "@/lib/affiliates/v2/server"
import { affiliateHref, siteHref } from "@/lib/urls"
import { AffiliateSettingsBody } from "@/components/affiliate/settings-body"
import { DashboardExperience } from "@/components/affiliate/v2/switch"
import { FeedbackButton } from "@/components/affiliate/v2/feedback"
import { LeaderboardOptIn } from "@/components/affiliate/v2/leaderboard-optin"
import { ThemePair } from "@/components/affiliate/v2/shell"
import { BetaBadge, PageFrame, V2Card } from "@/components/affiliate/v2/ui"

export const metadata: Metadata = { title: "Settings" }

export default async function AffiliateV2Settings() {
  const ctx = await requireAffiliate()
  const { affiliate } = ctx
  const config = await getV2Config()
  const links = [
    { href: affiliateHref(config.features.wallet ? "/affiliate/v2/wallet" : "/affiliate/v2/payouts"), label: "Payout methods", icon: Wallet },
    { href: affiliateHref("/affiliate/v2/support"), label: "Help & support", icon: LifeBuoy },
    { href: affiliateHref("/affiliate/terms"), label: "Terms & conditions", icon: FileText },
    { href: siteHref("/privacy"), label: "Privacy policy", icon: ShieldCheck },
  ]

  return (
    <PageFrame title="Settings" description="Your profile, payouts, notifications and dashboard.">
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
        <V2Card
          title={
            <span className="flex items-center gap-2">
              Dashboard experience <BetaBadge />
            </span>
          }
          subtitle="Try the redesigned TradeLoop Affiliate Dashboard, or go back to the Classic one. Your data is the same in both."
        >
          <DashboardExperience current="v2" />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/30 px-3 py-2.5">
            <p className="text-sm text-muted-foreground">Tell us what works and what doesn&apos;t.</p>
            <FeedbackButton />
          </div>
        </V2Card>
        <V2Card title="Appearance" subtitle="Remembered on this device.">
          <ThemePair />
          {config.features.leaderboard && (
            <div className="mt-5 border-t pt-4">
              <LeaderboardOptIn on={affiliate.leaderboardPublic} name={publicName(affiliate.firstName, affiliate.lastName)} />
            </div>
          )}
          <ul className="mt-5 divide-y rounded-xl border">
            {links.map((l) => (
              <li key={l.label}>
                <Link href={l.href} className="flex h-12 items-center gap-3 px-3.5 text-sm hover:bg-muted/40">
                  <l.icon className="size-4 text-primary" aria-hidden />
                  <span className="flex-1">{l.label}</span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </V2Card>
      </div>
      {/* Profile, notification emails, payout details and security — the same forms as Classic. */}
      <AffiliateSettingsBody {...ctx} />
    </PageFrame>
  )
}
