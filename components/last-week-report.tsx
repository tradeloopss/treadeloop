import { analyze, formatCurrency, type TradeStat } from "@/lib/calc"
import { generateFindings, type InsightTrade } from "@/lib/insights"
import type { ReportTrade } from "@/components/period-insights"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown, Minus, BarChart3 } from "lucide-react"

function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  out.setDate(out.getDate() - out.getDay())
  return out
}

const findingIcon = { strength: TrendingUp, weakness: TrendingDown, neutral: Minus }
const findingClass = {
  strength: "border-[var(--gain)]/30 bg-[var(--gain)]/10 text-[var(--gain)]",
  weakness: "border-[var(--loss)]/30 bg-[var(--loss)]/10 text-[var(--loss)]",
  neutral: "border-border bg-muted/40 text-muted-foreground",
}

export function LastWeekReport({ trades }: { trades: ReportTrade[] }) {
  const thisWeekStart = startOfWeek(new Date())
  const lastWeekStart = new Date(thisWeekStart)
  lastWeekStart.setDate(lastWeekStart.getDate() - 7)
  const lastWeekEndInclusive = new Date(thisWeekStart)
  lastWeekEndInclusive.setDate(lastWeekEndInclusive.getDate() - 1)

  const rangeLabel =
    lastWeekStart.getMonth() === lastWeekEndInclusive.getMonth()
      ? `${lastWeekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${lastWeekEndInclusive.toLocaleDateString("en-US", { day: "numeric" })}`
      : `${lastWeekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${lastWeekEndInclusive.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`

  const periodTrades = trades.filter((t) => {
    const d = t.exitTime ?? t.entryTime
    return d >= lastWeekStart && d < thisWeekStart
  })

  // Best/worst calendar day within the week, for a quick "which day made or
  // cost you the most" callout alongside the trade-level stats.
  const byDay = new Map<string, number>()
  for (const t of periodTrades) {
    if (t.status !== "closed") continue
    const key = (t.exitTime ?? t.entryTime).toISOString().slice(0, 10)
    byDay.set(key, (byDay.get(key) ?? 0) + t.pnl)
  }
  const dayEntries = Array.from(byDay.entries())
  const bestDay = dayEntries.length ? dayEntries.reduce((a, b) => (b[1] > a[1] ? b : a)) : null
  const worstDay = dayEntries.length ? dayEntries.reduce((a, b) => (b[1] < a[1] ? b : a)) : null
  const formatDayLabel = (key: string) => new Date(key + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })

  const stats = analyze(
    periodTrades.map((t): TradeStat => ({
      pnl: t.pnl,
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      rMultiple: t.rMultiple,
      status: t.status,
    })),
  )

  const findings = generateFindings(
    periodTrades.map(
      (t): InsightTrade => ({
        symbol: t.symbol,
        side: t.side,
        pnl: t.pnl,
        mistakes: t.mistakes,
        rating: t.rating,
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        status: t.status,
      }),
    ),
  ).slice(0, 3)

  return (
    <Card className="h-full p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Last Week's Report</h2>
        <span className="text-xs text-muted-foreground">{rangeLabel}</span>
      </div>

      {periodTrades.length === 0 ? (
        <div className="flex h-24 flex-col items-center justify-center gap-1.5 text-center">
          <BarChart3 className="size-5 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No trades logged last week.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 text-center sm:grid-cols-6">
            <div>
              <p className="text-xs text-muted-foreground">Trades</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums">{stats.totalTrades}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Net P&L</p>
              <p
                className={cn(
                  "mt-0.5 text-lg font-semibold tabular-nums",
                  stats.netPnl > 0 ? "text-[var(--gain)]" : stats.netPnl < 0 ? "text-[var(--loss)]" : "",
                )}
              >
                {stats.netPnl >= 0 ? "+" : ""}
                {formatCurrency(stats.netPnl)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Win Rate</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums">{stats.winRate.toFixed(0)}%</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Profit Factor</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums">
                {Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : "∞"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Avg Win</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--gain)]">{formatCurrency(stats.avgWin)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Avg Loss</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--loss)]">{formatCurrency(stats.avgLoss)}</p>
            </div>
          </div>

          {(bestDay || worstDay) && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {bestDay && (
                <div className="rounded-md border border-[var(--gain)]/30 bg-[var(--gain)]/10 p-2.5">
                  <p className="text-xs text-muted-foreground">Best day</p>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{formatDayLabel(bestDay[0])}</span>
                    <span className="text-sm font-semibold tabular-nums text-[var(--gain)]">
                      +{formatCurrency(bestDay[1])}
                    </span>
                  </div>
                </div>
              )}
              {worstDay && (
                <div className="rounded-md border border-[var(--loss)]/30 bg-[var(--loss)]/10 p-2.5">
                  <p className="text-xs text-muted-foreground">Worst day</p>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{formatDayLabel(worstDay[0])}</span>
                    <span className="text-sm font-semibold tabular-nums text-[var(--loss)]">
                      {formatCurrency(worstDay[1])}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {findings.length > 0 && (
            <div className="mt-4 space-y-2">
              {findings.map((f, i) => {
                const Icon = findingIcon[f.type]
                return (
                  <div key={i} className={cn("flex items-start gap-2 rounded-md border p-2.5 text-sm", findingClass[f.type])}>
                    <Icon className="mt-0.5 size-4 shrink-0" />
                    <div>
                      <p className="font-medium">{f.title}</p>
                      <p className="text-xs opacity-90">{f.detail}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </Card>
  )
}
