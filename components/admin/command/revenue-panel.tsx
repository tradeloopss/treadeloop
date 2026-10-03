"use client"

import { useMemo, useState } from "react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import type { revenueOverview } from "@/lib/admin/command-center"
import { Card, CardLink, Trend } from "@/components/admin/command/cards"
import { fmtMoney, fmtPercent } from "@/components/admin/ui"
import { cn } from "@/lib/utils"

type Data = Awaited<ReturnType<typeof revenueOverview>>

const WINDOWS = [
  { key: "7d", label: "7D", days: 7 },
  { key: "30d", label: "30D", days: 30 },
  { key: "90d", label: "90D", days: 90 },
  { key: "1y", label: "1Y", days: 365 },
] as const

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
const tick = (day: string, long: boolean) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", long ? { month: "short", year: "2-digit", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" })

// MRR over time, reconstructed from subscription start and cancel dates and
// priced at list price — an estimate, and labelled as one. The window buttons
// only change the chart; the figures below follow the page's date range.
export function RevenuePanel({ data, days, className }: { data: Data; days: number; className?: string }) {
  const [win, setWin] = useState<(typeof WINDOWS)[number]["key"]>(days >= 90 ? "90d" : days >= 30 ? "30d" : "7d")
  const span = WINDOWS.find((w) => w.key === win)!
  const points = useMemo(() => data.series.slice(-span.days - 1), [data.series, span.days])
  const first = points[0]?.mrr ?? 0
  const last = points[points.length - 1]?.mrr ?? 0
  const windowChange = first > 0 ? (last - first) / first : null
  const empty = data.series.every((p) => p.mrr === 0) && data.mrr === 0

  return (
    <Card
      title="Revenue & growth"
      subtitle="Monthly recurring revenue (MRR) · estimated at list price"
      action={<CardLink href="/admin/billing">View details</CardLink>}
      className={className}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <p className="text-[28px] leading-9 font-semibold tracking-tight tabular-nums sm:text-[32px]">{fmtMoney(data.mrr)}</p>
          <Trend value={windowChange} />
          {windowChange != null && <span className="text-xs text-muted-foreground">in {span.label}</span>}
        </div>
        <div className="inline-flex gap-0.5 rounded-lg bg-muted p-[3px]" role="group" aria-label="Chart period">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              onClick={() => setWin(w.key)}
              aria-pressed={w.key === win}
              className={cn("h-7 min-w-10 rounded-md px-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", w.key === win ? "bg-background text-foreground shadow-sm dark:bg-card" : "text-muted-foreground hover:text-foreground")}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 h-48 w-full sm:h-56 min-[87.5rem]:h-auto min-[87.5rem]:min-h-[232px] min-[87.5rem]:flex-1" role="img" aria-label={`Estimated MRR over the last ${span.label}: from ${fmtMoney(first)} to ${fmtMoney(last)}`}>
        {empty ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed px-6 text-center text-sm text-muted-foreground">No paid subscriptions yet — the chart starts with the first one.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="adminMrrFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" tickFormatter={(d) => tick(String(d), span.days > 120)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} minTickGap={32} />
              <YAxis width={48} tickFormatter={(v) => `$${compact.format(Number(v))}`} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} domain={[0, "auto"]} allowDecimals={false} />
              <Tooltip
                cursor={{ stroke: "var(--border)" }}
                contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, color: "var(--popover-foreground)", boxShadow: "0 8px 24px -12px rgb(0 0 0 / 0.25)" }}
                labelStyle={{ color: "var(--muted-foreground)" }}
                labelFormatter={(d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
                formatter={(value, _name, item) => [`${usd2.format(Number(value))} · ${(item?.payload as { paying?: number })?.paying ?? 0} paying`, "Est. MRR"]}
              />
              <Area type="monotone" dataKey="mrr" stroke="var(--primary)" strokeWidth={2} fill="url(#adminMrrFill)" isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 0, fill: "var(--primary)" }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4 sm:grid-cols-4">
        <Figure label="ARR" value={fmtMoney(data.arr)} trend={data.trends.mrr} />
        <Figure label={`New MRR, ${days}d`} value={`+${fmtMoney(data.newMrr)}`} trend={data.trends.newMrr} />
        <Figure label="Churn, 30d" value={fmtPercent(data.churnRate)} note={`${data.churned30d} cancelled`} />
        <Figure label="ARPU" value={data.arpu != null ? usd2.format(data.arpu) : "—"} trend={data.trends.arpu} />
      </dl>
    </Card>
  )
}

function Figure({ label, value, trend, note }: { label: string; value: string; trend?: number | null; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-base font-semibold tabular-nums">{value}</span>
        {trend !== undefined ? <Trend value={trend} /> : note ? <span className="text-[11px] text-muted-foreground">{note}</span> : null}
      </dd>
    </div>
  )
}
