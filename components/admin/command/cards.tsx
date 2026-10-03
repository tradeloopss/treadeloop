import type React from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CandlestickChart,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  CircleDollarSign,
  CreditCard,
  FileWarning,
  Flag,
  Handshake,
  Hourglass,
  LifeBuoy,
  MinusCircle,
  PlugZap,
  ShieldAlert,
  Sparkles,
  UserCheck,
  Users,
  Wallet,
  XCircle,
  type LucideIcon,
} from "lucide-react"
import type { ActivityCategory, AttentionItem, Kpi, affiliateOps, payoutOps, supportCenter, trading } from "@/lib/admin/command-center"
import { HEALTH_LABELS, overallHealth, type HealthCheck, type HealthStatus } from "@/lib/admin/command-center-rules"
import { fmtMoney, fmtNumber } from "@/components/admin/ui"
import { TONE_DOT, TONE_ICON, type Tone } from "@/components/admin/command/tones"
import { cn } from "@/lib/utils"

// The command center's cards. Presentational only: each takes the numbers its
// widget loaded (lib/admin/command-center) and shows them. One set of
// components for both themes; every colour is a theme token.

// --- Building blocks ---------------------------------------------------------------

export function Card({ title, subtitle, action, badge, children, className, bodyClassName }: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode; badge?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-2xl border bg-card text-card-foreground shadow-[0_1px_2px_0_rgb(16_24_40/0.04)] dark:shadow-none", className)}>
      <header className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            {title}
            {badge}
          </h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className={cn("flex min-w-0 flex-1 flex-col px-4 pt-3 pb-4 sm:px-5", bodyClassName)}>{children}</div>
    </section>
  )
}

export function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
      {children} <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  )
}

const pct = (v: number) => {
  const p = Math.abs(v * 100)
  return p >= 1000 ? "999%+" : `${p < 10 ? p.toFixed(1) : Math.round(p)}%`
}

// ↑ 8.4% / ↓ 3.2%. `invert` for numbers where going up is bad (churn).
export function Trend({ value, invert, className }: { value: number | null | undefined; invert?: boolean; className?: string }) {
  if (value == null || !Number.isFinite(value)) return null
  const flat = Math.abs(value) < 0.0005
  const good = invert ? value < 0 : value > 0
  const Icon = value > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums", flat ? "text-muted-foreground" : good ? "text-gain" : "text-loss", className)}>
      {!flat && <Icon className="size-3.5" aria-hidden />}
      <span className="sr-only">{flat ? "No change" : value > 0 ? "Up" : "Down"} </span>
      {flat ? "0%" : pct(value)}
    </span>
  )
}

function Stat({ label, value, trend, href, invert }: { label: string; value: React.ReactNode; trend?: number | null; href?: string; invert?: boolean }) {
  const body = (
    <>
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span className="ms-auto flex shrink-0 items-center gap-2">
        <span className="font-semibold tabular-nums">{value}</span>
        {trend !== undefined && <Trend value={trend} invert={invert} className="min-w-[3.25rem] justify-end" />}
        {href && <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />}
      </span>
    </>
  )
  const cls = "flex min-h-9 items-center gap-3 text-[13px]"
  return href ? (
    <Link href={href} className={cn(cls, "-mx-2 rounded-lg px-2 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="flex flex-1 items-center justify-center rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>
}

// --- KPI cards ---------------------------------------------------------------------------

const KPI_ICONS: Record<string, LucideIcon> = { users: Users, traders: UserCheck, mrr: CircleDollarSign, held: Hourglass, trades: CandlestickChart }
const KPI_COLS: Record<number, string> = { 1: "xl:grid-cols-1", 2: "xl:grid-cols-2", 3: "xl:grid-cols-3", 4: "xl:grid-cols-4", 5: "xl:grid-cols-5" }

export function KpiCards({ items }: { items: Kpi[] }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 [&>*:last-child:nth-child(odd)]:col-span-2 md:[&>*:last-child:nth-child(odd)]:col-span-1", KPI_COLS[items.length] ?? "xl:grid-cols-5")}>
      {items.map((k) => {
        const Icon = KPI_ICONS[k.key] ?? Sparkles
        const value = k.format === "money" ? fmtMoney(k.value) : fmtNumber(k.value)
        const inner = (
          <>
            <span className="flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary dark:bg-primary/15" aria-hidden>
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 truncate text-xs font-medium text-muted-foreground sm:text-[13px]">{k.label}</span>
            </span>
            <span className="mt-3 block truncate text-2xl font-semibold tracking-tight tabular-nums sm:text-[28px] sm:leading-9">{value}</span>
            <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground sm:text-xs">
              <Trend value={k.change} />
              <span className="min-w-0 truncate">{k.note}</span>
            </span>
          </>
        )
        const cls = "block min-w-0 rounded-2xl border bg-card p-4 shadow-[0_1px_2px_0_rgb(16_24_40/0.04)] transition-colors dark:shadow-none sm:p-5"
        return k.href ? (
          <Link key={k.key} href={k.href} className={cn(cls, "hover:border-primary/30 hover:bg-primary/[0.015] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none dark:hover:bg-primary/[0.04]")}>
            {inner}
          </Link>
        ) : (
          <div key={k.key} className={cls}>
            {inner}
          </div>
        )
      })}
    </div>
  )
}

// --- Needs attention -------------------------------------------------------------------------

const ATTENTION_ICONS: Record<string, LucideIcon> = { payouts: Wallet, tickets: LifeBuoy, syncs: PlugZap, applications: Handshake, security: ShieldAlert, signals: Flag, past_due: CreditCard, imports: FileWarning }

export function NeedsAttention({ items, className }: { items: AttentionItem[]; className?: string }) {
  const total = items.reduce((sum, i) => sum + i.count, 0)
  // What's waiting first; what's clear stays listed (dimmed) as a way in.
  const sorted = [...items].sort((a, b) => Number(b.count > 0) - Number(a.count > 0))
  return (
    <Card
      title="Needs attention"
      className={className}
      badge={
        total > 0 ? (
          <span className="rounded-full bg-loss px-2 py-0.5 text-[11px] leading-none font-semibold text-white tabular-nums" aria-label={`${total} items`}>
            {total}
          </span>
        ) : undefined
      }
      subtitle={total > 0 ? "Waiting on someone from the team" : "Nothing is waiting on the team"}
    >
      {items.length === 0 ? (
        <Empty>Nothing here for your role.</Empty>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {sorted.map((item) => {
            const Icon = ATTENTION_ICONS[item.key] ?? AlertTriangle
            const clear = item.count === 0
            return (
              <li key={item.key}>
                <Link href={item.href} className={cn("flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", clear && "text-muted-foreground")}>
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", clear ? TONE_ICON.muted : TONE_ICON[item.tone])} aria-hidden>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{item.label}</span>
                  <span className={cn("text-sm font-semibold tabular-nums", clear && "font-normal")}>{item.count}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

// --- Trading activity -----------------------------------------------------------------------------

type TradingData = Awaited<ReturnType<typeof trading>>

export function TradingActivity({ data, days, href }: { data: TradingData; days: number; href: string | null }) {
  const max = Math.max(1, ...data.chart.map((d) => d.trades))
  const total14 = data.chart.reduce((s, d) => s + d.trades, 0)
  return (
    <Card title="Trading activity" subtitle="Real trades logged · backtests excluded" action={href ? <CardLink href={href}>Analytics</CardLink> : undefined}>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[28px] leading-9 font-semibold tracking-tight tabular-nums">{fmtNumber(data.month)}</p>
          <p className="text-xs text-muted-foreground">Trades this month</p>
          <Trend value={data.monthChange} className="mt-1" />
        </div>
        <div className="flex h-16 w-[46%] max-w-[180px] items-end gap-[3px]" role="img" aria-label={`Trades per day, last 14 days: ${total14.toLocaleString("en-US")} in total`}>
          {data.chart.map((d, i) => (
            <span
              key={d.day}
              title={`${d.day}: ${d.trades.toLocaleString("en-US")} trades`}
              className={cn("min-h-[3px] flex-1 rounded-t-[3px]", i === data.chart.length - 1 ? "bg-primary" : "bg-primary/45 dark:bg-primary/55")}
              style={{ height: `${Math.max(4, (d.trades / max) * 100)}%` }}
            />
          ))}
        </div>
      </div>
      <div className="mt-4 border-t pt-2">
        <Stat label="Trades today" value={fmtNumber(data.today)} trend={data.todayChange} />
        <Stat label={`Active traders, ${days} days`} value={fmtNumber(data.traders)} trend={data.tradersChange} />
        <Stat label="Accounts synced, 24 h" value={`${fmtNumber(data.synced)} of ${fmtNumber(data.connected)}`} />
      </div>
    </Card>
  )
}

// --- Affiliate operations ---------------------------------------------------------------------------

export function AffiliateOperations({ data, days }: { data: Awaited<ReturnType<typeof affiliateOps>>; days: number }) {
  return (
    <Card title="Affiliate operations" action={<CardLink href="/admin/affiliates">View all</CardLink>}>
      <div>
        <p className="text-[28px] leading-9 font-semibold tracking-tight tabular-nums">{fmtNumber(data.active)}</p>
        <p className="text-xs text-muted-foreground">
          Active affiliates{data.approvedRecent > 0 && <span className="font-medium text-gain"> · +{data.approvedRecent} in {days} days</span>}
        </p>
      </div>
      <div className="mt-4 border-t pt-2">
        <Stat label="Applications" value={fmtNumber(data.applications)} href="/admin/affiliates/applications" />
        <Stat label="Payouts awaiting approval" value={fmtNumber(data.payoutsPending)} href="/admin/affiliates/payouts?tab=pending" />
        <Stat label="Paid this month" value={fmtMoney(data.paidMonth)} href="/admin/affiliates/payouts?tab=completed" />
        <Stat label="Commission owed" value={fmtMoney(data.owed)} href="/admin/affiliates" />
      </div>
      {data.payoutsAttention > 0 && (
        <Link href="/admin/affiliates/payouts?tab=pending" className="mt-3 flex items-center gap-2 rounded-lg bg-primary/[0.07] px-3 py-2 text-xs font-medium text-primary hover:bg-primary/10 dark:bg-primary/10">
          <Wallet className="size-3.5 shrink-0" aria-hidden />
          {data.payoutsAttention} payout{data.payoutsAttention === 1 ? "" : "s"} need attention
          <ArrowRight className="ms-auto size-3.5" aria-hidden />
        </Link>
      )}
    </Card>
  )
}

// --- Payout operations -------------------------------------------------------------------------------

export function PayoutOperations({ data }: { data: Awaited<ReturnType<typeof payoutOps>> }) {
  return (
    <Card title="Payout operations" action={<CardLink href="/admin/affiliates/payouts">View all</CardLink>}>
      <div>
        <p className="text-[28px] leading-9 font-semibold tracking-tight tabular-nums">{fmtMoney(data.value)}</p>
        <p className="text-xs text-muted-foreground">Not yet paid out (all open payouts)</p>
      </div>
      <ul className="mt-4 border-t pt-2">
        {data.rows.map((r) => (
          <li key={r.key}>
            <Link href={r.href} className="-mx-2 flex min-h-9 items-center gap-2.5 rounded-lg px-2 text-[13px] hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
              <span className={cn("size-2 shrink-0 rounded-full", TONE_DOT[r.tone as Tone])} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.label}</span>
              <span className="font-semibold tabular-nums">{fmtNumber(r.count)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// --- Support center ----------------------------------------------------------------------------------

const duration = (seconds: number) => {
  const m = Math.round(seconds / 60)
  if (m < 60) return `${Math.max(1, m)}m`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h}h ${m % 60}m` : `${Math.round(h / 24)}d`
}

export function SupportCenter({ data, days }: { data: Awaited<ReturnType<typeof supportCenter>>; days: number }) {
  const oldest = data.oldestOpen ? duration((Date.now() - Date.parse(data.oldestOpen)) / 1000) : null
  return (
    <Card title="Support center" subtitle={data.inbox}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[28px] leading-9 font-semibold tracking-tight tabular-nums">{fmtNumber(data.open)}</p>
          <p className="text-xs text-muted-foreground">Open requests</p>
        </div>
        {data.urgent > 0 && (
          <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-loss/10 px-2.5 py-1 text-xs font-semibold text-loss">
            <span className="size-1.5 rounded-full bg-loss" aria-hidden />
            {data.urgent} urgent
          </span>
        )}
      </div>
      <div className="mt-4 border-t pt-2">
        <Stat label="No reply yet" value={fmtNumber(data.unanswered)} />
        <Stat label="Waiting on the customer" value={fmtNumber(data.waiting)} />
        <Stat label={`Received, ${days} days`} value={fmtNumber(data.received)} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3 rounded-xl bg-muted/50 px-3 py-2.5 text-xs dark:bg-muted/30">
        <div>
          <p className="text-muted-foreground">Average first reply</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">{data.avgFirstReplySeconds != null ? duration(data.avgFirstReplySeconds) : "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Oldest waiting</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">{oldest ?? "—"}</p>
        </div>
      </div>
      <Link href="/admin/support" className="mt-3 inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
        Open Support <ArrowRight className="size-4" aria-hidden />
      </Link>
    </Card>
  )
}

// --- System health -----------------------------------------------------------------------------------------

const HEALTH_ICON: Record<HealthStatus, { icon: LucideIcon; className: string }> = {
  operational: { icon: CheckCircle2, className: "text-gain" },
  degraded: { icon: AlertTriangle, className: "text-[color-mix(in_oklch,var(--warning),black_20%)] dark:text-warning" },
  down: { icon: XCircle, className: "text-loss" },
  unknown: { icon: CircleDashed, className: "text-muted-foreground" },
  unused: { icon: MinusCircle, className: "text-muted-foreground/70" },
}

export function SystemHealth({ checks, checkedAt, refresh }: { checks: HealthCheck[]; checkedAt: string; refresh?: React.ReactNode }) {
  const overall = overallHealth(checks)
  const Overall = HEALTH_ICON[overall.status]
  const time = new Date(checkedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
  return (
    <section className="rounded-2xl border bg-card shadow-[0_1px_2px_0_rgb(16_24_40/0.04)] dark:shadow-none" aria-labelledby="system-health-title">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-5">
        <div className="flex items-center gap-3">
          <span className={cn("flex size-9 items-center justify-center rounded-full", overall.status === "operational" ? "bg-gain/12" : overall.status === "down" ? "bg-loss/12" : overall.status === "degraded" ? "bg-warning/15" : "bg-muted")} aria-hidden>
            <Overall.icon className={cn("size-5", Overall.className)} />
          </span>
          <div>
            <h2 id="system-health-title" className="text-[15px] font-semibold tracking-tight">
              System health
            </h2>
            <p className="text-xs text-muted-foreground">{overall.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Checked at {time}</span>
          {refresh}
        </div>
      </header>
      <ul className="grid grid-cols-1 gap-x-4 px-4 pt-3 pb-4 min-[480px]:grid-cols-2 sm:px-5 lg:grid-cols-4 xl:grid-cols-7">
        {checks.map((c) => {
          const s = HEALTH_ICON[c.status]
          return (
            <li key={c.key} className="flex min-w-0 gap-2.5 border-t py-3 xl:border-t-0 xl:border-s xl:ps-4 xl:first:border-s-0 xl:first:ps-0">
              <s.icon className={cn("mt-0.5 size-4 shrink-0", s.className)} aria-hidden />
              <div className="min-w-0">
                <p className="text-[13px] leading-snug font-medium">{c.label}</p>
                <p className={cn("text-xs font-medium", c.status === "unused" || c.status === "unknown" ? "text-muted-foreground" : s.className)}>{HEALTH_LABELS[c.status]}</p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground" title={c.detail}>
                  {c.detail}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// --- Activity bits shared with the client list ------------------------------------------------------------

export const ACTIVITY_LABELS: Record<ActivityCategory, string> = { users: "Users", payments: "Payments", support: "Support", trading: "Trading", security: "Security" }

const STATUS_TONES: Record<string, Tone> = {
  New: "primary",
  Pending: "warning",
  Trial: "primary",
  Open: "warning",
  Approved: "success",
  Paid: "success",
  Active: "success",
  Connected: "success",
  Processing: "info",
  Confirming: "info",
  Retry: "warning",
  "Past due": "danger",
  Cancelled: "muted",
  Rejected: "danger",
  Failed: "danger",
  Blocked: "danger",
  Reversed: "danger",
  Suspended: "danger",
  Waiting: "muted",
  Closed: "muted",
  "On hold": "muted",
}

export function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONES[status] ?? "muted"
  return <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap", TONE_ICON[tone])}>{status}</span>
}

// --- Loading + error ----------------------------------------------------------------------------------------

export function KpiSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4", KPI_COLS[count] ?? "xl:grid-cols-5")} aria-busy="true" aria-label="Loading key metrics">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-2xl border bg-card p-4 sm:p-5">
          <div className="flex items-center gap-2.5">
            <span className="size-8 animate-pulse rounded-lg bg-muted" />
            <span className="h-3 w-20 animate-pulse rounded bg-muted" />
          </div>
          <span className="mt-4 block h-7 w-24 animate-pulse rounded bg-muted" />
          <span className="mt-2 block h-3 w-28 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

export function CardSkeleton({ title, rows = 4, chart, className, label = "Loading" }: { title: string; rows?: number; chart?: boolean; className?: string; label?: string }) {
  return (
    <section className={cn("rounded-2xl border bg-card px-4 py-4 sm:px-5", className)} aria-busy="true" aria-label={`${label}: ${title}`}>
      <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      <span className="mt-3 block h-7 w-28 animate-pulse rounded bg-muted" />
      {chart && <span className="mt-4 block h-44 animate-pulse rounded-xl bg-muted/70 sm:h-56" />}
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="size-7 animate-pulse rounded-lg bg-muted" />
            <span className="h-3 flex-1 animate-pulse rounded bg-muted" />
            <span className="h-3 w-8 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </section>
  )
}

export function HealthSkeleton() {
  return (
    <section className="rounded-2xl border bg-card px-4 py-4 sm:px-5" aria-busy="true" aria-label="Checking system health">
      <div className="flex items-center gap-3">
        <span className="size-9 animate-pulse rounded-full bg-muted" />
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">System health</h2>
          <p className="text-xs text-muted-foreground">Checking…</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="space-y-2">
            <span className="block h-3 w-20 animate-pulse rounded bg-muted" />
            <span className="block h-3 w-16 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </section>
  )
}
