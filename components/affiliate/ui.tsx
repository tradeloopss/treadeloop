import type React from "react"
import Link from "next/link"
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { RANGES, RANGE_LABELS, type Range } from "@/lib/affiliates/types"

// Presentational pieces shared by the affiliate portal and the admin affiliate
// pages. Server-safe (no hooks), built from the app's existing tokens.

export const fmtDay = (v: Date | string | null | undefined) => (v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—")

// A word for every state — never colour on its own.
const STATUS: Record<string, { label: string; className: string }> = {
  // referrals
  signup: { label: "Signed up", className: "bg-muted text-muted-foreground" },
  trial: { label: "Trial", className: "bg-primary/12 text-primary" },
  active: { label: "Active", className: "bg-[var(--gain)]/12 text-[var(--gain)]" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
  refunded: { label: "Refunded", className: "bg-[var(--loss)]/12 text-[var(--loss)]" },
  // ledger
  pending: { label: "Pending", className: "bg-[var(--chart-4)]/15 text-[var(--chart-4)]" },
  approved: { label: "Approved", className: "bg-primary/12 text-primary" },
  available: { label: "Available", className: "bg-[var(--gain)]/12 text-[var(--gain)]" },
  paid: { label: "Paid", className: "bg-[var(--gain)]/12 text-[var(--gain)]" },
  reversed: { label: "Reversed", className: "bg-[var(--loss)]/12 text-[var(--loss)]" },
  // payouts
  processing: { label: "Processing", className: "bg-primary/12 text-primary" },
  queued: { label: "Queued", className: "bg-primary/12 text-primary" },
  submitted: { label: "Submitted", className: "bg-primary/12 text-primary" },
  confirming: { label: "Confirming", className: "bg-primary/12 text-primary" },
  retry_required: { label: "Retry required", className: "bg-[var(--chart-4)]/15 text-[var(--chart-4)]" },
  on_hold: { label: "On hold", className: "bg-[var(--chart-4)]/15 text-[var(--chart-4)]" },
  // payout methods
  pending_verification: { label: "Pending verification", className: "bg-[var(--chart-4)]/15 text-[var(--chart-4)]" },
  verification_required: { label: "Verification required", className: "bg-[var(--chart-4)]/15 text-[var(--chart-4)]" },
  failed: { label: "Failed", className: "bg-[var(--loss)]/12 text-[var(--loss)]" },
  // affiliates
  review: { label: "In review", className: "bg-primary/12 text-primary" },
  rejected: { label: "Rejected", className: "bg-[var(--loss)]/12 text-[var(--loss)]" },
  suspended: { label: "Suspended", className: "bg-[var(--loss)]/12 text-[var(--loss)]" },
  // misc
  archived: { label: "Archived", className: "bg-muted text-muted-foreground" },
  disabled: { label: "Disabled", className: "bg-muted text-muted-foreground" },
  open: { label: "Open", className: "bg-[var(--chart-4)]/15 text-[var(--chart-4)]" },
  reviewing: { label: "Reviewing", className: "bg-primary/12 text-primary" },
  cleared: { label: "Cleared", className: "bg-muted text-muted-foreground" },
  actioned: { label: "Actioned", className: "bg-[var(--gain)]/12 text-[var(--gain)]" },
  low: { label: "Low", className: "bg-muted text-muted-foreground" },
  medium: { label: "Medium", className: "bg-[var(--chart-4)]/15 text-[var(--chart-4)]" },
  high: { label: "High", className: "bg-[var(--loss)]/12 text-[var(--loss)]" },
}

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  const s = STATUS[status] ?? { label: status.replace(/_/g, " "), className: "bg-muted text-muted-foreground" }
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium capitalize", s.className, className)}>{label ?? s.label}</span>
}

export const LEDGER_TYPE_LABELS: Record<string, string> = { subscription: "Commission", bonus: "Bonus", adjustment: "Adjustment", refund: "Refund reversal", reversal: "Reversal", payout: "Payout" }

// Change against the previous period. `null` previous = nothing to compare to.
export function Delta({ value, previous }: { value: number; previous: number | null | undefined }) {
  if (previous == null) return null
  if (previous === 0 && value === 0) return <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"><Minus className="size-3" aria-hidden /> No change</span>
  if (previous === 0) return <span className="inline-flex items-center gap-0.5 text-xs text-[var(--gain)]"><ArrowUpRight className="size-3" aria-hidden /> New</span>
  const change = (value - previous) / Math.abs(previous)
  const up = change >= 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs tabular-nums", up ? "text-[var(--gain)]" : "text-[var(--loss)]")}>
      <Icon className="size-3" aria-hidden />
      {Math.abs(change * 100).toFixed(change !== 0 && Math.abs(change) < 0.1 ? 1 : 0)}%<span className="sr-only"> {up ? "up" : "down"}</span>
      <span className="text-muted-foreground"> vs previous</span>
    </span>
  )
}

export function Kpi({ label, value, icon: Icon, previous, current, note }: { label: string; value: string; icon?: LucideIcon; previous?: number | null; current?: number; note?: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        {Icon && <Icon className="size-4 text-muted-foreground/70" aria-hidden />}
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      <div className="mt-0.5 min-h-4 text-xs text-muted-foreground">{current != null && previous !== undefined ? <Delta value={current} previous={previous} /> : note}</div>
    </div>
  )
}

export function KpiGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>{children}</div>
}

export function Empty({ icon: Icon, title, children, action }: { icon?: LucideIcon; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {Icon && (
        <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" aria-hidden />
        </span>
      )}
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// Table shell matching the admin tables (rounded border, muted header).
export function TableShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-xl border bg-card", className)}>
      <table className="w-full text-sm">{children}</table>
    </div>
  )
}
export const thClass = "whitespace-nowrap px-3 py-2.5 text-start text-xs font-medium text-muted-foreground"
export const tdClass = "px-3 py-2.5 align-middle"
export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="border-b bg-muted/40">{children}</thead>
}

// Range picker as plain links, so the choice lives in the URL.
export function RangeTabs({ range, params = {} }: { range: Range; params?: Record<string, string | undefined> }) {
  return (
    <div className="inline-flex rounded-lg bg-muted p-[3px]" role="group" aria-label="Date range">
      {RANGES.map((r) => {
        const sp = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][])
        sp.set("range", r)
        return (
          <Link
            key={r}
            href={`?${sp}`}
            scroll={false}
            aria-current={r === range ? "true" : undefined}
            className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", r === range ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {RANGE_LABELS[r]}
          </Link>
        )
      })}
    </div>
  )
}

export function FieldRow({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end">
        {children}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </div>
  )
}

export const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
export const linkButtonClass = "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-muted"
export const primaryLinkClass = "inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
