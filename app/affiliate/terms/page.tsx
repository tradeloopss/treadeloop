import type { Metadata } from "next"
import { getSessionUser } from "@/lib/affiliates/guard"
import { SITE_URL, getProgram, loadTiers } from "@/lib/affiliates/program"
import { AffiliateTermsView } from "@/components/affiliate/landing/terms"
import { HELP_URL, affiliateHref, appHref } from "@/lib/urls"

// The affiliate program's terms. Public, like the program page that links to
// it; the application form's checkbox points here.
export const metadata: Metadata = {
  title: "Program Terms",
  description: "The terms of the TradeLoop affiliate program: commissions, tiers, attribution, holding period, payouts and what isn't allowed.",
  robots: { index: true, follow: true },
  alternates: { canonical: affiliateHref("/affiliate/terms") },
}

export default async function AffiliateTermsPage() {
  const [user, program, tiers] = await Promise.all([getSessionUser(), getProgram(), loadTiers()])
  const help = HELP_URL.startsWith("http") ? HELP_URL : `${SITE_URL}${HELP_URL}`
  const programHref = affiliateHref("/affiliate/apply")
  return (
    <AffiliateTermsView
      program={program}
      tiers={tiers}
      signedIn={!!user}
      nav={[
        { label: "Home", href: SITE_URL },
        { label: "Brokers", href: `${SITE_URL}/brokers` },
        { label: "Pricing", href: `${SITE_URL}/pricing` },
        { label: "Affiliates", href: programHref, active: true },
        { label: "Help", href: help },
      ]}
      footer={[
        { label: "Pricing", href: `${SITE_URL}/pricing` },
        { label: "Help", href: help },
        { label: "Affiliate program", href: programHref },
        { label: "Privacy", href: `${SITE_URL}/privacy` },
        { label: "Terms", href: `${SITE_URL}/terms` },
      ]}
      urls={{ site: SITE_URL, program: programHref, apply: `${programHref}#apply`, signIn: appHref("/sign-in?next=/affiliate/apply"), signUp: appHref("/sign-up?next=/affiliate/apply"), app: appHref("/dashboard") }}
    />
  )
}
