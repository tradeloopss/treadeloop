"use server"

import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { fetchTimeBars, type RithmicBarType } from "@/lib/rithmic-client"
import { toRithmicSymbol } from "@/lib/rithmic-exchange"
import { INTERVAL_LIMITS } from "@/lib/chart-intervals"
import { yahooProvider } from "@/lib/market-data/yahoo"

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
  // Set when no candles could be loaded, with a plain-language reason to show
  // the user. We return this instead of throwing so production never masks the
  // real cause as an opaque React server-action error (#441).
  error?: string
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

// --- Yahoo fallback --------------------------------------------------------
// When Rithmic can't serve bars (cloud-IP throttling, missing entitlement, or
// the symbol just isn't futures) we fall back to Yahoo's free feed, which also
// lets us chart forex / crypto / stocks — things Rithmic doesn't carry here.
// Futures map to their liquid continuous front-month (micros share the
// standard contract's price action), which is plenty to picture the trade.
const FUTURES_ROOT_TO_YAHOO: Record<string, string> = {
  ES: "ES=F", MES: "ES=F", NQ: "NQ=F", MNQ: "NQ=F", RTY: "RTY=F", M2K: "RTY=F",
  YM: "YM=F", MYM: "YM=F", CL: "CL=F", MCL: "CL=F", NG: "NG=F", QM: "CL=F",
  GC: "GC=F", MGC: "GC=F", SI: "SI=F", SIL: "SI=F", HG: "HG=F",
  ZB: "ZB=F", ZN: "ZN=F", ZF: "ZF=F", ZC: "ZC=F", ZS: "ZS=F", ZW: "ZW=F",
  "6E": "EURUSD=X", "6B": "GBPUSD=X", "6J": "JPY=X", "6A": "AUDUSD=X", "6C": "CAD=X",
}

// Our interval ids → the timeframe ids lib/market-data expects (Yahoo uses
// "1h", not our "60m"; everything else lines up).
const OUR_TF_TO_YAHOO: Record<string, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "60m": "1h", "1d": "1d",
}

function toYahooSymbol(symbol: string, market: string): string | null {
  // Strip broker decorations ("EURUSDm", "BTCUSD.r", "US30-cash") down to the root.
  const base = symbol.trim().replace(/[.\-_].*$/, "").replace(/m$/, "").toUpperCase()
  if (!base) return null
  if (market === "futures") {
    const root = toRithmicSymbol(symbol)?.symbol ?? base
    return FUTURES_ROOT_TO_YAHOO[root] ?? null
  }
  if (market === "crypto") {
    const b = base.replace(/USDT?$/, "") || base
    return `${b}-USD`
  }
  if (market === "forex") {
    return /^[A-Z]{6}$/.test(base) ? `${base}=X` : null
  }
  return base // stocks / equities use the ticker directly
}

// Chart data comes straight from Rithmic — the actual venue the trade
// happened on — through one app-owned login (RITHMIC_MARKET_DATA_* env
// vars), the same pattern METAAPI_TOKEN already uses for MetaTrader. Market
// data isn't account-specific, so every user gets charts regardless of
// whether they've personally connected a Rithmic account — that's only
// needed for pulling someone's own trades/fills, a separate concern from
// market data. Rithmic carries futures only; forex/crypto/stocks (and any
// futures Rithmic can't serve from this cloud IP) come from the Yahoo
// fallback instead. Logins are serialized through lib/rithmic-client.ts's
// session queue, so rapid back-to-back chart requests (switching timeframes,
// React re-running an effect) don't trip Rithmic's rapid-relogin rejection.
//
// This NEVER throws for a data problem: it returns { points: [], error } with
// a plain-language reason. A thrown server action is masked in production as
// the opaque "React error #441", which is exactly the bug users were seeing —
// so any real failure is caught and surfaced through `error` instead.
//
// Used by the trade chart dialog (components/trade-chart-dialog.tsx). The
// TradingView Charting Library version (components/trade-chart-dialog-tv.tsx)
// waits on library access — see getRithmicBarsForDatafeed below for its feed.
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

  const entrySec = Math.floor(new Date(entryTime).getTime() / 1000)
  const exitSec = exitTime ? Math.floor(new Date(exitTime).getTime() / 1000) : entrySec
  const startIndex = entrySec - padding
  const finishIndex = Math.min(Math.floor(Date.now() / 1000), exitSec + padding)

  // Preferred source: real venue data from Rithmic (futures only). Never let a
  // failure here crash the action — fall through to the free feed instead.
  if (market === "futures") {
    try {
      const bar = INTERVAL_TO_BAR[interval] ?? INTERVAL_TO_BAR["5m"]
      const { mappedSymbol, points } = await fetchBars(symbol, market, bar.barType, bar.barTypePeriod, startIndex, finishIndex)
      if (points.length > 0) return { symbol: mappedSymbol, interval, points }
    } catch (err) {
      console.warn("[chart] Rithmic bars unavailable, trying Yahoo fallback:", err instanceof Error ? err.message : err)
    }
  }

  // Fallback, and the primary path for forex / crypto / stocks.
  const yahoo = toYahooSymbol(symbol, market)
  if (yahoo) {
    try {
      const candles = await yahooProvider.getCandles({
        symbol: yahoo,
        timeframe: OUR_TF_TO_YAHOO[interval] ?? interval,
        from: startIndex,
        to: finishIndex,
      })
      const points = candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 }))
      if (points.length > 0) return { symbol: yahoo, interval, points }
    } catch (err) {
      console.warn("[chart] Yahoo bars unavailable:", err instanceof Error ? err.message : err)
    }
  }

  // Nothing available. Return an empty series with a clear reason rather than
  // throwing (a throw would surface as the masked React #441 in production).
  const intraday = interval !== "1d"
  return {
    symbol,
    interval,
    points: [],
    error: intraday
      ? "No intraday candles for this trade — free historical minute data only goes back ~60 days. Try the 1D timeframe."
      : "Chart data isn't available for this symbol yet.",
  }
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
