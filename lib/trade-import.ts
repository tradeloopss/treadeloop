// Shared shape every broker parser (Tradovate, NinjaTrader, MetaTrader)
// normalizes into, so the import action has one common insertion path.
export type ImportedTrade = {
  externalId: string
  account: string
  symbol: string
  side: "long" | "short"
  quantity: number
  entryPrice: number
  exitPrice: number
  entryTime: string
  exitTime: string
  fees: number
  // When set, use this directly as the trade's P&L instead of deriving one
  // from entry/exit price via the futures point-value model — forex/CFD P&L
  // depends on pip value per lot, which that model doesn't represent, so
  // MetaTrader trades carry their broker-reported profit here instead.
  pnl?: number
}
