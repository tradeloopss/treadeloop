import { PricingPlans } from "@/components/pricing-plans"
import { ShieldCheck } from "lucide-react"
import Link from "next/link"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { hasUsedTrial } from "@/lib/subscription"
import { BrandMark } from "@/components/brand-mark"
import { getT } from "@/lib/i18n/server"
import { LanguageSwitcher } from "@/components/language-switcher"

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ required?: string }>
}) {
  const { required } = await searchParams
  const t = await getT()
  // One free trial per person: someone signed in who has already had theirs
  // sees the plans as starting today. Signed-out visitors see the trial;
  // /checkout re-checks once they've signed in.
  const session = await auth.api.getSession({ headers: await headers() })
  const trialEligible = !session?.user || !(await hasUsedTrial(session.user.id, session.user.email))

  return (
    <div className="min-h-svh bg-gradient-to-b from-background to-accent/20 px-4 py-16">
      <div className="relative mx-auto mb-6 flex max-w-5xl items-center justify-center gap-2">
        <Link href="/" className="flex items-center gap-2">
          <BrandMark className="size-8" />
          <span className="text-lg font-semibold tracking-tight">TradeLoop</span>
        </Link>
        <LanguageSwitcher className="absolute end-0 top-1/2 -translate-y-1/2" />
      </div>

      {required && (
        <div className="mx-auto mb-10 max-w-3xl text-balance rounded-xl border-2 border-primary/40 bg-primary/10 px-6 py-4 text-center text-base font-medium text-foreground shadow-sm sm:text-lg">
          {trialEligible ? t("Pick a plan to start your free trial — you're one step away from your journal.") : t("Pick a plan to continue — you're one step away from your journal.")}
        </div>
      )}

      <h1 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">
        {t("Find the plan that fits your trading")}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-center text-sm text-muted-foreground">
        {trialEligible
          ? t("Every plan starts with a free trial — no charge today, cancel anytime before it ends.")
          : t("Your free trial has already been used, so your plan starts the moment you subscribe. Cancel anytime.")}
      </p>

      <PricingPlans trialEligible={trialEligible} />

      <div className="mx-auto mt-10 flex max-w-lg flex-col items-center gap-2 text-center text-xs text-muted-foreground sm:flex-row sm:justify-center sm:gap-6">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" /> {trialEligible ? t("No charge until your trial ends") : t("Secure checkout, instant access")}
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" /> {t("Cancel anytime, no questions asked")}
        </span>
      </div>
    </div>
  )
}
