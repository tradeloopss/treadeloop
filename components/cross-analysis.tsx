import type React from "react"
import { Card } from "@/components/ui/card"
import { formatCurrency } from "@/lib/calc"
import type { CrossAnalysisResult } from "@/lib/cross-analysis"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

export function CrossAnalysis({ data }: { data: CrossAnalysisResult }) {
  return (
    <Card className="p-5">
      <h2 className="mb-4 text-sm font-medium text-muted-foreground">Cross Analysis</h2>
      {data.rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Log closed trades across a few symbols to see the monthly breakdown.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-left font-medium text-muted-foreground">
                  &nbsp;
                </th>
                {MONTHS.map((m) => (
                  <th key={m} className="px-3 py-2 text-left font-medium text-muted-foreground">
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr key={row.symbol} className={i > 0 ? "border-t" : undefined}>
                  <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium">{row.symbol}</th>
                  {row.values.map((value, month) => (
                    <td key={month} className="px-3 py-2 tabular-nums" style={cellStyle(value, data.maxGain, data.maxLoss)}>
                      {formatCurrency(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function cellStyle(value: number, maxGain: number, maxLoss: number): React.CSSProperties {
  if (value === 0) return {}
  const isGain = value > 0
  const magnitude = isGain ? maxGain : maxLoss
  const intensity = magnitude > 0 ? Math.min(1, Math.abs(value) / magnitude) : 0
  const opacity = 0.1 + intensity * 0.55
  const color = isGain ? "var(--gain)" : "var(--loss)"
  return { backgroundColor: `color-mix(in srgb, ${color} ${Math.round(opacity * 100)}%, transparent)` }
}
