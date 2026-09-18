"use client"

import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip } from "recharts"
import type { ScoreAxis } from "@/lib/trading-score"
import { Card } from "@/components/ui/card"

export function TradingScore({ overall, axes }: { overall: number; axes: ScoreAxis[] }) {
  const rounded = Math.round(overall * 10) / 10

  return (
    <Card className="p-4">
      <h2 className="mb-2 text-sm font-medium text-muted-foreground">TradeLoop Score</h2>

      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={axes} outerRadius="70%">
            <PolarGrid stroke="var(--border)" />
            <PolarAngleAxis dataKey="label" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--popover-foreground)",
              }}
              formatter={(value) => [`${Number(value).toFixed(0)} / 100`, "Score"]}
            />
            <Radar dataKey="score" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.35} strokeWidth={2} />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 border-t pt-2">
        <div>
          <p className="text-[10px] text-muted-foreground">Your score</p>
          <p className="text-xl font-semibold tabular-nums">{rounded.toFixed(2)}</p>
        </div>
        <div className="relative h-1.5 flex-1 rounded-full bg-gradient-to-r from-[var(--loss)] via-yellow-400 to-[var(--gain)]">
          <div
            className="absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow"
            style={{ left: `calc(${Math.max(0, Math.min(100, overall))}% - 5px)` }}
          />
        </div>
      </div>
    </Card>
  )
}
