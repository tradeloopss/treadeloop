"use client"

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts"
import { Card } from "@/components/ui/card"
import { useT } from "@/components/locale-provider"
import type { Analytics } from "@/lib/calc"

export interface ResultsData {
  analytics: Analytics
  returnPct: number
  breakeven: number
  best: number
  worst: number
  equity: { i: number; equity: number }[]
  startingBalance: number
  endingBalance: number
}

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
const usd2 = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n)

export function BacktestResults({ data }: { data: ResultsData }) {
  const t = useT()
  const a = data.analytics
  const pf = a.profitFactor === Number.POSITIVE_INFINITY ? "∞" : a.profitFactor.toFixed(2)

  const tiles: { label: string; value: string; tone?: "up" | "down" }[] = [
    { label: t("Net P&L"), value: usd2(a.netPnl), tone: a.netPnl > 0 ? "up" : a.netPnl < 0 ? "down" : undefined },
    { label: t("Return"), value: `${data.returnPct >= 0 ? "+" : ""}${data.returnPct.toFixed(2)}%`, tone: data.returnPct > 0 ? "up" : data.returnPct < 0 ? "down" : undefined },
    { label: t("Win rate"), value: `${a.winRate.toFixed(0)}%` },
    { label: t("Profit factor"), value: pf },
    { label: t("Expectancy"), value: usd2(a.expectancy), tone: a.expectancy > 0 ? "up" : a.expectancy < 0 ? "down" : undefined },
    { label: t("Avg R"), value: a.avgRMultiple ? `${a.avgRMultiple.toFixed(2)}R` : "—" },
    { label: t("Trades"), value: String(a.totalTrades) },
    { label: t("Winners"), value: String(a.wins) },
    { label: t("Losers"), value: String(a.losses) },
    { label: t("Breakeven"), value: String(data.breakeven) },
    { label: t("Max drawdown"), value: usd(a.maxDrawdown), tone: a.maxDrawdown > 0 ? "down" : undefined },
    { label: t("Avg winner"), value: usd2(a.avgWin), tone: "up" },
    { label: t("Avg loser"), value: usd2(a.avgLoss), tone: "down" },
    { label: t("Best trade"), value: usd2(data.best), tone: "up" },
    { label: t("Worst trade"), value: usd2(data.worst), tone: data.worst < 0 ? "down" : undefined },
  ]

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <Card key={tile.label} className="gap-1 p-3">
            <div className="text-xs text-muted-foreground">{tile.label}</div>
            <div className={`text-lg font-semibold tabular-nums ${tile.tone === "up" ? "text-emerald-600 dark:text-emerald-400" : tile.tone === "down" ? "text-red-600 dark:text-red-400" : ""}`}>
              {tile.value}
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <div className="mb-3 text-sm font-semibold">{t("Equity curve")}</div>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.equity} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
              <XAxis dataKey="i" tick={{ fontSize: 11 }} stroke="currentColor" className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} width={64} stroke="currentColor" className="text-muted-foreground" tickFormatter={(v) => usd(Number(v))} domain={["auto", "auto"]} />
              <Tooltip formatter={(v) => usd2(Number(v))} labelFormatter={(l) => `${t("Trade")} ${l}`} contentStyle={{ fontSize: 12 }} />
              <ReferenceLine y={data.startingBalance} stroke="currentColor" strokeDasharray="3 3" className="text-muted-foreground/50" />
              <Line type="monotone" dataKey="equity" stroke="#6366f1" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span>{t("Start")}: {usd2(data.startingBalance)}</span>
          <span>{t("End")}: {usd2(data.endingBalance)}</span>
        </div>
      </Card>
    </div>
  )
}
