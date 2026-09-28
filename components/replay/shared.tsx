"use client"

import type React from "react"
import { cn } from "@/lib/utils"
import type { RuleStatus } from "@/lib/replay/types"

// Shared presentational bits for the replay page, so every card/metric/badge
// reads the same in the TradeLoop design language.

export const TONE_TEXT = {
  gain: "text-[var(--gain)]",
  loss: "text-[var(--loss)]",
  warning: "text-amber-600 dark:text-amber-400",
  neutral: "text-foreground",
  primary: "text-primary",
} as const

export const STATUS_META: Record<RuleStatus, { label: string; text: string; bg: string; dot: string }> = {
  safe: { label: "Safe", text: "text-[var(--gain)]", bg: "bg-[var(--gain)]/10", dot: "bg-[var(--gain)]" },
  warning: { label: "Warning", text: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10", dot: "bg-amber-500" },
  breach: { label: "Breach", text: "text-[var(--loss)]", bg: "bg-[var(--loss)]/10", dot: "bg-[var(--loss)]" },
}

export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("rounded-2xl border bg-card shadow-[0_1px_2px_rgba(20,21,42,0.03)]", className)}>{children}</section>
}

export function PanelHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {action}
    </div>
  )
}

export function StatusPill({ status }: { status: RuleStatus }) {
  const m = STATUS_META[status]
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", m.bg, m.text)}>
      <span className={cn("size-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  )
}

export function Metric({ label, value, tone = "neutral", sub }: { label: string; value: string; tone?: keyof typeof TONE_TEXT; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("truncate text-lg font-semibold tabular-nums", TONE_TEXT[tone])}>{value}</p>
      {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

export function ProgressRow({ label, text, pct, status }: { label: string; text: string; pct: number; status: RuleStatus }) {
  const bar = status === "breach" ? "bg-[var(--loss)]" : status === "warning" ? "bg-amber-500" : "bg-primary"
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums text-foreground">{text}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-[width] duration-300", bar)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
    </div>
  )
}

export function SideBadge({ side }: { side: "long" | "short" }) {
  const long = side === "long"
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase", long ? "bg-[var(--gain)]/10 text-[var(--gain)]" : "bg-[var(--loss)]/10 text-[var(--loss)]")}>
      <span className={cn("size-1.5 rounded-full", long ? "bg-[var(--gain)]" : "bg-[var(--loss)]")} />
      {long ? "Long" : "Short"}
    </span>
  )
}
