"use client"

import { useMemo, useState, useTransition, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowLeft,
  Wallet,
  TrendingUp,
  Target,
  TriangleAlert,
  Shield,
  CalendarDays,
  ShieldCheck,
  ShieldAlert,
  HelpCircle,
  RefreshCw,
  Settings,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Bell,
  CircleDollarSign,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { PropMaxAccountView } from "@/lib/propmax/account"
import type { PropMaxAlertView } from "@/lib/propmax/view-types"
import type { OpenTradeView } from "@/lib/trade-manager"
import type { RuleResult, RuleType, RuleSource } from "@/lib/propmax/types"
import { closeOpenTrade } from "@/app/actions/trade-manager"
import { STATUS_META, ruleLabel, formatMoney, formatValue, phaseLabel, confidenceLabel, timeAgo } from "@/components/propmax/display"

const money = (n: number | null | undefined, ccy = "USD") => (n == null ? "—" : formatMoney(n, ccy))
const num = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 })

function riskHeadline(status: string): { label: string; tone: keyof typeof TONE; icon: typeof ShieldCheck } {
  switch (status) {
    case "safe":
      return { label: "Account safe", tone: "gain", icon: ShieldCheck }
    case "watch":
      return { label: "Watch", tone: "sky", icon: Shield }
    case "warning":
      return { label: "At risk", tone: "amber", icon: TriangleAlert }
    case "critical":
      return { label: "Critical", tone: "orange", icon: TriangleAlert }
    case "breached":
      return { label: "Breached", tone: "loss", icon: ShieldAlert }
    case "stale":
      return { label: "Stale data", tone: "slate", icon: HelpCircle }
    default:
      return { label: "Unverified", tone: "slate", icon: HelpCircle }
  }
}

const TONE = {
  primary: { chip: "bg-primary/10 text-primary", bar: "bg-primary", text: "text-primary" },
  gain: { chip: "bg-[var(--gain)]/10 text-[var(--gain)]", bar: "bg-[var(--gain)]", text: "text-[var(--gain)]" },
  loss: { chip: "bg-[var(--loss)]/10 text-[var(--loss)]", bar: "bg-[var(--loss)]", text: "text-[var(--loss)]" },
  amber: { chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400", bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  orange: { chip: "bg-orange-600/10 text-orange-600 dark:text-orange-400", bar: "bg-orange-600", text: "text-orange-600 dark:text-orange-400" },
  sky: { chip: "bg-sky-500/10 text-sky-600 dark:text-sky-400", bar: "bg-sky-500", text: "text-sky-600 dark:text-sky-400" },
  indigo: { chip: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400", bar: "bg-indigo-500", text: "text-indigo-600 dark:text-indigo-400" },
  slate: { chip: "bg-slate-500/10 text-slate-600 dark:text-slate-300", bar: "bg-slate-400", text: "text-slate-600 dark:text-slate-300" },
} as const

export function PropMaxAccountDetail({
  account,
  positions,
  alerts,
}: {
  account: PropMaxAccountView
  positions: OpenTradeView[]
  alerts: PropMaxAlertView[]
}) {
  const router = useRouter()
  const evaln = account.evaluation
  const ccy = account.currency
  const rules = evaln?.rules ?? []
  const byType = (t: RuleType) => rules.find((r) => r.type === t)

  const balance = account.metrics?.balance ?? account.brokerBalance ?? account.startingBalance
  const equity = account.metrics?.equity ?? balance
  const balChange = balance - account.startingBalance
  const eqChange = equity - account.startingBalance
  const pct = (v: number) => (account.startingBalance > 0 ? (v / account.startingBalance) * 100 : 0)

  const profitTarget = byType("profit_target")
  const dailyLoss = byType("max_daily_loss")
  const drawdown = byType("max_drawdown")
  const tradingDays = byType("min_trading_days")

  const head = riskHeadline(evaln?.risk.status ?? "unknown")

  // Bottom risk analysis.
  const openRisk = positions.reduce((s, p) => s + (p.metrics.riskAmount ?? 0), 0)
  const unprotected = positions.filter((p) => p.metrics.riskAmount == null).length
  const breaches = rules.filter((r) => r.status === "breached").length
  const availableRisk = drawdown?.remainingValue ?? null

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6">
      <Link href="/propfirm-max" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> PropFirm Max
      </Link>

      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <span className={cn("flex size-14 shrink-0 items-center justify-center rounded-2xl text-xl font-bold", TONE.primary.chip)}>
            {account.name.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{account.name}</h1>
              <StatusBadge status={evaln?.risk.status ?? "unknown"} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {account.binding?.firmName ?? "Unassigned"}
              {account.binding?.programName ? ` · ${account.binding.programName}` : ""}
              {account.binding ? ` · ${phaseLabel(account.binding.phase)}` : ""}
            </p>
            {account.broker && (
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                <span className="size-2 rounded-full bg-primary" /> {account.broker}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => router.refresh()}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
          <Link href={`/accounts`}>
            <Button variant="outline" size="sm">
              <Settings className="size-4" /> Account settings
            </Button>
          </Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={Wallet} tone="primary" label="Balance" value={money(balance, ccy)} change={balChange} changePct={pct(balChange)} />
        <StatCard icon={TrendingUp} tone="gain" label="Equity" value={money(equity, ccy)} change={eqChange} changePct={pct(eqChange)} />
        {profitTarget && (
          <StatCard icon={Target} tone="gain" label="Profit Target" value={money(profitTarget.limitValue, ccy)} progress={profitTarget.percentageUsed} progressTone="gain" sub={`${money(profitTarget.currentValue, ccy)} reached`} />
        )}
        {dailyLoss && (
          <StatCard icon={TriangleAlert} tone="amber" label="Daily Loss" value={`${money(dailyLoss.currentValue, ccy)} / ${money(dailyLoss.limitValue, ccy)}`} valueSize="sm" progress={dailyLoss.percentageUsed} progressTone={statusTone(dailyLoss.status)} />
        )}
        {drawdown && (
          <StatCard icon={Shield} tone="loss" label="Max Drawdown" value={`${money(drawdown.currentValue, ccy)} / ${money(drawdown.limitValue, ccy)}`} valueSize="sm" progress={drawdown.percentageUsed} progressTone={statusTone(drawdown.status)} />
        )}
        {tradingDays && (
          <StatCard icon={CalendarDays} tone="indigo" label="Trading Days" value={`${tradingDays.currentValue ?? 0} / ${tradingDays.limitValue ?? 0}`} progress={tradingDays.percentageUsed} progressTone="indigo" />
        )}
      </div>

      {/* Main + sidebar */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        {/* Main */}
        <div className="min-w-0">
          {!evaln || !account.binding ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              This account isn&apos;t set up under PropFirm Max yet. Set it up on the main page to see its rules.
            </div>
          ) : (
            <Tabs defaultValue="running">
              <TabsList variant="line" className="mb-4 w-full justify-start overflow-x-auto">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="running">Running Trades</TabsTrigger>
                <TabsTrigger value="rules">Rules</TabsTrigger>
                <TabsTrigger value="payouts">Payouts</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>

              <TabsContent value="overview">
                <OverviewTab account={account} />
              </TabsContent>

              <TabsContent value="running">
                <RunningTradesTab
                  positions={positions}
                  ccy={ccy}
                  dailyLoss={dailyLoss}
                  drawdown={drawdown}
                  breaches={breaches}
                  unprotected={unprotected}
                  openRisk={openRisk}
                  availableRisk={availableRisk}
                />
              </TabsContent>

              <TabsContent value="rules">
                <RulesTab rules={rules} ccy={ccy} source={account.binding.source} caveat={account.binding.caveat} />
              </TabsContent>

              <TabsContent value="payouts">
                <PayoutsTab account={account} />
              </TabsContent>

              <TabsContent value="activity">
                <ActivityList alerts={alerts} full />
              </TabsContent>
            </Tabs>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="rounded-xl border bg-card p-5">
            <p className="mb-3 text-sm font-semibold">Account Status</p>
            <div className={cn("flex items-center gap-3 rounded-lg p-3", TONE[head.tone].chip)}>
              <head.icon className="size-8 shrink-0" />
              <div>
                <p className="text-sm font-bold uppercase tracking-wide">{head.label}</p>
                <p className="text-xs opacity-80">
                  {evaln ? (breaches ? `${breaches} rule${breaches > 1 ? "s" : ""} breached` : evaln.risk.dataFresh ? "All rules within limits" : "Based on the last sync") : "Not evaluated"}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-5">
            <p className="mb-3 text-sm font-semibold">Rule Status</p>
            <div className="space-y-2.5">
              {rules.length === 0 && <p className="text-xs text-muted-foreground">No rules.</p>}
              {rules.map((r) => (
                <RuleStatusRow key={r.type} rule={r} ccy={ccy} />
              ))}
            </div>
          </div>

          <div className="rounded-xl border bg-card p-5">
            <p className="mb-3 text-sm font-semibold">Recent Activity</p>
            <ActivityList alerts={alerts} />
          </div>
        </div>
      </div>
    </div>
  )
}

function statusTone(status: string): keyof typeof TONE {
  switch (status) {
    case "safe":
      return "gain"
    case "watch":
      return "sky"
    case "warning":
      return "amber"
    case "critical":
      return "orange"
    case "breached":
      return "loss"
    default:
      return "slate"
  }
}

function StatCard({
  icon: Icon,
  tone,
  label,
  value,
  valueSize = "md",
  change,
  changePct,
  progress,
  progressTone,
  sub,
}: {
  icon: typeof Wallet
  tone: keyof typeof TONE
  label: string
  value: string
  valueSize?: "md" | "sm"
  change?: number
  changePct?: number
  progress?: number | null
  progressTone?: keyof typeof TONE
  sub?: string
}) {
  const up = (change ?? 0) >= 0
  const p = progress != null ? Math.max(0, Math.min(100, progress)) : null
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <span className={cn("flex size-8 items-center justify-center rounded-lg", TONE[tone].chip)}>
          <Icon className="size-4" />
        </span>
        {p != null && <span className="text-xs font-medium tabular-nums text-muted-foreground">{Math.round(p)}%</span>}
      </div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 font-semibold tabular-nums", valueSize === "sm" ? "text-base" : "text-xl")}>{value}</p>
      {change != null && (
        <p className={cn("mt-0.5 flex items-center gap-0.5 text-xs font-medium", up ? "text-[var(--gain)]" : "text-[var(--loss)]")}>
          {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
          {up ? "+" : ""}
          {formatMoney(change)} ({changePct != null ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%` : "—"})
        </p>
      )}
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      {p != null && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full", TONE[progressTone ?? tone].bar)} style={{ width: `${p}%` }} />
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status as keyof typeof STATUS_META] ?? STATUS_META.unknown
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", meta.pill)}>{meta.label}</span>
}

function RuleStatusRow({ rule, ccy }: { rule: RuleResult; ccy: string }) {
  const meta = STATUS_META[rule.status]
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", meta.pill)}>
        <span className={cn("size-2 rounded-full", meta.dot)} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{ruleLabel(rule.type)}</p>
        <p className="truncate text-xs text-muted-foreground">
          {rule.currentValue != null && rule.limitValue != null
            ? `${formatValue(rule.currentValue, rule.unit, ccy)} / ${formatValue(rule.limitValue, rule.unit, ccy)}`
            : meta.label}
        </p>
      </div>
      <span className={cn("shrink-0 text-xs font-medium", meta.text)}>{meta.label}</span>
    </div>
  )
}

// ---- Tabs ----------------------------------------------------------------

function OverviewTab({ account }: { account: PropMaxAccountView }) {
  const evaln = account.evaluation!
  const closest = evaln.risk.closest
  return (
    <div className="space-y-4">
      {closest && closest.status !== "safe" ? (
        <div className="rounded-xl border bg-card p-5">
          <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
            <span className={cn("size-2 rounded-full", STATUS_META[closest.status].dot)} /> Closest to breach: {ruleLabel(closest.type)}
          </p>
          <p className="text-sm text-muted-foreground">{closest.explanation}</p>
        </div>
      ) : (
        <div className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">All rules are comfortably within limits. Keep it up.</div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {evaln.rules.map((r) => (
          <div key={r.type} className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{ruleLabel(r.type)}</p>
              <StatusBadge status={r.status} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{r.explanation}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function RunningTradesTab({
  positions,
  ccy,
  dailyLoss,
  drawdown,
  breaches,
  unprotected,
  openRisk,
  availableRisk,
}: {
  positions: OpenTradeView[]
  ccy: string
  dailyLoss?: RuleResult
  drawdown?: RuleResult
  breaches: number
  unprotected: number
  openRisk: number
  availableRisk: number | null
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Running Trades</h2>
          <p className="text-sm text-muted-foreground">Your open positions and the risk on each.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className={cn("size-2 rounded-full", positions.length ? "bg-[var(--gain)]" : "bg-muted-foreground/40")} />
            {positions.length} open
          </span>
          <Link href="/add-trade">
            <Button size="sm">
              <Plus className="size-4" /> New Trade
            </Button>
          </Link>
        </div>
      </div>

      {positions.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <Activity className="mx-auto mb-2 size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No open positions on this account right now.</p>
        </div>
      ) : (
        positions.map((p) => <PositionCard key={`${p.origin}-${p.id}`} p={p} ccy={ccy} dailyLoss={dailyLoss} drawdown={drawdown} />)
      )}

      {/* Trade Risk & Rule Impact */}
      <div className="rounded-xl border bg-card p-5">
        <p className="mb-4 flex items-center gap-1.5 text-sm font-semibold">
          <Shield className="size-4 text-primary" /> Trade Risk &amp; Rule Impact
        </p>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <RiskTile icon={ShieldCheck} tone={breaches ? "loss" : "gain"} label="Potential Rule Breaches" value={String(breaches)} note={breaches ? "action needed" : "none detected"} />
          <RiskTile icon={TriangleAlert} tone={unprotected ? "amber" : "gain"} label="Unprotected Positions" value={String(unprotected)} note={unprotected ? "no stop set" : "all have a stop"} />
          <RiskTile icon={CircleDollarSign} tone="slate" label="Open Risk" value={money(openRisk, ccy)} note="if every stop is hit" />
          <RiskTile icon={Wallet} tone="primary" label="Available Risk" value={availableRisk != null ? money(availableRisk, ccy) : "—"} note="room before drawdown breach" />
        </div>
      </div>
    </div>
  )
}

function PositionCard({ p, ccy, dailyLoss, drawdown }: { p: OpenTradeView; ccy: string; dailyLoss?: RuleResult; drawdown?: RuleResult }) {
  const long = p.side === "long"
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={cn("flex size-10 items-center justify-center rounded-full text-xs font-bold", long ? TONE.gain.chip : TONE.loss.chip)}>{p.symbol.slice(0, 3)}</span>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{p.symbol}</span>
              <SideBadge side={p.side} />
            </div>
            <p className="text-xs text-muted-foreground">
              {p.quantity} {p.market === "futures" ? "contracts" : "units"} · {p.source ?? p.origin}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Risk if stop hit</p>
          <p className={cn("font-semibold tabular-nums", p.metrics.riskAmount != null ? "text-[var(--loss)]" : "text-amber-500")}>
            {p.metrics.riskAmount != null ? `−${money(p.metrics.riskAmount, ccy)}` : "no stop"}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Entry" value={num(p.entryPrice)} />
        <MiniStat label="Stop" value={p.stopLoss != null ? num(p.stopLoss) : "—"} tone={p.stopLoss == null || !p.metrics.stopConsistent ? "amber" : undefined} />
        <MiniStat label="Target" value={p.takeProfit != null ? num(p.takeProfit) : "—"} />
        <MiniStat label="Reward at target" value={p.metrics.rewardAmount != null ? money(p.metrics.rewardAmount, ccy) : "—"} tone="gain" />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-3 text-xs">
        {dailyLoss && <InlineRule label="Daily Loss" rule={dailyLoss} ccy={ccy} />}
        {drawdown && <InlineRule label="Max Drawdown" rule={drawdown} ccy={ccy} />}
        <span className="text-muted-foreground">
          R:R <span className="font-medium text-foreground">{p.metrics.riskReward != null ? `1:${p.metrics.riskReward}` : "—"}</span>
        </span>
        <span className="ms-auto flex items-center gap-2">
          {p.origin === "trade" ? (
            <CloseTradeDialog id={p.id} symbol={p.symbol} />
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-[var(--gain)]" /> Live · manage in platform
            </span>
          )}
        </span>
      </div>
      {p.origin === "provider" && (
        <p className="mt-2 text-[11px] text-muted-foreground">Live price isn&apos;t available in TradeLoop, so unrealized P&amp;L isn&apos;t shown — the risk above is from this position&apos;s size.</p>
      )}
    </div>
  )
}

function InlineRule({ label, rule, ccy }: { label: string; rule: RuleResult; ccy: string }) {
  const meta = STATUS_META[rule.status]
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">
        {rule.currentValue != null && rule.limitValue != null ? `${formatValue(rule.currentValue, rule.unit, ccy)}/${formatValue(rule.limitValue, rule.unit, ccy)}` : meta.label}
      </span>
    </span>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "gain" | "amber" }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("font-medium tabular-nums", tone === "gain" && "text-[var(--gain)]", tone === "amber" && "text-amber-500")}>{value}</p>
    </div>
  )
}

function RiskTile({ icon: Icon, tone, label, value, note }: { icon: typeof Shield; tone: keyof typeof TONE; label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border p-3">
      <span className={cn("mb-2 flex size-8 items-center justify-center rounded-lg", TONE[tone].chip)}>
        <Icon className="size-4" />
      </span>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  )
}

function SideBadge({ side }: { side: "long" | "short" }) {
  const long = side === "long"
  const Icon = long ? ArrowUpRight : ArrowDownRight
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", long ? "border-[var(--gain)]/20 bg-[var(--gain)]/10 text-[var(--gain)]" : "border-[var(--loss)]/20 bg-[var(--loss)]/10 text-[var(--loss)]")}>
      <Icon className="size-3.5" />
      {long ? "Long" : "Short"}
    </span>
  )
}

function RulesTab({ rules, ccy, source, caveat }: { rules: RuleResult[]; ccy: string; source: RuleSource | null; caveat: string | null }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card">
        {rules.map((r, i) => (
          <div key={r.type} className={cn("p-4", i > 0 && "border-t")}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{ruleLabel(r.type)}</p>
              <StatusBadge status={r.status} />
            </div>
            {r.currentValue != null && r.limitValue != null && (
              <div className="mt-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{formatValue(r.currentValue, r.unit, ccy)}</span>
                  <span>limit {formatValue(r.limitValue, r.unit, ccy)}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className={cn("h-full rounded-full", STATUS_META[r.status].bar)} style={{ width: `${Math.max(0, Math.min(100, r.percentageUsed ?? 0))}%` }} />
                </div>
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">{r.explanation}</p>
          </div>
        ))}
      </div>
      {source && (
        <div className="rounded-xl border bg-card p-4 text-sm">
          <p className="font-medium">Source</p>
          <p className="mt-0.5 text-muted-foreground">
            {source.name} · {confidenceLabel(source.confidence)}
            {source.verifiedAt ? ` · verified ${new Date(source.verifiedAt).toLocaleDateString()}` : ""}
          </p>
          {caveat && <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">Note: {caveat}</p>}
        </div>
      )}
    </div>
  )
}

function PayoutsTab({ account }: { account: PropMaxAccountView }) {
  const p = account.evaluation!.payout
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className={cn("flex size-9 items-center justify-center rounded-lg", p.eligible ? TONE.gain.chip : TONE.slate.chip)}>
          <CircleDollarSign className="size-5" />
        </span>
        <div>
          <p className="font-semibold">{!p.determinable ? "Can't judge payout yet" : p.eligible ? "Eligible for payout" : "Not eligible yet"}</p>
          <p className="text-xs text-muted-foreground">Based on the current rules and synced trades.</p>
        </div>
      </div>
      <ul className="space-y-1.5 text-sm">
        {p.reasons.map((r, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className={p.eligible ? "text-[var(--gain)]" : "text-muted-foreground"}>•</span>
            <span className="text-muted-foreground">{r}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ActivityList({ alerts, full }: { alerts: PropMaxAlertView[]; full?: boolean }) {
  if (alerts.length === 0) {
    return <p className="text-xs text-muted-foreground">Nothing recent.</p>
  }
  const list = full ? alerts : alerts.slice(0, 6)
  return (
    <ul className={cn(full && "rounded-xl border bg-card")}>
      {list.map((a, i) => {
        const meta = STATUS_META[a.status as keyof typeof STATUS_META] ?? STATUS_META.unknown
        return (
          <li key={a.id} className={cn("flex items-start gap-2.5", full ? "border-b p-4 last:border-0" : "py-1.5")}>
            <span className={cn("mt-1 flex size-6 shrink-0 items-center justify-center rounded-md", meta.pill)}>
              <Bell className="size-3" />
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm", full ? "font-medium" : "truncate")}>{a.title}</p>
              {full && <p className="mt-0.5 text-xs text-muted-foreground">{a.body}</p>}
              <p className="text-xs text-muted-foreground">{timeAgo(a.createdAt)}</p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function CloseTradeDialog({ id, symbol }: { id: number; symbol: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [exit, setExit] = useState("")
  const [pending, startTransition] = useTransition()

  function onClose() {
    const price = Number(exit)
    if (!Number.isFinite(price) || exit.trim() === "") {
      toast.error("Enter the exit price.")
      return
    }
    startTransition(async () => {
      try {
        const { pnl } = await closeOpenTrade(id, price)
        toast.success(`Closed ${symbol} — ${pnl >= 0 ? "+" : ""}${formatMoney(pnl)}.`)
        setOpen(false)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't close.")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
            Close trade
          </Button>
        }
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Close {symbol}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1.5 py-1">
          <Label htmlFor="exit-price">Exit price</Label>
          <Input id="exit-price" type="number" inputMode="decimal" value={exit} onChange={(e) => setExit(e.target.value)} placeholder="e.g. 5012.5" autoFocus />
          <p className="text-xs text-muted-foreground">Records the exit and moves this trade into your journal with its realized P&amp;L.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onClose} disabled={pending}>
            {pending ? "Closing…" : "Close trade"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
