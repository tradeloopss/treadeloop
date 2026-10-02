import { ArrowLeft, ArrowRight } from "lucide-react"
import type { TierRow } from "@/lib/affiliates/engine"
import type { ProgramSettings } from "@/lib/affiliates/types"
import { cn } from "@/lib/utils"
import { ProgramTerms } from "@/components/affiliate/program-terms"
import { SiteFooter } from "@/components/site-footer"
import { ContactSupportTrigger } from "@/components/support/contact-support"
import { AffiliateNavbar, type NavLink } from "./nav"
import { Eyebrow, containerClass } from "./parts"

// The affiliate program's terms, on a page of their own (/affiliate/terms),
// drawn from plain data like the program page beside it.
export function AffiliateTermsView({
  program,
  tiers,
  signedIn,
  nav,
  urls,
}: {
  program: ProgramSettings
  tiers: TierRow[]
  signedIn: boolean
  nav: NavLink[]
  urls: { site: string; program: string; apply: string; signIn: string; signUp: string; app: string }
}) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <AffiliateNavbar homeHref={urls.site} links={nav} signedIn={signedIn} signInHref={urls.signIn} signUpHref={urls.signUp} appHref={urls.app} />
      <main className="flex-1">
        <div className={cn(containerClass, "py-10 sm:py-14")}>
          <div className="mx-auto max-w-3xl">
            <a href={urls.program} className="inline-flex items-center gap-1.5 rounded text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40">
              <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /> Affiliate program
            </a>
            <div className="mt-5">
              <Eyebrow>Affiliate program</Eyebrow>
              <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Program Terms</h1>
              <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">What you agree to when you join the TradeLoop affiliate program: how commissions, tiers, attribution and payouts work, and what isn&apos;t allowed.</p>
            </div>
            <div className="mt-8 rounded-2xl border bg-card p-5 shadow-xs sm:p-8">
              <ProgramTerms program={program} tiers={tiers} />
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-primary/[0.04] px-5 py-4">
              <p className="text-sm text-muted-foreground">
                Questions about the terms?{" "}
                <ContactSupportTrigger category="affiliate" className="cursor-pointer font-medium text-primary hover:underline">
                  Contact support
                </ContactSupportTrigger>
                .
              </p>
              <a href={urls.apply} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/40">
                Apply to the program <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
              </a>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter affiliate supportCategory="affiliate" />
    </div>
  )
}
