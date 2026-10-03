import type React from "react"
import Link from "next/link"
import { AlertTriangle, ArrowLeft, ArrowRight, type LucideIcon } from "lucide-react"
import { RANGES, RANGE_LABELS, type Range } from "@/lib/affiliates/types"
import { affiliateHref } from "@/lib/urls"
import { cn } from "@/lib/utils"

// V2's building blocks. Presentational only (they work in server and client
// components alike); the palette comes from the [data-aff-v2] tokens in
// globals.css, so light and dark need nothing here.

export function V2Card({ title, subtitle, action, children, className, bodyClassName, glow, id }: { title?: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string; glow?: boolean; id?: string }) {
  return (
    <section id={id} className={cn(glow ? "v2-card-glow" : "v2-card", "flex min-w-0 flex-col", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cn("flex min-w-0 flex-1 flex-col px-4 pt-3 pb-4 sm:px-5", !title && !action && "pt-4", bodyClassName)}>{children}</div>
    </section>
  )
}

export function CardLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={affiliateHref(href)} className={cn("inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", className)}>
      {children} <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  )
}

// "← Wallet" at the top of a page that sits under another.
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={affiliateHref(href)} className="-ms-1 inline-flex h-9 w-fit items-center gap-1.5 rounded-lg px-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
      <ArrowLeft className="size-4" aria-hidden /> {children}
    </Link>
  )
}

// A small section whose whole point is to send you somewhere else: what is
// there, and one button to go ("Manage Wallet" under the Payout History).
export function LinkSection({ icon, title, description, href, cta, className }: { icon: LucideIcon; title: string; description: string; href: string; cta: string; className?: string }) {
  return (
    <section className={cn("v2-card flex min-w-0 flex-col gap-3.5 p-4 sm:p-5", className)}>
      <div className="flex items-center gap-3">
        <IconTile icon={icon} />
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <Link href={affiliateHref(href)} className="group inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-primary/40 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none active:translate-y-px">
        {cta} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
      </Link>
    </section>
  )
}

export function IconTile({ icon: Icon, className, size = "md" }: { icon: LucideIcon; className?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={cn("v2-icon flex shrink-0 items-center justify-center rounded-xl", size === "sm" ? "size-8" : size === "lg" ? "size-12 rounded-2xl" : "size-10", className)} aria-hidden>
      <Icon className={size === "lg" ? "size-6" : size === "sm" ? "size-4" : "size-5"} />
    </span>
  )
}

export function MetricCard({ icon, label, value, sub, action, className }: { icon: LucideIcon; label: string; value: string; sub?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("v2-card flex min-w-0 items-center gap-3 p-4 sm:gap-4", className)}>
      <IconTile icon={icon} size="lg" className="max-sm:size-10 max-sm:rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-tight font-medium text-muted-foreground sm:truncate">{label}</p>
        <p className="truncate text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</p>
        {sub && <div className="text-[11px] leading-tight text-muted-foreground sm:truncate sm:text-xs">{sub}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  )
}

export const btnClass = "v2-btn inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:cursor-not-allowed"
export const ghostBtnClass = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border bg-card/60 px-3 text-sm font-medium whitespace-nowrap transition-colors hover:border-primary/40 hover:bg-primary/[0.06] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"

// One row of a funnel: label, count, share, and a bar that grows in on load.
export function ProgressRow({ label, value, of, valueText, note }: { label: string; value: number; of: number; valueText?: string; note?: string }) {
  const share = of > 0 ? Math.min(1, value / of) : 0
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          <span className="font-semibold">{valueText ?? value.toLocaleString("en-US")}</span>
          <span className="text-muted-foreground"> · {note ?? `${Math.round(share * 100)}%`}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={of} aria-valuenow={value}>
        <div className="v2-bar v2-grow h-full rounded-full" style={{ width: `${Math.max(share * 100, value > 0 ? 3 : 0)}%` }} />
      </div>
    </div>
  )
}

export function Bar({ value, className, label }: { value: number; className?: string; label: string }) {
  const p = Math.max(0, Math.min(1, value))
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
      <div className="v2-bar v2-grow h-full rounded-full" style={{ width: `${Math.max(p * 100, p > 0 ? 3 : 0)}%` }} />
    </div>
  )
}

// --- Status ---------------------------------------------------------------------

type Tone = "success" | "warning" | "danger" | "info" | "primary" | "muted"
const TONES: Record<Tone, string> = {
  success: "bg-gain/12 text-gain border-gain/25",
  warning: "bg-warning/12 text-[color-mix(in_oklch,var(--warning),black_18%)] border-warning/30 dark:text-warning",
  danger: "bg-loss/12 text-loss border-loss/25",
  info: "bg-[var(--v2-cyan)]/12 text-[var(--v2-cyan)] border-[var(--v2-cyan)]/25",
  primary: "bg-primary/12 text-primary border-primary/25",
  muted: "bg-muted text-muted-foreground border-border",
}
const STATUS: Record<string, [string, Tone]> = {
  // payouts
  pending: ["Pending", "warning"],
  queued: ["Approved", "primary"],
  processing: ["Processing", "info"],
  submitted: ["Processing", "info"],
  confirming: ["Confirming", "info"],
  paid: ["Paid", "success"],
  completed: ["Completed", "success"],
  failed: ["Failed", "danger"],
  retry_required: ["Failed", "danger"],
  on_hold: ["On hold", "muted"],
  cancelled: ["Cancelled", "muted"],
  rejected: ["Rejected", "danger"],
  reversed: ["Reversed", "danger"],
  // ledger
  approved: ["Approved", "primary"],
  available: ["Available", "success"],
  refunded: ["Refunded", "danger"],
  // referrals
  signup: ["Signed up", "muted"],
  trial: ["Trial", "primary"],
  active: ["Active", "success"],
  // campaigns, links, coupons
  archived: ["Archived", "muted"],
  disabled: ["Disabled", "muted"],
  expired: ["Expired", "muted"],
}
// A payout, as the affiliate follows it: waiting, on its way, done, or not
// going to happen. Completed is green, anything still in flight amber, anything
// that failed red. "Retry required" is still in flight — it will be sent again.
const PAYOUT_STATUS: Record<string, [string, Tone]> = {
  pending: ["Pending", "warning"],
  queued: ["Processing", "warning"],
  processing: ["Processing", "warning"],
  submitted: ["Processing", "warning"],
  confirming: ["Processing", "warning"],
  retry_required: ["Processing", "warning"],
  on_hold: ["On hold", "muted"],
  paid: ["Completed", "success"],
  completed: ["Completed", "success"],
  failed: ["Failed", "danger"],
  rejected: ["Rejected", "danger"],
  reversed: ["Reversed", "danger"],
  cancelled: ["Cancelled", "muted"],
}
const statusOf = (status: string, kind?: "payout"): [string, Tone] => (kind === "payout" ? PAYOUT_STATUS[status] : undefined) ?? STATUS[status] ?? [status.replace(/_/g, " "), "muted"]
export function statusText(status: string, kind?: "payout") {
  return statusOf(status, kind)[0]
}
// `label` says it in other words while keeping the status's colour ("Security hold").
export function StatusChip({ status, kind, label, className }: { status: string; kind?: "payout"; label?: string; className?: string }) {
  const [text, tone] = statusOf(status, kind)
  return <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap capitalize", TONES[tone], className)}>{label ?? text}</span>
}

// --- States ----------------------------------------------------------------------

export function EmptyState({ icon: Icon, title, children, action, className }: { icon: LucideIcon; title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-center", className)}>
      <IconTile icon={Icon} size="lg" />
      <p className="mt-1 text-sm font-semibold">{title}</p>
      {children && <p className="max-w-sm text-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function InlineError({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-xl border border-loss/30 bg-loss/[0.06] px-3 py-2.5 text-sm text-loss" role="alert">
      <AlertTriangle className="size-4 shrink-0" aria-hidden /> {children}
    </p>
  )
}

export function Shimmer({ className }: { className?: string }) {
  return <span className={cn("block animate-pulse rounded-lg bg-muted", className)} />
}

// --- Range tabs (links, so the server reloads the period) --------------------------

export function RangeTabs({ range, path, params = {}, ranges = RANGES as readonly Range[], className }: { range: Range; path: string; params?: Record<string, string | undefined>; ranges?: readonly Range[]; className?: string }) {
  return (
    <nav aria-label="Period" className={cn("inline-flex shrink-0 gap-0.5 rounded-lg border bg-muted/40 p-0.5", className)}>
      {ranges.map((r) => {
        const sp = new URLSearchParams(Object.entries({ ...params, range: r === "30d" ? undefined : r }).filter(([, v]) => v) as [string, string][])
        const href = `${path}${sp.size ? `?${sp}` : ""}`
        return (
          <Link
            key={r}
            href={affiliateHref(href)}
            scroll={false}
            aria-current={r === range ? "true" : undefined}
            className={cn("rounded-md px-2 py-1 text-[11px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none sm:px-2.5", r === range ? "v2-nav-active" : "text-muted-foreground hover:text-foreground")}
          >
            {RANGE_LABELS[r]}
          </Link>
        )
      })}
    </nav>
  )
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "A"
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--v2-violet)] to-[var(--v2-blue)] text-[13px] font-semibold text-white shadow-[0_0_0_2px_var(--background)]", className)} aria-hidden>
      {initials}
    </span>
  )
}

export function BetaBadge({ className }: { className?: string }) {
  return <span className={cn("v2-beta inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-bold tracking-wider uppercase", className)}>Beta</span>
}

export function NewBadge() {
  return <span className="rounded-full bg-gradient-to-r from-[var(--v2-violet)] to-[var(--v2-blue)] px-1.5 py-px text-[9px] font-bold tracking-wide text-white uppercase">New</span>
}

export const fmtDate = (v: Date | string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) => (v ? new Date(v).toLocaleDateString("en-US", opts) : "—")
export const fmtAgo = (v: Date | string | null | undefined) => {
  if (!v) return "—"
  const s = (Date.now() - new Date(v).getTime()) / 1000
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return fmtDate(v)
}

// Every V2 page's frame. The desktop header already shows the page's title;
// on a phone (logo header) the page shows it itself. `action` sits beside it.
export function PageFrame({ title, description, action, back, children, className }: { title: string; description?: string; action?: React.ReactNode; back?: { href: string; label: string }; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-[1500px] space-y-4 p-4 sm:p-5 lg:space-y-5 lg:p-6", className)}>
      {back && (
        <div className="-mb-2 lg:-mb-3">
          <BackLink href={back.href}>{back.label}</BackLink>
        </div>
      )}
      {(action || title) && (
        <div className={cn("flex flex-wrap items-end justify-between gap-3", !action && "md:hidden")}>
          <div className="min-w-0 md:hidden">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="flex flex-wrap items-center gap-2 md:ms-auto">{action}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

// Tabs that are links (the server filters the list).
export function LinkTabs({ tabs, current, className }: { tabs: { key: string; label: string; href: string; count?: number }[]; current: string; className?: string }) {
  return (
    <nav aria-label="Filter" className={cn("-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]", className)}>
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={affiliateHref(t.href)}
          scroll={false}
          aria-current={t.key === current ? "page" : undefined}
          className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", t.key === current ? "v2-nav-active" : "border bg-card/60 text-muted-foreground hover:text-foreground")}
        >
          {t.label}
          {t.count != null && <span className={cn("rounded-full px-1.5 text-[10px] font-bold tabular-nums", t.key === current ? "bg-white/20" : "bg-muted")}>{t.count}</span>}
        </Link>
      ))}
    </nav>
  )
}

// Previous / Next for a paged list.
export function Pagination({ page, total, size, href }: { page: number; total: number; size: number; href: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / size))
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-between gap-3 pt-3 text-sm text-muted-foreground">
      <span>
        Page {page} of {pages} · {total.toLocaleString("en-US")} total
      </span>
      <span className="flex gap-2">
        {page > 1 && (
          <Link href={affiliateHref(href(page - 1))} className="rounded-lg border px-3 py-1.5 hover:bg-muted">
            Previous
          </Link>
        )}
        {page < pages && (
          <Link href={affiliateHref(href(page + 1))} className="rounded-lg border px-3 py-1.5 hover:bg-muted">
            Next
          </Link>
        )}
      </span>
    </div>
  )
}

// ↑ 12% / ↓ 4% against the previous period (nothing when there is no previous).
export function Delta({ now, before, className }: { now: number; before: number | null | undefined; className?: string }) {
  if (before == null || before <= 0) return null
  const d = (now - before) / before
  if (!Number.isFinite(d)) return null
  const flat = Math.abs(d) < 0.005
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums", flat ? "text-muted-foreground" : d > 0 ? "text-gain" : "text-loss", className)}>
      <span aria-hidden>{flat ? "→" : d > 0 ? "↑" : "↓"}</span>
      <span className="sr-only">{flat ? "No change" : d > 0 ? "Up" : "Down"}</span>
      {flat ? "0%" : `${Math.abs(d * 100) >= 100 ? Math.round(Math.abs(d * 100)) : (Math.abs(d * 100)).toFixed(1)}%`}
    </span>
  )
}
