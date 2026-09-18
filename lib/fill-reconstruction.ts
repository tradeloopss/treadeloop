import type { ImportedTrade } from "@/lib/trade-import"

// A single buy/sell fill from any broker's raw execution feed. Every
// fill-based broker (Tradovate, Rithmic, ...) normalizes into this shape
// before reconstruction, so the FIFO/avg-cost logic below is written once.
export type ParsedFill = {
  externalId: string // stable id for this fill — used to dedupe re-imports
  account: string
  symbol: string
  timestamp: string
  action: "Buy" | "Sell"
  qty: number
  price: number
}

// Turns a fill stream into round-trip trades using average-cost position
// tracking (one blended entry price per trade, matching this app's schema —
// not FIFO lot-level detail). Only emits trades that have fully closed; a
// still-open position at the end of the stream is left out, so re-importing
// the same (or an extended) history never produces duplicate/partial rows.
// `sourcePrefix` (e.g. "tradovate", "rithmic") namespaces the externalId so
// two brokers can never collide even if their own fill ids happen to match.
export function reconstructTrades(fills: ParsedFill[], sourcePrefix: string): ImportedTrade[] {
  const byGroup = new Map<string, ParsedFill[]>()
  for (const f of fills) {
    const key = `${f.account}:${f.symbol}`
    if (!byGroup.has(key)) byGroup.set(key, [])
    byGroup.get(key)!.push(f)
  }

  const trades: ImportedTrade[] = []

  for (const [key, groupFills] of byGroup) {
    const [account, symbol] = key.split(":")
    const sorted = [...groupFills].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )

    let position = 0 // signed open quantity: positive = long, negative = short
    let entryQty = 0 // unsigned quantity backing the current open position
    let entryNotional = 0 // entryQty * average entry price
    let entryTime: string | null = null

    for (const fill of sorted) {
      const signedQty = fill.action === "Buy" ? fill.qty : -fill.qty

      if (position === 0) {
        position = signedQty
        entryQty = fill.qty
        entryNotional = fill.price * fill.qty
        entryTime = fill.timestamp
        continue
      }

      const isAdding = Math.sign(signedQty) === Math.sign(position)
      if (isAdding) {
        entryNotional += fill.price * fill.qty
        entryQty += fill.qty
        position += signedQty
        continue
      }

      // This fill reduces (or flips) the open position, closing some/all of it.
      const closingQty = Math.min(fill.qty, Math.abs(position))
      const avgEntryPrice = entryNotional / entryQty
      const side: "long" | "short" = position > 0 ? "long" : "short"

      trades.push({
        externalId: `${sourcePrefix}:${account}:${symbol}:${fill.externalId}`,
        account,
        symbol,
        side,
        quantity: closingQty,
        entryPrice: avgEntryPrice,
        exitPrice: fill.price,
        entryTime: entryTime!,
        exitTime: fill.timestamp,
        fees: 0,
      })

      const remainderQty = fill.qty - closingQty
      position += signedQty

      if (remainderQty > 0) {
        // The fill was large enough to close the old position and open a new one the other way.
        entryQty = remainderQty
        entryNotional = fill.price * remainderQty
        entryTime = fill.timestamp
      } else if (position === 0) {
        entryQty = 0
        entryNotional = 0
        entryTime = null
      } else {
        entryQty -= closingQty
        entryNotional = avgEntryPrice * entryQty
      }
    }
  }

  return trades.sort((a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime())
}
