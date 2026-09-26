import { reconstructTrades, type ParsedFill } from "@/lib/fill-reconstruction"
import { computePnl, contractMultiplierForSymbol } from "@/lib/calc"
import type { ImportedTrade } from "@/lib/trade-import"

// Stored executions of one provider account → closed trades with their P&L.
// The pure half of lib/tradovate/trades.ts (which reads and writes the DB),
// kept separate so the tests run exactly this code.

export interface StoredExecution {
  providerExecutionId: string | null
  idempotencyKey: string
  symbol: string
  timestamp: Date
  side: string // buy | sell
  quantity: number | string
  price: number | string
  commission: number | string | null
  pointValue: number | string | null
  assetClass?: string | null
}

export interface BuiltTrade extends ImportedTrade {
  market: "futures" | "stocks" | "options" | "forex" | "crypto" | "cfd"
  multiplier: number
  gross: number
  pnl: number // gross − fees, rounded to cents
}

// Fill-reconstruction splits keys on ":", so ids and symbols must not contain one.
const sanitize = (s: string) => s.replace(/:/g, "_")

export function executionsToFills(accountKey: string, rows: StoredExecution[]): ParsedFill[] {
  return rows.map((r) => ({
    externalId: sanitize(r.providerExecutionId ?? r.idempotencyKey),
    account: sanitize(accountKey),
    symbol: sanitize(r.symbol),
    timestamp: r.timestamp.toISOString(),
    action: r.side === "buy" ? "Buy" : "Sell",
    qty: Number(r.quantity),
    price: Number(r.price),
    fee: r.commission == null ? undefined : Number(r.commission),
  }))
}

const MARKETS: Record<string, BuiltTrade["market"]> = { future: "futures", stock: "stocks", option: "options", forex: "forex", crypto: "crypto", cfd: "cfd" }

// The point value the provider reported for the product wins; the app's
// contract table (lib/calc) is only the fallback. `prefix` namespaces the
// trades' externalIds by provider ("tradovate", "ninjatrader").
export function buildTradesFromExecutions(accountKey: string, rows: StoredExecution[], prefix = "tradovate"): BuiltTrade[] {
  const pointValue = new Map<string, number>()
  const market = new Map<string, BuiltTrade["market"]>()
  for (const r of rows) {
    if (r.pointValue != null) pointValue.set(sanitize(r.symbol), Number(r.pointValue))
    if (r.assetClass && MARKETS[r.assetClass]) market.set(sanitize(r.symbol), MARKETS[r.assetClass])
  }
  return reconstructTrades(executionsToFills(accountKey, rows), prefix).map((t) => {
    const multiplier = pointValue.get(t.symbol) ?? contractMultiplierForSymbol(t.symbol)
    const gross = Math.round(computePnl({ side: t.side, quantity: t.quantity, entryPrice: t.entryPrice, exitPrice: t.exitPrice, fees: 0, contractMultiplier: multiplier }) * 100) / 100
    return { ...t, market: market.get(t.symbol) ?? "futures", multiplier, gross, pnl: Math.round((gross - t.fees) * 100) / 100 }
  })
}
