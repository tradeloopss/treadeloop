// Types shared across the backtest engines. A Candle is the same OHLCV bar the
// market-data layer produces — imported, not redefined, so there's one shape
// end to end.
import type { Candle } from "@/lib/market-data/types"

export type { Candle }

export type PositionSide = "long" | "short"
export type OrderSide = "buy" | "sell"

// A resting order waiting for the market to reach it. Market orders never rest
// — they fill immediately against the current candle — so only limit/stop live
// here.
export interface PendingOrder {
  id: string
  kind: "limit" | "stop"
  side: OrderSide
  qty: number
  price: number // limit price or stop trigger
  stopLoss: number | null
  takeProfit: number | null
  symbol: string
  contractMultiplier: number
  createdAt: number // market time, unix seconds
}

// The single open position (one-position MVP). contractMultiplier/tickValue are
// snapshotted at entry so P&L math never depends on a later symbol lookup.
export interface OpenPosition {
  side: PositionSide
  qty: number
  entryPrice: number
  entryTime: number // unix seconds
  stopLoss: number | null
  takeProfit: number | null
  symbol: string
  contractMultiplier: number
  fees: number
}

// Emitted when a position closes, carrying everything the trade record needs.
export interface CloseEvent {
  position: OpenPosition
  exitPrice: number
  exitTime: number
  reason: "sl" | "tp" | "manual" | "liquidation"
  pnl: number
}
