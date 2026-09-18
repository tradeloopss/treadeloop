"use server"

import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { fetchTimeBars, type RithmicBarType } from "@/lib/rithmic-client"
import { toRithmicSymbol } from "@/lib/rithmic-exchange"
import { INTERVAL_LIMITS } from "@/lib/chart-intervals"

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
}

export interface ChartPoint {
  time: number // unix seconds
  open: number
  close: number
  high: number
  low: number
  volume: number
}

export interface TradeChartData {
  symbol: string
  interval: string
  points: ChartPoint[]
}

// Bar type/period Rithmic needs for each timeframe label the UI offers.
const INTERVAL_TO_BAR: Record<string, { barType: RithmicBarType; barTypePeriod: number }> = {
  "1m": { barType: "MINUTE_BAR", barTypePeriod: 1 },
  "5m": { barType: "MINUTE_BAR", barTypePeriod: 5 },
  "15m": { barType: "MINUTE_BAR", barTypePeriod: 15 },
  "60m": { barType: "MINUTE_BAR", barTypePeriod: 60 },
  "1d": { barType: "DAILY_BAR", barTypePeriod: 1 },
}

// Same bar type/period table, keyed by TradingView's own resolution strings
// instead — used by the Charting Library datafeed (see
// components/trade-chart-dialog-tv.tsx), which calls getBars with whatever
// resolution its own UI is set to, not one of our INTERVAL_LIMITS keys.
const TV_RESOLUTION_TO_BAR: Record<string, { barType: RithmicBarType; barTypePeriod: number }> = {
  "1": { barType: "MINUTE_BAR", barTypePeriod: 1 },
  "5": { barType: "MINUTE_BAR", barTypePeriod: 5 },
  "15": { barType: "MINUTE_BAR", barTypePeriod: 15 },
  "60": { barType: "MINUTE_BAR", barTypePeriod: 60 },
  "1D": { barType: "DAILY_BAR", barTypePeriod: 1 },
}

// Rithmic Test only distributes other developers' sparse, disconnected test
// activity — not real market data — so a chart built from it would show
// candles that never actually happened. Block it until the login behind
// these env vars has live data entitlements (Rithmic calls this "passing
// conformance"), rather than silently rendering fabricated price action.
const NON_LIVE_SYSTEMS = ["rithmic test", "rithmic paper trading"]

function marketDataCredentials() {
  const user = process.env.RITHMIC_MARKET_DATA_USER
  const password = process.env.RITHMIC_MARKET_DATA_PASSWORD
  const systemName = process.env.RITHMIC_MARKET_DATA_SYSTEM
  const gatewayUri = process.env.RITHMIC_MARKET_DATA_GATEWAY
  if (!user || !password || !systemName || !gatewayUri) {
    throw new Error("Chart market data isn't configured on this server yet")
  }
  if (NON_LIVE_SYSTEMS.includes(systemName.trim().toLowerCase())) {
    throw new Error("Live chart data isn't available yet — check back soon.")
  }
  return { user, password, systemName, gatewayUri }
}

async function fetchBars(
  symbol: string,
  market: string,
  barType: RithmicBarType,
  barTypePeriod: number,
  startIndex: number,
  finishIndex: number
): Promise<{ mappedSymbol: string; points: ChartPoint[] }> {
  if (market !== "futures") {
    throw new Error("Charts are only available for futures trades right now")
  }
  const mapped = toRithmicSymbol(symbol)
  if (!mapped) {
    throw new Error(`No chart available for "${symbol}" yet`)
  }
  const { user, password, systemName, gatewayUri } = marketDataCredentials()

  const bars = await fetchTimeBars(
    user,
    password,
    systemName,
    gatewayUri,
    mapped.symbol,
    mapped.exchange,
    barType,
    barTypePeriod,
    startIndex,
    finishIndex
  )

  return {
    mappedSymbol: `${mapped.exchange}:${mapped.symbol}`,
    points: bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })),
  }
}

// Chart data comes straight from Rithmic — the actual venue the trade
// happened on — through one app-owned login (RITHMIC_MARKET_DATA_* env
// vars), the same pattern METAAPI_TOKEN already uses for MetaTrader. Market
// data isn't account-specific, so every user gets charts regardless of
// whether they've personally connected a Rithmic account — that's only
// needed for pulling someone's own trades/fills, a separate concern from
// market data. Only futures are supported, since that's what Rithmic
// carries. Logins are serialized through lib/rithmic-client.ts's session
// queue, so rapid back-to-back chart requests (switching timeframes, React
// re-running an effect) don't trip Rithmic's rapid-relogin rejection.
//
// Used by the current recharts-based chart dialog (components/trade-chart-
// dialog.tsx). Kept working as-is while components/trade-chart-dialog-tv.tsx
// (the real TradingView Charting Library version) waits on library access —
// see getRithmicBarsForDatafeed below for that one's data source.
export async function getTradeChartData(
  symbol: string,
  market: string,
  entryTime: string,
  exitTime: string | null,
  intervalOverride?: string
): Promise<TradeChartData> {
  await requireSession()

  const interval = intervalOverride && INTERVAL_LIMITS[intervalOverride] ? intervalOverride : "5m"
  const { padding } = INTERVAL_LIMITS[interval]
  const { barType, barTypePeriod } = INTERVAL_TO_BAR[interval]

  const entrySec = Math.floor(new Date(entryTime).getTime() / 1000)
  const exitSec = exitTime ? Math.floor(new Date(exitTime).getTime() / 1000) : entrySec
  const startIndex = entrySec - padding
  const finishIndex = Math.min(Math.floor(Date.now() / 1000), exitSec + padding)

  const { mappedSymbol, points } = await fetchBars(symbol, market, barType, barTypePeriod, startIndex, finishIndex)
  if (points.length === 0) {
    throw new Error(
      `No chart data available from Rithmic for this symbol at this timeframe — the site's market data account may not have access to it`
    )
  }
  return { symbol: mappedSymbol, interval, points }
}

// Resolution/range-driven — this is what the TradingView Charting Library's
// Datafeed.getBars calls, since the library manages its own pan/zoom/
// resolution switching and asks for whatever range it currently needs,
// rather than us computing a window around one trade up front.
export async function getRithmicBarsForDatafeed(
  symbol: string,
  market: string,
  resolution: string,
  fromSec: number,
  toSec: number
): Promise<ChartPoint[]> {
  await requireSession()
  const barSpec = TV_RESOLUTION_TO_BAR[resolution]
  if (!barSpec) {
    throw new Error(`Unsupported resolution "${resolution}"`)
  }
  const { points } = await fetchBars(symbol, market, barSpec.barType, barSpec.barTypePeriod, fromSec, toSec)
  return points
}
