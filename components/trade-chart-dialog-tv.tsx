"use client"

// The real TradingView Charting Library (not the free embed widget used
// before — that one refuses real-time/delayed data for CME futures
// exchanges when embedded off tradingview.com). This library is not public:
// it requires applying at tradingview.com/advanced-charts, getting
// approved, and being invited to a private GitHub repo for the actual
// files. Until those files exist at public/charting_library/, this
// component can't load — see loadChartingLibrary() below. The custom
// Datafeed object here feeds it OUR OWN Rithmic-sourced bars (via
// getRithmicBarsForDatafeed in app/actions/chart.ts) instead of
// TradingView's own market data, which is what avoids the CME data-
// licensing wall entirely: the library is just the front end, not the data
// source.
//
// The Datafeed API method names/shapes here (onReady, resolveSymbol,
// getBars, subscribeBars) come from TradingView's own docs
// (tradingview.com/charting-library-docs/latest/connecting_data/datafeed-api).
// The entry/exit/SL/TP marker calls (createShape / createOrderLine) use
// that library's commonly documented pattern for this, but haven't been
// tested against the real library files (no access yet) — verify field
// names against the actual typings once installed, in case they've drifted.

import { useEffect, useRef, useState } from "react"
import { useTheme } from "next-themes"
import { getRithmicBarsForDatafeed } from "@/app/actions/chart"
import { toRithmicSymbol } from "@/lib/rithmic-exchange"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Loader2 } from "lucide-react"

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

interface TvOrderLine {
  setPrice(price: number): TvOrderLine
  setText(text: string): TvOrderLine
  setLineColor(color: string): TvOrderLine
  setLineStyle(style: number): TvOrderLine
  setQuantity(qty: string): TvOrderLine
}
interface TvChartApi {
  createShape(
    point: { time: number; price: number },
    options: { shape: string; text?: string; overrides?: Record<string, unknown> }
  ): number
  createOrderLine(): TvOrderLine
}
interface TvWidget {
  onChartReady(callback: () => void): void
  activeChart(): TvChartApi
  remove(): void
}
declare global {
  interface Window {
    TradingView?: { widget: new (options: Record<string, unknown>) => TvWidget }
  }
}

let scriptPromise: Promise<void> | null = null
function loadChartingLibrary(): Promise<void> {
  if (window.TradingView?.widget) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = "/charting_library/charting_library.standalone.js"
    script.async = true
    script.onload = () => resolve()
    script.onerror = () =>
      reject(new Error("Charting library files aren't installed yet (public/charting_library/) — see trade-chart-dialog-tv.tsx"))
    document.head.appendChild(script)
  })
  return scriptPromise
}

function createDatafeed(trade: ChartTrade) {
  return {
    onReady(callback: (config: Record<string, unknown>) => void) {
      setTimeout(
        () =>
          callback({
            supported_resolutions: ["1", "5", "15", "60", "1D"],
            supports_search: false,
            supports_group_request: false,
            supports_marks: false,
            supports_timescale_marks: false,
            exchanges: [],
            symbols_types: [],
          }),
        0
      )
    },
    searchSymbols(_input: string, _exchange: string, _type: string, onResult: (results: unknown[]) => void) {
      onResult([])
    },
    resolveSymbol(symbolName: string, onResolve: (info: Record<string, unknown>) => void, onError: (msg: string) => void) {
      const mapped = toRithmicSymbol(symbolName)
      if (!mapped) {
        onError(`No chart available for "${symbolName}"`)
        return
      }
      setTimeout(
        () =>
          onResolve({
            name: mapped.symbol,
            ticker: symbolName,
            description: symbolName,
            type: "futures",
            session: "24x7",
            timezone: "Etc/UTC",
            exchange: mapped.exchange,
            listed_exchange: mapped.exchange,
            minmov: 1,
            pricescale: 100,
            has_intraday: true,
            has_daily: true,
            supported_resolutions: ["1", "5", "15", "60", "1D"],
            volume_precision: 0,
            data_status: "endofday",
          }),
        0
      )
    },
    async getBars(
      _symbolInfo: unknown,
      resolution: string,
      periodParams: { from: number; to: number },
      onResult: (bars: unknown[], meta: { noData: boolean }) => void,
      onError: (msg: string) => void
    ) {
      try {
        const points = await getRithmicBarsForDatafeed(trade.symbol, trade.market, resolution, periodParams.from, periodParams.to)
        // TradingView's Bar.time is documented in milliseconds — our own
        // data (and Rithmic's) is unix seconds throughout, so convert here.
        const bars = points.map((p) => ({
          time: p.time * 1000,
          open: p.open,
          high: p.high,
          low: p.low,
          close: p.close,
          volume: p.volume,
        }))
        onResult(bars, { noData: bars.length === 0 })
      } catch (err) {
        onError(err instanceof Error ? err.message : "Could not load bars")
      }
    },
    // No live streaming — this previews a past trade, it isn't a live
    // trading terminal, so bars don't need to update in real time.
    subscribeBars() {},
    unsubscribeBars() {},
  }
}

export function TradeChartDialogTV({
  trade,
  open,
  onOpenChange,
}: {
  trade: ChartTrade
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<TvWidget | null>(null)
  const { resolvedTheme } = useTheme()
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!open || !containerRef.current) return
    let cancelled = false
    setLoaded(false)
    setError(null)

    loadChartingLibrary()
      .then(() => {
        if (cancelled || !containerRef.current || !window.TradingView) return
        const widget = new window.TradingView.widget({
          container: containerRef.current,
          library_path: "/charting_library/",
          datafeed: createDatafeed(trade),
          symbol: trade.symbol,
          interval: "5",
          timezone: "Etc/UTC",
          theme: resolvedTheme === "dark" ? "dark" : "light",
          autosize: true,
          disabled_features: ["use_localstorage_for_settings"],
        })
        widgetRef.current = widget

        widget.onChartReady(() => {
          if (cancelled) return
          setLoaded(true)
          const chart = widget.activeChart()
          const entrySec = Math.floor(new Date(trade.entryTime).getTime() / 1000)
          chart.createShape(
            { time: entrySec, price: trade.entryPrice },
            { shape: trade.side === "long" ? "arrow_up" : "arrow_down", text: "Entry", overrides: { color: "#3b82f6" } }
          )
          if (trade.exitTime && trade.exitPrice != null) {
            const exitSec = Math.floor(new Date(trade.exitTime).getTime() / 1000)
            const won = trade.pnl >= 0
            chart.createShape(
              { time: exitSec, price: trade.exitPrice },
              { shape: trade.side === "long" ? "arrow_down" : "arrow_up", text: "Exit", overrides: { color: won ? "#22c55e" : "#ef4444" } }
            )
          }
          if (trade.stopLoss != null) {
            chart.createOrderLine().setPrice(trade.stopLoss).setText("SL").setLineColor("#ef4444")
          }
          if (trade.takeProfit != null) {
            chart.createOrderLine().setPrice(trade.takeProfit).setText("TP").setLineColor("#22c55e")
          }
        })
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load chart"))

    return () => {
      cancelled = true
      widgetRef.current?.remove()
      widgetRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trade.symbol, trade.market, trade.entryTime, trade.exitTime, resolvedTheme])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{trade.symbol}</DialogTitle>
          <DialogDescription>
            {trade.side === "long" ? "Long" : "Short"} · entered {new Date(trade.entryTime).toLocaleString()}
            {trade.exitTime && <> · exited {new Date(trade.exitTime).toLocaleString()}</>}
          </DialogDescription>
        </DialogHeader>

        <div className="relative h-[560px] w-full overflow-hidden rounded-lg border">
          {!error && !loaded && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-muted-foreground">
              {error}
            </div>
          )}
          <div ref={containerRef} className="relative size-full" />
        </div>
      </DialogContent>
    </Dialog>
  )
}
