"use client"

import { useMemo, useState } from "react"
import { analyze, formatCurrency, type TradeStat } from "@/lib/calc"
import { generateFindings, type InsightTrade } from "@/lib/insights"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Minus, Sparkles } from "lucide-react"

export type ReportTrade = {
  symbol: string
  market: string
  side: "long" | "short"
  status: "open" | "closed"
  pnl: number
  rMultiple: number | null
  rating: number | null
  mistakes: string[]
  entryTime: Date
  exitTime: Date | null
}

type Period = "week" | "month"

function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  out.setDate(out.getDate() - out.getDay())
  return out
}

function periodRange(period: Period, cursor: Date): { start: Date; end: Date; label: string } {
  if (period === "week") {
    const start = startOfWeek(cursor)
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    const endInclusive = new Date(end)
    endInclusive.setDate(endInclusive.getDate() - 1)
    const label =
      start.getMonth() === endInclusive.getMonth()
        ? `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${endInclusive.toLocaleDateString("en-US", { day: "numeric", year: "numeric" })}`
        : `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${endInclusive.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    return { start, end, label }
  }
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  return { start, end, label: start.toLocaleDateString("en-US", { month: "long", year: "numeric" }) }
}

function shiftCursor(period: Period, cursor: Date, dir: 1 | -1): Date {
  if (period === "week") {
    const next = new Date(cursor)
    next.setDate(next.getDate() + dir * 7)
    return next
  }
  return new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1)
}

const findingIcon = { strength: TrendingUp, weakness: TrendingDown, neutral: Minus }
const findingClass = {
  strength: "border-[var(--gain)]/30 bg-[var(--gain)]/10 text-[var(--gain)]",
  weakness: "border-[var(--loss)]/30 bg-[var(--loss)]/10 text-[var(--loss)]",
  neutral: "border-border bg-muted/40 text-muted-foreground",
}

export function PeriodInsights({ trades }: { trades: ReportTrade[] }) {
  const [period, setPeriod] = useState<Period>("week")
  const [cursor, setCursor] = useState(() => new Date())

  const { start, end, label } = periodRange(period, cursor)

  const periodTrades = useMemo(
    () => trades.filter((t) => (t.exitTime ?? t.entryTime) >= start && (t.exitTime ?? t.entryTime) < end),
    [trades, start.getTime(), end.getTime()]
  )

  const stats = useMemo(() => {
    const asStats: TradeStat[] = periodTrades.map((t) => ({
      pnl: t.pnl,
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      rMultiple: t.rMultiple,
      status: t.status,
    }))
    return analyze(asStats)
  }, [periodTrades])

  const findings = useMemo(() => {
    const asInsightTrades: InsightTrade[] = periodTrades.map((t) => ({
      symbol: t.symbol,
      side: t.side,
      pnl: t.pnl,
      mistakes: t.mistakes,
      rating: t.rating,
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      status: t.status,
    }))
    return generateFindings(asInsightTrades)
  }, [periodTrades])

  const isCurrentPeriod = (() => {
    const now = new Date()
    return now >= start && now < end
  })()

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Select value={period} onValueChange={(v) => v && setPeriod(v as Period)}>
          <SelectTrigger className="w-24 shrink-0 sm:w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="week">Week</SelectItem>
            <SelectItem value="month">Month</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="icon" className="size-8 shrink-0" onClick={() => setCursor((c) => shiftCursor(period, c, -1))} aria-label="Previous period">
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="shrink-0 whitespace-nowrap text-center text-sm font-semibold sm:text-base">{label}</h2>
          <Button variant="outline" size="icon" className="size-8 shrink-0" onClick={() => setCursor((c) => shiftCursor(period, c, 1))} aria-label="Next period">
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-8 shrink-0", isCurrentPeriod && "bg-accent")}
          onClick={() => setCursor(new Date())}
        >
          This {period}
        </Button>
        <p className="w-full text-sm text-muted-foreground sm:ml-auto sm:w-auto">
          {stats.totalTrades} trade{stats.totalTrades === 1 ? "" : "s"} ·{" "}
          <span className={cn("font-medium", stats.netPnl >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")}>
            {stats.netPnl >= 0 ? "+" : ""}
            {formatCurrency(stats.netPnl)}
          </span>{" "}
          · {stats.winRate.toFixed(0)}% win rate
        </p>
      </div>

      {periodTrades.filter((t) => t.status === "closed").length < 3 ? (
        <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-center">
          <Sparkles className="size-6 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            Log at least 3 closed trades in this {period} to unlock pattern analysis.
          </p>
        </div>
      ) : findings.length === 0 ? (
        <div className="flex h-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-center">
          <p className="text-sm text-muted-foreground">No strong patterns found this {period} — trading looks consistent.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {findings.map((f, i) => {
            const Icon = findingIcon[f.type]
            return (
              <div key={i} className={cn("flex items-start gap-3 rounded-md border p-3", findingClass[f.type])}>
                <Icon className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">{f.title}</p>
                  <p className="text-sm text-muted-foreground">{f.detail}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
