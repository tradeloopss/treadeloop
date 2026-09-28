"use client"

// The taken trade on a real TradingView chart, via TradingView's free public
// Advanced Chart embed widget (no private Charting Library files needed). The
// widget can't take programmatic entry/exit markers, so the dialog shows the
// trade's levels as a legend above it; this renders the instrument itself on
// TradingView so the trader can inspect the setup on the chart they know.
import { useEffect, useRef } from "react"
import { useTheme } from "next-themes"

// Map our stored symbol to a TradingView symbol. Strips broker suffixes
// ("EURUSDm", "EURUSD.r") and prefixes an exchange TradingView will resolve.
export function toTradingViewSymbol(symbol: string, market: string): string {
  const s = symbol
    .replace(/[.\-_].*$/, "") // broker suffix after a separator
    .replace(/m$/, "") // Exness-style trailing "m"
    .toUpperCase()
  if (/^XA[UG]USD$/.test(s)) return `OANDA:${s}` // gold / silver
  if (market === "forex" && /^[A-Z]{6}$/.test(s)) return `FX:${s}`
  if (market === "crypto") return s // TradingView resolves BTCUSD etc.
  return s
}

// Our interval ids → TradingView's ("1","5","15","60","240","D","W").
function tvInterval(interval: string): string {
  return { "1m": "1", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "4h": "240", "1d": "D", "1w": "W" }[interval] ?? "15"
}

export function TradeTradingViewChart({ symbol, market, interval }: { symbol: string; market: string; interval: string }) {
  const { resolvedTheme } = useTheme()
  const ref = useRef<HTMLDivElement>(null)
  const tvSymbol = toTradingViewSymbol(symbol, market)

  useEffect(() => {
    const container = ref.current
    if (!container) return
    container.innerHTML = '<div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>'
    const script = document.createElement("script")
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
    script.type = "text/javascript"
    script.async = true
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: tvInterval(interval),
      timezone: "Etc/UTC",
      theme: resolvedTheme === "dark" ? "dark" : "light",
      style: "1",
      locale: "en",
      hide_side_toolbar: false,
      allow_symbol_change: true,
      calendar: false,
      support_host: "https://www.tradingview.com",
    })
    container.appendChild(script)
    return () => {
      container.innerHTML = ""
    }
  }, [tvSymbol, interval, resolvedTheme])

  return (
    <div className="h-[460px] w-full overflow-hidden rounded-lg border">
      <div ref={ref} className="tradingview-widget-container h-full w-full" />
    </div>
  )
}
