"use client"

import { BacktestChart, type ChartMarker, type ChartPriceLine, type Drawing } from "@/components/backtest/backtest-chart"
import { cn } from "@/lib/utils"
import type { Candle } from "@/lib/replay/types"

function OhlcCell({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </span>
  )
}

export function ReplayChart({
  candles,
  priceLines,
  markers,
  drawings = [],
  digits,
  symbol,
  timeframe,
  onChartClick,
}: {
  candles: Candle[]
  priceLines: ChartPriceLine[]
  markers: ChartMarker[]
  drawings?: Drawing[]
  digits: number
  symbol: string
  timeframe: string
  onChartClick?: (point: { time: number; price: number }) => void
}) {
  const last = candles[candles.length - 1]
  const fmt = (n: number) => n.toFixed(digits)
  const change = last ? last.close - last.open : 0
  const changePct = last && last.open ? (change / last.open) * 100 : 0

  return (
    <div className="flex h-full flex-col rounded-2xl border bg-card shadow-[0_1px_2px_rgba(20,21,42,0.03)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2.5 text-xs">
        <span className="text-sm font-semibold text-foreground">{symbol}</span>
        <span className="rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">{timeframe}</span>
        {last ? (
          <>
            <OhlcCell label="O" value={fmt(last.open)} />
            <OhlcCell label="H" value={fmt(last.high)} />
            <OhlcCell label="L" value={fmt(last.low)} />
            <OhlcCell label="C" value={fmt(last.close)} />
            <span className={cn("tabular-nums font-medium", change >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")}>
              {change >= 0 ? "+" : ""}
              {fmt(change)} ({changePct >= 0 ? "+" : ""}
              {changePct.toFixed(2)}%)
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">Waiting for candles…</span>
        )}
      </div>
      <div className="relative min-h-[340px] flex-1">
        {candles.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Choose a market to start replaying.</div>
        ) : (
          <BacktestChart candles={candles} markers={markers} priceLines={priceLines} drawings={drawings} onChartClick={onChartClick} />
        )}
      </div>
    </div>
  )
}
