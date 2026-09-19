"use client"

import { useMemo, useState } from "react"
import { formatCurrency, formatCompact } from "@/lib/calc"
import type { DayPnl } from "@/lib/day-pnl"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ChevronLeft, ChevronRight, NotebookPen } from "lucide-react"
import { useIntlLocale, useT } from "@/components/locale-provider"

export type { DayPnl }

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// Calendar cell palette — theme-aware tokens (see globals.css): a light,
// tinted look in light mode and the solid dark-green/dark-red reference
// look in dark mode, so cells stay legible in either theme.
const CELL_GAIN_BG = "var(--cal-gain-bg)"
const CELL_GAIN_BORDER = "var(--cal-gain-border)"
const CELL_GAIN_TEXT = "var(--cal-gain-text)"
const CELL_GAIN_SUB = "var(--cal-gain-sub)"
const CELL_LOSS_BG = "var(--cal-loss-bg)"
const CELL_LOSS_BORDER = "var(--cal-loss-border)"
const CELL_LOSS_TEXT = "var(--cal-loss-text)"
const CELL_LOSS_SUB = "var(--cal-loss-sub)"
// For colored text over a plain card (no fill background) — dark green/red
// in light mode, bright green/red in dark mode so it still reads clearly.
const CELL_GAIN_LINE = "var(--cal-gain-line)"
const CELL_LOSS_LINE = "var(--cal-loss-line)"
// A traded day that nets to exactly $0 — blue, distinct from both win/loss.
const CELL_NEUTRAL_BG = "var(--cal-neutral-bg)"
const CELL_NEUTRAL_BORDER = "var(--cal-neutral-border)"
const CELL_NEUTRAL_TEXT = "var(--cal-neutral-text)"

export function PnlCalendar({ days }: { days: DayPnl[] }) {
  const t = useT()
  const dateLocale = useIntlLocale()
  const map = useMemo(() => new Map(days.map((d) => [d.date, d])), [days])

  const initial = days.length ? new Date(days[0].date + "T00:00:00") : new Date()
  const [cursor, setCursor] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1))

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: (DayPnl | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    cells.push(map.get(key) ?? { date: key, pnl: 0, trades: 0, wins: 0 })
  }
  while (cells.length % 7 !== 0) cells.push(null)

  const monthTrades = cells.filter((c): c is DayPnl => c != null && c.trades > 0)
  const monthNet = monthTrades.reduce((sum, c) => sum + c.pnl, 0)
  const greenDays = monthTrades.filter((c) => c.pnl > 0).length
  const redDays = monthTrades.filter((c) => c.pnl < 0).length
  const tradingDays = monthTrades.length

  // Group into calendar-week rows for the sidebar, matching the grid's own rows.
  const weeks: { net: number; tradingDays: number }[] = []
  for (let i = 0; i < cells.length; i += 7) {
    const row = cells.slice(i, i + 7).filter((c): c is DayPnl => c != null && c.trades > 0)
    weeks.push({ net: row.reduce((s, c) => s + c.pnl, 0), tradingDays: row.length })
  }

  const now = new Date()
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth()

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="icon" className="size-8 shrink-0" onClick={() => setCursor(new Date(year, month - 1, 1))} aria-label={t("Previous month")}>
              <ChevronLeft className="size-4" />
            </Button>
            <h2 className="shrink-0 whitespace-nowrap text-center text-base font-semibold sm:text-lg">
              {cursor.toLocaleDateString(dateLocale, { month: "long", year: "numeric" })}
            </h2>
            <Button variant="outline" size="icon" className="size-8 shrink-0" onClick={() => setCursor(new Date(year, month + 1, 1))} aria-label={t("Next month")}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            className={cn("h-8 shrink-0", isCurrentMonth && "bg-accent")}
            onClick={() => setCursor(new Date(now.getFullYear(), now.getMonth(), 1))}
          >
            {t("This month")}
          </Button>
          <div className="flex flex-wrap items-center gap-2 text-sm sm:ms-auto">
            <span className="text-muted-foreground">{t("Monthly stats:")}</span>
            <Badge
              className={cn("border-transparent", monthNet === 0 && "bg-muted text-muted-foreground")}
              style={
                monthNet > 0
                  ? { backgroundColor: CELL_GAIN_BG, color: CELL_GAIN_TEXT }
                  : monthNet < 0
                    ? { backgroundColor: CELL_LOSS_BG, color: CELL_LOSS_TEXT }
                    : undefined
              }
            >
              {monthNet >= 0 ? "+" : ""}
              {formatCompact(monthNet)}
            </Badge>
            <Badge variant="outline">
              {tradingDays === 1 ? t("1 day") : t("{n} days", { n: tradingDays })}
            </Badge>
          </div>
        </div>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          {t("{green} green · {red} red", { green: greenDays, red: redDays })}
        </p>

        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((w) => (
            <div key={w} className="pb-1 text-center text-xs font-medium text-muted-foreground">
              {t(w)}
            </div>
          ))}
          {cells.map((cell, i) => {
            if (!cell) return <div key={`empty-${i}`} />
            const day = Number(cell.date.slice(8))
            const has = cell.trades > 0
            const win = cell.pnl > 0
            const loss = cell.pnl < 0
            const winRate = has ? (cell.wins / cell.trades) * 100 : 0
            const colors = has
              ? win
                ? { bg: CELL_GAIN_BG, border: CELL_GAIN_BORDER, text: CELL_GAIN_TEXT, sub: CELL_GAIN_SUB }
                : loss
                  ? { bg: CELL_LOSS_BG, border: CELL_LOSS_BORDER, text: CELL_LOSS_TEXT, sub: CELL_LOSS_SUB }
                  : { bg: CELL_NEUTRAL_BG, border: CELL_NEUTRAL_BORDER, text: CELL_NEUTRAL_TEXT, sub: CELL_NEUTRAL_TEXT }
              : null
            return (
              <div
                key={cell.date}
                className={cn(
                  "flex min-h-20 min-w-0 flex-col justify-between overflow-hidden rounded-md border p-1.5 transition-colors sm:min-h-24",
                  !has && "border-dashed bg-muted/20",
                )}
                style={colors ? { borderColor: colors.border, backgroundColor: colors.bg } : undefined}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn("text-xs", !colors && "text-muted-foreground")}
                    style={colors ? { color: colors.text, opacity: 0.7 } : undefined}
                  >
                    {day}
                  </span>
                  {cell.hasNote && (
                    <NotebookPen
                      className={cn("size-3", !colors && "text-muted-foreground/60")}
                      style={colors ? { color: colors.text, opacity: 0.5 } : undefined}
                    />
                  )}
                </div>
                {has && colors && (
                  <div className="min-w-0 text-end">
                    <p
                      className="whitespace-nowrap text-[10px] font-semibold leading-tight tabular-nums sm:text-xs"
                      style={{ color: colors.text }}
                    >
                      {win ? "+" : ""}
                      {formatCompact(Math.round(cell.pnl))}
                    </p>
                    <p className="text-[10px] leading-tight" style={{ color: colors.text, opacity: 0.7 }}>
                      {cell.trades === 1 ? t("1 trade") : t("{n} trades", { n: cell.trades })}
                    </p>
                    <p className="whitespace-nowrap text-[10px] leading-tight font-medium" style={{ color: colors.sub }}>
                      {winRate.toFixed(0)}%
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      <div className="space-y-2">
        {weeks.map((w, i) => (
          <Card key={i} className="p-3">
            <p className="text-xs font-medium text-muted-foreground">{t("Week {n}", { n: i + 1 })}</p>
            <p
              className={cn("mt-0.5 text-lg font-semibold tabular-nums", w.tradingDays === 0 && "text-muted-foreground")}
              style={w.tradingDays === 0 ? undefined : { color: w.net >= 0 ? CELL_GAIN_LINE : CELL_LOSS_LINE }}
            >
              {w.tradingDays === 0 ? formatCurrency(0) : `${w.net >= 0 ? "+" : ""}${formatCurrency(w.net)}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {w.tradingDays === 1 ? t("1 day") : t("{n} days", { n: w.tradingDays })}
            </p>
          </Card>
        ))}
      </div>
    </div>
  )
}
