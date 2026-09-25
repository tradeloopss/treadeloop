"use client"

import type React from "react"
import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, ArrowRight, Check, Crown, CreditCard, ExternalLink, FileText, Loader2, MoreVertical, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useIntlLocale, useT } from "@/components/locale-provider"
import { ConfirmDialog } from "@/components/accounts/account-dialogs"
import { cancelSubscription, reactivateSubscription, removePaymentMethod } from "@/app/actions/billing"
import type { BillingCard, BillingOverview, PlanOption } from "@/lib/billing"
import { BrandTile, PaymentPill, PlanPill, Row, Section, brandName, countryName, day, money, usePeriod } from "@/components/billing/billing-ui"
import { CancelDialog, HistoryDialog, ManagePlanDialog, PLAN_HIGHLIGHTS } from "@/components/billing/billing-dialogs"

// The Billing page: the plan (from Whop, live) with its price and actions,
// plan details and usage, the card that pays for it, billing details, and on
// the side the charge history, saved cards and a note on how billing works.
// Two columns (≈2:1) once the page is wide enough, one column below.

const PLAN_NAME = { essential: "Essential", pro: "Pro" } as const
const PLAN_BLURB = {
  essential: "The core journal for up to 3 trading accounts, with live sync for one MetaTrader account.",
  pro: "Everything in TradeLoop: unlimited accounts, live sync from Rithmic, MetaTrader and TradingView, and the full reports suite.",
} as const

const HISTORY_PREVIEW = 5

export function BillingCenter({ overview, planOptions }: { overview: BillingOverview; planOptions: PlanOption[] }) {
  const t = useT()
  const locale = useIntlLocale()
  const router = useRouter()
  const period = usePeriod()
  const [planOpen, setPlanOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [removing, setRemoving] = useState<BillingCard | null>(null)
  const [pending, startTransition] = useTransition()

  const { access, subscription: sub, usage } = overview
  const live = access === "whop" && sub != null
  const manageUrl = live ? sub.manageUrl : null
  const cardInUse = overview.cards.find((c) => c.inUse) ?? null
  const billingOf = (days: number | undefined) => (days != null && days >= 360 ? "annual" : "monthly") as "monthly" | "annual"
  const current = live ? { plan: sub.plan, billing: billingOf(sub.price?.periodDays) } : null
  const planName = live ? t(PLAN_NAME[sub.plan]) : overview.plan ? t(PLAN_NAME[overview.plan]) : ""

  // "Expires 07/2029", or nothing when Whop doesn't know the date.
  const expiry = (c: BillingCard) => (c.expMonth && c.expYear ? t("Expires {date}", { date: `${String(c.expMonth).padStart(2, "0")}/${c.expYear}` }) : null)

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string, after?: () => void) {
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        toast.error(t(result.error))
        return
      }
      toast.success(success)
      after?.()
      router.refresh()
    })
  }

  // ------------------------------------------------------------------ hero
  const cheapest = planOptions.filter((o) => o.billing === "monthly").sort((a, b) => a.amount - b.amount)[0]
  const hero = (() => {
    if (access === "owner") {
      return {
        pill: <PlanPill kind="owner" />,
        title: t("Pro plan"),
        blurb: t("Full Pro access on this account. Owner accounts aren't billed, so there's nothing to pay or manage here."),
        features: PLAN_HIGHLIGHTS.pro,
        price: null,
        actions: null,
      }
    }
    if (access === "admin" && overview.adminGrant) {
      const g = overview.adminGrant
      return {
        pill: <PlanPill kind="granted" />,
        title: t("{plan} plan", { plan: t(PLAN_NAME[g.plan]) }),
        blurb: t("Access given by the TradeLoop team — no payment needed."),
        features: PLAN_HIGHLIGHTS[g.plan],
        price: (
          <>
            <p className="text-3xl font-bold tracking-tight text-foreground">{t("Free")}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{g.until ? t("Until {date}", { date: day(g.until, locale) }) : t("No end date")}</p>
          </>
        ),
        actions: (
          <Button variant="outline" className="h-11 w-full font-semibold @[520px]/hero:w-auto" onClick={() => setPlanOpen(true)}>
            {t("View plans")}
          </Button>
        ),
      }
    }
    if (live) {
      const s = sub
      const periodName = s.price ? period(s.price.periodDays) : null
      const sub2 =
        s.status === "trialing"
          ? t("Free trial until {date}, then billed every {period}", { date: day(s.periodEnd, locale), period: periodName ?? t("period") })
          : s.status === "canceling"
            ? t("Won't renew — access until {date}", { date: day(s.periodEnd, locale) })
            : s.status === "past_due"
              ? t("Your latest payment didn't go through")
              : t("Billed every {period} · renews {date}", { period: periodName ?? t("period"), date: day(s.periodEnd, locale) })
      return {
        pill: <PlanPill kind={s.status} />,
        title: t("{plan} plan", { plan: planName }),
        blurb: t(PLAN_BLURB[s.plan]),
        features: PLAN_HIGHLIGHTS[s.plan],
        price: (
          <>
            {s.price ? (
              <p className="flex items-baseline gap-1.5">
                <span className="text-[34px] leading-10 font-bold tracking-tight text-foreground tabular-nums">{money(s.price.amount, s.price.currency, locale)}</span>
                <span className="text-sm font-medium text-muted-foreground">/ {periodName}</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t("Price unavailable right now")}</p>
            )}
            <p className="mt-1 text-[13px] text-muted-foreground">{sub2}</p>
            {s.price && s.price.periodDays >= 360 && (
              <p className="text-xs text-muted-foreground">{t("{amount} a month", { amount: money(s.price.amount / 12, s.price.currency, locale) })}</p>
            )}
          </>
        ),
        actions:
          s.status === "canceling" ? (
            <>
              <Button className="h-11 w-full font-semibold hover:bg-primary/90 @[520px]/hero:w-auto" disabled={pending} onClick={() => run(reactivateSubscription, t("Your subscription will renew as normal."))}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                {pending ? t("Reactivating…") : t("Reactivate subscription")}
              </Button>
              <Button variant="outline" className="h-11 w-full @[520px]/hero:w-auto" onClick={() => setPlanOpen(true)}>
                {t("Manage plan")}
              </Button>
            </>
          ) : (
            <>
              <Button className="h-11 w-full font-semibold hover:bg-primary/90 @[520px]/hero:w-auto" onClick={() => setPlanOpen(true)}>
                <CreditCard className="size-4" /> {t("Manage plan")}
              </Button>
              <Button variant="outline" className="h-11 w-full text-muted-foreground hover:text-foreground @[520px]/hero:w-auto" onClick={() => setCancelOpen(true)}>
                {t("Cancel subscription")}
              </Button>
            </>
          ),
      }
    }
    // No plan (never had one, or it ended).
    const ended = sub && (sub.status === "canceled" || sub.status === "expired") ? sub : null
    return {
      pill: <PlanPill kind={ended ? ended.status : "none"} />,
      title: t("Choose a TradeLoop plan"),
      blurb: ended
        ? t("Your {plan} plan ended on {date}. Pick a plan to pick up where you left off — your journal is still here.", { plan: t(PLAN_NAME[ended.plan]), date: day(ended.periodEnd, locale) })
        : t("Select the plan that fits your trading workflow."),
      features: null,
      price: cheapest ? (
        <>
          <p className="text-[13px] text-muted-foreground">{t("Plans from")}</p>
          <p className="flex items-baseline gap-1.5">
            <span className="text-[34px] leading-10 font-bold tracking-tight text-foreground tabular-nums">{money(cheapest.amount, "USD", locale)}</span>
            <span className="text-sm font-medium text-muted-foreground">/ {t("month")}</span>
          </p>
          {overview.trialEligible && <p className="mt-1 text-[13px] text-muted-foreground">{t("Starts with a free trial")}</p>}
        </>
      ) : null,
      actions: (
        <Button className="h-11 w-full font-semibold hover:bg-primary/90 @[520px]/hero:w-auto" onClick={() => setPlanOpen(true)}>
          {t("View plans")}
        </Button>
      ),
    }
  })()

  // ---------------------------------------------------------- plan details
  const cycle = live && sub.price ? (sub.price.periodDays >= 360 ? t("Annual") : t("Monthly")) : access === "owner" || access === "admin" ? t("Not billed") : "—"
  const dateRow: { label: string; value: string } | null = live
    ? sub.status === "trialing"
      ? { label: t("Trial ends"), value: day(sub.periodEnd, locale) }
      : sub.status === "canceling"
        ? { label: t("Access until"), value: day(sub.periodEnd, locale) }
        : sub.status === "past_due"
          ? { label: t("Payment due"), value: t("Now") }
          : { label: t("Next billing date"), value: day(sub.periodEnd, locale) }
    : access === "admin" && overview.adminGrant
      ? { label: t("Access until"), value: overview.adminGrant.until ? day(overview.adminGrant.until, locale) : t("No end date") }
      : null

  const address = overview.address
  const addressLines = address ? [address.line1, address.line2, [address.city, address.state, address.postalCode].filter(Boolean).join(", ")].filter((l) => l && l.trim() !== "") : []
  const country = countryName(address?.country, locale)

  return (
    <div className="@container/page min-h-full bg-background">
      <div className="mx-auto max-w-[1400px] space-y-6 p-4 @[640px]/page:p-6 @[1100px]/page:p-8">
        <header>
          <p className="text-[11px] font-bold tracking-[0.7px] text-primary uppercase">{t("Billing & subscription")}</p>
          <h1 className="mt-1.5 text-2xl leading-[30px] font-bold tracking-[-0.5px] text-foreground @[768px]/page:text-[30px] @[768px]/page:leading-9">{t("Manage your plan and billing")}</h1>
          <p className="mt-1.5 max-w-[640px] text-sm text-muted-foreground">{t("View your subscription details, manage payment methods, and keep your account up to date.")}</p>
        </header>

        {overview.whopError && (
          <p role="status" className="rounded-xl border bg-muted/50 px-4 py-3 text-[13px] text-muted-foreground">
            {t("Some billing details couldn't be loaded from Whop just now. Refresh the page to try again.")}
          </p>
        )}

        {live && sub.status === "past_due" && (
          <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-loss/25 bg-loss/[0.04] p-4 @[640px]/page:flex-row @[640px]/page:items-center @[640px]/page:justify-between">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-loss" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-foreground">{t("Payment needs attention")}</p>
                <p className="text-[13px] text-muted-foreground">{t("We couldn't process your latest payment. Update your card to keep your plan active.")}</p>
              </div>
            </div>
            {(sub.recoveryUrl || sub.manageUrl) && (
              <Button nativeButton={false} className="h-11 shrink-0 font-semibold hover:bg-primary/90" render={<a href={(sub.recoveryUrl ?? sub.manageUrl)!} target="_blank" rel="noopener noreferrer" />}>
                {t("Update payment method")} <ExternalLink className="size-3.5" />
              </Button>
            )}
          </div>
        )}

        <div className="grid items-start gap-5 @[1080px]/page:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] @[1080px]/page:gap-6">
          {/* ---------------- main column ---------------- */}
          <div className="min-w-0 space-y-5">
            <section
              aria-label={t("Current plan")}
              className="@container/hero relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-card to-primary/[0.05] p-5 shadow-[0_1px_2px_rgba(20,21,42,0.03)] @[640px]/page:p-7"
            >
              <div aria-hidden className="pointer-events-none absolute -top-24 -right-20 size-72 rounded-full bg-primary/10 blur-3xl" />
              <div className="relative grid gap-6 @[620px]/hero:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  {hero.pill}
                  <h2 className="mt-3 text-[26px] leading-8 font-bold tracking-[-0.5px] text-foreground @[520px]/hero:text-[30px] @[520px]/hero:leading-9">{hero.title}</h2>
                  <p className="mt-2 max-w-[460px] text-sm leading-[22px] text-muted-foreground">{hero.blurb}</p>
                  {hero.features && (
                    <ul className="mt-4 grid gap-x-6 gap-y-2 @[420px]/hero:grid-cols-2">
                      {hero.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-[13px] text-foreground">
                          <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                          {t(f)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {(hero.price || hero.actions) && (
                  <div className="flex min-w-0 flex-col gap-4 @[620px]/hero:min-w-[260px] @[620px]/hero:items-stretch">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">{hero.price}</div>
                      <span aria-hidden className="hidden size-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30 @[620px]/hero:flex">
                        <Crown className="size-6" />
                      </span>
                    </div>
                    {hero.actions && <div className="flex flex-col gap-2 @[520px]/hero:flex-row @[620px]/hero:flex-col">{hero.actions}</div>}
                  </div>
                )}
              </div>
            </section>

            <section className="@container/details rounded-2xl border bg-card p-4 shadow-[0_1px_2px_rgba(20,21,42,0.03)] @[640px]/page:p-5">
              <div className="grid gap-6 @[600px]/details:grid-cols-2 @[600px]/details:gap-0">
                <div className="@[600px]/details:pe-6">
                  <h2 className="text-base font-semibold text-foreground">{t("Plan details")}</h2>
                  <dl className="mt-2">
                    <Row label={t("Plan name")}>{live ? t(sub.title) : overview.plan ? t(PLAN_NAME[overview.plan]) : t("No plan")}</Row>
                    <Row label={t("Billing cycle")}>{cycle}</Row>
                    {dateRow && <Row label={dateRow.label}>{dateRow.value}</Row>}
                    <Row label={t("Status")}>
                      <PlanPill kind={access === "owner" ? "owner" : access === "admin" ? "granted" : live ? sub.status : (sub?.status ?? "none")} />
                    </Row>
                  </dl>
                </div>
                <div className="border-t pt-5 @[600px]/details:border-t-0 @[600px]/details:border-s @[600px]/details:ps-6 @[600px]/details:pt-0">
                  <h2 className="text-base font-semibold text-foreground">{t("Usage")}</h2>
                  <div className="mt-3 space-y-4">
                    <Meter label={t("Trading accounts")} used={usage.accounts} limit={usage.accountLimit} />
                    <Meter label={t("MetaTrader live sync")} used={usage.metatrader} limit={usage.metatraderLimit} />
                    <Meter label={t("Trades this month")} used={usage.tradesThisMonth} limit={null} />
                  </div>
                </div>
              </div>
            </section>

            {live && (
              <Section
                title={t("Payment method")}
                action={
                  manageUrl ? (
                    <Button variant="outline" nativeButton={false} className="h-9 text-[13px]" render={<a href={manageUrl} target="_blank" rel="noopener noreferrer" />}>
                      <CreditCard className="size-3.5" /> {t("Update payment method")}
                    </Button>
                  ) : undefined
                }
              >
                {cardInUse ? (
                  <div className="flex items-center gap-3">
                    <BrandTile card={cardInUse} />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                        {t("{brand} ending in {last4}", { brand: brandName(cardInUse.brand), last4: cardInUse.last4 })}
                        <span className="rounded-full bg-gain/10 px-2 py-0.5 text-[11px] font-semibold text-gain">{t("Default")}</span>
                      </p>
                      <p className={cn("text-xs", cardInUse.expired ? "text-loss" : "text-muted-foreground")}>
                        {[cardInUse.expired ? t("Expired") : expiry(cardInUse), t("Used for renewals")].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-[13px] text-muted-foreground">{t("No card on file yet — your plan will ask for one before its first charge.")}</p>
                )}
              </Section>
            )}

            <Section
              title={t("Billing information")}
              action={
                manageUrl ? (
                  <Button variant="outline" nativeButton={false} className="h-9 text-[13px]" render={<a href={manageUrl} target="_blank" rel="noopener noreferrer" />}>
                    <Pencil className="size-3.5" /> {t("Edit")}
                  </Button>
                ) : undefined
              }
            >
              <dl className="grid gap-x-8 gap-y-4 @[560px]/page:grid-cols-2">
                <Info label={t("Name")}>{address?.name || overview.account.name || "—"}</Info>
                <Info label={t("Email")}>{overview.account.billingEmail ?? overview.account.email}</Info>
                <Info label={t("Address")}>
                  {addressLines.length > 0 ? addressLines.map((l) => <span key={l} className="block">{l}</span>) : <span className="text-muted-foreground">{t("Added when you check out")}</span>}
                </Info>
                <Info label={t("Country")}>{country ?? <span className="text-muted-foreground">—</span>}</Info>
              </dl>
              {manageUrl && <p className="mt-4 text-xs text-muted-foreground">{t("Your billing details are kept by Whop, our payment processor — Edit opens them there.")}</p>}
            </Section>
          </div>

          {/* ---------------- side column ---------------- */}
          <div className="min-w-0 space-y-5">
            <Section
              title={t("Billing history")}
              action={
                overview.payments.length > HISTORY_PREVIEW ? (
                  <Button variant="ghost" className="h-9 px-2 text-[13px] font-semibold text-primary hover:bg-primary/5 hover:text-primary" onClick={() => setHistoryOpen(true)}>
                    {t("View all")}
                  </Button>
                ) : undefined
              }
              className="@container/hist"
            >
              {overview.payments.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed px-4 py-8 text-center">
                  <FileText className="size-5 text-muted-foreground" aria-hidden />
                  <p className="text-sm font-medium text-foreground">{t("No invoices yet")}</p>
                  <p className="max-w-[260px] text-xs text-muted-foreground">{t("Your billing history will appear here after your first payment.")}</p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border">
                  {/* Date (with what it was for underneath) · amount · status. */}
                  <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_72px_84px] gap-2 bg-muted/40 px-3 py-2 text-[11px] font-semibold text-muted-foreground @[300px]/hist:grid">
                    <span>{t("Date")}</span>
                    <span className="text-end">{t("Amount")}</span>
                    <span className="text-end">{t("Status")}</span>
                  </div>
                  <ul className="divide-y">
                    {overview.payments.slice(0, HISTORY_PREVIEW).map((p) => (
                      <li key={p.id} className="grid min-h-[56px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 px-3 py-2.5 @[300px]/hist:grid-cols-[minmax(0,1fr)_72px_84px]">
                        <div className="flex min-w-0 items-start gap-2">
                          <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium whitespace-nowrap text-foreground">{day(p.date, locale)}</p>
                            <p className="truncate text-[11px] text-muted-foreground" title={p.reason ? `${t(p.description)} · ${t(p.reason)}` : t(p.description)}>
                              {t(p.description)}
                              {p.reason ? ` · ${t(p.reason)}` : ""}
                            </p>
                          </div>
                        </div>
                        <span className="text-end text-[13px] font-semibold tabular-nums text-foreground">{money(p.amount, p.currency, locale)}</span>
                        <span className="col-span-2 flex justify-end @[300px]/hist:col-span-1">
                          <PaymentPill status={p.status} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>

            <Section
              title={t("Payment methods")}
              action={
                manageUrl ? (
                  <Button variant="outline" nativeButton={false} className="h-9 border-primary/30 px-3 text-[13px] font-semibold text-primary hover:bg-primary/5 hover:text-primary" render={<a href={manageUrl} target="_blank" rel="noopener noreferrer" />}>
                    <Plus className="size-3.5" /> {t("Add payment method")}
                  </Button>
                ) : undefined
              }
            >
              {overview.cards.length === 0 ? (
                <div className="rounded-xl border border-dashed px-4 py-6 text-center">
                  <p className="text-sm font-medium text-foreground">{t("No payment method added")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {live ? t("Add a payment method to keep your subscription active.") : t("You'll add a card when you choose a plan.")}
                  </p>
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {overview.cards.map((c) => (
                    <li key={c.id} className="flex min-h-[64px] items-center gap-3 rounded-xl border bg-card px-3.5 py-3 transition-colors hover:bg-primary/[0.02]">
                      <BrandTile card={c} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{t("{brand} ending in {last4}", { brand: brandName(c.brand), last4: c.last4 })}</p>
                        <p className={cn("text-xs", c.expired ? "text-loss" : "text-muted-foreground")}>
                          {c.expired ? t("Expired") : (expiry(c) ?? t("Saved card"))}
                        </p>
                      </div>
                      {c.inUse ? (
                        <span className="rounded-full bg-gain/10 px-2 py-0.5 text-[11px] font-semibold text-gain">{t("Default")}</span>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="icon" className="size-11 shrink-0 text-muted-foreground" aria-label={t("Options for {card}", { card: `${brandName(c.brand)} ${c.last4}` })}>
                                <MoreVertical className="size-4" />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end" className="w-56">
                            {manageUrl && (
                              <DropdownMenuItem render={<a href={manageUrl} target="_blank" rel="noopener noreferrer" />}>
                                <CreditCard className="size-4" /> {t("Use for renewals (on Whop)")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem variant="destructive" onClick={() => setRemoving(c)}>
                              <Trash2 className="size-4" /> {t("Remove card")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <section className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-4 @[640px]/page:p-5">
              <div className="flex gap-3">
                <ShieldCheck className="size-6 shrink-0 text-primary" aria-hidden />
                <div>
                  <h2 className="text-sm font-semibold text-foreground">{t("Secure & flexible billing")}</h2>
                  <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                    {t("Payments are processed by Whop — TradeLoop never sees or stores your card number. Cancel or change your plan any time; you keep access until the end of what you've paid for.")}
                  </p>
                  <Link href="/terms" className="mt-3 inline-flex items-center gap-1 rounded-sm text-[13px] font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary">
                    {t("Learn more")} <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      <ManagePlanDialog open={planOpen} onOpenChange={setPlanOpen} options={planOptions} current={current} manageUrl={manageUrl} trialEligible={overview.trialEligible} />
      {live && (
        <CancelDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          planName={t("{plan} plan", { plan: planName })}
          until={day(sub.periodEnd, locale)}
          trial={sub.status === "trialing"}
          pending={pending}
          onConfirm={() => run(cancelSubscription, t("Your subscription won't renew. You keep access until {date}.", { date: day(sub.periodEnd, locale) }), () => setCancelOpen(false))}
        />
      )}
      <HistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} payments={overview.payments} />
      <ConfirmDialog
        open={removing != null}
        pending={pending}
        destructive
        title={t("Remove this card?")}
        description={removing ? t("{brand} ending in {last4} will be removed from your saved cards on Whop.", { brand: brandName(removing.brand), last4: removing.last4 }) : ""}
        confirmLabel={t("Remove card")}
        onConfirm={() => removing && run(() => removePaymentMethod(removing.id), t("Card removed"), () => setRemoving(null))}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium break-words text-foreground">{children}</dd>
    </div>
  )
}

// used / limit with a bar; an unlimited allowance says so instead of
// pretending to be a percentage.
function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const t = useT()
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0
  const full = limit != null && used >= limit
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-foreground">{label}</span>
        <span className="font-semibold tabular-nums text-foreground">
          {used} <span className="font-normal text-muted-foreground">/ {limit == null ? t("Unlimited") : limit}</span>
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit ?? undefined}
        aria-valuetext={limit == null ? t("{n} used, unlimited", { n: used }) : t("{n} of {max} used", { n: used, max: limit })}
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
      >
        {limit == null ? (
          <div className="h-full w-full rounded-full bg-primary/15" />
        ) : (
          <div className={cn("h-full rounded-full transition-[width]", full ? "bg-warning" : "bg-primary")} style={{ width: `${Math.max(pct, used > 0 ? 4 : 0)}%` }} />
        )}
      </div>
    </div>
  )
}
