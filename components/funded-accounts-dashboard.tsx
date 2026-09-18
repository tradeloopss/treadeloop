"use client"

import { useMemo } from "react"
import type { PropFirmAccount } from "@/app/actions/propfirm"
import { analyze, formatCurrency, type TradeStat } from "@/lib/calc"
import { computeTradingScore } from "@/lib/trading-score"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { StatCard } from "@/components/stat-card"
import { EquityCurve, type EquityPoint } from "@/components/equity-curve"
import { TradingScore } from "@/components/trading-score"
import { DollarSign, Percent, Scale, Activity, Wallet, TrendingUp } from "lucide-react"

export interface FundedTrade {
  accountId: number | null
  symbol: string
  market: string
  side: string
  status: string
  pnl: string | number
  rMultiple: string | number | null
  entryTime: string | Date
  exitTime: string | Date | null
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
      <TrendingUp className="size-6 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

export function FundedAccountsDashboard({
  accounts,
  trades,
  currency,
}: {
  accounts: PropFirmAccount[]
  trades: FundedTrade[]
  currency: string
}) {
  const fundedAccounts = useMemo(() => accounts.filter((a) => a.rules?.phase === "funded"), [accounts])
  const fundedIds = useMemo(() => new Set(fundedAccounts.map((a) => a.id)), [fundedAccounts])
  const fundedTrades = useMemo(() => trades.filter((t) => t.accountId != null && fundedIds.has(t.accountId)), [trades, fundedIds])

  const stats: TradeStat[] = useMemo(
    () =>
      fundedTrades.map((t) => ({
        pnl: Number(t.pnl),
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        rMultiple: t.rMultiple == null ? null : Number(t.rMultiple),
        status: t.status,
      })),
    [fundedTrades]
  )
  const a = analyze(stats)
  const tradingScore = computeTradingScore(stats)
  const pf = Number.isFinite(a.profitFactor) ? a.profitFactor.toFixed(2) : "∞"

  const equity = useMemo(() => {
    const closed = [...fundedTrades]
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
  }, [fundedTrades])

  const fundedBalance = fundedAccounts.reduce((sum, acc) => sum + acc.startingBalance + (acc.evaluation?.netProfit ?? 0), 0)

  if (fundedAccounts.length === 0) {
    return (
      <Card className="flex h-40 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-muted-foreground">No funded accounts yet — this tab lights up once an evaluation passes.</p>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Funded balance"
          value={formatCurrency(fundedBalance, currency)}
          sub={`${fundedAccounts.length} funded account${fundedAccounts.length === 1 ? "" : "s"}`}
          icon={<Wallet className="size-4" />}
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
              <h2 className="text-sm font-medium text-muted-foreground">Funded equity curve</h2>
              <p className="text-lg font-semibold tabular-nums">{formatCurrency(a.netPnl, currency)}</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>Max DD {formatCurrency(-a.maxDrawdown, currency)}</span>
              <span>Avg R {a.avgRMultiple.toFixed(2)}</span>
            </div>
          </div>
          {equity.length > 1 ? <EquityCurve data={equity} /> : <EmptyState message="Log a closed trade on a funded account to see this build up." />}
        </Card>
        <TradingScore overall={tradingScore.overall} axes={tradingScore.axes} />
      </div>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Funded accounts</h2>
        <ul className="divide-y">
          {fundedAccounts.map((acc) => {
            const balance = acc.startingBalance + (acc.evaluation?.netProfit ?? 0)
            const netProfit = acc.evaluation?.netProfit ?? 0
            return (
              <li key={acc.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-medium">{acc.name}</p>
                  <p className="text-xs text-muted-foreground">{acc.firmName ?? "Firm not set"} · {acc.planType ?? "Plan not set"}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums">{formatCurrency(balance, acc.currency)}</p>
                  <p className={cn("text-xs tabular-nums", netProfit >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")}>
                    {netProfit >= 0 ? "+" : ""}
                    {formatCurrency(netProfit, acc.currency)} net P&amp;L
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}
