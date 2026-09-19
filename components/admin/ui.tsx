import type React from "react"
import { cn } from "@/lib/utils"
import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react"

// --- Formatting ------------------------------------------------------------------

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })

export const fmtNumber = (value: number) => (Math.abs(value) >= 10_000 ? compact.format(value) : value.toLocaleString("en-US"))
export const fmtMoney = (value: number) => (Math.abs(value) >= 100_000 ? `$${compact.format(value)}` : usd.format(value))
export const fmtPercent = (value: number | null) =>
  value == null ? "—" : value === 0 ? "0%" : `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`

export function fmtBytes(bytes: number | null | undefined) {
  if (bytes == null) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export function fmtDate(value: Date | string | null | undefined) {
  if (!value) return "—"
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export function fmtDateTime(value: Date | string | null | undefined) {
  if (!value) return "—"
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

export function fmtAgo(value: Date | string | null | undefined) {
  if (!value) return "never"
  const seconds = (Date.now() - new Date(value).getTime()) / 1000
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d ago`
  return fmtDate(value)
}

// --- Layout pieces -----------------------------------------------------------------

export function AdminPageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b px-4 py-5 sm:px-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function Panel({ title, description, children, className, action }: { title: string; description?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section className={cn("rounded-xl border bg-card", className)}>
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

// Stat tile: label, value, optional note. No chart — a headline number is
// the right form for a single current value.
export function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{children}</div>
}

// Single-series horizontal bars (one hue, one baseline) for comparing
// magnitudes: the onboarding funnel and feature adoption. Each bar carries
// its value as text, and `title` gives the hover readout.
export function BarList({ items, total, unit = "users" }: { items: { label: string; value: number }[]; total: number; unit?: string }) {
  const max = Math.max(total, ...items.map((i) => i.value), 1)
  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const share = total > 0 ? item.value / total : 0
        return (
          <li key={item.label} title={`${item.label}: ${item.value.toLocaleString("en-US")} ${unit} (${fmtPercent(share)})`}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span>{item.label}</span>
              <span className="tabular-nums text-muted-foreground">
                <span className="font-medium text-foreground">{item.value.toLocaleString("en-US")}</span> · {fmtPercent(share)}
              </span>
            </div>
            <div className="h-3 w-full">
              <div
                className="h-full rounded-r-[4px] bg-primary"
                style={{ width: `${(item.value / max) * 100}%`, minWidth: item.value > 0 ? 3 : 0 }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// Status is never colour alone: every state has its icon and its word.
const STATUS = {
  healthy: { label: "Healthy", icon: CheckCircle2, className: "text-[var(--gain)]" },
  stale: { label: "Stale", icon: AlertTriangle, className: "text-[var(--chart-4)]" },
  failing: { label: "Failing", icon: XCircle, className: "text-[var(--loss)]" },
  never: { label: "Never synced", icon: CircleDashed, className: "text-muted-foreground" },
} as const

export function SyncStatus({ status }: { status: keyof typeof STATUS }) {
  const s = STATUS[status]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
      <s.icon className={cn("size-4", s.className)} aria-hidden="true" />
      <span>{s.label}</span>
    </span>
  )
}

const STATE_STYLES: Record<string, string> = {
  active: "bg-[var(--gain)]/12 text-[var(--gain)]",
  trialing: "bg-primary/12 text-primary",
  past_due: "bg-[var(--chart-4)]/15 text-[var(--chart-4)]",
  suspended: "bg-[var(--loss)]/12 text-[var(--loss)]",
  canceled: "bg-muted text-muted-foreground",
  expired: "bg-muted text-muted-foreground",
  inactive: "bg-muted text-muted-foreground",
  pending: "bg-muted text-muted-foreground",
}

export function StatePill({ state, children }: { state: string; children?: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize", STATE_STYLES[state] ?? "bg-muted text-muted-foreground")}>
      {children ?? state.replace("_", " ")}
    </span>
  )
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  )
}

// Native <select> for GET filter forms, styled like the app's inputs.
export function FilterSelect({ name, defaultValue, options, label }: { name: string; defaultValue?: string; options: [string, string][]; label: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <select
        name={name}
        defaultValue={defaultValue ?? ""}
        className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Pager({ page, total, pageSize, params }: { page: number; total: number; pageSize: number; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const href = (p: number) => {
    const sp = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][])
    sp.set("page", String(p))
    return `?${sp}`
  }
  return (
    <div className="flex items-center justify-between gap-3 px-1 pt-4 text-sm text-muted-foreground">
      <span>
        {total.toLocaleString("en-US")} result{total === 1 ? "" : "s"} · page {page} of {pages}
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <a className="rounded-lg border px-3 py-1.5 hover:bg-muted" href={href(page - 1)}>
            Previous
          </a>
        )}
        {page < pages && (
          <a className="rounded-lg border px-3 py-1.5 hover:bg-muted" href={href(page + 1)}>
            Next
          </a>
        )}
      </div>
    </div>
  )
}
