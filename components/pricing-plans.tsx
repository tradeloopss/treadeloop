"use client"

import { useState, useTransition } from "react"
import { startCheckout } from "@/app/actions/subscriptions"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { Check, Minus, Gift, Tag, CalendarCheck } from "lucide-react"
import { TRIAL_DAYS, PROMO, isPromoActive, promoPrice, renewalPriceFor, type PlanTier, type Billing } from "@/lib/whop"
import { useIntlLocale, useT } from "@/components/locale-provider"

interface FeatureGroup {
  title: string
  items: { text: string; included: boolean }[]
}

interface Plan {
  tier: PlanTier
  name: string
  tagline: string
  monthlyPrice: number
  annualPrice: number
  cta: string
  featured?: boolean
  groups: FeatureGroup[]
}

const PLANS: Plan[] = [
  {
    tier: "essential",
    name: "Essential",
    tagline: "For all traders",
    monthlyPrice: 25,
    annualPrice: 18.75,
    cta: "Start free trial",
    groups: [
      { title: "Accounts", items: [{ text: "Connect 1 trading account", included: true }] },
      {
        title: "Import & Sync",
        items: [
          { text: "CSV / file import", included: true },
          { text: "Live broker & prop firm sync", included: false },
        ],
      },
      {
        title: "Journal & Reports",
        items: [
          { text: "Automated daily journal", included: true },
          { text: "Calendar & basic reports", included: true },
          { text: "Cross Analysis & period insights", included: false },
        ],
      },
      {
        title: "Tags & Playbooks",
        items: [
          { text: "Custom tags", included: true },
          { text: "Create playbooks", included: true },
          { text: "Share playbooks with other traders", included: false },
        ],
      },
      { title: "Support", items: [{ text: "Community support", included: true }] },
    ],
  },
  {
    tier: "pro",
    name: "Pro",
    tagline: "For active traders",
    monthlyPrice: 55,
    annualPrice: 41.25,
    cta: "Start free trial",
    featured: true,
    groups: [
      { title: "Accounts", items: [{ text: "Connect unlimited trading accounts", included: true }] },
      {
        title: "Import & Sync",
        items: [
          { text: "CSV / file import", included: true },
          { text: "Live broker & prop firm sync (Rithmic)", included: true },
          { text: "MetaTrader (MT4/5) live sync — coming soon", included: false },
        ],
      },
      {
        title: "Journal & Reports",
        items: [
          { text: "Automated daily journal with AI narrative", included: true },
          { text: "Calendar & basic reports", included: true },
          { text: "Cross Analysis & period insights", included: true },
        ],
      },
      {
        title: "Tags & Playbooks",
        items: [
          { text: "Custom tags", included: true },
          { text: "Create playbooks", included: true },
          { text: "Share playbooks with other traders", included: true },
        ],
      },
      { title: "Support", items: [{ text: "Priority support", included: true }] },
    ],
  },
]

// trialEligible is false for someone who has already had their free trial
// (lib/subscription.ts hasUsedTrial): the cards then sell the plan as
// starting today, and lib/checkout.ts creates it without a trial whatever
// this shows — the flag only keeps what's promised in step with what's
// charged. Visitors who aren't signed in are shown the trial; whether they
// actually get one is settled once they're signed in.
export function PricingPlans({ trialEligible = true }: { trialEligible?: boolean }) {
  const t = useT()
  const dateLocale = useIntlLocale()
  const [billing, setBilling] = useState<Billing>("annual")
  const [pending, startTransition] = useTransition()
  const [loadingTier, setLoadingTier] = useState<PlanTier | null>(null)
  const promoActive = isPromoActive()
  // Formatted in UTC so the date shown matches the actual cutoff instant and
  // renders identically on the server and the client (no hydration mismatch).
  const promoEnds = PROMO.endsAt.toLocaleDateString(dateLocale, { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })

  function onCheckout(tier: PlanTier) {
    setLoadingTier(tier)
    startTransition(async () => {
      await startCheckout(tier, billing)
    })
  }

  return (
    <div className="mx-auto mt-8 max-w-4xl">
      {promoActive && (
        <div className="mx-auto mb-6 flex max-w-lg flex-col items-center gap-1 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-center">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-primary">
            <Tag className="size-4" /> {t("Limited time — {pct}% off every plan", { pct: PROMO.percentOff })}
          </p>
          <p className="text-xs text-muted-foreground">{t("Offer ends {date}. Locked in for as long as you stay subscribed.", { date: promoEnds })}</p>
        </div>
      )}

      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border bg-muted p-1">
          <button
            type="button"
            onClick={() => setBilling("monthly")}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              billing === "monthly" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {t("Monthly")}
          </button>
          <button
            type="button"
            onClick={() => setBilling("annual")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              billing === "annual" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {t("Annual")}
            <span className="rounded-full bg-[var(--gain)]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--gain)]">
              {t("SAVE 25%")}
            </span>
          </button>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        {PLANS.map((plan) => {
          const fullPrice = billing === "annual" ? plan.annualPrice : plan.monthlyPrice
          const price = promoActive ? promoPrice(fullPrice) : fullPrice
          const trialDays = TRIAL_DAYS[billing]
          // What Whop charges at checkout when there's no trial: the whole
          // year up front on annual, one month on monthly.
          const chargeToday = renewalPriceFor(plan.tier, billing, false).amount
          return (
            <div key={plan.name} className="relative h-full">
              {plan.featured && (
                <span className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-semibold whitespace-nowrap text-primary-foreground">
                  {t("Most Popular")}
                </span>
              )}
              <Card className={cn("flex h-full flex-col gap-0 p-6", plan.featured && "border-primary shadow-md")}>
                <div>
                  <p className="text-lg font-bold uppercase tracking-wide">{t(plan.name)}</p>
                  <p className="text-sm text-muted-foreground">{t(plan.tagline)}</p>
                </div>

                {(promoActive || !trialEligible) && (
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="text-3xl font-bold tracking-tight">${price.toFixed(2)}</span>
                    {promoActive && <span className="text-lg text-muted-foreground line-through">${fullPrice.toFixed(2)}</span>}
                    <span className="text-sm text-muted-foreground">{t("/mo")}</span>
                  </div>
                )}

                {trialEligible ? (
                  <>
                    <div className={cn("flex items-center gap-1.5 rounded-lg bg-[var(--gain)]/10 px-3 py-2 text-[var(--gain)]", promoActive ? "mt-3" : "mt-4")}>
                      <Gift className="size-4 shrink-0" />
                      <p className="text-sm font-semibold">{t("{days} days free, then ${price}/mo", { days: trialDays, price: price.toFixed(2) })}</p>
                    </div>
                    <p className="mt-1.5 px-1 text-xs text-muted-foreground">{t("No charge today · cancel anytime before your trial ends")}</p>
                  </>
                ) : (
                  <>
                    <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-foreground">
                      <CalendarCheck className="size-4 shrink-0 text-primary" />
                      <p className="text-sm font-semibold">
                        {billing === "annual" ? t("${amount} today for the year", { amount: chargeToday.toFixed(2) }) : t("${amount} today, then monthly", { amount: chargeToday.toFixed(2) })}
                      </p>
                    </div>
                    <p className="mt-1.5 px-1 text-xs text-muted-foreground">{t("Access starts right away · cancel anytime")}</p>
                  </>
                )}

                <Button
                  onClick={() => onCheckout(plan.tier)}
                  disabled={pending}
                  variant={plan.featured ? "default" : "outline"}
                  className={cn("mt-4 h-10", plan.featured && "bg-gradient-to-r from-violet-600 to-fuchsia-500")}
                >
                  {pending && loadingTier === plan.tier ? t("Redirecting…") : trialEligible ? t(plan.cta) : t("Subscribe to {plan}", { plan: t(plan.name) })}
                </Button>

                <div className="mt-6 flex-1 space-y-4">
                  {plan.groups.map((group) => (
                    <div key={group.title}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(group.title)}</p>
                      <ul className="mt-1.5 space-y-1.5">
                        {group.items.map((item) => (
                          <li key={item.text} className="flex items-start gap-2 text-sm">
                            {item.included ? (
                              <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                            ) : (
                              <Minus className="mt-0.5 size-4 shrink-0 text-muted-foreground/40" />
                            )}
                            <span className={cn(!item.included && "text-muted-foreground")}>{t(item.text)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )
        })}
      </div>
    </div>
  )
}
