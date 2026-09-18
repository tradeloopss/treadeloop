import { formatCurrency, formatCompact } from "@/lib/calc"
import type { DayPnl } from "@/lib/day-pnl"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { NotebookPen } from "lucide-react"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// Same cell palette as the full Calendar page (see globals.css) — green/red
// win-loss, blue for a traded day that nets to exactly $0.
const CELL_GAIN_BG = "var(--cal-gain-bg)"
const CELL_GAIN_BORDER = "var(--cal-gain-border)"
const CELL_GAIN_TEXT = "var(--cal-gain-text)"
const CELL_GAIN_SUB = "var(--cal-gain-sub)"
const CELL_LOSS_BG = "var(--cal-loss-bg)"
const CELL_LOSS_BORDER = "var(--cal-loss-border)"
const CELL_LOSS_TEXT = "var(--cal-loss-text)"
const CELL_LOSS_SUB = "var(--cal-loss-sub)"
const CELL_NEUTRAL_BG = "var(--cal-neutral-bg)"
const CELL_NEUTRAL_BORDER = "var(--cal-neutral-border)"
const CELL_NEUTRAL_TEXT = "var(--cal-neutral-text)"
const CELL_GAIN_LINE = "var(--cal-gain-line)"
const CELL_LOSS_LINE = "var(--cal-loss-line)"

// Sunday-start week containing `today`, recomputed on every render — so
// this always shows whichever week is current, with no stored cursor to
// go stale.
//
// All of it in UTC on purpose: trades are keyed by their UTC day
// (lib/day-pnl.ts), so mixing local weekday maths with toISOString() put
// every cell one day out east of Greenwich — local midnight serialises to
// the previous UTC day.
function currentWeekDates(today: Date): string[] {
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - today.getUTCDay())
  return Array.from({ length: 7 }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10))
}

export function CurrentWeekCalendar({ byDay }: { byDay: Map<string, DayPnl> }) {
  const today = new Date()
  const dates = currentWeekDates(today)
  const todayKey = today.toISOString().slice(0, 10)

  const weekCells = dates.map((date) => byDay.get(date) ?? { date, pnl: 0, trades: 0, wins: 0 })
  const traded = weekCells.filter((c) => c.trades > 0)
  const weekNet = traded.reduce((sum, c) => sum + c.pnl, 0)
  const tradingDays = traded.length

  const start = new Date(dates[0] + "T00:00:00Z")
  const end = new Date(dates[6] + "T00:00:00Z")
  const rangeLabel =
    start.getUTCMonth() === end.getUTCMonth()
      ? `${start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} – ${end.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" })}`
      : `${start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`

  return (
    <Card className="flex h-full flex-col p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">This Week</h2>
          <p className="text-xs text-muted-foreground">{rangeLabel}</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Badge
            className={cn("border-transparent", weekNet === 0 && "bg-muted text-muted-foreground")}
            style={
              weekNet > 0
                ? { backgroundColor: CELL_GAIN_BG, color: CELL_GAIN_TEXT }
                : weekNet < 0
                  ? { backgroundColor: CELL_LOSS_BG, color: CELL_LOSS_TEXT }
                  : undefined
            }
          >
            {weekNet >= 0 ? "+" : ""}
            {formatCompact(weekNet)}
          </Badge>
          <Badge variant="outline">
            {tradingDays} day{tradingDays === 1 ? "" : "s"}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-1 text-center text-xs font-medium text-muted-foreground">
            {w}
          </div>
        ))}
      </div>

      <div className="grid flex-1 auto-rows-fr grid-cols-7 gap-1.5">
        {weekCells.map((cell) => {
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
                cell.date === todayKey && "ring-2 ring-primary/50",
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
                <div className="min-w-0 text-right">
                  <p
                    className="whitespace-nowrap text-[10px] font-semibold leading-tight tabular-nums sm:text-xs"
                    style={{ color: colors.text }}
                  >
                    {win ? "+" : ""}
                    {formatCompact(Math.round(cell.pnl))}
                  </p>
                  <p className="text-[10px] leading-tight" style={{ color: colors.text, opacity: 0.7 }}>
                    {cell.trades} trade{cell.trades === 1 ? "" : "s"}
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

      <div className="mt-4 border-t pt-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Daily P&L</p>
        <div className="grid grid-cols-7 gap-1.5">
          {weekCells.map((cell, i) => {
            const has = cell.trades > 0
            const win = cell.pnl > 0
            const loss = cell.pnl < 0
            const color = !has ? undefined : win ? CELL_GAIN_LINE : loss ? CELL_LOSS_LINE : CELL_NEUTRAL_TEXT
            return (
              <div key={cell.date} className="text-center">
                <p className="text-[10px] text-muted-foreground">{WEEKDAYS[i]}</p>
                <p
                  className={cn("whitespace-nowrap text-xs font-semibold tabular-nums", !has && "text-muted-foreground")}
                  style={color ? { color } : undefined}
                >
                  {has ? `${win ? "+" : ""}${formatCompact(Math.round(cell.pnl))}` : "—"}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Week net{" "}
        <span className="font-medium" style={{ color: weekNet >= 0 ? CELL_GAIN_LINE : CELL_LOSS_LINE }}>
          {weekNet >= 0 ? "+" : ""}
          {formatCurrency(weekNet)}
        </span>
      </p>
    </Card>
  )
}
