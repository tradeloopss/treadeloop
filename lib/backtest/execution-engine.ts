// Execution engine — answers "what happened to orders and positions on this
// candle?". Pure and framework-free so it runs both in the replay UI (stepping
// candle by candle as the trader plays) and on the server. It never fetches or
// stores anything; it takes the current state + one candle and returns the next
// state. Persisting a closed trade into the real trade log is the caller's job.
import type { Candle, CloseEvent, OpenPosition, PendingOrder } from "./types"
import { computePnl } from "@/lib/calc"

// Realized/unrealized P&L of a position marked at `price`, via the same
// computePnl the live journal uses — one source of truth for trade math.
export function positionPnl(position: OpenPosition, price: number): number {
  return computePnl({
    side: position.side,
    quantity: position.qty,
    entryPrice: position.entryPrice,
    exitPrice: price,
    fees: position.fees,
    contractMultiplier: position.contractMultiplier,
  })
}

// Does this candle hit the position's stop or target?
//   long:  stop when low <= SL,  target when high >= TP
//   short: stop when high >= SL, target when low <= TP
//
// INTRABAR RULE (MVP): when one candle's range spans BOTH the stop and the
// target, OHLC alone can't say which printed first, so we take the STOP —
// the conservative, worst-case fill. The engine is built to later consume a
// lower execution timeframe (session.executionTimeframe) to resolve the true
// sequence; until then this rule is deterministic and documented here.
export function resolvePositionExit(candle: Candle, position: OpenPosition): { price: number; reason: "sl" | "tp" } | null {
  const { side, stopLoss: sl, takeProfit: tp } = position
  const hitSl = sl != null && (side === "long" ? candle.low <= sl : candle.high >= sl)
  const hitTp = tp != null && (side === "long" ? candle.high >= tp : candle.low <= tp)
  if (hitSl) return { price: sl as number, reason: "sl" } // worst case first
  if (hitTp) return { price: tp as number, reason: "tp" }
  return null
}

export function closePosition(
  position: OpenPosition,
  exitPrice: number,
  exitTime: number,
  reason: CloseEvent["reason"],
): CloseEvent {
  return { position, exitPrice, exitTime, reason, pnl: positionPnl(position, exitPrice) }
}

// A resting order's trigger test for this candle.
//   buy limit  fills when price trades down to it (low <= price)
//   sell limit fills when price trades up to it   (high >= price)
//   buy stop   fills when price trades up through it (high >= price)
//   sell stop  fills when price trades down through it (low <= price)
export function orderTriggers(candle: Candle, order: PendingOrder): boolean {
  if (order.kind === "limit") {
    return order.side === "buy" ? candle.low <= order.price : candle.high >= order.price
  }
  return order.side === "buy" ? candle.high >= order.price : candle.low <= order.price
}

function positionFromOrder(order: PendingOrder, time: number): OpenPosition {
  return {
    side: order.side === "buy" ? "long" : "short",
    qty: order.qty,
    entryPrice: order.price,
    entryTime: time,
    stopLoss: order.stopLoss,
    takeProfit: order.takeProfit,
    symbol: order.symbol,
    contractMultiplier: order.contractMultiplier,
    fees: 0,
  }
}

export interface StepResult {
  position: OpenPosition | null
  orders: PendingOrder[]
  closed: CloseEvent[]
}

// Advance one candle. Order of operations, and why:
//  1. An already-open position is checked for SL/TP first (a stop from a prior
//     bar takes priority over any new entry).
//  2. If flat afterwards, the first resting order that triggers opens a
//     position AT ITS PRICE; its siblings are cancelled (one-position MVP, so a
//     stale bracket can't immediately re-enter).
//  3. A position opened on THIS candle is not SL/TP-checked until the next one,
//     which sidesteps unknowable intra-candle open→exit sequencing.
export function stepCandle(candle: Candle, positionIn: OpenPosition | null, ordersIn: PendingOrder[]): StepResult {
  let position = positionIn
  let orders = ordersIn
  const closed: CloseEvent[] = []

  if (position) {
    const exit = resolvePositionExit(candle, position)
    if (exit) {
      closed.push(closePosition(position, exit.price, candle.time, exit.reason))
      position = null
    }
  }

  if (!position) {
    const idx = orders.findIndex((o) => orderTriggers(candle, o))
    if (idx !== -1) {
      position = positionFromOrder(orders[idx], candle.time)
      orders = [] // cancel siblings
    }
  }

  return { position, orders, closed }
}
