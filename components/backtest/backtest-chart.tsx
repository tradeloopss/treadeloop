"use client"

// Candlestick replay chart on TradingView's open-source Lightweight Charts
// (Apache-2.0), vendored at public/vendor/ and loaded via a script tag (no
// build-time dependency). It renders exactly what it's handed — candles/line/
// area, indicator overlays, entry/exit markers, SL/TP price lines and the
// trader's drawings — and reports clicks back as {time, price}. Look-ahead is
// the replay engine's job upstream: it's only ever passed candles at/under the
// cursor. Drawing state lives in the workspace and is rendered here
// declaratively, which keeps "clear all" and "hide" trivial.
import { useEffect, useRef, useState } from "react"
import { useTheme } from "next-themes"
import type { Candle } from "@/lib/market-data/types"
import type { IndicatorOutput } from "@/lib/backtest/indicators"

export type SeriesType = "candles" | "line" | "area"

export interface ChartMarker {
  time: number
  position: "aboveBar" | "belowBar"
  color: string
  shape: "arrowUp" | "arrowDown" | "circle"
  text?: string
}

export interface ChartPriceLine {
  price: number
  color: string
  title: string
  dashed?: boolean
}

export interface Drawing {
  id: string
  type: "hline" | "trend" | "text"
  points: { time: number; price: number }[]
  color: string
  text?: string
}

const SCRIPT_SRC = "/vendor/lightweight-charts.standalone.production.js"

function loadLibrary(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve()
  const w = window as unknown as { LightweightCharts?: unknown }
  if (w.LightweightCharts) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`)
    if (existing) {
      existing.addEventListener("load", () => resolve())
      existing.addEventListener("error", () => reject(new Error("Failed to load chart library")))
      return
    }
    const s = document.createElement("script")
    s.src = SCRIPT_SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error("Failed to load chart library"))
    document.head.appendChild(s)
  })
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function BacktestChart({
  candles,
  markers,
  priceLines,
  seriesType = "candles",
  indicators = [],
  drawings = [],
  showDrawings = true,
  magnet = false,
  onChartClick,
}: {
  candles: Candle[]
  markers: ChartMarker[]
  priceLines: ChartPriceLine[]
  seriesType?: SeriesType
  indicators?: IndicatorOutput[]
  drawings?: Drawing[]
  showDrawings?: boolean
  magnet?: boolean
  onChartClick?: (point: { time: number; price: number }) => void
}) {
  const { resolvedTheme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<any>(null)
  const candleSeriesRef = useRef<any>(null)
  const lineSeriesRef = useRef<any>(null)
  const areaSeriesRef = useRef<any>(null)
  const volumeSeriesRef = useRef<any>(null)
  const priceLineRefs = useRef<any[]>([])
  const indicatorSeriesRef = useRef<any[]>([])
  const drawingSeriesRef = useRef<any[]>([])
  const drawingPriceLineRefs = useRef<any[]>([])
  const [ready, setReady] = useState(0)

  // Keep the latest values available to the (stable) click subscription.
  const clickRef = useRef(onChartClick)
  clickRef.current = onChartClick
  const magnetRef = useRef(magnet)
  magnetRef.current = magnet
  const candlesRef = useRef(candles)
  candlesRef.current = candles

  // Create the chart once per theme.
  useEffect(() => {
    let disposed = false
    loadLibrary()
      .then(() => {
        if (disposed || !containerRef.current) return
        const LWC = (window as any).LightweightCharts
        const dark = resolvedTheme === "dark"
        const chart = LWC.createChart(containerRef.current, {
          layout: { background: { color: "transparent" }, textColor: dark ? "#a1a1aa" : "#52525b", fontFamily: "inherit" },
          grid: {
            vertLines: { color: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)" },
            horzLines: { color: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)" },
          },
          rightPriceScale: { borderColor: dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)" },
          timeScale: { borderColor: dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)", timeVisible: true, secondsVisible: false },
          crosshair: { mode: magnetRef.current ? 2 : 0 },
          autoSize: true,
        })
        const candleSeries = chart.addCandlestickSeries({
          upColor: "#16a34a", downColor: "#dc2626", borderUpColor: "#16a34a", borderDownColor: "#dc2626", wickUpColor: "#16a34a", wickDownColor: "#dc2626",
        })
        const lineSeries = chart.addLineSeries({ color: "#3b82f6", lineWidth: 2, visible: false })
        const areaSeries = chart.addAreaSeries({ lineColor: "#3b82f6", topColor: "rgba(59,130,246,0.3)", bottomColor: "rgba(59,130,246,0.02)", lineWidth: 2, visible: false })
        const volumeSeries = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "", color: dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)" })
        volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })

        chart.subscribeClick((param: any) => {
          if (!clickRef.current || !param.point || param.time == null) return
          let price = candleSeries.coordinateToPrice(param.point.y)
          if (price == null) return
          if (magnetRef.current) {
            const c = candlesRef.current.find((k) => k.time === param.time)
            if (c) {
              const cands = [c.open, c.high, c.low, c.close]
              price = cands.reduce((best, v) => (Math.abs(v - price) < Math.abs(best - price) ? v : best), cands[0])
            }
          }
          clickRef.current({ time: Number(param.time), price: Number(price) })
        })

        chartRef.current = chart
        candleSeriesRef.current = candleSeries
        lineSeriesRef.current = lineSeries
        areaSeriesRef.current = areaSeries
        volumeSeriesRef.current = volumeSeries
        setReady((n) => n + 1)
      })
      .catch(() => {})

    return () => {
      disposed = true
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
        candleSeriesRef.current = null
        lineSeriesRef.current = null
        areaSeriesRef.current = null
        volumeSeriesRef.current = null
        priceLineRefs.current = []
        indicatorSeriesRef.current = []
        drawingSeriesRef.current = []
        drawingPriceLineRefs.current = []
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme])

  // Price data + series-type visibility.
  useEffect(() => {
    const cs = candleSeriesRef.current, ls = lineSeriesRef.current, as = areaSeriesRef.current, vs = volumeSeriesRef.current
    if (!cs || !ls || !as) return
    cs.setData(candles.map((c) => ({ time: c.time as any, open: c.open, high: c.high, low: c.low, close: c.close })))
    const lineData = candles.map((c) => ({ time: c.time as any, value: c.close }))
    ls.setData(lineData)
    as.setData(lineData)
    vs?.setData(candles.map((c) => ({ time: c.time as any, value: c.volume, color: c.close >= c.open ? "rgba(22,163,74,0.4)" : "rgba(220,38,38,0.4)" })))
    cs.applyOptions({ visible: seriesType === "candles" })
    ls.applyOptions({ visible: seriesType === "line" })
    as.applyOptions({ visible: seriesType === "area" })
  }, [candles, seriesType, ready])

  // Indicator overlays — rebuilt whenever the selection or data changes.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    for (const s of indicatorSeriesRef.current) chart.removeSeries(s)
    indicatorSeriesRef.current = indicators.map((ind) => {
      const s = chart.addLineSeries({ color: ind.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
      s.setData(ind.points.map((p) => ({ time: p.time as any, value: p.value })))
      return s
    })
  }, [indicators, ready])

  // Trade + text-drawing markers (Lightweight Charts replaces all markers at
  // once, so trade markers and text drawings are merged here).
  useEffect(() => {
    const series = candleSeriesRef.current
    if (!series) return
    const textMarkers: any[] = showDrawings
      ? drawings.filter((d) => d.type === "text").map((d) => ({ time: d.points[0].time as any, position: "aboveBar", color: d.color, shape: "circle", text: d.text || "" }))
      : []
    series.setMarkers([...markers.map((m) => ({ time: m.time as any, position: m.position, color: m.color, shape: m.shape, text: m.text })), ...textMarkers])
  }, [markers, drawings, showDrawings, ready])

  // SL / TP / entry price lines + horizontal-line drawings.
  useEffect(() => {
    const series = candleSeriesRef.current
    if (!series) return
    for (const l of priceLineRefs.current) series.removePriceLine(l)
    for (const l of drawingPriceLineRefs.current) series.removePriceLine(l)
    priceLineRefs.current = priceLines.map((pl) =>
      series.createPriceLine({ price: pl.price, color: pl.color, lineWidth: 1, lineStyle: pl.dashed ? 2 : 0, axisLabelVisible: true, title: pl.title }),
    )
    drawingPriceLineRefs.current = showDrawings
      ? drawings.filter((d) => d.type === "hline").map((d) => series.createPriceLine({ price: d.points[0].price, color: d.color, lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: "" }))
      : []
  }, [priceLines, drawings, showDrawings, ready])

  // Trend-line drawings — one line series each.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    for (const s of drawingSeriesRef.current) chart.removeSeries(s)
    drawingSeriesRef.current = showDrawings
      ? drawings
          .filter((d) => d.type === "trend" && d.points.length === 2)
          .map((d) => {
            const s = chart.addLineSeries({ color: d.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
            const pts = [...d.points].sort((a, b) => a.time - b.time)
            s.setData(pts.map((p) => ({ time: p.time as any, value: p.price })))
            return s
          })
      : []
  }, [drawings, showDrawings, ready])

  // Crosshair magnet mode.
  useEffect(() => {
    chartRef.current?.applyOptions({ crosshair: { mode: magnet ? 2 : 0 } })
  }, [magnet])

  return <div ref={containerRef} className="h-full w-full" />
}
