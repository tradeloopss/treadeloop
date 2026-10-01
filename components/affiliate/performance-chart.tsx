"use client"

import { useState } from "react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { cn } from "@/lib/utils"

export type ChartPoint = { date: string; clicks: number; signups: number; customers: number; revenue: number; commission: number }

const METRICS = [
  { key: "commission", label: "Commission", money: true },
  { key: "revenue", label: "Revenue", money: true },
  { key: "clicks", label: "Clicks", money: false },
  { key: "signups", label: "Sign-ups", money: false },
  { key: "customers", label: "Customers", money: false },
] as const
type MetricKey = (typeof METRICS)[number]["key"]

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })

function tick(date: string, unit: "day" | "week" | "month") {
  const d = new Date(`${date}T00:00:00Z`)
  return unit === "month" ? d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }) : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

// One series at a time, switched with the buttons above the plot — clicks and
// dollars don't share a scale, so they aren't drawn together.
export function PerformanceChart({ points, unit, metrics = ["commission", "clicks", "signups", "customers"], initial }: { points: ChartPoint[]; unit: "day" | "week" | "month"; metrics?: MetricKey[]; initial?: MetricKey }) {
  const [metric, setMetric] = useState<MetricKey>(initial ?? metrics[0])
  const meta = METRICS.find((m) => m.key === metric)!
  const total = points.reduce((sum, p) => sum + p[metric], 0)
  const fmt = (v: number) => (meta.money ? usd.format(v) : v.toLocaleString("en-US"))
  const empty = points.every((p) => p[metric] === 0)

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-[3px]" role="group" aria-label="Metric">
          {METRICS.filter((m) => metrics.includes(m.key)).map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMetric(m.key)}
              aria-pressed={m.key === metric}
              className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", m.key === metric ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-sm tabular-nums">
          <span className="font-semibold">{fmt(Math.round(total * 100) / 100)}</span> <span className="text-muted-foreground">in this period</span>
        </p>
      </div>
      <div className="h-64 w-full" role="img" aria-label={`${meta.label} over time: ${fmt(Math.round(total * 100) / 100)} in this period`}>
        {empty ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">No {meta.label.toLowerCase()} in this period yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="affPerfFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d) => tick(String(d), unit)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis width={44} allowDecimals={meta.money} tickFormatter={(v) => (meta.money ? `$${compact.format(Number(v))}` : compact.format(Number(v)))} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ stroke: "var(--border)" }}
                contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--popover-foreground)" }}
                labelStyle={{ color: "var(--muted-foreground)" }}
                labelFormatter={(d) => `${unit === "day" ? "" : unit === "week" ? "Week of " : ""}${tick(String(d), unit)}`}
                formatter={(value) => [fmt(Number(value)), meta.label]}
              />
              <Area type="monotone" dataKey={metric} stroke="var(--primary)" strokeWidth={2} fill="url(#affPerfFill)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
