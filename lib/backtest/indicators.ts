// Overlay indicators computed from the visible candles. Pure functions →
// {time, value} series the chart draws as line overlays. Kept dependency-free
// and separate from the chart so they can be unit-tested and reused. These are
// the common price-scale overlays Lightweight Charts can render directly; a
// separate-pane oscillator (RSI/MACD) or TradingView's full indicator engine
// would need the licensed charting library.
import type { Candle } from "@/lib/market-data/types"

export type IndicatorId = "sma20" | "sma50" | "ema9" | "ema21" | "vwap" | "bb"

export interface LinePoint {
  time: number
  value: number
}

export interface IndicatorOutput {
  id: string
  color: string
  points: LinePoint[]
}

export function sma(candles: Candle[], period: number): LinePoint[] {
  const out: LinePoint[] = []
  let sum = 0
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close
    if (i >= period) sum -= candles[i - period].close
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period })
  }
  return out
}

export function ema(candles: Candle[], period: number): LinePoint[] {
  if (candles.length < period) return []
  const k = 2 / (period + 1)
  const out: LinePoint[] = []
  // Seed with the SMA of the first `period` closes.
  let prev = 0
  for (let i = 0; i < period; i++) prev += candles[i].close
  prev /= period
  out.push({ time: candles[period - 1].time, value: prev })
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k)
    out.push({ time: candles[i].time, value: prev })
  }
  return out
}

// Cumulative session VWAP over the given candles (typical price × volume).
export function vwap(candles: Candle[]): LinePoint[] {
  const out: LinePoint[] = []
  let cumPV = 0
  let cumV = 0
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3
    const v = c.volume || 1
    cumPV += tp * v
    cumV += v
    out.push({ time: c.time, value: cumV ? cumPV / cumV : c.close })
  }
  return out
}

export function bollinger(candles: Candle[], period = 20, mult = 2): { upper: LinePoint[]; middle: LinePoint[]; lower: LinePoint[] } {
  const upper: LinePoint[] = []
  const middle: LinePoint[] = []
  const lower: LinePoint[] = []
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close
    const mean = sum / period
    let variance = 0
    for (let j = i - period + 1; j <= i; j++) variance += (candles[j].close - mean) ** 2
    const sd = Math.sqrt(variance / period)
    const time = candles[i].time
    middle.push({ time, value: mean })
    upper.push({ time, value: mean + mult * sd })
    lower.push({ time, value: mean - mult * sd })
  }
  return { upper, middle, lower }
}

export const INDICATOR_META: Record<IndicatorId, { label: string; color: string }> = {
  sma20: { label: "SMA 20", color: "#f59e0b" },
  sma50: { label: "SMA 50", color: "#3b82f6" },
  ema9: { label: "EMA 9", color: "#ec4899" },
  ema21: { label: "EMA 21", color: "#8b5cf6" },
  vwap: { label: "VWAP", color: "#14b8a6" },
  bb: { label: "Bollinger Bands", color: "#94a3b8" },
}

// Turns the selected indicator ids into drawable line series for the chart.
export function computeIndicators(candles: Candle[], ids: IndicatorId[]): IndicatorOutput[] {
  const out: IndicatorOutput[] = []
  for (const id of ids) {
    const meta = INDICATOR_META[id]
    if (id === "sma20") out.push({ id, color: meta.color, points: sma(candles, 20) })
    else if (id === "sma50") out.push({ id, color: meta.color, points: sma(candles, 50) })
    else if (id === "ema9") out.push({ id, color: meta.color, points: ema(candles, 9) })
    else if (id === "ema21") out.push({ id, color: meta.color, points: ema(candles, 21) })
    else if (id === "vwap") out.push({ id, color: meta.color, points: vwap(candles) })
    else if (id === "bb") {
      const bb = bollinger(candles, 20, 2)
      out.push({ id: "bb-upper", color: meta.color, points: bb.upper })
      out.push({ id: "bb-middle", color: meta.color, points: bb.middle })
      out.push({ id: "bb-lower", color: meta.color, points: bb.lower })
    }
  }
  return out
}
