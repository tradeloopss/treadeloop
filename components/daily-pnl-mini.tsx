"use client"

import { Area, AreaChart, Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip } from "recharts"
import { Card } from "@/components/ui/card"
import { formatCurrency } from "@/lib/calc"
import { useT } from "@/components/locale-provider"

export interface DailyPnlPoint {
  label: string
  cumulative: number
}

export function DailyPnlMini({ data }: { data: DailyPnlPoint[] }) {
  const t = useT()
  const positive = data.length === 0 || data[data.length - 1].cumulative >= 0
  const stroke = positive ? "var(--gain)" : "var(--loss)"

  // Each day's own P&L is the step between two points on the cumulative line,
  // so the bars come from the same data the line already has — no extra query.
  const daily = data.map((point, i) => ({
    label: point.label,
    pnl: i === 0 ? point.cumulative : point.cumulative - data[i - 1].cumulative,
  }))

  return (
    <Card className="flex-1 p-4">
      <h2 className="mb-2 text-sm font-medium text-muted-foreground">{t("Daily net cumulative P&L")}</h2>
      <div className="h-40 w-full">
        {data.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="dailyPnlFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "var(--popover-foreground)",
                }}
                labelStyle={{ color: "var(--muted-foreground)" }}
                formatter={(value) => [formatCurrency(Number(value)), t("Cumulative")]}
              />
              <Area type="monotone" dataKey="cumulative" stroke={stroke} strokeWidth={2} fill="url(#dailyPnlFill)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {t("Not enough closed trades yet.")}
          </div>
        )}
      </div>

      <div className="mt-3 border-t pt-3">
        <h3 className="mb-1 text-xs font-medium text-muted-foreground">{t("Daily P&L")}</h3>
        <div className="h-20 w-full">
          {daily.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "var(--popover-foreground)",
                  }}
                  labelStyle={{ color: "var(--muted-foreground)" }}
                  formatter={(value) => [formatCurrency(Number(value)), t("Day P&L")]}
                />
                {/* Zero line, so losing days read as below the baseline rather
                    than just a differently coloured bar. */}
                <ReferenceLine y={0} stroke="var(--border)" />
                <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
                  {daily.map((day) => (
                    <Cell key={day.label} fill={day.pnl >= 0 ? "var(--gain)" : "var(--loss)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">{t("No closed days yet.")}</div>
          )}
        </div>
      </div>
    </Card>
  )
}
