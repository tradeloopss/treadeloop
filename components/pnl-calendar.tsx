"use client"

import type React from "react"
import { Fragment, useEffect, useMemo, useState } from "react"
import { formatCurrency, type TradingSession } from "@/lib/calc"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { ChevronDown, ChevronLeft, ChevronRight, Settings, Info, NotebookPen, SlidersHorizontal } from "lucide-react"
import { useIntlLocale, useT } from "@/components/locale-provider"

// One closed trade, trimmed to what the calendar aggregates and filters on.
export interface CalendarTrade {
  date: string // YYYY-MM-DD, the day the trade counts toward (lib/day-pnl tradeDate)
  pnl: number
  r: number | null
  rating: number | null // 1-5 execution grade
  symbol: string
  side: "long" | "short"
  session: TradingSession
  playbookId: number | null
  tags: string[]
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const SESSIONS: TradingSession[] = ["NY AM", "London", "NY PM", "Asia"]

type Metric = "pnl" | "r" | "winRate" | "trades" | "execution"
const METRICS: { id: Metric; label: string }[] = [
  { id: "pnl", label: "P&L" },
  { id: "r", label: "R" },
  { id: "winRate", label: "Win Rate" },
  { id: "trades", label: "Trades" },
  { id: "execution", label: "Execution" },
]

// Compact dollars for the cells and the monthly stat: "$12.7K", "-$1.16K",
// "$321". The minimum is spelled out because Node and browsers disagree on
// the default ("$876.0" vs "$876"), which breaks hydration.
const usdCompact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 })
const compact = (n: number) => usdCompact.format(Math.round(n))
const rSigned = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, signDisplay: "exceptZero" })

// The reference win-rate style: a whole number keeps one decimal ("50.0%"),
// otherwise two ("53.85%").
function winRateLabel(rate: number): string {
  return `${rate.toFixed(rate % 1 === 0 ? 1 : 2)}%`
}

type CalOptions = { trades: boolean; winRate: boolean }
const DEFAULT_OPTIONS: CalOptions = { trades: true, winRate: true }

type Tone = "gain" | "loss" | "neutral"

// Running totals for any span of trades — a day, a week row, the month.
interface Agg {
  pnl: number
  trades: number
  wins: number
  rSum: number
  rCount: number
  ratingSum: number
  ratingCount: number
  grossProfit: number
  grossLoss: number
}

function emptyAgg(): Agg {
  return { pnl: 0, trades: 0, wins: 0, rSum: 0, rCount: 0, ratingSum: 0, ratingCount: 0, grossProfit: 0, grossLoss: 0 }
}

function addTrade(a: Agg, t: CalendarTrade) {
  a.pnl += t.pnl
  a.trades += 1
  if (t.pnl > 0) {
    a.wins += 1
    a.grossProfit += t.pnl
  } else if (t.pnl < 0) {
    a.grossLoss -= t.pnl
  }
  if (t.r != null) {
    a.rSum += t.r
    a.rCount += 1
  }
  if (t.rating != null) {
    a.ratingSum += t.rating
    a.ratingCount += 1
  }
}

function mergeAgg(into: Agg, from: Agg) {
  for (const k of Object.keys(into) as (keyof Agg)[]) into[k] += from[k]
}

const signTone = (n: number): Tone => (n > 0 ? "gain" : n < 0 ? "loss" : "neutral")
const winRate = (a: Agg) => (a.trades ? (a.wins / a.trades) * 100 : 0)

// The headline figure for a span under the selected metric, and the colour it
// earns. Spans with no trades return null and render empty.
function metricValue(a: Agg, metric: Metric): { text: string; tone: Tone } | null {
  if (a.trades === 0) return null
  switch (metric) {
    case "pnl":
      return { text: compact(a.pnl), tone: signTone(a.pnl) }
    case "r":
      return a.rCount ? { text: `${rSigned.format(a.rSum)}R`, tone: signTone(a.rSum) } : { text: "—", tone: "neutral" }
    case "winRate": {
      const rate = winRate(a)
      return { text: winRateLabel(rate), tone: rate > 50 ? "gain" : rate < 50 ? "loss" : "neutral" }
    }
    case "trades":
      return { text: String(a.trades), tone: signTone(a.pnl) }
    case "execution": {
      if (!a.ratingCount) return { text: "—", tone: "neutral" }
      const avg = a.ratingSum / a.ratingCount
      return { text: `${avg.toFixed(1)}/5`, tone: avg >= 3.5 ? "gain" : avg < 2.5 ? "loss" : "neutral" }
    }
  }
}

const TONE_FILL: Record<Tone, { bg: string; border: string }> = {
  gain: { bg: "var(--cal-gain-bg)", border: "var(--cal-gain-border)" },
  loss: { bg: "var(--cal-loss-bg)", border: "var(--cal-loss-border)" },
  neutral: { bg: "var(--cal-neutral-bg)", border: "var(--cal-neutral-border)" },
}

type FilterKey = "side" | "session" | "symbol" | "playbook" | "tag"
type Filters = Record<FilterKey, string[]>
const NO_FILTERS: Filters = { side: [], session: [], symbol: [], playbook: [], tag: [] }

function matches(t: CalendarTrade, f: Filters): boolean {
  if (f.side.length && !f.side.includes(t.side)) return false
  if (f.session.length && !f.session.includes(t.session)) return false
  if (f.symbol.length && !f.symbol.includes(t.symbol)) return false
  if (f.playbook.length && (t.playbookId == null || !f.playbook.includes(String(t.playbookId)))) return false
  if (f.tag.length && !t.tags.some((tag) => f.tag.includes(tag))) return false
  return true
}

// Distinct values, most-traded first.
function byFrequency(values: string[]): string[] {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v)
}

// Reads a remembered per-viewer choice; storage can be missing or blocked.
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore unavailable storage
  }
}

export function PnlCalendar({
  trades,
  noteDates,
  playbooks,
}: {
  trades: CalendarTrade[]
  noteDates: string[]
  playbooks: { id: number; name: string }[]
}) {
  const t = useT()
  const dateLocale = useIntlLocale()

  const latest = useMemo(() => trades.reduce<string | null>((max, tr) => (max == null || tr.date > max ? tr.date : max), null), [trades])
  const [cursor, setCursor] = useState(() => {
    const d = latest ? new Date(latest + "T00:00:00") : new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  // Which figures to show in a cell, and which metric leads — per-viewer
  // conveniences, remembered.
  const [options, setOptions] = useState<CalOptions>(DEFAULT_OPTIONS)
  const [metric, setMetricState] = useState<Metric>("pnl")
  useEffect(() => {
    const storedOptions = readStored("tl-cal-options")
    if (storedOptions) {
      try {
        setOptions({ ...DEFAULT_OPTIONS, ...JSON.parse(storedOptions) })
      } catch {
        // ignore a malformed value
      }
    }
    const storedMetric = readStored("tl-cal-metric")
    if (storedMetric && METRICS.some((m) => m.id === storedMetric)) setMetricState(storedMetric as Metric)
  }, [])
  function setOption(key: keyof CalOptions, value: boolean) {
    setOptions((prev) => {
      const next = { ...prev, [key]: value }
      writeStored("tl-cal-options", JSON.stringify(next))
      return next
    })
  }
  function setMetric(next: Metric) {
    setMetricState(next)
    writeStored("tl-cal-metric", next)
  }

  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  function toggleFilter(key: FilterKey, value: string) {
    setFilters((prev) => ({ ...prev, [key]: prev[key].includes(value) ? prev[key].filter((v) => v !== value) : [...prev[key], value] }))
  }
  const activeFilterCount = (Object.keys(filters) as FilterKey[]).filter((k) => filters[k].length > 0).length

  const filterOptions = useMemo(() => {
    const usedPlaybooks = new Set(trades.map((tr) => tr.playbookId).filter((id): id is number => id != null))
    return {
      symbols: byFrequency(trades.map((tr) => tr.symbol)),
      tags: byFrequency(trades.flatMap((tr) => tr.tags)),
      playbooks: playbooks.filter((p) => usedPlaybooks.has(p.id)),
    }
  }, [trades, playbooks])

  const byDay = useMemo(() => {
    const map = new Map<string, Agg>()
    for (const tr of trades) {
      if (!matches(tr, filters)) continue
      let agg = map.get(tr.date)
      if (!agg) map.set(tr.date, (agg = emptyAgg()))
      addTrade(agg, tr)
    }
    return map
  }, [trades, filters])

  const noted = useMemo(() => new Set(noteDates), [noteDates])

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: ({ date: string; day: number; agg: Agg } | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    cells.push({ date, day: d, agg: byDay.get(date) ?? emptyAgg() })
  }
  while (cells.length % 7 !== 0) cells.push(null)

  // Calendar-week rows, each with its own totals for the week column.
  const weeks: { cells: typeof cells; agg: Agg; tradingDays: number }[] = []
  for (let i = 0; i < cells.length; i += 7) {
    const row = cells.slice(i, i + 7)
    const agg = emptyAgg()
    for (const c of row) if (c) mergeAgg(agg, c.agg)
    weeks.push({ cells: row, agg, tradingDays: row.filter((c) => c != null && c.agg.trades > 0).length })
  }

  const monthAgg = emptyAgg()
  for (const w of weeks) mergeAgg(monthAgg, w.agg)
  const tradedDays = cells.filter((c): c is NonNullable<typeof c> => c != null && c.agg.trades > 0)
  const best = tradedDays.reduce<(typeof tradedDays)[number] | null>((b, c) => (b == null || c.agg.pnl > b.agg.pnl ? c : b), null)
  const worst = tradedDays.reduce<(typeof tradedDays)[number] | null>((w, c) => (w == null || c.agg.pnl < w.agg.pnl ? c : w), null)
  const winningDays = tradedDays.filter((c) => c.agg.pnl > 0).length
  const profitFactor = monthAgg.grossLoss > 0 ? (monthAgg.grossProfit / monthAgg.grossLoss).toFixed(2) : monthAgg.grossProfit > 0 ? "∞" : "—"

  const now = new Date()
  const shortDate = (date: string) => new Date(date + "T00:00:00").toLocaleDateString(dateLocale, { month: "short", day: "numeric" })
  const tradesLabel = (n: number) => (n === 1 ? t("1 trade") : t("{n} trades", { n }))
  const daysLabel = (n: number) => (n === 1 ? t("1 day") : t("{n} days", { n }))

  const monthPill =
    monthAgg.pnl > 0
      ? { backgroundColor: "var(--cal-gain-bg)", color: "var(--cal-gain-line)" }
      : monthAgg.pnl < 0
        ? { backgroundColor: "var(--cal-loss-bg)", color: "var(--cal-loss-line)" }
        : undefined

  // The small lines under a day's headline. The display options pick trade
  // count and win rate; whichever of those the headline already shows gives
  // way to the day's P&L, and R/execution days lead with the P&L too.
  function detailLines(a: Agg): string[] {
    const out: string[] = []
    if (metric === "r" || metric === "execution") out.push(compact(a.pnl))
    if (options.trades) out.push(metric === "trades" ? compact(a.pnl) : tradesLabel(a.trades))
    if (options.winRate) out.push(metric === "winRate" ? compact(a.pnl) : winRateLabel(winRate(a)))
    return out
  }

  return (
    <div>
      {/* Header: month nav on the left, monthly stats and options on the right. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b pb-4">
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

        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden text-sm text-muted-foreground sm:inline">{t("Monthly stats:")}</span>
          <span
            className={cn("rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums", !monthPill && "bg-muted text-muted-foreground")}
            style={monthPill}
          >
            {compact(monthAgg.pnl)}
          </span>
          <span className="rounded-full bg-muted px-2.5 py-1 text-sm text-muted-foreground tabular-nums">{tradesLabel(monthAgg.trades)}</span>
          <span className="rounded-full bg-muted px-2.5 py-1 text-sm text-muted-foreground tabular-nums">
            {t("{rate} win rate", { rate: monthAgg.trades ? `${winRate(monthAgg).toFixed(1)}%` : "—" })}
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

      {/* Which figure leads each day, and the trade filters. */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <div role="tablist" aria-label={t("Calendar metric")} className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-lg border p-1 [scrollbar-width:none]">
          {METRICS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={metric === m.id}
              onClick={() => setMetric(m.id)}
              className={cn(
                "shrink-0 rounded-md px-2 py-1 text-xs font-semibold whitespace-nowrap transition-colors sm:px-2.5",
                metric === m.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(m.label)}
            </button>
          ))}
        </div>

        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label={t("Filters")}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3",
                  activeFilterCount > 0 ? "border-primary/40 bg-primary/10 text-primary" : "bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                <SlidersHorizontal className="size-4 sm:hidden" />
                <ChevronDown className="hidden size-4 sm:block" />
                <span className="hidden sm:inline">{t("Filters")}</span>
                {activeFilterCount > 0 && (
                  <span className="rounded bg-primary px-1.5 text-xs text-primary-foreground tabular-nums">{activeFilterCount}</span>
                )}
              </button>
            }
          />
          <PopoverContent align="end" className="max-h-[70vh] w-80 space-y-4 overflow-y-auto p-4">
            <FilterGroup label={t("Side")}>
              {(["long", "short"] as const).map((s) => (
                <FilterChip key={s} active={filters.side.includes(s)} onClick={() => toggleFilter("side", s)}>
                  {t(s === "long" ? "Long" : "Short")}
                </FilterChip>
              ))}
            </FilterGroup>
            <FilterGroup label={t("Session")}>
              {SESSIONS.map((s) => (
                <FilterChip key={s} active={filters.session.includes(s)} onClick={() => toggleFilter("session", s)}>
                  {t(s)}
                </FilterChip>
              ))}
            </FilterGroup>
            {filterOptions.symbols.length > 0 && (
              <FilterGroup label={t("Symbol")}>
                {filterOptions.symbols.map((s) => (
                  <FilterChip key={s} active={filters.symbol.includes(s)} onClick={() => toggleFilter("symbol", s)}>
                    {s}
                  </FilterChip>
                ))}
              </FilterGroup>
            )}
            {filterOptions.playbooks.length > 0 && (
              <FilterGroup label={t("Playbook")}>
                {filterOptions.playbooks.map((p) => (
                  <FilterChip key={p.id} active={filters.playbook.includes(String(p.id))} onClick={() => toggleFilter("playbook", String(p.id))}>
                    {p.name}
                  </FilterChip>
                ))}
              </FilterGroup>
            )}
            {filterOptions.tags.length > 0 && (
              <FilterGroup label={t("Tags")}>
                {filterOptions.tags.map((tag) => (
                  <FilterChip key={tag} active={filters.tag.includes(tag)} onClick={() => toggleFilter("tag", tag)}>
                    {tag}
                  </FilterChip>
                ))}
              </FilterGroup>
            )}
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={() => setFilters(NO_FILTERS)}
                className="w-full rounded-md border py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {t("Clear filters")}
              </button>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* Days, with each week's total beside its row on wide screens. */}
      <div className="grid grid-cols-7 gap-1 sm:gap-2 lg:grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.5fr)]">
        {WEEKDAYS.map((w) => (
          <div key={w} className="rounded-lg border py-1.5 text-center text-xs font-semibold text-muted-foreground sm:rounded-xl sm:py-2.5 sm:text-sm">
            {t(w)}
          </div>
        ))}
        <div className="hidden rounded-xl border py-2.5 text-center text-sm font-semibold text-muted-foreground lg:block">{t("Week")}</div>

        {weeks.map((week, wi) => (
          <Fragment key={wi}>
            {week.cells.map((cell, ci) => {
              if (!cell) return <div key={`empty-${wi}-${ci}`} className="min-h-28 rounded-lg border border-border bg-muted/30 sm:rounded-xl" />
              const value = metricValue(cell.agg, metric)
              const fill = value ? TONE_FILL[value.tone] : null
              return (
                <div
                  key={cell.date}
                  className={cn(
                    "flex min-h-28 min-w-0 flex-col justify-between overflow-hidden rounded-lg border p-1 transition-colors sm:rounded-xl sm:p-2.5",
                    !value && "border-border bg-muted/30",
                  )}
                  style={fill ? { backgroundColor: fill.bg, borderColor: fill.border } : undefined}
                >
                  <div className="flex items-start justify-between">
                    {noted.has(cell.date) ? <NotebookPen className="size-3 text-foreground/70 sm:size-3.5" /> : <span />}
                    <span className={cn("text-xs font-medium tabular-nums sm:text-sm", value ? "text-foreground/80" : "text-muted-foreground")}>{cell.day}</span>
                  </div>
                  {value && (
                    <div className="min-w-0 space-y-0.5">
                      <p className="truncate text-[11px] font-bold leading-tight tabular-nums text-foreground sm:text-lg">{value.text}</p>
                      {detailLines(cell.agg).map((line, i) => (
                        <p key={i} className="truncate text-[9px] leading-tight text-foreground/70 sm:text-xs">
                          {line}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            <WeekCard index={wi + 1} agg={week.agg} tradingDays={week.tradingDays} metric={metric} daysLabel={daysLabel} inGrid />
          </Fragment>
        ))}
      </div>

      {/* Narrower screens have no room for the week column — weeks go underneath. */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:hidden">
        {weeks.map((week, wi) => (
          <WeekCard key={wi} index={wi + 1} agg={week.agg} tradingDays={week.tradingDays} metric={metric} daysLabel={daysLabel} />
        ))}
      </div>

      {/* The month at a glance. */}
      <p className="mt-6 mb-3 text-sm font-semibold">{t("Monthly insights")}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Insight label={t("Best day")} value={best ? formatCurrency(best.agg.pnl) : "—"} tone={best ? signTone(best.agg.pnl) : undefined} sub={best ? shortDate(best.date) : undefined} />
        <Insight label={t("Worst day")} value={worst ? formatCurrency(worst.agg.pnl) : "—"} tone={worst ? signTone(worst.agg.pnl) : undefined} sub={worst ? shortDate(worst.date) : undefined} />
        <Insight label={t("Avg trade")} value={monthAgg.trades ? formatCurrency(monthAgg.pnl / monthAgg.trades) : "—"} tone={monthAgg.trades ? signTone(monthAgg.pnl) : undefined} />
        <Insight label={t("Profit factor")} value={profitFactor} />
        <Insight label={t("Winning days")} value={tradedDays.length ? `${winningDays}/${tradedDays.length}` : "—"} />
      </div>
    </div>
  )
}

function WeekCard({
  index,
  agg,
  tradingDays,
  metric,
  daysLabel,
  inGrid,
}: {
  index: number
  agg: Agg
  tradingDays: number
  metric: Metric
  daysLabel: (n: number) => string
  // In the grid's week column (wide screens only), where it sits in a
  // narrower slot than the cards listed under the calendar.
  inGrid?: boolean
}) {
  const t = useT()
  const value = metricValue(agg, metric)
  const text = metric === "pnl" ? formatCurrency(agg.pnl) : value ? value.text : "—"
  return (
    <div className={cn("min-w-0 rounded-xl border p-4", inGrid && "hidden min-h-28 lg:block lg:p-3 xl:p-4")}>
      <p className="text-sm font-medium text-indigo-500 dark:text-indigo-400">{t("Week {n}", { n: index })}</p>
      <p
        className={cn("mt-1 truncate font-semibold tabular-nums", inGrid ? "text-lg xl:text-xl" : "text-xl", !value && "text-muted-foreground")}
        style={value ? { color: `var(--cal-${value.tone}-line)` } : undefined}
      >
        {text}
      </p>
      <span className="mt-2 inline-block rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{daysLabel(tradingDays)}</span>
    </div>
  )
}

function Insight({ label, value, tone, sub }: { label: string; value: string; tone?: Tone; sub?: string }) {
  return (
    <div className="min-w-0 rounded-xl border p-4">
      <p className="truncate text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold tabular-nums" style={tone ? { color: `var(--cal-${tone}-line)` } : undefined}>
        {value}
      </p>
      {sub && <span className="mt-2 inline-block rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{sub}</span>}
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

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "max-w-full truncate rounded-md border px-2 py-1 text-xs font-medium transition-colors",
        active ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}
