// Replay engine — answers "what is the current market time / which candles has
// the trader seen?". It is the single guard against look-ahead bias: everything
// downstream only ever receives the slice at or before `currentTime`, and the
// only way to see more is to advance the cursor. Pure functions over an
// in-memory candle array — no per-candle fetching (see lib/market-data and the
// chunked loader for how the array is filled ahead of the cursor).
import type { Candle } from "./types"

// Candles the trader is allowed to see at `currentTime` — bars whose OPEN time
// is at or before now. A bar that opened exactly at currentTime is the "current"
// (forming) candle.
export function visibleCandles(candles: Candle[], currentTime: number): Candle[] {
  return candles.filter((c) => c.time <= currentTime)
}

// The open time of the next bar after `currentTime`, or null at the end.
export function nextCandleTime(candles: Candle[], currentTime: number): number | null {
  for (const c of candles) if (c.time > currentTime) return c.time
  return null
}

// The bar that just became visible when advancing to `time` (the one whose open
// equals `time`), used to feed the execution engine exactly one step.
export function candleAt(candles: Candle[], time: number): Candle | null {
  return candles.find((c) => c.time === time) ?? null
}

export function isAtEnd(candles: Candle[], currentTime: number): boolean {
  return nextCandleTime(candles, currentTime) == null
}

// How many bars remain to be revealed — drives the progress indicator.
export function remainingCandles(candles: Candle[], currentTime: number): number {
  let n = 0
  for (const c of candles) if (c.time > currentTime) n++
  return n
}
