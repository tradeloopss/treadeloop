// Free, keyless historical bars from Yahoo Finance's chart endpoint. It covers
// exactly the instruments a futures/prop-firm trader wants to replay — index
// futures (NQ=F, ES=F, ...), plus crypto, FX and stocks — which is why it's the
// default provider. Caveats, documented so the UI can set expectations:
//   * Intraday history is shallow: ~7 days of 1m, ~60 days of 5m/15m/30m/1h,
//     then daily going back years. getCandles just returns what's available.
//   * It's an unofficial endpoint (no SLA); the MarketDataProvider abstraction
//     is what lets us swap in a paid feed or CSV upload later.
import type { Candle, GetCandlesParams, InstrumentInfo, MarketDataProvider } from "./types"
import { TIMEFRAMES } from "./types"
import { INSTRUMENTS } from "./instruments"

// Yahoo's interval ids differ slightly from ours (60m vs 1h).
const INTERVAL_MAP: Record<string, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "60m",
  "1d": "1d",
}

interface YahooChartResponse {
  chart: {
    result?: Array<{
      timestamp?: number[]
      indicators: {
        quote: Array<{
          open?: (number | null)[]
          high?: (number | null)[]
          low?: (number | null)[]
          close?: (number | null)[]
          volume?: (number | null)[]
        }>
      }
    }>
    error?: { code: string; description: string } | null
  }
}

export const yahooProvider: MarketDataProvider = {
  id: "yahoo",

  async getSymbols(): Promise<InstrumentInfo[]> {
    return INSTRUMENTS
  },

  async getTimeframes() {
    return TIMEFRAMES
  },

  async getCandles({ symbol, timeframe, from, to }: GetCandlesParams): Promise<Candle[]> {
    const interval = INTERVAL_MAP[timeframe] ?? "5m"
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`)
    url.searchParams.set("period1", String(Math.floor(from)))
    url.searchParams.set("period2", String(Math.ceil(to)))
    url.searchParams.set("interval", interval)
    url.searchParams.set("includePrePost", "false")

    const res = await fetch(url.toString(), {
      // A browser-ish UA avoids the occasional bot rejection; this runs
      // server-side so it never reaches the trader's IP.
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TradeLoop/1.0)" },
      // Bars for a fixed historical window never change, so let the platform
      // cache them — this is what keeps the replay from re-fetching.
      next: { revalidate: 60 * 60 },
    })
    if (!res.ok) throw new Error(`Yahoo chart request failed (${res.status})`)
    const data = (await res.json()) as YahooChartResponse
    if (data.chart.error) throw new Error(data.chart.error.description || "Yahoo returned an error for that symbol/range")
    const result = data.chart.result?.[0]
    const timestamps = result?.timestamp
    const quote = result?.indicators.quote[0]
    if (!timestamps || !quote) return []

    const candles: Candle[] = []
    for (let i = 0; i < timestamps.length; i++) {
      const o = quote.open?.[i]
      const h = quote.high?.[i]
      const l = quote.low?.[i]
      const c = quote.close?.[i]
      // Yahoo interleaves nulls for gaps/halts — skip any incomplete bar.
      if (o == null || h == null || l == null || c == null) continue
      candles.push({ time: timestamps[i], open: o, high: h, low: l, close: c, volume: quote.volume?.[i] ?? 0 })
    }
    return candles
  },
}
