import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { SITE_URL, currentRule, getPayoutSettings, getProgram } from "@/lib/affiliates/program"
import { methodAvailable } from "@/lib/affiliates/providers"
import { methodList, money } from "@/lib/affiliates/types"
import { earningText } from "@/lib/affiliates/engine"
import { BrandMark } from "@/components/brand-mark"
import { ThemeSwitch } from "@/components/affiliate/theme-switch"
import { OnboardingForm } from "@/components/affiliate/apply-form"
import { affiliateHref } from "@/lib/urls"

export const metadata: Metadata = { title: "Set up your affiliate account" }

export default async function AffiliateOnboardingPage() {
  const { affiliate } = await requireAffiliate({ allowUnonboarded: true })
  if (affiliate.onboardedAt) redirect(affiliateHref("/affiliate"))
  const [program, rule, payoutSettings] = await Promise.all([getProgram(), currentRule(affiliate.id), getPayoutSettings()])

  const facts: [string, string][] = [
    ["Your commission", earningText(rule, program)],
    ["Tracking window", `${program.cookieDays} days from the click to the sign-up`],
    ["Holding period", `${program.holdDays} days before a commission can be withdrawn`],
    ["Payouts", `From ${money(program.minPayout)}, by ${methodList(payoutSettings.methods.filter(methodAvailable))}`],
  ]

  return (
    <div className="min-h-svh bg-background">
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-16">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BrandMark className="size-7" />
            <span className="font-semibold tracking-tight">TradeLoop</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Affiliates</span>
          </div>
          <ThemeSwitch compact />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome aboard, {affiliate.firstName}</h1>
          <p className="mt-2 text-sm text-muted-foreground">You&apos;re approved. One last step: choose your referral code and confirm how the program works.</p>
        </div>

        <section className="rounded-xl border bg-card">
          <div className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold">How it works for you</h2>
          </div>
          <dl className="divide-y px-5">
            {facts.map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-4 py-3 text-sm">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-end font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="border-t px-5 py-3 text-xs text-muted-foreground">No self-referrals, spam, fake sign-ups or bidding on TradeLoop brand keywords. {program.refundReversal ? "Refunded and disputed payments have their commission reversed." : "Disputed payments have their commission reversed."}</p>
        </section>

        <section className="rounded-xl border bg-card p-5">
          <OnboardingForm suggested={affiliate.code} siteHost={SITE_URL.replace(/^https?:\/\//, "")} />
        </section>
      </main>
    </div>
  )
}
