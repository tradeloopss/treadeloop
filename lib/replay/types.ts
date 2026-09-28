// Trade Replay domain types. Kept separate from the UI so a real market-data /
// account backend can slot in later without touching components. A Candle is
// the same OHLCV bar the market-data + backtest engines use — imported, not
// redefined.
import type { Candle } from "@/lib/market-data/types"

export type { Candle }

export type Side = "long" | "short"
export type ReplayMode = "practice" | "single" | "all"
export type RuleStatus = "safe" | "warning" | "breach"

// A tradable instrument with the constants P&L math needs. `pip` is one pip in
// price; `contractMultiplier` turns a 1-unit price move into money per lot.
export interface ReplaySymbol {
  symbol: string
  name: string
  digits: number
  pip: number
  contractMultiplier: number
  seed: number // deterministic mock-data seed + a plausible base price
  basePrice: number
}

// A prop-firm rule set, in account currency. Any limit can be null (a practice
// account with no rule). Values are absolute dollars, not percentages.
export interface PropFirmRuleSet {
  profitTarget: number | null
  dailyLoss: number | null
  maxDrawdown: number | null
  minTradingDays: number | null
}

export interface ReplayAccount {
  id: string
  name: string // "FTMO $100K"
  firm: string // "FTMO"
  platform: string // "MetaTrader 5" | "Rithmic" | "Practice"
  currency: string
  startingBalance: number
  rules: PropFirmRuleSet
}

export interface ReplayTrade {
  id: string
  symbol: string
  side: Side
  size: number // lots
  entry: number
  stopLoss: number | null
  takeProfit: number | null
  entryTime: number // unix seconds (market time)
  status: "open" | "closed"
  exitPrice?: number
  exitTime?: number
  pnl?: number // realized, set on close
  result?: "win" | "loss" | "be"
  reason?: "sl" | "tp" | "manual"
  note?: string
  tags?: string[]
  // Snapshotted at entry so P&L never depends on a later symbol lookup.
  contractMultiplier: number
  pip: number
  digits: number
}

export interface ReplayActivityItem {
  id: string
  text: string
  at: number // unix seconds (market time)
  tone: "gain" | "loss" | "neutral" | "warning"
}

// The live account snapshot the UI renders — derived, never stored.
export interface AccountState {
  balance: number
  equity: number
  todayPnl: number
  openRisk: number
  openTrades: number
}

// One prop-firm rule's live progress, for the rules card.
export interface RuleProgress {
  label: string
  used: number
  limit: number | null
  pct: number // 0–100 of the limit
  status: RuleStatus
}
