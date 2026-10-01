import type { Metadata } from "next"
import Link from "next/link"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { account } from "@/lib/db/schema"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { countryOptions } from "@/lib/affiliates/countries"
import { buildTrackingUrl } from "@/lib/affiliates/engine"
import { prefEnabled } from "@/lib/affiliates/notify"
import { SITE_URL, currentRule, getProgram } from "@/lib/affiliates/program"
import { defaultLink, payoutMethodsFor } from "@/lib/affiliates/queries"
import { NOTIFICATION_PREFS, money } from "@/lib/affiliates/types"
import { PageHeader } from "@/components/page-header"
import { TwoFactorPanel } from "@/components/two-factor-panel"
import { AffiliateSettings } from "@/components/affiliate/settings"
import { fmtDay } from "@/components/affiliate/ui"

export const metadata: Metadata = { title: "Settings" }

export default async function AffiliateSettingsPage() {
  const { user, affiliate } = await requireAffiliate()
  const [methods, program, rule, link, providers] = await Promise.all([
    payoutMethodsFor(affiliate.id),
    getProgram(),
    currentRule(affiliate.id),
    defaultLink(affiliate.id),
    db.select({ providerId: account.providerId }).from(account).where(eq(account.userId, user.id)),
  ])
  const hasPassword = providers.some((p) => p.providerId === "credential")

  return (
    <div>
      <PageHeader title="Settings" description="Your affiliate profile, emails and payout details." />
      <div className="p-4 sm:p-6">
        <AffiliateSettings
          profile={{ firstName: affiliate.firstName, lastName: affiliate.lastName, email: affiliate.email, country: affiliate.country ?? "", website: affiliate.website ?? "", socials: affiliate.socials ?? {} }}
          countries={countryOptions()}
          prefs={Object.fromEntries(NOTIFICATION_PREFS.map((p) => [p.key, prefEnabled(affiliate.notifications, p.key)]))}
          methods={methods.map((m) => ({ id: m.id, type: m.type, label: m.label, nickname: m.nickname, status: m.status, isDefault: m.isDefault }))}
          account={{
            code: affiliate.code,
            url: buildTrackingUrl({ base: SITE_URL, code: affiliate.code, linkToken: link?.token }),
            joined: fmtDay(affiliate.approvedAt ?? affiliate.createdAt),
            rate: rule.ratePercent,
            tier: rule.tier?.name ?? null,
            cookieDays: program.cookieDays,
            holdDays: program.holdDays,
            minPayout: money(program.minPayout),
          }}
          security={
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">Your affiliate account uses your TradeLoop sign-in. Turn on two-step verification before you request a payout — it protects the account your money is paid from.</p>
              <TwoFactorPanel enabled={!!(user as { twoFactorEnabled?: boolean }).twoFactorEnabled} hasPassword={hasPassword} />
              <p className="text-sm text-muted-foreground">
                {hasPassword ? (
                  <>
                    To change your password,{" "}
                    <Link href="/forgot-password" className="font-medium text-primary hover:underline">
                      request a reset link
                    </Link>
                    .
                  </>
                ) : (
                  "You sign in with a social account, so there's no TradeLoop password to manage."
                )}
              </p>
            </div>
          }
        />
      </div>
    </div>
  )
}
