"use client"

import { useEffect, useMemo, useState } from "react"
import { formatCurrency } from "@/lib/calc"
import type { DayPnl } from "@/lib/day-pnl"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { ChevronLeft, ChevronRight, Settings, Info, NotebookPen } from "lucide-react"
import { useIntlLocale, useT } from "@/components/locale-provider"

export type { DayPnl }

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// Compact dollars for the cells and the monthly stat: "$12.7K", "-$1.16K",
// "$321".
const usdCompact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 })
const compact = (n: number) => usdCompact.format(n)

// The reference win-rate style: a whole number keeps one decimal ("50.0%"),
// otherwise two ("53.85%").
function winRateLabel(rate: number): string {
  return `${rate.toFixed(rate % 1 === 0 ? 1 : 2)}%`
}

type CalOptions = { trades: boolean; winRate: boolean }
const DEFAULT_OPTIONS: CalOptions = { trades: true, winRate: true }

export function PnlCalendar({ days }: { days: DayPnl[] }) {
  const t = useT()
  const dateLocale = useIntlLocale()
  const map = useMemo(() => new Map(days.map((d) => [d.date, d])), [days])

  const initial = days.length ? new Date(days[0].date + "T00:00:00") : new Date()
  const [cursor, setCursor] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1))

  // Which figures to show in a cell — a per-viewer convenience, remembered.
  const [options, setOptions] = useState<CalOptions>(DEFAULT_OPTIONS)
  useEffect(() => {
    try {
      const stored = localStorage.getItem("tl-cal-options")
      if (stored) setOptions({ ...DEFAULT_OPTIONS, ...JSON.parse(stored) })
    } catch {
      // ignore unavailable storage
    }
  }, [])
  function setOption(key: keyof CalOptions, value: boolean) {
    setOptions((prev) => {
      const next = { ...prev, [key]: value }
      try {
        localStorage.setItem("tl-cal-options", JSON.stringify(next))
      } catch {
        // ignore unavailable storage
      }
      return next
    })
  }

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
  const tradingDays = monthTrades.length

  // Calendar-week rows for the sidebar, matching the grid's own rows.
  const weeks: { net: number; tradingDays: number }[] = []
  for (let i = 0; i < cells.length; i += 7) {
    const row = cells.slice(i, i + 7).filter((c): c is DayPnl => c != null && c.trades > 0)
    weeks.push({ net: row.reduce((s, c) => s + c.pnl, 0), tradingDays: row.length })
  }

  const now = new Date()

  const monthPill =
    monthNet > 0
      ? { backgroundColor: "var(--cal-gain-bg)", color: "var(--cal-gain-line)" }
      : monthNet < 0
        ? { backgroundColor: "var(--cal-loss-bg)", color: "var(--cal-loss-line)" }
        : undefined

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_248px]">
      <div>
        {/* Header: month nav on the left, monthly stats and options on the right. */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b pb-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
              <button
                type="button"
                onClick={() => setCursor(new Date(year, month - 1, 1))}
                aria-label={t("Previous month")}
                className="rounded-md p-1 hover:bg-accent hover:text-foreground"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setCursor(new Date(now.getFullYear(), now.getMonth(), 1))}
                className="rounded-md px-1.5 py-0.5 text-xs font-semibold tracking-wide uppercase hover:bg-accent hover:text-foreground"
              >
                {t("Today")}
              </button>
              <button
                type="button"
                onClick={() => setCursor(new Date(year, month + 1, 1))}
                aria-label={t("Next month")}
                className="rounded-md p-1 hover:bg-accent hover:text-foreground"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {cursor.toLocaleDateString(dateLocale, { month: "long", year: "numeric" })}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:inline">{t("Monthly stats:")}</span>
            <span
              className={cn("rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums", !monthPill && "bg-muted text-muted-foreground")}
              style={monthPill}
            >
              {compact(monthNet)}
            </span>
            <span className="rounded-full bg-muted px-2.5 py-1 text-sm text-muted-foreground">
              {tradingDays === 1 ? t("1 day") : t("{n} days", { n: tradingDays })}
            </span>

            <Popover>
              <PopoverTrigger
                render={
                  <button type="button" aria-label={t("Display options")} className="rounded-md p-1.5 text-primary hover:bg-accent">
                    <Settings className="size-4" />
                  </button>
                }
              />
              <PopoverContent align="end" className="w-52 p-1">
                <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t("Show in each day")}</p>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                  <Checkbox checked={options.trades} onCheckedChange={(v) => setOption("trades", v === true)} />
                  {t("Trade count")}
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                  <Checkbox checked={options.winRate} onCheckedChange={(v) => setOption("winRate", v === true)} />
                  {t("Win rate")}
                </label>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger
                render={
                  <button type="button" aria-label={t("About this calendar")} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                    <Info className="size-4" />
                  </button>
                }
              />
              <PopoverContent align="end" className="w-64 space-y-2 p-3 text-sm">
                <p className="font-medium">{t("Daily net P&L")}</p>
                <p className="text-muted-foreground">{t("Each day shows your net profit or loss, how many trades you closed, and your win rate.")}</p>
                <div className="space-y-1.5 pt-1">
                  <Legend swatch="var(--cal-gain-bg)" border="var(--cal-gain-border)" label={t("Profit")} />
                  <Legend swatch="var(--cal-loss-bg)" border="var(--cal-loss-border)" label={t("Loss")} />
                  <Legend swatch="var(--cal-neutral-bg)" border="var(--cal-neutral-border)" label={t("Breakeven")} />
                </div>
                <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                  <NotebookPen className="size-3.5" /> {t("A note icon marks days you've journaled.")}
                </p>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {WEEKDAYS.map((w) => (
            <div key={w} className="rounded-lg border py-1.5 text-center text-xs font-semibold text-muted-foreground sm:rounded-xl sm:py-2.5 sm:text-sm">
              {t(w)}
            </div>
          ))}
          {cells.map((cell, i) => {
            if (!cell) return <div key={`empty-${i}`} className="min-h-16 rounded-lg border border-border/50 bg-muted/10 sm:min-h-28 sm:rounded-xl" />
            const day = Number(cell.date.slice(8))
            const has = cell.trades > 0
            const win = cell.pnl > 0
            const loss = cell.pnl < 0
            const winRate = has ? (cell.wins / cell.trades) * 100 : 0
            const fill = !has
              ? null
              : win
                ? { bg: "var(--cal-gain-bg)", border: "var(--cal-gain-border)" }
                : loss
                  ? { bg: "var(--cal-loss-bg)", border: "var(--cal-loss-border)" }
                  : { bg: "var(--cal-neutral-bg)", border: "var(--cal-neutral-border)" }
            return (
              <div
                key={cell.date}
                className={cn(
                  "flex min-h-16 min-w-0 flex-col justify-between overflow-hidden rounded-lg border p-1.5 transition-colors sm:min-h-28 sm:rounded-xl sm:p-2.5",
                  !has && "bg-muted/20",
                )}
                style={fill ? { backgroundColor: fill.bg, borderColor: fill.border } : undefined}
              >
                <div className="flex items-start justify-between">
                  {cell.hasNote ? <NotebookPen className="size-3 text-foreground/60 sm:size-3.5" /> : <span />}
                  <span className={cn("text-xs tabular-nums sm:text-sm", has ? "text-foreground/60" : "text-muted-foreground")}>{day}</span>
                </div>
                {has && (
                  <div className="min-w-0">
                    {/* Phones only have room for the number; the trade count and
                        win rate appear from sm up. */}
                    <p className="truncate text-[11px] font-bold tabular-nums text-foreground sm:text-lg">{compact(Math.round(cell.pnl))}</p>
                    {options.trades && (
                      <p className="hidden text-xs text-muted-foreground sm:block">{cell.trades === 1 ? t("1 trade") : t("{n} trades", { n: cell.trades })}</p>
                    )}
                    {options.winRate && <p className="hidden text-xs text-muted-foreground sm:block">{winRateLabel(winRate)}</p>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="space-y-3">
        {weeks.map((w, i) => (
          <div key={i} className="rounded-xl border p-4">
            <p className="text-sm font-medium text-indigo-500 dark:text-indigo-400">{t("Week {n}", { n: i + 1 })}</p>
            <p
              className={cn("mt-1 text-xl font-semibold tabular-nums", w.tradingDays === 0 && "text-muted-foreground")}
              style={w.tradingDays === 0 ? undefined : { color: w.net >= 0 ? "var(--cal-gain-line)" : "var(--cal-loss-line)" }}
            >
              {w.tradingDays === 0 ? formatCurrency(0) : formatCurrency(w.net)}
            </p>
            <span className="mt-2 inline-block rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {w.tradingDays === 1 ? t("1 day") : t("{n} days", { n: w.tradingDays })}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Legend({ swatch, border, label }: { swatch: string; border: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="size-3.5 rounded border" style={{ backgroundColor: swatch, borderColor: border }} />
      {label}
    </div>
  )
}
