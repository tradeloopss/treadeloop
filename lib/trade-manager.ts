// Pure math for the Trade Manager (open/running positions monitor). Kept
// separate from the server action so it's unit-testable. Open trades have no
// exit price and we don't carry a live market mark, so "running P&L" isn't
// invented here — instead we surface what the trade's own levels tell us:
// risk if the stop is hit, reward if the target is hit, the resulting R:R, and
// the notional at risk. A trade with no stop set simply has null risk (shown as
// "no stop"), never a fabricated number.

export interface OpenTradeInput {
  side: "long" | "short"
  quantity: number
  entryPrice: number
  stopLoss: number | null
  takeProfit: number | null
  contractMultiplier: number
  fees: number
}

export interface OpenTradeMetrics {
  // Loss if the stop is hit (entry→stop distance × size × multiplier), incl.
  // fees. Null when no stop is set.
  riskAmount: number | null
  // Gain if the target is hit. Null when no target is set.
  rewardAmount: number | null
  // reward ÷ risk, when both are known and risk > 0.
  riskReward: number | null
  // Position notional (entry × size × multiplier).
  notional: number
  // True when the stop is on the correct side of entry for the direction
  // (below for a long, above for a short). A stop on the wrong side means the
  // "risk" would actually be a locked gain — flagged rather than shown as risk.
  stopConsistent: boolean
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function openTradeMetrics(t: OpenTradeInput): OpenTradeMetrics {
  const mult = t.contractMultiplier || 1
  const notional = round2(t.entryPrice * t.quantity * mult)

  let riskAmount: number | null = null
  let stopConsistent = true
  if (t.stopLoss != null) {
    const dir = t.side === "long" ? 1 : -1
    // For a long, a valid stop is below entry (entry−stop > 0); for a short, above.
    const signedDistance = (t.entryPrice - t.stopLoss) * dir
    stopConsistent = signedDistance > 0
    riskAmount = round2(Math.abs(t.entryPrice - t.stopLoss) * t.quantity * mult + (t.fees ?? 0))
  }

  let rewardAmount: number | null = null
  if (t.takeProfit != null) {
    rewardAmount = round2(Math.abs(t.takeProfit - t.entryPrice) * t.quantity * mult - (t.fees ?? 0))
  }

  const riskReward = riskAmount != null && rewardAmount != null && riskAmount > 0 ? round2(rewardAmount / riskAmount) : null

  return { riskAmount, rewardAmount, riskReward, notional, stopConsistent }
}

// One open position as the Trade Manager UI renders it (server-shaped, plain
// data — safe to pass to a client component).
// A live MetaTrader open position, as the MT5 worker records it on the
// connection each sync. MT5's positions_get() reports floating P&L and the
// current price, so unlike a bare Tradovate snapshot these carry a real
// unrealized P&L — no market feed needed on our side.
export interface Mt5Position {
  symbol: string
  side: "long" | "short"
  volume: number
  openPrice: number
  currentPrice: number | null
  stopLoss: number | null
  takeProfit: number | null
  profit: number | null // floating (unrealized) P&L, incl. swap where the broker folds it in
  identifier: string
}

// A live Rithmic open position, from the P&L plant snapshot (per instrument).
// Stored on the connection each sync so the Trades Manager can show running
// futures positions with their real open P&L.
export interface RithmicPosition {
  symbol: string
  exchange: string
  netQuantity: number // signed: >0 long, <0 short
  avgOpenFillPrice: number | null
  openPositionPnl: number | null
  productCode: string | null
}

export interface OpenTradeView {
  id: number
  // Where this row came from: a `trades` row, or a live broker position
  // (Tradovate snapshot / MetaTrader). Live rows are managed in the platform.
  origin: "trade" | "provider"
  // The broker's own position id/ticket, for sending orders against it (MT5
  // position identifier). Null for manual `trades` rows (closed via the app).
  positionRef: string | null
  accountId: number | null
  accountName: string
  currency: string
  symbol: string
  // The instrument's exchange, when the broker reports it (Rithmic futures) —
  // needed to send an order against it. Null for FX/MT/manual.
  exchange: string | null
  market: string
  side: "long" | "short"
  quantity: number
  entryPrice: number
  // Live mark + unrealized P&L when the broker reports them (MetaTrader);
  // null otherwise (manual trades, Tradovate snapshots) — never fabricated.
  currentPrice: number | null
  unrealizedPnl: number | null
  stopLoss: number | null
  takeProfit: number | null
  entryTime: string // ISO
  contractMultiplier: number
  source: string | null
  notes: string | null
  metrics: OpenTradeMetrics
}

export interface TradeManagerData {
  accounts: { id: number; name: string }[]
  trades: OpenTradeView[]
}

// A recently-closed trade, for the "Closed Today" tab and the win-rate KPI.
export interface ClosedTradeRow {
  id: number
  accountId: number | null
  accountName: string
  currency: string
  symbol: string
  side: "long" | "short"
  quantity: number
  entryPrice: number
  exitPrice: number | null
  pnl: number
  exitTime: string // ISO
}

// KPI figures for the Trades Manager header — all from real data.
export interface TradesManagerStats {
  openCount: number
  buys: number
  shorts: number
  // Sum of unrealized P&L across positions that report it (MetaTrader). Null
  // when no open position reports a live P&L, so the UI shows "—" not "$0".
  totalUnrealized: number | null
  todayRealized: number
  wins: number
  losses: number
  winRate: number | null // over closed-today; null when nothing closed today
}

// Whether an account can send orders, and whether it's turned on.
export interface AccountExecution {
  broker: "mt5" | "mt4" | "rithmic" | "tradovate" | null
  supported: boolean // execution is possible for this broker at all
  enabled: boolean // turned on for this account (trading credential stored)
}

export interface TradesManagerData {
  accounts: { id: number; name: string }[]
  openTrades: OpenTradeView[]
  closedToday: ClosedTradeRow[]
  stats: TradesManagerStats
  // accountId → execution capability, for the account's open trades.
  execution: Record<number, AccountExecution>
}

export function computeStats(openTrades: OpenTradeView[], closedToday: ClosedTradeRow[]): TradesManagerStats {
  const withPnl = openTrades.filter((t) => t.unrealizedPnl != null)
  const totalUnrealized = withPnl.length ? round2(withPnl.reduce((s, t) => s + (t.unrealizedPnl ?? 0), 0)) : null
  const wins = closedToday.filter((t) => t.pnl > 0).length
  const losses = closedToday.filter((t) => t.pnl < 0).length
  const decided = wins + losses
  return {
    openCount: openTrades.length,
    buys: openTrades.filter((t) => t.side === "long").length,
    shorts: openTrades.filter((t) => t.side === "short").length,
    totalUnrealized,
    todayRealized: round2(closedToday.reduce((s, t) => s + t.pnl, 0)),
    wins,
    losses,
    winRate: decided > 0 ? Math.round((wins / decided) * 100) : null,
  }
}

// Metrics for a LIVE broker position that reports its floating P&L (MetaTrader).
// Rather than guess a forex pip value, we calibrate money-per-price-move from
// the broker's own unrealized P&L: perUnit = profit ÷ (current − open). Then
// risk at the stop and reward at the target are exact in account currency.
// Falls back to null (never a fabricated number) when the position hasn't moved
// yet (profit ≈ 0 at open) so the calibration isn't defined.
export function liveTradeMetrics(args: {
  side: "long" | "short"
  volume: number
  openPrice: number
  currentPrice: number | null
  profit: number | null
  stopLoss: number | null
  takeProfit: number | null
}): OpenTradeMetrics {
  const { openPrice, currentPrice, profit, stopLoss, takeProfit } = args
  const notional = round2(openPrice * args.volume)

  const moved = currentPrice != null && Math.abs(currentPrice - openPrice) > 1e-9
  const perUnit = moved && profit != null ? profit / (currentPrice! - openPrice) : null

  const riskAmount = perUnit != null && stopLoss != null ? round2(Math.abs(perUnit * (stopLoss - openPrice))) : null
  const rewardAmount = perUnit != null && takeProfit != null ? round2(Math.abs(perUnit * (takeProfit - openPrice))) : null
  const riskReward = riskAmount != null && rewardAmount != null && riskAmount > 0 ? round2(rewardAmount / riskAmount) : null

  const dir = args.side === "long" ? 1 : -1
  const stopConsistent = stopLoss == null ? true : (openPrice - stopLoss) * dir > 0

  return { riskAmount, rewardAmount, riskReward, notional, stopConsistent }
}

export interface OpenTradesSummary {
  count: number
  // Total risk across trades that have a stop (the rest are "unprotected").
  totalRisk: number
  unprotected: number // open trades with no stop set
  longs: number
  shorts: number
}

export function summarizeOpenTrades(metrics: { side: "long" | "short"; riskAmount: number | null }[]): OpenTradesSummary {
  let totalRisk = 0
  let unprotected = 0
  let longs = 0
  let shorts = 0
  for (const m of metrics) {
    if (m.riskAmount != null) totalRisk += m.riskAmount
    else unprotected++
    if (m.side === "long") longs++
    else shorts++
  }
  return { count: metrics.length, totalRisk: round2(totalRisk), unprotected, longs, shorts }
}
