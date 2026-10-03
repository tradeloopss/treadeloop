"use client"

import { useId, useState, useSyncExternalStore } from "react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import type { SeriesPoint } from "@/lib/affiliates/queries"
import { cn } from "@/lib/utils"

export type Metric = "commission" | "clicks" | "signups" | "customers" | "revenue"
const META: Record<Metric, { label: string; money: boolean }> = {
  commission: { label: "Commission", money: true },
  revenue: { label: "Revenue", money: true },
  clicks: { label: "Clicks", money: false },
  signups: { label: "Sign-ups", money: false },
  customers: { label: "Customers", money: false },
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 })
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
const tick = (date: string, unit: "day" | "week" | "month") => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", unit === "month" ? { month: "short", year: "2-digit", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" })

// The draw-in animation is skipped for people who ask for less motion.
function useReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia("(prefers-reduced-motion: reduce)")
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true
  )
}

// A smooth violet line with a soft glow and a gradient fill; one series.
export function GlowChart({ points, unit, metric, height = "h-56", label }: { points: SeriesPoint[]; unit: "day" | "week" | "month"; metric: Metric; height?: string; label?: string }) {
  const id = useId().replace(/:/g, "")
  const still = useReducedMotion()
  const meta = META[metric]
  const fmt = (v: number) => (meta.money ? usd.format(v) : v.toLocaleString("en-US"))
  const total = points.reduce((s, p) => s + p[metric], 0)
  const empty = points.every((p) => p[metric] === 0)
  return (
    <div className={cn("w-full min-w-0", height)} role="img" aria-label={label ?? `${meta.label} over time: ${fmt(Math.round(total * 100) / 100)} in this period`}>
      {empty ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-center text-sm text-muted-foreground">
          <span className="font-medium text-foreground">No {meta.label.toLowerCase()} in this period yet</span>
          <span className="text-xs">Share your link — your results show up here as they happen.</span>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 10, right: 6, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--v2-violet-bright)" stopOpacity={0.38} />
                <stop offset="60%" stopColor="var(--v2-blue)" stopOpacity={0.08} />
                <stop offset="100%" stopColor="var(--v2-blue)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id={`line-${id}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--v2-blue)" />
                <stop offset="55%" stopColor="var(--v2-violet-bright)" />
                <stop offset="100%" stopColor="var(--v2-magenta)" />
              </linearGradient>
              <filter id={`glow-${id}`} x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3.5" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeOpacity={0.7} strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="date" tickFormatter={(d) => tick(String(d), unit)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} minTickGap={26} />
            <YAxis width={meta.money ? 52 : 36} allowDecimals={meta.money} tickFormatter={(v) => (meta.money ? `$${compact.format(Number(v))}` : compact.format(Number(v)))} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
            <Tooltip
              cursor={{ stroke: "var(--v2-violet-bright)", strokeOpacity: 0.4, strokeDasharray: "3 3" }}
              contentStyle={{ background: "var(--popover)", border: "1px solid color-mix(in oklab, var(--v2-violet-bright) 40%, var(--border))", borderRadius: 12, fontSize: 12, color: "var(--popover-foreground)", boxShadow: "0 12px 30px -12px rgb(76 29 149 / 0.55)" }}
              labelStyle={{ color: "var(--muted-foreground)", marginBottom: 2 }}
              labelFormatter={(d) => `${unit === "week" ? "Week of " : ""}${tick(String(d), unit)}`}
              formatter={(value) => [fmt(Number(value)), meta.label]}
            />
            <Area type="monotone" dataKey={metric} stroke={`url(#line-${id})`} strokeWidth={2.5} fill={`url(#fill-${id})`} filter={`url(#glow-${id})`} isAnimationActive={!still} animationDuration={700} activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--background)", fill: "var(--v2-violet-bright)" }} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// The Performance card's body: metric tabs over one chart, with the period's total.
export function MetricSwitcher({ points, unit, metrics = ["commission", "clicks", "signups", "customers"], initial = "commission", height }: { points: SeriesPoint[]; unit: "day" | "week" | "month"; metrics?: Metric[]; initial?: Metric; height?: string }) {
  const [metric, setMetric] = useState<Metric>(initial)
  const meta = META[metric]
  const total = Math.round(points.reduce((s, p) => s + p[metric], 0) * 100) / 100
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div role="tablist" aria-label="Metric" className="flex flex-wrap gap-1">
        {metrics.map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={m === metric}
            onClick={() => setMetric(m)}
            className={cn("h-8 rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", m === metric ? "v2-nav-active" : "border bg-card/50 text-muted-foreground hover:text-foreground")}
          >
            {META[m].label}
          </button>
        ))}
      </div>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">
        {meta.money ? usd.format(total) : total.toLocaleString("en-US")} <span className="text-xs font-normal text-muted-foreground">in this period</span>
      </p>
      <GlowChart points={points} unit={unit} metric={metric} height={height} />
    </div>
  )
}
