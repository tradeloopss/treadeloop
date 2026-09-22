// The market-data layer is deliberately provider-agnostic: the replay and
// execution engines only ever see `Candle[]`, so the underlying source (a free
// keyless API today, a paid feed or an uploaded CSV tomorrow) can change
// without touching anything downstream. Add a provider by implementing
// MarketDataProvider and registering it in ./index.ts.

// One OHLCV bar. `time` is the bar's OPEN time in unix seconds (the convention
// lightweight-charts and most feeds use), so a candle is only "complete"/safe
// to reveal once the replay clock has passed time + timeframe.
export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface InstrumentInfo {
  symbol: string // the provider's own symbol, e.g. "NQ=F" or "BTC-USD"
  name: string
  market: "futures" | "crypto" | "forex" | "stocks"
}

export interface Timeframe {
  id: string // "1m" | "5m" | "15m" | "1h" | "1d" ...
  label: string
  seconds: number
}

export interface GetCandlesParams {
  symbol: string
  timeframe: string
  from: number // unix seconds, inclusive
  to: number // unix seconds, inclusive
}

export interface MarketDataProvider {
  id: string
  getSymbols(): Promise<InstrumentInfo[]>
  getTimeframes(): Promise<Timeframe[]>
  getCandles(params: GetCandlesParams): Promise<Candle[]>
}

export const TIMEFRAMES: Timeframe[] = [
  { id: "1m", label: "1 min", seconds: 60 },
  { id: "5m", label: "5 min", seconds: 300 },
  { id: "15m", label: "15 min", seconds: 900 },
  { id: "30m", label: "30 min", seconds: 1800 },
  { id: "1h", label: "1 hour", seconds: 3600 },
  { id: "1d", label: "1 day", seconds: 86400 },
  { id: "1w", label: "1 week", seconds: 604800 },
  { id: "1M", label: "1 month", seconds: 2592000 },
]

export function timeframeSeconds(id: string): number {
  return TIMEFRAMES.find((t) => t.id === id)?.seconds ?? 300
}
