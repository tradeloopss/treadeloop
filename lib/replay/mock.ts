// Deterministic mock market data + accounts for the replay MVP. The candle
// generator is a seeded random walk so a given (symbol, timeframe, date) always
// replays the same session — swap this for the real market-data provider
// (lib/market-data) later without touching the UI.
import type { Candle } from "@/lib/market-data/types"
import type { ReplayAccount, ReplaySymbol } from "@/lib/replay/types"

export const REPLAY_SYMBOLS: ReplaySymbol[] = [
  { symbol: "EURUSD", name: "Euro / US Dollar", digits: 5, pip: 0.0001, contractMultiplier: 100_000, seed: 11, basePrice: 1.0842 },
  { symbol: "GBPUSD", name: "British Pound / US Dollar", digits: 5, pip: 0.0001, contractMultiplier: 100_000, seed: 23, basePrice: 1.2715 },
  { symbol: "XAUUSD", name: "Gold / US Dollar", digits: 2, pip: 0.1, contractMultiplier: 100, seed: 37, basePrice: 2648.5 },
  { symbol: "US100", name: "US Tech 100", digits: 1, pip: 1, contractMultiplier: 2, seed: 51, basePrice: 20120 },
  { symbol: "BTCUSD", name: "Bitcoin / US Dollar", digits: 1, pip: 1, contractMultiplier: 1, seed: 67, basePrice: 63250 },
]

export function findSymbol(symbol: string): ReplaySymbol {
  return REPLAY_SYMBOLS.find((s) => s.symbol === symbol) ?? REPLAY_SYMBOLS[0]
}

export const REPLAY_ACCOUNTS: ReplayAccount[] = [
  { id: "practice", name: "Practice Account", firm: "Practice", platform: "Practice", currency: "USD", startingBalance: 100_000, rules: { profitTarget: null, dailyLoss: null, maxDrawdown: null, minTradingDays: null } },
  { id: "ftmo-100k", name: "FTMO $100K", firm: "FTMO", platform: "MetaTrader 5", currency: "USD", startingBalance: 100_000, rules: { profitTarget: 8_000, dailyLoss: 2_500, maxDrawdown: 5_000, minTradingDays: 10 } },
  { id: "apex-50k", name: "Apex $50K", firm: "Apex Trader Funding", platform: "Rithmic", currency: "USD", startingBalance: 50_000, rules: { profitTarget: 3_000, dailyLoss: 2_500, maxDrawdown: 2_500, minTradingDays: null } },
  { id: "topstep-100k", name: "Topstep $100K", firm: "Topstep", platform: "Rithmic", currency: "USD", startingBalance: 100_000, rules: { profitTarget: 6_000, dailyLoss: 3_200, maxDrawdown: 3_000, minTradingDays: null } },
  { id: "fundednext-50k", name: "FundedNext $50K", firm: "FundedNext", platform: "MetaTrader 5", currency: "USD", startingBalance: 50_000, rules: { profitTarget: 4_000, dailyLoss: 2_500, maxDrawdown: 4_000, minTradingDays: 5 } },
]

// Small, fast, deterministic PRNG (mulberry32).
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Generate `count` candles for a symbol/timeframe starting at `startUnix`. A
// gentle trending random walk with realistic-looking wicks and volume.
export function generateCandles(symbol: string, timeframeSeconds: number, startUnix: number, count: number): Candle[] {
  const meta = findSymbol(symbol)
  // Seed off the symbol + the day so the same date replays identically.
  const dayIndex = Math.floor(startUnix / 86400)
  const rand = rng(meta.seed * 100003 + dayIndex)
  const vol = meta.pip * (meta.symbol === "XAUUSD" ? 40 : meta.symbol === "US100" ? 60 : meta.symbol === "BTCUSD" ? 120 : 12)
  const drift = (rand() - 0.5) * vol * 0.3
  const candles: Candle[] = []
  let price = meta.basePrice * (1 + (rand() - 0.5) * 0.004)
  for (let i = 0; i < count; i++) {
    const open = price
    const step = (rand() - 0.5) * 2 * vol + drift
    let close = open + step
    if (close <= 0) close = open
    const wick = vol * (0.4 + rand())
    const high = Math.max(open, close) + rand() * wick
    const low = Math.min(open, close) - rand() * wick
    const volume = Math.round(400 + rand() * 1600)
    const round = (v: number) => Number(v.toFixed(meta.digits))
    candles.push({ time: startUnix + i * timeframeSeconds, open: round(open), high: round(high), low: round(low), close: round(close), volume })
    price = close
  }
  return candles
}

// The unix-seconds start of a replay session: the given date at the session's
// start hour, treated as UTC for deterministic mock data.
export function sessionStartUnix(dateISO: string, startHour: number): number {
  return Math.floor(new Date(`${dateISO}T${String(startHour).padStart(2, "0")}:00:00Z`).getTime() / 1000)
}
