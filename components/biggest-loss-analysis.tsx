import { formatCurrency } from "@/lib/calc"
import type { LossAnalysisResult } from "@/lib/loss-analysis"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Lightbulb, TriangleAlert } from "lucide-react"

export function BiggestLossAnalysis({ result }: { result: LossAnalysisResult }) {
  const { trade, tips } = result
  const pnl = Number(trade.pnl)
  const date = new Date(trade.exitTime ?? trade.entryTime).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })

  return (
    <Card className="overflow-hidden border-[var(--loss)]/25">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-[var(--loss)]/8 px-5 py-3">
        <div className="flex items-center gap-2">
          <TriangleAlert className="size-4 text-[var(--loss)]" />
          <h2 className="font-medium">Biggest loss — how to fix it</h2>
        </div>
        <span className="text-lg font-semibold tabular-nums text-[var(--loss)]">{formatCurrency(pnl)}</span>
      </div>

      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{trade.symbol}</span>
          <Badge
            variant="outline"
            className={cn(
              "uppercase",
              trade.side === "long" ? "border-[var(--gain)]/30 text-[var(--gain)]" : "border-[var(--loss)]/30 text-[var(--loss)]",
            )}
          >
            {trade.side}
          </Badge>
          <span className="text-muted-foreground">{date}</span>
          {trade.rMultiple != null && (
            <span className="text-muted-foreground">{Number(trade.rMultiple).toFixed(2)}R</span>
          )}
          {(trade.mistakes ?? []).map((m) => (
            <Badge key={m} variant="outline" className="border-[var(--loss)]/30 text-[var(--loss)]">
              {m}
            </Badge>
          ))}
        </div>

        {trade.notes && <p className="text-sm text-muted-foreground">"{trade.notes}"</p>}

        <ul className="space-y-2.5">
          {tips.map((tip, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-500" />
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}
