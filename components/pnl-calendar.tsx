"use client"

import type React from "react"
import { Fragment, useEffect, useMemo, useState } from "react"
import type { TradingSession } from "@/lib/calc"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ChevronDown, ChevronLeft, ChevronRight, NotebookPen, SlidersHorizontal } from "lucide-react"
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

// Compact signed dollars for cells and totals: "+$876", "-$1.2K", "$0".
const usdSigned = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1, signDisplay: "exceptZero" })
const money = (n: number) => usdSigned.format(Math.round(n))
// Phone-width day cells have no room for the "$": "+567", "-1.2K".
const numSigned = new Intl.NumberFormat("en-US", { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1, signDisplay: "exceptZero" })
const rSigned = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, signDisplay: "exceptZero" })

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
// earns (`short` is a narrower form for phone-width cells). Spans with no
// trades return null and render muted.
function metricValue(a: Agg, metric: Metric): { text: string; short?: string; tone: Tone } | null {
  if (a.trades === 0) return null
  switch (metric) {
    case "pnl":
      return { text: money(a.pnl), short: numSigned.format(Math.round(a.pnl)), tone: signTone(a.pnl) }
    case "r":
      return a.rCount ? { text: `${rSigned.format(a.rSum)}R`, tone: signTone(a.rSum) } : { text: "—", tone: "neutral" }
    case "winRate": {
      const rate = winRate(a)
      return { text: `${Math.round(rate)}%`, tone: rate > 50 ? "gain" : rate < 50 ? "loss" : "neutral" }
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

  // The selected metric is a per-viewer convenience, remembered across visits.
  const [metric, setMetricState] = useState<Metric>("pnl")
  useEffect(() => {
    try {
      const stored = localStorage.getItem("tl-cal-metric")
      if (stored && METRICS.some((m) => m.id === stored)) setMetricState(stored as Metric)
    } catch {
      // ignore unavailable storage
    }
  }, [])
  function setMetric(next: Metric) {
    setMetricState(next)
    try {
      localStorage.setItem("tl-cal-metric", next)
    } catch {
      // ignore unavailable storage
    }
  }

  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  function toggleFilter(key: FilterKey, value: string) {
    setFilters((prev) => ({ ...prev, [key]: prev[key].includes(value) ? prev[key].filter((v) => v !== value) : [...prev[key], value] }))
  }
  const activeFilterCount = (Object.keys(filters) as FilterKey[]).filter((k) => filters[k].length > 0).length

  const options = useMemo(() => {
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

  const weeks: { cells: typeof cells; agg: Agg }[] = []
  for (let i = 0; i < cells.length; i += 7) {
    const row = cells.slice(i, i + 7)
    const agg = emptyAgg()
    for (const c of row) if (c) mergeAgg(agg, c.agg)
    weeks.push({ cells: row, agg })
  }

  const monthAgg = emptyAgg()
  for (const w of weeks) mergeAgg(monthAgg, w.agg)
  const tradedDays = cells.filter((c): c is NonNullable<typeof c> => c != null && c.agg.trades > 0)
  const best = tradedDays.reduce<(typeof tradedDays)[number] | null>((b, c) => (b == null || c.agg.pnl > b.agg.pnl ? c : b), null)
  const worst = tradedDays.reduce<(typeof tradedDays)[number] | null>((w, c) => (w == null || c.agg.pnl < w.agg.pnl ? c : w), null)
  const winningDays = tradedDays.filter((c) => c.agg.pnl > 0).length
  const profitFactor = monthAgg.grossLoss > 0 ? (monthAgg.grossProfit / monthAgg.grossLoss).toFixed(2) : monthAgg.grossProfit > 0 ? "∞" : "—"

  const now = new Date()
  // Read after mount: the server renders in UTC and may be on a different day
  // than the viewer.
  const [todayKey, setTodayKey] = useState<string | null>(null)
  useEffect(() => {
    const d = new Date()
    setTodayKey(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`)
  }, [])
  const shortDate = (date: string) => new Date(date + "T00:00:00").toLocaleDateString(dateLocale, { month: "short", day: "numeric" })
  const tradesShort = (n: number) => t("{n}T", { n })

  // The two small figures under a day's headline — whichever of P&L, trade
  // count and win rate the headline isn't already showing.
  function secondary(a: Agg): string[] {
    const pnl = money(a.pnl)
    const count = tradesShort(a.trades)
    const rate = `${Math.round(winRate(a))}%`
    if (metric === "pnl") return [count, rate]
    if (metric === "trades") return [pnl, rate]
    return [pnl, count]
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {/* Month, navigation and the month's headline numbers. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b px-3 py-3 sm:px-5 sm:py-4">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-0.5 text-muted-foreground">
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
              onClick={() => setCursor(new Date(year, month + 1, 1))}
              aria-label={t("Next month")}
              className="rounded-md p-1 hover:bg-accent hover:text-foreground"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
          <h2 className="text-lg font-semibold tracking-tight sm:text-2xl">
            {cursor.toLocaleDateString(dateLocale, { month: "long", year: "numeric" })}
          </h2>
          <button
            type="button"
            onClick={() => setCursor(new Date(now.getFullYear(), now.getMonth(), 1))}
            className="rounded-md border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {t("Today")}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span
            className={cn("rounded-full px-3 py-1 font-semibold tabular-nums", monthAgg.trades === 0 && "bg-muted text-muted-foreground")}
            style={monthAgg.trades === 0 ? undefined : toneStyle(signTone(monthAgg.pnl), "pill")}
          >
            {money(monthAgg.pnl)}
          </span>
          <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground tabular-nums">
            {monthAgg.trades === 1 ? t("1 trade") : t("{n} trades", { n: monthAgg.trades })}
          </span>
          <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground tabular-nums">
            {t("{rate} win rate", { rate: monthAgg.trades ? `${winRate(monthAgg).toFixed(1)}%` : "—" })}
          </span>
        </div>
      </div>

      {/* Which figure the days show, and the trade filters. */}
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2 sm:px-5">
        <div role="tablist" aria-label={t("Calendar metric")} className="-mx-1 flex min-w-0 items-center gap-0.5 overflow-x-auto px-1 [scrollbar-width:none]">
          {METRICS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={metric === m.id}
              onClick={() => setMetric(m.id)}
              className={cn(
                "shrink-0 rounded-md px-2 py-1.5 text-xs font-medium whitespace-nowrap transition-colors sm:px-2.5 sm:text-sm",
                metric === m.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
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
                  "flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-sm font-medium transition-colors sm:px-2.5",
                  activeFilterCount > 0 ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
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
            {options.symbols.length > 0 && (
              <FilterGroup label={t("Symbol")}>
                {options.symbols.map((s) => (
                  <FilterChip key={s} active={filters.symbol.includes(s)} onClick={() => toggleFilter("symbol", s)}>
                    {s}
                  </FilterChip>
                ))}
              </FilterGroup>
            )}
            {options.playbooks.length > 0 && (
              <FilterGroup label={t("Playbook")}>
                {options.playbooks.map((p) => (
                  <FilterChip key={p.id} active={filters.playbook.includes(String(p.id))} onClick={() => toggleFilter("playbook", String(p.id))}>
                    {p.name}
                  </FilterChip>
                ))}
              </FilterGroup>
            )}
            {options.tags.length > 0 && (
              <FilterGroup label={t("Tags")}>
                {options.tags.map((tag) => (
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

      {/* Days, with each week's total in the column on the right. */}
      <div className="p-2 sm:p-3">
        <div className="grid grid-cols-7 gap-1 sm:grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.15fr)] sm:gap-1.5">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-1.5 text-center text-xs font-semibold text-muted-foreground sm:text-sm">
              {t(w)}
            </div>
          ))}
          <div className="hidden py-1.5 text-center text-xs font-semibold text-muted-foreground sm:block sm:text-sm">{t("Week")}</div>

          {weeks.map((week, wi) => (
            <Fragment key={wi}>
              {week.cells.map((cell, ci) => {
                if (!cell) return <div key={`empty-${wi}-${ci}`} className="min-h-28 rounded-lg bg-muted/30" />
                const value = metricValue(cell.agg, metric)
                const isToday = cell.date === todayKey
                return (
                  <div
                    key={cell.date}
                    className={cn(
                      "flex min-h-28 min-w-0 flex-col justify-between overflow-hidden rounded-lg border p-1 sm:p-2",
                      !value && "bg-muted/30",
                    )}
                    style={value ? toneStyle(value.tone, "cell") : undefined}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span
                        className={cn(
                          "flex size-5 items-center justify-center rounded-full text-[11px] font-medium tabular-nums sm:size-6 sm:text-xs",
                          isToday ? "bg-primary text-primary-foreground" : value ? "text-foreground/80" : "text-muted-foreground",
                        )}
                      >
                        {cell.day}
                      </span>
                      {noted.has(cell.date) && <NotebookPen className="size-3 shrink-0 text-foreground/60 sm:size-3.5" aria-label={t("Journaled")} />}
                    </div>
                    {value && (
                      <div className="min-w-0 space-y-0.5">
                        <p className="truncate text-[11px] font-bold leading-tight tabular-nums sm:text-base lg:text-lg" style={{ color: `var(--cal-${value.tone}-text)` }}>
                          {value.short ? (
                            <>
                              <span className="sm:hidden">{value.short}</span>
                              <span className="hidden sm:inline">{value.text}</span>
                            </>
                          ) : (
                            value.text
                          )}
                        </p>
                        {secondary(cell.agg).map((s, i) => (
                          <p key={i} className="truncate text-[9px] leading-tight tabular-nums sm:text-xs" style={{ color: `var(--cal-${value.tone}-sub)` }}>
                            {s}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
              <WeekCell index={wi + 1} agg={week.agg} metric={metric} tradesShort={tradesShort} className="hidden sm:flex" />
            </Fragment>
          ))}
        </div>

        {/* Phones have no room for an eighth column — weeks go underneath. */}
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:hidden">
          {weeks.map((week, wi) => (
            <WeekCell key={wi} index={wi + 1} agg={week.agg} metric={metric} tradesShort={tradesShort} className="flex" />
          ))}
        </div>
      </div>

      {/* The month at a glance. */}
      <div className="border-t px-3 py-3 sm:px-5 sm:py-4">
        <p className="mb-3 text-center text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("Monthly insights")}</p>
        <div className="grid grid-cols-3 gap-y-3 sm:grid-cols-5 sm:divide-x sm:rtl:divide-x-reverse">
          <Insight label={t("Best day")} value={best ? money(best.agg.pnl) : "—"} tone={best ? signTone(best.agg.pnl) : undefined} sub={best ? shortDate(best.date) : undefined} />
          <Insight label={t("Worst day")} value={worst ? money(worst.agg.pnl) : "—"} tone={worst ? signTone(worst.agg.pnl) : undefined} sub={worst ? shortDate(worst.date) : undefined} />
          <Insight label={t("Avg trade")} value={monthAgg.trades ? money(monthAgg.pnl / monthAgg.trades) : "—"} tone={monthAgg.trades ? signTone(monthAgg.pnl) : undefined} />
          <Insight label={t("Profit factor")} value={profitFactor} />
          <Insight label={t("Winning days")} value={tradedDays.length ? `${winningDays}/${tradedDays.length}` : "—"} />
        </div>
      </div>
    </div>
  )
}

function WeekCell({
  index,
  agg,
  metric,
  tradesShort,
  className,
}: {
  index: number
  agg: Agg
  metric: Metric
  tradesShort: (n: number) => string
  className?: string
}) {
  const t = useT()
  const value = metricValue(agg, metric)
  const sub = agg.trades === 0 ? null : metric === "trades" ? money(agg.pnl) : tradesShort(agg.trades)
  return (
    <div className={cn("min-w-0 flex-col justify-center gap-0.5 rounded-lg border bg-muted/40 px-2.5 py-2 sm:min-h-28", className)}>
      <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase sm:text-[11px]">{t("Week {n}", { n: index })}</p>
      <p
        className={cn("truncate text-sm font-semibold tabular-nums sm:text-lg", !value && "text-muted-foreground")}
        style={value ? { color: `var(--cal-${value.tone}-line)` } : undefined}
      >
        {value ? value.text : metric === "pnl" ? money(0) : "—"}
      </p>
      {sub && <p className="truncate text-xs text-muted-foreground tabular-nums">{sub}</p>}
    </div>
  )
}

function toneStyle(tone: Tone, kind: "cell" | "pill"): React.CSSProperties {
  return kind === "cell"
    ? { backgroundColor: `var(--cal-${tone}-bg)`, borderColor: `var(--cal-${tone}-border)` }
    : { backgroundColor: `var(--cal-${tone}-bg)`, color: `var(--cal-${tone}-line)` }
}

function Insight({ label, value, tone, sub }: { label: string; value: string; tone?: Tone; sub?: string }) {
  return (
    <div className="min-w-0 px-2 text-center">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-base font-semibold tabular-nums sm:text-lg" style={tone ? { color: `var(--cal-${tone}-line)` } : undefined}>
        {value}
      </p>
      {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
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
