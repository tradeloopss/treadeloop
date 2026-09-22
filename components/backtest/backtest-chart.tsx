"use client"

// Candlestick replay chart, built on TradingView's open-source Lightweight
// Charts (Apache-2.0), vendored at public/vendor/ and loaded via a script tag
// so it needs no build-time dependency. It is a dumb renderer: it draws exactly
// the candles/markers/price-lines it's handed and never decides what's visible —
// look-ahead is the replay engine's job upstream (only candles at/under the
// cursor are ever passed in).
import { useEffect, useRef } from "react"
import { useTheme } from "next-themes"
import type { Candle } from "@/lib/market-data/types"

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
}: {
  candles: Candle[]
  markers: ChartMarker[]
  priceLines: ChartPriceLine[]
}) {
  const { resolvedTheme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<any>(null)
  const candleSeriesRef = useRef<any>(null)
  const volumeSeriesRef = useRef<any>(null)
  const priceLineRefs = useRef<any[]>([])
  const readyRef = useRef(false)

  // Create the chart once.
  useEffect(() => {
    let disposed = false
    let resizeObserver: ResizeObserver | null = null
    loadLibrary()
      .then(() => {
        if (disposed || !containerRef.current) return
        const LWC = (window as any).LightweightCharts
        const dark = resolvedTheme === "dark"
        const chart = LWC.createChart(containerRef.current, {
          layout: {
            background: { color: "transparent" },
            textColor: dark ? "#a1a1aa" : "#52525b",
            fontFamily: "inherit",
          },
          grid: {
            vertLines: { color: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)" },
            horzLines: { color: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)" },
          },
          rightPriceScale: { borderColor: dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)" },
          timeScale: { borderColor: dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)", timeVisible: true, secondsVisible: false },
          crosshair: { mode: 0 },
          autoSize: true,
        })
        const candleSeries = chart.addCandlestickSeries({
          upColor: "#16a34a",
          downColor: "#dc2626",
          borderUpColor: "#16a34a",
          borderDownColor: "#dc2626",
          wickUpColor: "#16a34a",
          wickDownColor: "#dc2626",
        })
        const volumeSeries = chart.addHistogramSeries({
          priceFormat: { type: "volume" },
          priceScaleId: "",
          color: dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)",
        })
        volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })

        chartRef.current = chart
        candleSeriesRef.current = candleSeries
        volumeSeriesRef.current = volumeSeries
        readyRef.current = true
        // Prime with whatever we already have.
        candleSeries.setData(candles.map((c) => ({ time: c.time as any, open: c.open, high: c.high, low: c.low, close: c.close })))
        volumeSeries.setData(candles.map((c) => ({ time: c.time as any, value: c.volume, color: c.close >= c.open ? "rgba(22,163,74,0.4)" : "rgba(220,38,38,0.4)" })))
        chart.timeScale().fitContent()
      })
      .catch(() => {})

    return () => {
      disposed = true
      resizeObserver?.disconnect()
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
        candleSeriesRef.current = null
        volumeSeriesRef.current = null
        readyRef.current = false
      }
    }
    // Recreate on theme change so colors follow the app theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme])

  // Push candle updates as the replay reveals bars.
  useEffect(() => {
    const series = candleSeriesRef.current
    const vol = volumeSeriesRef.current
    if (!series || !vol) return
    series.setData(candles.map((c) => ({ time: c.time as any, open: c.open, high: c.high, low: c.low, close: c.close })))
    vol.setData(candles.map((c) => ({ time: c.time as any, value: c.volume, color: c.close >= c.open ? "rgba(22,163,74,0.4)" : "rgba(220,38,38,0.4)" })))
  }, [candles])

  // Entry/exit markers.
  useEffect(() => {
    const series = candleSeriesRef.current
    if (!series) return
    series.setMarkers(markers.map((m) => ({ time: m.time as any, position: m.position, color: m.color, shape: m.shape, text: m.text })))
  }, [markers])

  // SL / TP / entry price lines — rebuilt whenever they change.
  useEffect(() => {
    const series = candleSeriesRef.current
    if (!series) return
    for (const l of priceLineRefs.current) series.removePriceLine(l)
    priceLineRefs.current = priceLines.map((pl) =>
      series.createPriceLine({
        price: pl.price,
        color: pl.color,
        lineWidth: 1,
        lineStyle: pl.dashed ? 2 : 0,
        axisLabelVisible: true,
        title: pl.title,
      }),
    )
  }, [priceLines])

  return <div ref={containerRef} className="h-full w-full" />
}
