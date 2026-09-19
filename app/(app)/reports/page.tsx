import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { getTrades } from "@/app/actions/trades"
import { analyze, formatCurrency, type TradeStat } from "@/lib/calc"
import { isPro } from "@/lib/subscription"
import { PageHeader } from "@/components/page-header"
import { PnlBarChart, CountBarChart, type BarDatum } from "@/components/reports-charts"
import { PeriodInsights, type ReportTrade } from "@/components/period-insights"
import { CrossAnalysis } from "@/components/cross-analysis"
import { computeCrossAnalysis } from "@/lib/cross-analysis"
import { StatCard } from "@/components/stat-card"
import { Card } from "@/components/ui/card"
import { UpgradePrompt } from "@/components/upgrade-prompt"
import { recordRequestTiming } from "@/lib/telemetry"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export default async function ReportsPage() {
  const startedAt = Date.now()
  const session = await auth.api.getSession({ headers: await headers() })
  const pro = session?.user ? await isPro(session.user.id) : false
  const rows = await getTrades()
  const closed = rows.filter((t) => t.status === "closed")

  const stats: TradeStat[] = rows.map((t) => ({
    pnl: Number(t.pnl),
    entryTime: t.entryTime,
    exitTime: t.exitTime,
    rMultiple: t.rMultiple == null ? null : Number(t.rMultiple),
    status: t.status,
  }))
  const a = analyze(stats)

  // P&L grouped by market.
  const marketMap = new Map<string, number>()
  for (const t of closed) marketMap.set(t.market, (marketMap.get(t.market) ?? 0) + Number(t.pnl))
  const byMarket: BarDatum[] = Array.from(marketMap.entries()).map(([label, value]) => ({
    label: label.charAt(0).toUpperCase() + label.slice(1),
    value: Number(value.toFixed(2)),
  }))

  // P&L grouped by weekday.
  const dayMap = new Map<number, number>()
  for (const t of closed) {
    const d = new Date(t.exitTime ?? t.entryTime).getDay()
    dayMap.set(d, (dayMap.get(d) ?? 0) + Number(t.pnl))
  }
  const byWeekday: BarDatum[] = WEEKDAYS.map((label, i) => ({ label, value: Number((dayMap.get(i) ?? 0).toFixed(2)) })).filter(
    (_, i) => i >= 1 && i <= 5,
  )

  // R-multiple distribution buckets.
  const buckets = [
    { label: "< -2R", test: (r: number) => r < -2 },
    { label: "-2 to -1R", test: (r: number) => r >= -2 && r < -1 },
    { label: "-1 to 0R", test: (r: number) => r >= -1 && r < 0 },
    { label: "0 to 1R", test: (r: number) => r >= 0 && r < 1 },
    { label: "1 to 2R", test: (r: number) => r >= 1 && r < 2 },
    { label: "> 2R", test: (r: number) => r >= 2 },
  ]
  const rValues = closed.map((t) => (t.rMultiple == null ? null : Number(t.rMultiple))).filter((r): r is number => r != null)
  const rDist: BarDatum[] = buckets.map((b) => ({ label: b.label, value: rValues.filter(b.test).length }))

  const hasData = closed.length > 0
  const crossAnalysis = computeCrossAnalysis(
    rows.map((t) => ({
      symbol: t.symbol,
      pnl: Number(t.pnl),
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      status: t.status,
    })),
  )

  const reportTrades: ReportTrade[] = rows.map((t) => ({
    symbol: t.symbol,
    market: t.market,
    side: t.side as "long" | "short",
    status: t.status as "open" | "closed",
    pnl: Number(t.pnl),
    rMultiple: t.rMultiple == null ? null : Number(t.rMultiple),
    rating: t.rating,
    mistakes: t.mistakes ?? [],
    entryTime: new Date(t.entryTime),
    exitTime: t.exitTime ? new Date(t.exitTime) : null,
  }))

  void recordRequestTiming("/reports", Date.now() - startedAt)
  return (
    <div>
      <PageHeader title="Reports" description="Deep-dive analytics across markets, timing, and risk" />
      <div className="space-y-6 p-4 sm:p-6">
        {pro ? <PeriodInsights trades={reportTrades} /> : <UpgradePrompt feature="Period insights" />}

        <h2 className="text-sm font-medium text-muted-foreground">All-time</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Net P&L" value={formatCurrency(a.netPnl)} tone={a.netPnl >= 0 ? "gain" : "loss"} />
          <StatCard label="Avg Win" value={formatCurrency(a.avgWin)} tone="gain" />
          <StatCard label="Avg Loss" value={formatCurrency(a.avgLoss)} tone="loss" />
          <StatCard label="Avg R-Multiple" value={`${a.avgRMultiple >= 0 ? "+" : ""}${a.avgRMultiple.toFixed(2)}R`} tone={a.avgRMultiple >= 0 ? "gain" : "loss"} />
        </div>

        {hasData ? (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <h2 className="mb-4 text-sm font-medium text-muted-foreground">P&L by Market</h2>
                <PnlBarChart data={byMarket} />
              </Card>
              <Card className="p-5">
                <h2 className="mb-4 text-sm font-medium text-muted-foreground">P&L by Day of Week</h2>
                <PnlBarChart data={byWeekday} />
              </Card>
            </div>
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-medium text-muted-foreground">R-Multiple Distribution</h2>
              <CountBarChart data={rDist} />
            </Card>
            {pro ? <CrossAnalysis data={crossAnalysis} /> : <UpgradePrompt feature="Cross Analysis" />}
          </>
        ) : (
          <Card className="flex h-48 items-center justify-center">
            <p className="text-sm text-muted-foreground">Log closed trades to unlock your performance reports.</p>
          </Card>
        )}
      </div>
    </div>
  )
}
