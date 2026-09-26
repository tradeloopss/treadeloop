// Display metadata for the PropFirm Max UI — the one place status colors,
// labels and formatting live, so every card/rule renders the engine's output
// consistently. Colors use the app's gain/loss/warning tokens plus fixed
// accent hues; each status is visually distinct across the ladder.
import type { RuleStatus, RuleType, Unit } from "@/lib/propmax/types"

export interface StatusStyle {
  label: string
  // pill: a small status chip. dot: a solid indicator. bar: a progress fill.
  pill: string
  dot: string
  bar: string
  text: string
}

export const STATUS_META: Record<RuleStatus, StatusStyle> = {
  safe: {
    label: "Safe",
    pill: "bg-[var(--gain)]/10 text-[var(--gain)] border-[var(--gain)]/20",
    dot: "bg-[var(--gain)]",
    bar: "bg-[var(--gain)]",
    text: "text-[var(--gain)]",
  },
  watch: {
    label: "Watch",
    pill: "bg-sky-500/10 text-sky-600 border-sky-500/20 dark:text-sky-400",
    dot: "bg-sky-500",
    bar: "bg-sky-500",
    text: "text-sky-600 dark:text-sky-400",
  },
  warning: {
    label: "Warning",
    pill: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
    dot: "bg-amber-500",
    bar: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
  },
  critical: {
    label: "Critical",
    pill: "bg-orange-600/10 text-orange-600 border-orange-600/20 dark:text-orange-400",
    dot: "bg-orange-600",
    bar: "bg-orange-600",
    text: "text-orange-600 dark:text-orange-400",
  },
  breached: {
    label: "Breached",
    pill: "bg-[var(--loss)]/10 text-[var(--loss)] border-[var(--loss)]/20",
    dot: "bg-[var(--loss)]",
    bar: "bg-[var(--loss)]",
    text: "text-[var(--loss)]",
  },
  stale: {
    label: "Stale data",
    pill: "bg-slate-500/10 text-slate-600 border-slate-500/20 dark:text-slate-300",
    dot: "bg-slate-400",
    bar: "bg-slate-400",
    text: "text-slate-600 dark:text-slate-300",
  },
  unknown: {
    label: "Unknown",
    pill: "bg-slate-500/10 text-slate-600 border-slate-500/20 dark:text-slate-300",
    dot: "bg-slate-400",
    bar: "bg-slate-400",
    text: "text-slate-600 dark:text-slate-300",
  },
  not_applicable: {
    label: "—",
    pill: "bg-muted text-muted-foreground border-transparent",
    dot: "bg-muted-foreground/40",
    bar: "bg-muted-foreground/40",
    text: "text-muted-foreground",
  },
}

// Account-level risk headline (a subset of RuleStatus).
export function riskLabel(status: string): string {
  return STATUS_META[(status as RuleStatus)]?.label ?? status
}

export const RULE_LABELS: Record<RuleType, string> = {
  max_daily_loss: "Daily loss limit",
  max_drawdown: "Max drawdown",
  profit_target: "Profit target",
  min_trading_days: "Minimum trading days",
  max_trading_days: "Maximum trading days",
  consistency: "Consistency rule",
  max_position_size: "Max position size",
  max_contracts: "Max contracts",
  max_open_positions: "Max open positions",
  inactivity: "Inactivity limit",
  weekend_holding: "Weekend holding",
  news_restriction: "News trading restriction",
  min_trade_duration: "Minimum trade duration",
}

export function ruleLabel(type: RuleType): string {
  return RULE_LABELS[type] ?? type
}

export function confidenceLabel(c: string): string {
  return { high: "High confidence", medium: "Medium confidence", low: "Low confidence", unknown: "Unverified" }[c] ?? c
}

// Format a rule's value in its unit.
export function formatValue(value: number | null, unit: Unit, currency = "USD"): string {
  if (value == null) return "—"
  switch (unit) {
    case "currency":
      return formatMoney(value, currency)
    case "percentage":
      return `${round(value)}%`
    case "days":
      return `${round(value)} day${value === 1 ? "" : "s"}`
    case "minutes":
      return `${round(value)} min`
    case "count":
      return `${round(value)}`
    default:
      return `${round(value)}`
  }
}

export function formatMoney(value: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: value % 1 === 0 ? 0 : 2 }).format(value)
  } catch {
    return `$${round(value).toLocaleString()}`
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

export function formatSize(size: number | null): string {
  if (size == null) return "—"
  if (size >= 1000 && size % 1000 === 0) return `$${size / 1000}K`
  return formatMoney(size)
}

export function phaseLabel(phase: string): string {
  return { evaluation: "Evaluation", verification: "Verification", funded: "Funded" }[phase] ?? phase
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never"
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "unknown"
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}
