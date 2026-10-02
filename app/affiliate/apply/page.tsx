import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { getSessionUser } from "@/lib/affiliates/guard"
import { countryOptions } from "@/lib/affiliates/countries"
import { SITE_URL, getPayoutSettings, getProgram, loadTiers } from "@/lib/affiliates/program"
import { methodAvailable } from "@/lib/affiliates/providers"
import { getAffiliateByUser } from "@/lib/affiliates/queries"
import { methodList, money } from "@/lib/affiliates/types"
import { AffiliateLanding } from "@/components/affiliate/landing/landing"
import { HELP_URL, affiliateHref, appHref } from "@/lib/urls"

// The one public page of the program — what it is, how the tiers work, and the
// application. Indexable (the rest of /affiliate is not). This file loads the
// data; components/affiliate/landing/landing.tsx draws it.
export async function generateMetadata(): Promise<Metadata> {
  const [program, tiers] = await Promise.all([getProgram(), loadTiers()])
  const rates = tiers.filter((t) => t.enabled).map((t) => t.ratePercent)
  const title = "Affiliate Program"
  const description = `Earn ${rates.length ? `up to ${Math.max(...rates)}` : program.defaultRate}% ${program.commissionType === "recurring" ? "recurring " : ""}commission for every trader you refer to TradeLoop, the trading journal and analytics platform. ${program.cookieDays}-day tracking, real-time dashboard, payouts from ${money(program.minPayout)}.`
  return { title, description, robots: { index: true, follow: true }, alternates: { canonical: affiliateHref("/affiliate/apply") }, openGraph: { title: `${title} — TradeLoop`, description, type: "website" } }
}

export default async function AffiliateApplyPage() {
  const user = await getSessionUser()
  const affiliate = user ? await getAffiliateByUser(user.id) : null
  if (affiliate?.status === "approved") redirect(affiliateHref(affiliate.onboardedAt ? "/affiliate" : "/affiliate/onboarding"))

  const [program, tiers, payoutSettings] = await Promise.all([getProgram(), loadTiers(), getPayoutSettings()])
  return (
    <AffiliateLanding
      user={user ? { name: user.name ?? "", email: user.email } : null}
      affiliate={affiliate}
      program={program}
      tiers={tiers}
      payoutMethods={methodList(payoutSettings.methods.filter(methodAvailable))}
      country={(await headers()).get("x-vercel-ip-country") ?? ""}
      countries={countryOptions()}
      urls={{
        site: SITE_URL,
        // The Help Center's own address, or /help on the public site (never on this host, where it isn't served).
        help: HELP_URL.startsWith("http") ? HELP_URL : `${SITE_URL}${HELP_URL}`,
        self: affiliateHref("/affiliate/apply"),
        signIn: appHref("/sign-in?next=/affiliate/apply"),
        signUp: appHref("/sign-up?next=/affiliate/apply"),
        app: appHref("/dashboard"),
      }}
    />
  )
}
