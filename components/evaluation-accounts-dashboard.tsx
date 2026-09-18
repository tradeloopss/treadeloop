"use client"

import { useMemo } from "react"
import type { PropFirmAccount } from "@/app/actions/propfirm"
import { analyze, formatCurrency, type TradeStat } from "@/lib/calc"
import { computeTradingScore } from "@/lib/trading-score"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/stat-card"
import { EquityCurve, type EquityPoint } from "@/components/equity-curve"
import { TradingScore } from "@/components/trading-score"
import type { FundedTrade } from "@/components/funded-accounts-dashboard"
import { DollarSign, Percent, Scale, Activity, Target, TrendingUp, ShieldAlert } from "lucide-react"

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
      <TrendingUp className="size-6 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

function Bar({ pct, tone }: { pct: number; tone: "gain" | "loss" }) {
  const clamped = Math.min(100, Math.max(0, pct))
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full transition-all", tone === "gain" ? "bg-[var(--gain)]" : "bg-[var(--loss)]")}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

export function EvaluationAccountsDashboard({
  accounts,
  trades,
  currency,
}: {
  accounts: PropFirmAccount[]
  trades: FundedTrade[]
  currency: string
}) {
  const evalAccounts = useMemo(() => accounts.filter((a) => a.rules != null && a.rules.phase !== "funded"), [accounts])
  const evalIds = useMemo(() => new Set(evalAccounts.map((a) => a.id)), [evalAccounts])
  const evalTrades = useMemo(() => trades.filter((t) => t.accountId != null && evalIds.has(t.accountId)), [trades, evalIds])

  const stats: TradeStat[] = useMemo(
    () =>
      evalTrades.map((t) => ({
        pnl: Number(t.pnl),
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        rMultiple: t.rMultiple == null ? null : Number(t.rMultiple),
        status: t.status,
      })),
    [evalTrades]
  )
  const a = analyze(stats)
  const tradingScore = computeTradingScore(stats)
  const pf = Number.isFinite(a.profitFactor) ? a.profitFactor.toFixed(2) : "∞"

  const equity = useMemo(() => {
    const closed = [...evalTrades]
      .filter((t) => t.status === "closed")
      .sort((x, y) => new Date(x.exitTime ?? x.entryTime).getTime() - new Date(y.exitTime ?? y.entryTime).getTime())
    let running = 0
    const points: EquityPoint[] = [{ label: "Start", equity: 0 }]
    for (const t of closed) {
      running += Number(t.pnl)
      points.push({
        label: new Date(t.exitTime ?? t.entryTime).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        equity: Number(running.toFixed(2)),
      })
    }
    return points
  }, [evalTrades])

  const activeCount = evalAccounts.filter((acc) => acc.evaluation?.status === "active").length
  const breachedCount = evalAccounts.filter((acc) => acc.evaluation?.status === "breached").length
  const totalBalance = evalAccounts.reduce((sum, acc) => sum + acc.startingBalance + (acc.evaluation?.netProfit ?? 0), 0)

  if (evalAccounts.length === 0) {
    return (
      <Card className="flex h-40 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-muted-foreground">No accounts in evaluation right now — track one from the Accounts tab.</p>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Evaluation balance"
          value={formatCurrency(totalBalance, currency)}
          sub={`${activeCount} active · ${breachedCount} breached`}
          icon={<Target className="size-4" />}
        />
        <StatCard
          label="Net P&L"
          value={formatCurrency(a.netPnl, currency)}
          tone={a.netPnl > 0 ? "gain" : a.netPnl < 0 ? "loss" : "neutral"}
          sub={`${a.totalTrades} closed trade${a.totalTrades === 1 ? "" : "s"}`}
          icon={<DollarSign className="size-4" />}
        />
        <StatCard label="Win Rate" value={`${a.winRate.toFixed(1)}%`} sub={`${a.wins}W / ${a.losses}L`} icon={<Percent className="size-4" />} />
        <StatCard label="Profit Factor" value={pf} sub="Gross profit ÷ gross loss" icon={<Scale className="size-4" />} />
        <StatCard
          label="Expectancy"
          value={formatCurrency(a.expectancy, currency)}
          tone={a.expectancy > 0 ? "gain" : a.expectancy < 0 ? "loss" : "neutral"}
          sub="Avg P&L per trade"
          icon={<Activity className="size-4" />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-muted-foreground">Evaluation equity curve</h2>
              <p className="text-lg font-semibold tabular-nums">{formatCurrency(a.netPnl, currency)}</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>Max DD {formatCurrency(-a.maxDrawdown, currency)}</span>
              <span>Avg R {a.avgRMultiple.toFixed(2)}</span>
            </div>
          </div>
          {equity.length > 1 ? <EquityCurve data={equity} /> : <EmptyState message="Log a closed trade on an evaluation account to see this build up." />}
        </Card>
        <TradingScore overall={tradingScore.overall} axes={tradingScore.axes} />
      </div>

      <Card className="space-y-4 p-5">
        <h2 className="text-sm font-medium text-muted-foreground">Accounts in evaluation</h2>
        <div className="space-y-4">
          {evalAccounts.map((acc) => {
            const evaluation = acc.evaluation
            const isBreached = evaluation?.status === "breached"
            return (
              <div key={acc.id} className="rounded-lg border p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{acc.name}</p>
                    <p className="text-xs text-muted-foreground">{acc.firmName ?? "Firm not set"} · {acc.planType ?? "Plan not set"}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "uppercase",
                      isBreached ? "border-[var(--loss)]/30 text-[var(--loss)]" : "border-primary/30 text-primary"
                    )}
                  >
                    {isBreached && <ShieldAlert className="size-3.5" />} {evaluation?.status ?? "active"}
                  </Badge>
                </div>
                {evaluation && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {evaluation.profitTargetAmount != null && (
                      <div>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Profit target</span>
                          <span className="font-medium tabular-nums">
                            {formatCurrency(evaluation.netProfit, acc.currency)} / {formatCurrency(evaluation.profitTargetAmount, acc.currency)}
                          </span>
                        </div>
                        <Bar pct={evaluation.profitProgressPct ?? 0} tone="gain" />
                      </div>
                    )}
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Drawdown used</span>
                        <span className="font-medium tabular-nums">
                          {formatCurrency(evaluation.currentDrawdownAmount, acc.currency)} / {formatCurrency(evaluation.drawdownLimitAmount, acc.currency)}
                        </span>
                      </div>
                      <Bar pct={(evaluation.currentDrawdownAmount / evaluation.drawdownLimitAmount) * 100} tone="loss" />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
