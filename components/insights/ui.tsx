import type React from "react"
import { AlertTriangle, CheckCircle2, CircleDashed, HelpCircle, MinusCircle, TrendingDown, TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

// The pieces Edge Lab and Psychology are built from. Nothing here says more
// than the data does: every figure shows the number of trades it rests on, and
// a state is always a word and an icon as well as a colour.

// What the terms mean, for the "?" beside them.
export const HELP = {
  expectancy: "What an average trade made. In R when your trades have stops (1R = what the trade risked), otherwise in money.",
  pf: "Profit factor: gross profit divided by gross loss. Above 1 means winners outweighed losers; 1.5 or more is healthy.",
  edgeScore: "0–100. Built from sample size, expectancy, profit factor, statistical confidence, month-to-month consistency, drawdown and how the most recent trades did. A small sample caps it, whatever the win rate.",
  confidence: "How sure the data is that the average result is really above zero and not luck, given the number of trades and how much they vary.",
  sample: "The number of closed trades behind the figure. Trades copied to several accounts count once.",
  mfe: "Maximum favourable excursion: the furthest the trade went in your favour before it closed.",
  mae: "Maximum adverse excursion: the furthest the trade went against you before it closed.",
  r: "R is the trade's result divided by what it risked (entry to stop). +2R made twice the risk; −1R lost it.",
  winRate: "The share of trades that made money. On its own it says little: a high win rate with large losses still loses.",
  drawdown: "The largest fall of the running total from a peak.",
} as const

export function InfoTip({ text, label = "What this means" }: { text: string; label?: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <button type="button" aria-label={label} className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <HelpCircle className="size-3.5" />
            </button>
          }
        />
        <TooltipContent className="max-w-64 text-start leading-snug">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function StageBadge({ stage }: { stage: "admin" | "beta" }) {
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase", stage === "beta" ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground")}>
      {stage === "beta" ? "Beta" : "Admin test"}
    </span>
  )
}

export const toneClass = (v: number | null | undefined) => (v == null || v === 0 ? "" : v > 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")

// "n = 42", always beside a figure.
export function SampleTag({ n, className }: { n: number; className?: string }) {
  return <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground", className)}>n = {n.toLocaleString("en-US")}</span>
}

export type Delta = { text: string; direction: "up" | "down" | "flat"; good: boolean | null } | null

export function Metric({ label, value, sub, tone, help, delta, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: number | null; help?: string; delta?: Delta; className?: string }) {
  return (
    <Card className={cn("gap-1 p-4", className)}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        {help && <InfoTip text={help} label={`What ${label} means`} />}
      </div>
      <p className={cn("text-2xl font-semibold tracking-tight tabular-nums", toneClass(tone))}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      {delta && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          {delta.direction === "up" ? <TrendingUp className="size-3.5" aria-hidden /> : delta.direction === "down" ? <TrendingDown className="size-3.5" aria-hidden /> : <MinusCircle className="size-3.5" aria-hidden />}
          <span className={cn(delta.good === true && "text-[var(--gain)]", delta.good === false && "text-[var(--loss)]")}>{delta.text}</span>
          <span>vs previous period</span>
        </p>
      )}
    </Card>
  )
}

// A score out of 100 as a ring, with the number and its band in words.
export function ScoreRing({ score, band, size = 72 }: { score: number | null; band?: string; size?: number }) {
  const r = (size - 8) / 2
  const c = 2 * Math.PI * r
  const v = score == null ? 0 : Math.max(0, Math.min(100, score))
  const colour = score == null ? "var(--muted-foreground)" : v >= 71 ? "var(--gain)" : v >= 51 ? "var(--primary)" : v >= 31 ? "var(--warning)" : "var(--loss)"
  return (
    <div className="flex items-center gap-3">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={score == null ? "No score yet" : `Score ${Math.round(v)} out of 100${band ? `, ${band}` : ""}`} className="shrink-0">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={6} className="text-muted" />
        {score != null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colour} strokeWidth={6} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-foreground text-lg font-semibold tabular-nums">
          {score == null ? "—" : Math.round(v)}
        </text>
      </svg>
      {band && <span className="text-sm font-medium">{band}</span>}
    </div>
  )
}

const PILL = {
  good: { cls: "border-[var(--gain)]/40 bg-[var(--gain)]/10 text-[var(--gain)]", Icon: CheckCircle2 },
  ok: { cls: "border-primary/40 bg-primary/10 text-primary", Icon: CheckCircle2 },
  warn: { cls: "border-[var(--warning)]/50 bg-[var(--warning)]/10 text-[var(--warning)]", Icon: AlertTriangle },
  bad: { cls: "border-[var(--loss)]/40 bg-[var(--loss)]/10 text-[var(--loss)]", Icon: AlertTriangle },
  none: { cls: "text-muted-foreground", Icon: CircleDashed },
} as const
export type PillTone = keyof typeof PILL

// A state, said three ways: colour, icon and word.
export function Pill({ tone = "none", children, className }: { tone?: PillTone; children: React.ReactNode; className?: string }) {
  const { cls, Icon } = PILL[tone]
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", cls, className)}>
      <Icon className="size-3" aria-hidden />
      {children}
    </span>
  )
}

export const bandTone = (band: string): PillTone => (band === "Exceptional" || band === "Strong" ? "good" : band === "Promising" ? "ok" : band === "Unproven" ? "warn" : band === "Weak" ? "bad" : "none")

export function Section({ title, description, action, children, className, id }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <Card id={id} className={cn("gap-3 p-4 sm:p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </div>
      {children}
    </Card>
  )
}

// "Not enough data yet" — with how far along the trader is, never an invented figure.
export function NotEnough({ have, need, what = "closed trades", title = "Not enough data yet", children }: { have?: number; need?: number; what?: string; title?: string; children?: React.ReactNode }) {
  const share = have != null && need ? Math.min(1, have / need) : null
  return (
    <div className="rounded-lg border border-dashed p-5 text-center">
      <CircleDashed className="mx-auto size-6 text-muted-foreground" aria-hidden />
      <p className="mt-2 text-sm font-medium">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</p>}
      {share != null && (
        <div className="mx-auto mt-3 max-w-xs">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={need} aria-valuenow={Math.min(have!, need!)} aria-label={`${have} of ${need} ${what}`}>
            <div className="h-full rounded-full bg-primary" style={{ width: `${share * 100}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
            {have} / {need} {what}
          </p>
        </div>
      )}
    </div>
  )
}

const DISCLAIMERS = {
  history: "Historical performance does not guarantee future results.",
  ai: "AI insights are based on your recorded trading data and should be treated as analysis, not financial advice.",
  behaviour: "Behavioral insights describe observed trading patterns and are not medical or psychological diagnoses.",
  simulation: "This is a statistical simulation of your past results in a different order, not a prediction.",
} as const

export function Disclaimer({ kinds, className }: { kinds: (keyof typeof DISCLAIMERS)[]; className?: string }) {
  return (
    <p className={cn("text-xs leading-relaxed text-muted-foreground", className)}>
      {kinds.map((k) => DISCLAIMERS[k]).join(" ")}
    </p>
  )
}

// A label and a value on one line (the body of a detail sheet).
export function Rows({ rows }: { rows: ([string, React.ReactNode] | [string, React.ReactNode, string] | null | false | undefined)[] }) {
  return (
    <dl className="divide-y text-sm">
      {rows.map((row) =>
        row ? (
          <div key={row[0]} className="flex items-center justify-between gap-3 py-1.5">
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              {row[0]}
              {row[2] && <InfoTip text={row[2]} label={`What ${row[0]} means`} />}
            </dt>
            <dd className="text-end font-medium tabular-nums">{row[1]}</dd>
          </div>
        ) : null,
      )}
    </dl>
  )
}

export const linkBtn = "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
export const linkBtnPrimary = "inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
export const fieldClass = "h-9 w-full min-w-0 rounded-md border bg-background px-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
