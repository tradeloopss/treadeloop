"use client"

import { useState, useTransition } from "react"
import { Check, ExternalLink, FileText, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useIntlLocale, useT } from "@/components/locale-provider"
import { startCheckout } from "@/app/actions/subscriptions"
import type { BillingPayment, PlanOption } from "@/lib/billing"
import type { PlanTier } from "@/lib/whop"
import { PaymentPill, day, money, usePeriod } from "@/components/billing/billing-ui"

// What each plan adds, for the Manage plan window — mirrors the plan lists
// on the pricing page (components/pricing-plans.tsx).
export const PLAN_HIGHLIGHTS: Record<PlanTier, string[]> = {
  essential: ["Up to 3 trading accounts", "Live sync for 1 MetaTrader account", "Automated daily journal", "Calendar, reports & playbooks"],
  pro: ["Unlimited trading accounts", "Rithmic, MetaTrader & TradingView live sync", "AI journal narrative & Cross Analysis", "Share playbooks · priority support"],
}

// Plans and billing intervals at the price checkout would charge. Picking a
// different one opens Whop checkout for it; once it's live, the current
// membership stops renewing (lib/checkout.ts retireReplacedMembership).
export function ManagePlanDialog({
  open,
  onOpenChange,
  options,
  current,
  manageUrl,
  trialEligible,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  options: PlanOption[]
  current: { plan: PlanTier; billing: "monthly" | "annual" } | null
  manageUrl: string | null
  trialEligible: boolean
}) {
  const t = useT()
  const locale = useIntlLocale()
  const period = usePeriod()
  const [billing, setBilling] = useState<"monthly" | "annual">(current?.billing ?? "annual")
  const [pending, startTransition] = useTransition()
  const [choice, setChoice] = useState<PlanTier | null>(null)

  function choose(plan: PlanTier) {
    setChoice(plan)
    startTransition(async () => {
      try {
        await startCheckout(plan, billing) // redirects to Whop checkout
      } catch (err) {
        // A redirect surfaces here as a thrown NEXT_REDIRECT; anything else is real.
        if (err instanceof Error && /NEXT_REDIRECT/.test(err.message)) throw err
        toast.error(t("We couldn't open checkout right now — please try again."))
        setChoice(null)
      }
    })
  }

  const shown = options.filter((o) => o.billing === billing)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg">{current ? t("Change your plan") : t("Choose a plan")}</DialogTitle>
          <DialogDescription>
            {current
              ? t("Switching opens a secure Whop checkout for the new plan. Once it's active, your current plan stops renewing — you're never billed for both.")
              : trialEligible
                ? t("Every plan starts with a free trial — you won't be charged until it ends.")
                : t("Pick a plan to continue with TradeLoop.")}
          </DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label={t("Billing interval")} className="inline-flex w-fit rounded-lg border bg-muted/40 p-1">
          {(["monthly", "annual"] as const).map((b) => (
            <button
              key={b}
              type="button"
              role="radio"
              aria-checked={billing === b}
              onClick={() => setBilling(b)}
              className={cn(
                "h-9 rounded-md px-4 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-primary",
                billing === b ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {b === "monthly" ? t("Monthly") : t("Annual")}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {shown.map((o) => {
            const isCurrent = current?.plan === o.plan && current.billing === o.billing
            const perMonth = o.billing === "annual" ? o.amount / 12 : o.amount
            return (
              <div key={o.plan} className={cn("flex flex-col rounded-xl border p-4", isCurrent ? "border-primary/40 bg-primary/[0.03]" : "bg-card")}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-base font-semibold text-foreground">{t(o.title)}</p>
                  {isCurrent && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{t("Current plan")}</span>}
                </div>
                <p className="mt-2 flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold tracking-tight text-foreground tabular-nums">{money(o.amount, "USD", locale)}</span>
                  <span className="text-sm text-muted-foreground">/ {period(o.periodDays)}</span>
                  {o.list > o.amount && <span className="text-xs text-muted-foreground line-through tabular-nums">{money(o.list, "USD", locale)}</span>}
                </p>
                {o.billing === "annual" && <p className="text-xs text-muted-foreground">{t("{amount} a month, billed yearly", { amount: money(perMonth, "USD", locale) })}</p>}
                <ul className="mt-3 flex-1 space-y-1.5">
                  {PLAN_HIGHLIGHTS[o.plan].map((f) => (
                    <li key={f} className="flex gap-2 text-[13px] text-foreground">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                      {t(f)}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-4 h-11 w-full font-semibold hover:bg-primary/90"
                  variant={isCurrent ? "outline" : "default"}
                  disabled={isCurrent || pending}
                  onClick={() => choose(o.plan)}
                >
                  {pending && choice === o.plan ? <Loader2 className="size-4 animate-spin" /> : null}
                  {isCurrent ? t("Your current plan") : pending && choice === o.plan ? t("Opening checkout…") : current ? t("Switch to {plan}", { plan: t(o.title) }) : t("Choose {plan}", { plan: t(o.title) })}
                </Button>
              </div>
            )
          })}
        </div>

        {manageUrl && (
          <DialogFooter className="sm:justify-start">
            <a href={manageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-sm text-[13px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary">
              {t("Card & billing details on Whop")} <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Keeping the subscription is the prominent choice; cancelling is the quiet one.
export function CancelDialog({
  open,
  onOpenChange,
  planName,
  until,
  trial,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  planName: string
  until: string
  trial: boolean
  pending: boolean
  onConfirm: () => void
}) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Cancel subscription?")}</DialogTitle>
          <DialogDescription>
            {trial
              ? t("Your free trial of {plan} continues until {date}, and you won't be charged.", { plan: planName, date: until })
              : t("You'll keep {plan} until {date}, and you won't be charged again.", { plan: planName, date: until })}{" "}
            {t("You can reactivate any time before then.")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" className="h-11 text-loss hover:bg-loss/5 hover:text-loss" onClick={onConfirm} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {pending ? t("Canceling…") : t("Cancel subscription")}
          </Button>
          <Button className="h-11 font-semibold hover:bg-primary/90" onClick={() => onOpenChange(false)} disabled={pending}>
            {t("Keep subscription")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function HistoryDialog({ open, onOpenChange, payments }: { open: boolean; onOpenChange: (open: boolean) => void; payments: BillingPayment[] }) {
  const t = useT()
  const locale = useIntlLocale()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Billing history")}</DialogTitle>
          <DialogDescription>{t("Every charge on your TradeLoop subscription, newest first.")}</DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-xl border">
          {payments.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3.5 py-3">
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{day(p.date, locale)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {t(p.description)}
                  {p.reason ? ` · ${t(p.reason)}` : ""}
                  {p.card ? ` · ${p.card}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-sm font-semibold tabular-nums text-foreground">{money(p.amount, p.currency, locale)}</span>
                <PaymentPill status={p.status} />
              </div>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
