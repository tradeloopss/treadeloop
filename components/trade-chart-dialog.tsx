"use client"

import { useEffect, useMemo, useState } from "react"
import { getTradeChartData, type TradeChartData } from "@/app/actions/chart"
import { INTERVAL_LIMITS, defaultInterval, availableIntervals } from "@/lib/chart-intervals"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Loader2 } from "lucide-react"
import { useIntlLocale, useT } from "@/components/locale-provider"
import { BacktestChart, type ChartMarker, type ChartPriceLine } from "@/components/backtest/backtest-chart"

export interface ChartTrade {
  symbol: string
  market: string
  side: string
  entryTime: string
  exitTime: string | null
  entryPrice: number
  exitPrice: number | null
  stopLoss: number | null
  takeProfit: number | null
  pnl: number
}

// Shows one taken trade on a candlestick chart (TradingView's open-source
// Lightweight Charts, vendored) with exactly what happened: where it was
// entered and where it was closed — plus SL/TP if set. No drawing tools; this
// is a read-only picture of the trade, not a charting workspace.
export function TradeChartDialog({ trade, open, onOpenChange }: { trade: ChartTrade; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [interval, setInterval] = useState(() => defaultInterval(trade.entryTime))
  const [data, setData] = useState<TradeChartData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const t = useT()
  const dateLocale = useIntlLocale()
  const intervals = useMemo(() => availableIntervals(), [])

  useEffect(() => {
    if (!open) return
    setInterval(defaultInterval(trade.entryTime))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trade.entryTime])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    getTradeChartData(trade.symbol, trade.market, trade.entryTime, trade.exitTime, interval)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? t(err.message) : t("Could not load chart"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, trade.symbol, trade.market, trade.entryTime, trade.exitTime, interval])

  const entrySec = Math.floor(new Date(trade.entryTime).getTime() / 1000)
  const exitSec = trade.exitTime ? Math.floor(new Date(trade.exitTime).getTime() / 1000) : null
  const exitColor = trade.pnl >= 0 ? "#16a34a" : "#dc2626"
  const isLong = trade.side === "long"

  const candles = data?.points ?? []

  // Snap a trade timestamp onto the nearest candle so its marker lands on a real
  // bar (lightweight-charts markers must sit on a data point).
  function nearestTime(target: number): number | null {
    if (candles.length === 0) return null
    let best = candles[0].time
    let bestD = Math.abs(best - target)
    for (const c of candles) {
      const d = Math.abs(c.time - target)
      if (d < bestD) {
        bestD = d
        best = c.time
      }
    }
    return best
  }

  const priceLines: ChartPriceLine[] = useMemo(() => {
    const lines: ChartPriceLine[] = [{ price: trade.entryPrice, color: "#6d4aff", title: t("Entry") }]
    if (trade.exitPrice != null) lines.push({ price: trade.exitPrice, color: exitColor, title: t("Exit") })
    if (trade.stopLoss != null) lines.push({ price: trade.stopLoss, color: "#dc2626", title: "SL", dashed: true })
    if (trade.takeProfit != null) lines.push({ price: trade.takeProfit, color: "#16a34a", title: "TP", dashed: true })
    return lines
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade.entryPrice, trade.exitPrice, trade.stopLoss, trade.takeProfit, exitColor])

  const markers: ChartMarker[] = useMemo(() => {
    const m: ChartMarker[] = []
    const et = nearestTime(entrySec)
    if (et != null) m.push({ time: et, position: isLong ? "belowBar" : "aboveBar", color: "#6d4aff", shape: isLong ? "arrowUp" : "arrowDown", text: t("Entry") })
    if (exitSec != null && trade.exitPrice != null) {
      const xt = nearestTime(exitSec)
      if (xt != null) m.push({ time: xt, position: isLong ? "aboveBar" : "belowBar", color: exitColor, shape: "circle", text: t("Exit") })
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, entrySec, exitSec, isLong, exitColor, trade.exitPrice])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{trade.symbol}</DialogTitle>
          <DialogDescription>
            {isLong ? t("Long") : t("Short")} · {t("entered {time}", { time: new Date(trade.entryTime).toLocaleString(dateLocale) })}
            {trade.exitTime && <> · {t("exited {time}", { time: new Date(trade.exitTime).toLocaleString(dateLocale) })}</>}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-[var(--primary)]" /> {t("Entry")} {trade.entryPrice}
            </span>
            {trade.exitPrice != null && (
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: exitColor }} /> {t("Exit")} {trade.exitPrice}
              </span>
            )}
            {trade.stopLoss != null && (
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 bg-[var(--loss)]" /> {t("Stop loss")} {trade.stopLoss}
              </span>
            )}
            {trade.takeProfit != null && (
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 bg-[var(--gain)]" /> {t("Take profit")} {trade.takeProfit}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 rounded-lg border p-1">
            {intervals.map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => setInterval(i)}
                className={cn("rounded-md px-2.5 py-1 text-xs font-semibold transition-colors", interval === i ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}
              >
                {INTERVAL_LIMITS[i].label}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="flex h-[460px] items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}
        {error && !loading && <div className="flex h-[460px] items-center justify-center px-8 text-center text-sm text-muted-foreground">{error}</div>}
        {!loading && !error && (
          <div className="h-[460px] w-full">
            {candles.length > 0 ? (
              <BacktestChart candles={candles} markers={markers} priceLines={priceLines} />
            ) : (
              <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">{t("No chart data for this symbol and timeframe.")}</div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
