"use client"

import { useState } from "react"
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"
import type { BacktestDashboard as Data } from "@/lib/backtest/dashboard-stats"
import { CandlestickChart } from "lucide-react"

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n)
const usd0 = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
const compactUsd = (n: number) => {
  const abs = Math.abs(n)
  const s = abs >= 1000 ? `$${(n / 1000).toFixed(abs >= 10000 ? 0 : 1)}K` : `$${Math.round(n)}`
  return n < 0 ? s.replace("$", "-$").replace("--", "-") : s
}
const pfLabel = (n: number) => (n === Infinity ? "∞" : n.toFixed(2))
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

type CalMode = "pnl" | "winrate" | "trades"

export function BacktestDashboard({ data }: { data: Data }) {
  const t = useT()
  const [calMode, setCalMode] = useState<CalMode>("pnl")

  if (data.totalTrades === 0) {
    return (
      <div className="p-6">
        <Card className="mx-auto max-w-md gap-3 p-8 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-muted">
            <CandlestickChart className="size-6 text-muted-foreground" />
          </div>
          <h2 className="font-semibold">{t("No backtest data yet")}</h2>
          <p className="text-sm text-muted-foreground">{t("Run a backtest session and your aggregate stats will appear here.")}</p>
        </Card>
      </div>
    )
  }

  const tone = (n: number) => (n > 0 ? "text-emerald-600 dark:text-emerald-400" : n < 0 ? "text-red-600 dark:text-red-400" : "")

  return (
    <div className="space-y-5 p-4 sm:p-6">
      {/* Stat tiles */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label={t("Net P&L")} badge={String(data.totalTrades)}>
          <span className={cn("text-2xl font-bold tabular-nums", tone(data.netPnl))}>{usd(data.netPnl)}</span>
        </Tile>
        <Tile label={t("Trade win %")}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-2xl font-bold tabular-nums">{data.tradeWinRate.toFixed(2)}%</span>
            <MiniBar green={data.wins} red={data.losses} gray={data.breakeven} />
          </div>
        </Tile>
        <Tile label={t("Day win %")}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-2xl font-bold tabular-nums">{data.dayWinRate.toFixed(2)}%</span>
            <MiniBar green={data.winningDays} red={data.losingDays} gray={data.breakevenDays} />
          </div>
        </Tile>
        <Tile label={t("Avg win/loss trade")}>
          <div className="space-y-1.5">
            <span className="text-2xl font-bold tabular-nums">{data.winLossRatio === Infinity ? "∞" : data.winLossRatio.toFixed(2)}</span>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-emerald-600 tabular-nums dark:text-emerald-400">{compactUsd(data.avgWin)}</span>
              <div className="flex-1 overflow-hidden rounded-full">
                <div className="flex h-1.5">
                  <div className="bg-emerald-500" style={{ width: `${Math.max(8, ratioSplit(data.avgWin, data.avgLoss))}%` }} />
                  <div className="flex-1 bg-red-500" />
                </div>
              </div>
              <span className="text-red-600 tabular-nums dark:text-red-400">{compactUsd(data.avgLoss)}</span>
            </div>
          </div>
        </Tile>
        <Tile label={t("Profit factor")}>
          <span className="text-2xl font-bold tabular-nums">{pfLabel(data.profitFactor)}</span>
        </Tile>
      </div>

      {/* Yearly calendar */}
      <Card className="gap-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("Yearly calendar")}</h2>
          <div className="flex items-center gap-1 rounded-lg border p-0.5 text-xs">
            {(["winrate", "pnl", "trades"] as CalMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setCalMode(m)}
                className={cn("rounded-md px-2 py-1 font-medium", calMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {m === "winrate" ? t("Win rate") : m === "pnl" ? t("P&L") : t("Trades")}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-separate border-spacing-1 text-center text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="w-14 py-1 font-medium">{t("Year")}</th>
                {MONTHS.map((m) => (
                  <th key={m} className="py-1 font-medium">{t(m)}</th>
                ))}
                <th className="py-1 font-medium">{t("Total")}</th>
              </tr>
            </thead>
            <tbody>
              {data.years.map((row) => (
                <tr key={row.year}>
                  <td className="rounded-md border py-2 font-semibold">{row.year}</td>
                  {row.months.map((cell, i) => (
                    <CalCell key={i} cell={cell} mode={calMode} />
                  ))}
                  <CalCell cell={row.total} mode={calMode} total />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Statistics + performance */}
      <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
        <Card className="gap-3 p-4">
          <h2 className="text-sm font-semibold">{t("Statistics")}</h2>
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>{t("Long")} {data.longCount}</span>
              <span>{t("Short")} {data.shortCount}</span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-muted">
              <div className="bg-emerald-500" style={{ width: `${pct(data.longCount, data.longCount + data.shortCount)}%` }} />
              <div className="bg-red-500" style={{ width: `${pct(data.shortCount, data.longCount + data.shortCount)}%` }} />
            </div>
          </div>
          <dl className="divide-y text-sm">
            <StatRow k={t("Time spent backtesting")} v={formatDuration(data.timeSpentMinutes)} />
            <StatRow k={t("Total data backtested")} v={`${Math.round(data.totalDataMonths)} ${t("months")}`} />
            <StatRow k={t("Avg. realized r-multiple")} v={`${data.avgRMultiple.toFixed(2)}R`} />
            <StatRow k={t("Avg hold time")} v={formatDuration(data.avgHoldMinutes)} />
            <StatRow k={t("Max consecutive winning days")} v={String(data.maxConsecWinDays)} />
            <StatRow k={t("Max consecutive losing days")} v={String(data.maxConsecLoseDays)} />
          </dl>
        </Card>

        <Card className="gap-3 p-4">
          <h2 className="text-sm font-semibold">{t("Performance")}</h2>
          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.equity.map((e, i) => ({ i, date: e.date.slice(0, 10), equity: e.equity }))} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="btEq" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} stroke="currentColor" className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 10 }} width={56} stroke="currentColor" className="text-muted-foreground" tickFormatter={(v) => compactUsd(Number(v))} />
                  <Tooltip formatter={(v) => usd(Number(v))} contentStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={0} stroke="currentColor" strokeDasharray="3 3" className="text-muted-foreground/40" />
                  <Area type="monotone" dataKey="equity" stroke="#10b981" strokeWidth={2} fill="url(#btEq)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-3">
              <SideStat label={t("Total trades")} value={String(data.totalTrades)} />
              <SideStat label={t("Profit factor")} value={pfLabel(data.profitFactor)} />
              <SideStat label={t("Trade expectancy")} value={usd0(data.tradeExpectancy)} tone={tone(data.tradeExpectancy)} />
              <SideStat label={t("Max drawdown")} value={`-${usd0(data.maxDrawdown)}`} tone="text-red-600 dark:text-red-400" />
              <SideStat label={t("Avg drawdown")} value={`-${usd0(data.avgDrawdown)}`} tone="text-red-600 dark:text-red-400" />
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

function ratioSplit(win: number, loss: number) {
  const total = Math.abs(win) + Math.abs(loss)
  return total ? (Math.abs(win) / total) * 100 : 50
}
function pct(n: number, total: number) {
  return total ? (n / total) * 100 : 0
}
function formatDuration(minutes: number) {
  if (minutes < 1) return "0m"
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h >= 24) {
    const d = Math.floor(h / 24)
    return `${d}d ${h % 24}h`
  }
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function Tile({ label, badge, children }: { label: string; badge?: string; children: React.ReactNode }) {
  return (
    <Card className="gap-2 p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {label}
        {badge && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-foreground">{badge}</span>}
      </div>
      {children}
    </Card>
  )
}

function MiniBar({ green, red, gray }: { green: number; red: number; gray: number }) {
  const total = green + red + gray || 1
  return (
    <div className="flex items-center gap-1 text-[10px] tabular-nums">
      <div className="flex h-1.5 w-16 overflow-hidden rounded-full">
        <div className="bg-emerald-500" style={{ width: `${(green / total) * 100}%` }} />
        <div className="bg-muted-foreground/40" style={{ width: `${(gray / total) * 100}%` }} />
        <div className="bg-red-500" style={{ width: `${(red / total) * 100}%` }} />
      </div>
    </div>
  )
}

function CalCell({ cell, mode, total }: { cell: { pnl: number; trades: number; wins: number }; mode: CalMode; total?: boolean }) {
  const empty = cell.trades === 0
  const positive = cell.pnl > 0
  const negative = cell.pnl < 0
  const bg = empty
    ? "bg-muted/40 text-muted-foreground"
    : positive
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : negative
        ? "bg-red-500/15 text-red-700 dark:text-red-300"
        : "bg-muted/60"
  let main = "--"
  if (!empty) {
    if (mode === "pnl") main = compactUsd(cell.pnl)
    else if (mode === "winrate") main = `${Math.round((cell.wins / cell.trades) * 100)}%`
    else main = String(cell.trades)
  }
  return (
    <td className={cn("rounded-md px-1 py-1.5 align-middle", bg, total && "font-semibold")}>
      <div className="text-xs font-semibold tabular-nums">{main}</div>
      {!empty && mode !== "trades" && <div className="text-[9px] opacity-70">{cell.trades} {cell.trades === 1 ? "trade" : "trades"}</div>}
    </td>
  )
}

function StatRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium tabular-nums">{v}</dd>
    </div>
  )
}

function SideStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums", tone)}>{value}</div>
    </div>
  )
}
