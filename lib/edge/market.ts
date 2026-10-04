import type { Candle } from "@/lib/market-data/types"
import { instrumentOf } from "./core"

// What the market was doing around a trade, worked out from price history:
// the regime of the day (trending or ranging, how volatile), and how far the
// trade went for and against the trader while it was open. Pure — the fetching
// and storing is in market-server.ts.
//
// None of it is guessed: where there is no price history for an instrument, or
// it is too coarse for a short trade, there is no figure.

// Futures roots → the continuous contract on the price feed. Micros share the
// standard contract's price.
const FUTURES: Record<string, string> = {
  ES: "ES=F", MES: "ES=F", NQ: "NQ=F", MNQ: "NQ=F", RTY: "RTY=F", M2K: "RTY=F",
  YM: "YM=F", MYM: "YM=F", CL: "CL=F", MCL: "CL=F", NG: "NG=F", QM: "CL=F",
  GC: "GC=F", MGC: "GC=F", SI: "SI=F", SIL: "SI=F", HG: "HG=F",
  ZB: "ZB=F", ZN: "ZN=F", ZF: "ZF=F", ZC: "ZC=F", ZS: "ZS=F", ZW: "ZW=F",
  "6E": "EURUSD=X", "6B": "GBPUSD=X", "6J": "JPY=X", "6A": "AUDUSD=X", "6C": "CAD=X",
}

// The price feed's symbol for a trade's instrument, or null when it has none.
export function yahooSymbolFor(symbol: string, market: string): string | null {
  const base = instrumentOf(symbol, market)
  if (!base) return null
  if (market === "futures" || market === "future_option") return FUTURES[base] ?? null
  if (market === "crypto") {
    const coin = base.replace(/[-/]?USDT?$/, "")
    return coin ? `${coin}-USD` : null
  }
  if (market === "forex" || market === "cfd") return /^[A-Z]{6}$/.test(base) ? `${base}=X` : null
  if (market === "stocks") return /^[A-Z.]{1,6}$/.test(base) ? base : null
  return null
}

// ------------------------------------------------------------------ regimes

export type DailyRegime = { day: string; trend: "bullish" | "bearish" | "ranging"; volatility: "high" | "normal" | "low"; range: "expansion" | "normal" | "compression" }

// Daily bars needed before a day can be classified.
export const REGIME_WARMUP = 40

// Each day's regime, from that day's bar and the ones before it:
//   trend       — the 20-day efficiency ratio (net move ÷ total movement). At
//                 0.30 or more the market went somewhere: up is "bullish", down
//                 is "bearish". Below it, it went back and forth: "ranging".
//   volatility  — the 14-day average true range (as a share of price) against
//                 the previous 100 days: top third "high", bottom third "low".
//   range       — the day's own range against that average: 1.4× or more is
//                 "expansion", 0.6× or less is "compression".
export function dailyRegimes(candles: Candle[]): DailyRegime[] {
  const bars = [...candles].sort((a, b) => a.time - b.time)
  const tr: number[] = bars.map((b, i) => (i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))))
  const atrPct: number[] = []
  const out: DailyRegime[] = []
  for (let i = 0; i < bars.length; i++) {
    if (i < 14) {
      atrPct.push(NaN)
      continue
    }
    let sum = 0
    for (let k = i - 13; k <= i; k++) sum += tr[k]
    const atr = sum / 14
    atrPct.push(bars[i].close > 0 ? atr / bars[i].close : NaN)
    if (i < REGIME_WARMUP) continue

    let path = 0
    for (let k = i - 19; k <= i; k++) path += Math.abs(bars[k].close - bars[k - 1].close)
    const net = bars[i].close - bars[i - 20].close
    const efficiency = path > 0 ? Math.abs(net) / path : 0
    const trend = efficiency >= 0.3 ? (net > 0 ? "bullish" : "bearish") : "ranging"

    const history = atrPct.slice(Math.max(14, i - 100), i).filter((v) => Number.isFinite(v))
    let volatility: DailyRegime["volatility"] = "normal"
    if (history.length >= 30 && Number.isFinite(atrPct[i])) {
      const rank = history.filter((v) => v <= atrPct[i]).length / history.length
      volatility = rank >= 0.67 ? "high" : rank <= 0.33 ? "low" : "normal"
    }
    const ratio = atr > 0 ? tr[i] / atr : 1
    out.push({ day: new Date(bars[i].time * 1000).toISOString().slice(0, 10), trend, volatility, range: ratio >= 1.4 ? "expansion" : ratio <= 0.6 ? "compression" : "normal" })
  }
  return out
}

// ------------------------------------------------------------------ excursions

export type Excursion = { mae: number; mfe: number; maeR: number | null; mfeR: number | null } | null

// How far price went against the trade (MAE) and for it (MFE) while it was
// open, from the bars that cover it. `barSeconds` is the bars' timeframe.
// Returns null when the bars can't describe the trade: none cover it, it was
// shorter than one bar (the bar would include movement from outside the trade),
// or the prices aren't this instrument's.
export function excursion(candles: Candle[], trade: { entryMs: number; exitMs: number; side: "long" | "short"; entryPrice: number; riskPerUnit: number | null }, barSeconds: number): Excursion {
  const from = trade.entryMs / 1000
  const to = trade.exitMs / 1000
  if (to - from < barSeconds) return null
  // bars that overlap the time the trade was open
  const bars = candles.filter((c) => c.time + barSeconds > from && c.time < to)
  if (!bars.length) return null
  const high = Math.max(...bars.map((b) => b.high))
  const low = Math.min(...bars.map((b) => b.low))
  // a feed quoting something else (another contract, another scale) would give nonsense
  if (trade.entryPrice <= 0 || high < trade.entryPrice * 0.97 || low > trade.entryPrice * 1.03) return null
  const mfe = Math.max(0, trade.side === "long" ? high - trade.entryPrice : trade.entryPrice - low)
  const mae = Math.max(0, trade.side === "long" ? trade.entryPrice - low : high - trade.entryPrice)
  const r = trade.riskPerUnit && trade.riskPerUnit > 0 ? trade.riskPerUnit : null
  return { mae, mfe, maeR: r ? mae / r : null, mfeR: r ? mfe / r : null }
}
