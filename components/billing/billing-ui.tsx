"use client"

import type React from "react"
import { AlertCircle, Check, Clock, Crown, Gift, RotateCcw, Sparkles, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"
import type { BillingCard, BillingStatus, PaymentStatus } from "@/lib/billing"

// Small shared pieces of the Billing page.

export function money(amount: number, currency: string, locale: string) {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: currency || "USD" }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

export function day(iso: string | null | undefined, locale: string) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })
}

export function countryName(code: string | null | undefined, locale: string) {
  if (!code) return null
  if (code.length !== 2) return code
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

// "year" / "month" for the periods TradeLoop sells, else "N days".
export function usePeriod() {
  const t = useT()
  return (days: number) => (days >= 360 ? t("year") : days >= 28 && days <= 31 ? t("month") : t("{n} days", { n: days }))
}

export function Section({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border bg-card p-4 shadow-[0_1px_2px_rgba(20,21,42,0.03)] @[640px]/page:p-5", className)}>
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-base font-semibold whitespace-nowrap text-foreground">{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

type PillKind = BillingStatus | "owner" | "granted" | "none"

const PLAN_PILL: Record<PillKind, { label: string; className: string; icon: React.ComponentType<{ className?: string }> | null }> = {
  active: { label: "Active", className: "bg-gain/10 text-gain", icon: null },
  trialing: { label: "Free trial", className: "bg-primary/10 text-primary", icon: Sparkles },
  past_due: { label: "Past due", className: "bg-loss/10 text-loss", icon: AlertCircle },
  canceling: { label: "Canceling", className: "bg-warning/15 text-warning", icon: Clock },
  canceled: { label: "Canceled", className: "bg-muted text-muted-foreground", icon: XCircle },
  expired: { label: "Expired", className: "bg-muted text-muted-foreground", icon: XCircle },
  owner: { label: "Owner access", className: "bg-primary/10 text-primary", icon: Crown },
  granted: { label: "Granted", className: "bg-primary/10 text-primary", icon: Gift },
  none: { label: "No plan", className: "bg-muted text-muted-foreground", icon: null },
}

// Status is always icon (or dot) + words, never color alone.
export function PlanPill({ kind }: { kind: PillKind }) {
  const t = useT()
  const p = PLAN_PILL[kind]
  const Icon = p.icon
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold whitespace-nowrap", p.className)}>
      {Icon ? <Icon className="size-3" aria-hidden /> : <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {t(p.label)}
    </span>
  )
}

const PAY_PILL: Record<PaymentStatus, { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  paid: { label: "Paid", className: "bg-gain/10 text-gain", icon: Check },
  pending: { label: "Pending", className: "bg-warning/15 text-warning", icon: Clock },
  failed: { label: "Failed", className: "bg-loss/10 text-loss", icon: AlertCircle },
  refunded: { label: "Refunded", className: "bg-muted text-muted-foreground", icon: RotateCcw },
  canceled: { label: "Canceled", className: "bg-muted text-muted-foreground", icon: XCircle },
  review: { label: "In review", className: "bg-warning/15 text-warning", icon: Clock },
}

export function PaymentPill({ status }: { status: PaymentStatus }) {
  const t = useT()
  const p = PAY_PILL[status]
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-semibold whitespace-nowrap", p.className)}>
      <p.icon className="size-3" aria-hidden />
      {t(p.label)}
    </span>
  )
}

const BRAND_NAME: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", american_express: "American Express", discover: "Discover", jcb: "JCB", diners: "Diners Club", unionpay: "UnionPay" }

export function brandName(brand: string) {
  return BRAND_NAME[brand.toLowerCase()] ?? brand.charAt(0).toUpperCase() + brand.slice(1)
}

// The card's brand as a compact 42×32 tile: Whop's own artwork when it sends
// one, else the brand in type.
export function BrandTile({ card }: { card: Pick<BillingCard, "brand" | "icon"> }) {
  if (card.icon?.startsWith("https://")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={card.icon} alt="" className="h-8 w-[42px] shrink-0 rounded-md border bg-white object-contain p-0.5" />
  }
  const b = card.brand.toLowerCase()
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-8 w-[42px] shrink-0 items-center justify-center rounded-md text-[10px] font-extrabold tracking-tight uppercase italic",
        b === "visa" ? "bg-[#1a1f71] text-white" : b === "mastercard" ? "border bg-white text-[#eb001b]" : "border bg-muted text-muted-foreground",
      )}
    >
      {b === "mastercard" ? "MC" : b === "american_express" || b === "amex" ? "AMEX" : b.slice(0, 4)}
    </span>
  )
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,130px)_minmax(0,1fr)] items-center gap-3 py-2">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm font-medium text-foreground">{children}</dd>
    </div>
  )
}
