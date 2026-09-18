// Shared trade math + analytics helpers. Kept framework-agnostic so both
// server actions and client components can use them.

export type Market = "futures" | "stocks" | "options" | "future_option" | "forex" | "crypto" | "cfd"
export type Side = "long" | "short"
export type TradeStatus = "open" | "closed"

export interface TradeInput {
  side: Side
  quantity: number
  entryPrice: number
  exitPrice?: number | null
  fees?: number
  contractMultiplier?: number
}

// Common futures contracts and their point value (per 1.00 price move).
export const FUTURES_CONTRACTS: Record<string, { name: string; multiplier: number; tickSize: number }> = {
  ES: { name: "E-mini S&P 500", multiplier: 50, tickSize: 0.25 },
  MES: { name: "Micro E-mini S&P 500", multiplier: 5, tickSize: 0.25 },
  NQ: { name: "E-mini Nasdaq 100", multiplier: 20, tickSize: 0.25 },
  MNQ: { name: "Micro E-mini Nasdaq 100", multiplier: 2, tickSize: 0.25 },
  YM: { name: "E-mini Dow", multiplier: 5, tickSize: 1 },
  MYM: { name: "Micro E-mini Dow", multiplier: 0.5, tickSize: 1 },
  RTY: { name: "E-mini Russell 2000", multiplier: 50, tickSize: 0.1 },
  M2K: { name: "Micro E-mini Russell 2000", multiplier: 5, tickSize: 0.1 },
  CL: { name: "Crude Oil", multiplier: 1000, tickSize: 0.01 },
  MCL: { name: "Micro Crude Oil", multiplier: 100, tickSize: 0.01 },
  GC: { name: "Gold", multiplier: 100, tickSize: 0.1 },
  MGC: { name: "Micro Gold", multiplier: 10, tickSize: 0.1 },
  SI: { name: "Silver", multiplier: 5000, tickSize: 0.005 },
  ZB: { name: "30-Year T-Bond", multiplier: 1000, tickSize: 0.03125 },
  ZN: { name: "10-Year T-Note", multiplier: 1000, tickSize: 0.015625 },
  "6E": { name: "Euro FX", multiplier: 125000, tickSize: 0.00005 },
  "6J": { name: "Japanese Yen", multiplier: 12500000, tickSize: 0.0000005 },
  HG: { name: "Copper", multiplier: 25000, tickSize: 0.0005 },
  NG: { name: "Natural Gas", multiplier: 10000, tickSize: 0.001 },
}

// Matches a broker contract symbol (e.g. "MESZ4") against the known root
// (e.g. "MES") to find its point value. Longest roots are checked first so
// "MES"/"MNQ" don't get mistaken for a prefix of "ES"/"NQ".
export function contractMultiplierForSymbol(contractName: string): number {
  const upper = contractName.toUpperCase()
  const roots = Object.keys(FUTURES_CONTRACTS).sort((a, b) => b.length - a.length)
  for (const root of roots) {
    if (upper.startsWith(root)) return FUTURES_CONTRACTS[root].multiplier
  }
  return 1
}

// Standard CME futures month codes (F=Jan ... Z=Dec) — public exchange
// convention, not firm-specific. Used only to show a human-readable hint
// (e.g. "MNQU4" -> "September 2024") next to the symbol field; the actual
// expiration date the user enters is still authoritative.
const FUTURES_MONTH_CODES: Record<string, number> = {
  F: 0, G: 1, H: 2, J: 3, K: 4, M: 5, N: 6, Q: 7, U: 8, V: 9, X: 10, Z: 11,
}

export function parseFuturesExpiryHint(contractName: string): string | null {
  const upper = contractName.toUpperCase()
  const roots = Object.keys(FUTURES_CONTRACTS).sort((a, b) => b.length - a.length)
  const root = roots.find((r) => upper.startsWith(r))
  if (!root) return null
  const suffix = upper.slice(root.length)
  const match = suffix.match(/^([FGHJKMNQUVXZ])(\d{1,2})$/)
  if (!match) return null
  const monthIndex = FUTURES_MONTH_CODES[match[1]]
  const yearDigits = match[2]
  const year = yearDigits.length === 1 ? 2020 + Number(yearDigits) : 2000 + Number(yearDigits)
  const monthName = new Date(year, monthIndex, 1).toLocaleString("en-US", { month: "long" })
  return `${match[1]}${yearDigits} → ${monthName} ${year}`
}

export function computePnl(t: TradeInput): number {
  if (t.exitPrice == null || Number.isNaN(t.exitPrice)) return 0
  const dir = t.side === "long" ? 1 : -1
  const mult = t.contractMultiplier ?? 1
  const gross = (t.exitPrice - t.entryPrice) * t.quantity * mult * dir
  return gross - (t.fees ?? 0)
}

// R-multiple = realized PnL / initial risk (entry→stop distance * size).
export function computeRMultiple(t: TradeInput & { stopLoss?: number | null }): number | null {
  if (t.stopLoss == null || t.exitPrice == null) return null
  const mult = t.contractMultiplier ?? 1
  const riskPerUnit = Math.abs(t.entryPrice - t.stopLoss)
  const risk = riskPerUnit * t.quantity * mult
  if (risk === 0) return null
  const pnl = computePnl(t)
  return pnl / risk
}

export interface TradeStat {
  pnl: number
  entryTime: string | Date
  exitTime?: string | Date | null
  rMultiple?: number | null
  status: string
}

export interface Analytics {
  netPnl: number
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  profitFactor: number
  avgWin: number
  avgLoss: number
  expectancy: number
  largestWin: number
  largestLoss: number
  avgRMultiple: number
  maxDrawdown: number
  currentStreak: number
}

export function analyze(trades: TradeStat[]): Analytics {
  const closed = trades.filter((t) => t.status === "closed")
  const pnls = closed.map((t) => t.pnl)
  const wins = pnls.filter((p) => p > 0)
  const losses = pnls.filter((p) => p < 0)
  const grossProfit = wins.reduce((a, b) => a + b, 0)
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0))
  const netPnl = pnls.reduce((a, b) => a + b, 0)

  const rMultiples = closed.map((t) => t.rMultiple).filter((r): r is number => r != null)

  // Max drawdown from the cumulative equity curve.
  const sorted = [...closed].sort(
    (a, b) => new Date(a.exitTime ?? a.entryTime).getTime() - new Date(b.exitTime ?? b.entryTime).getTime(),
  )
  let peak = 0
  let equity = 0
  let maxDd = 0
  for (const t of sorted) {
    equity += t.pnl
    if (equity > peak) peak = equity
    const dd = peak - equity
    if (dd > maxDd) maxDd = dd
  }

  // Current win/loss streak (negative = losing streak).
  let streak = 0
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i].pnl
    if (p === 0) break
    if (streak === 0) streak = p > 0 ? 1 : -1
    else if ((streak > 0 && p > 0) || (streak < 0 && p < 0)) streak += p > 0 ? 1 : -1
    else break
  }

  return {
    netPnl,
    totalTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0,
    avgWin: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? -grossLoss / losses.length : 0,
    expectancy: closed.length ? netPnl / closed.length : 0,
    largestWin: wins.length ? Math.max(...wins) : 0,
    largestLoss: losses.length ? Math.min(...losses) : 0,
    avgRMultiple: rMultiples.length ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : 0,
    maxDrawdown: maxDd,
    currentStreak: streak,
  }
}

export function formatCurrency(n: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

export function formatCompact(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)
}

export type TradingSession = "Asia" | "London" | "NY AM" | "NY PM"

// Approximate FX/futures session windows by UTC hour. Boundaries overlap in
// reality, but this split is the common simplification (London open ~08:00
// UTC, NY morning ~13:00-17:00 UTC, NY afternoon ~17:00-21:00 UTC, and Asia
// covering the rest — Tokyo/Sydney open through the early London pre-market).
export function tradingSession(date: string | Date): TradingSession {
  const hour = new Date(date).getUTCHours()
  if (hour >= 8 && hour < 13) return "London"
  if (hour >= 13 && hour < 17) return "NY AM"
  if (hour >= 17 && hour < 21) return "NY PM"
  return "Asia"
}
