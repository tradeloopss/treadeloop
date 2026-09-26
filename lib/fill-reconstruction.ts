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
  // All fees on this fill when the broker reports them per fill (Tradovate's
  // fillFee). Summed onto the trade the fill belongs to; a fill that flips
  // the position splits its fee by quantity between the closing and the new
  // trade. Omitted → 0, so feeds without per-fill fees are unaffected.
  fee?: number
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

    // One trade per POSITION (flat → flat), not per fill: a position built and
    // scaled out over many fills is ONE trade the trader took, with a blended
    // entry and exit price — so partial scale-ins/outs never inflate the trade
    // count. A trade is only emitted when the position returns to flat (or
    // flips through it).
    let position = 0 // signed open quantity: positive = long, negative = short
    let side: "long" | "short" | null = null
    let entryQty = 0 // total contracts entered on this leg
    let entryNotional = 0 // sum(entry price × entry qty) → avg entry
    let entryTime: string | null = null
    let closedQty = 0 // total contracts closed on this leg
    let closedNotional = 0 // sum(exit price × close qty) → avg exit
    let exitTime: string | null = null
    let lastExitFillId = "" // the fill that closed the leg — stable id for dedupe
    let legFees = 0 // fees of every fill (or fill share) in this leg

    const openLeg = (signedQty: number, price: number, time: string, fee: number) => {
      position = signedQty
      side = signedQty > 0 ? "long" : "short"
      entryQty = Math.abs(signedQty)
      entryNotional = price * entryQty
      entryTime = time
      closedQty = 0
      closedNotional = 0
      exitTime = null
      lastExitFillId = ""
      legFees = fee
    }

    const emit = () => {
      if (closedQty <= 0 || entryQty <= 0 || side == null || entryTime == null || exitTime == null) return
      trades.push({
        externalId: `${sourcePrefix}:${account}:${symbol}:${lastExitFillId}`,
        account,
        symbol,
        side,
        quantity: closedQty,
        entryPrice: entryNotional / entryQty,
        exitPrice: closedNotional / closedQty,
        entryTime,
        exitTime,
        fees: Math.round(legFees * 100) / 100,
      })
      position = 0
      side = null
    }

    for (const fill of sorted) {
      const signedQty = fill.action === "Buy" ? fill.qty : -fill.qty
      const fee = fill.fee ?? 0

      if (position === 0) {
        openLeg(signedQty, fill.price, fill.timestamp, fee)
        continue
      }

      if (Math.sign(signedQty) === Math.sign(position)) {
        // Adding to the position (scale-in): fold into the average entry.
        entryNotional += fill.price * fill.qty
        entryQty += fill.qty
        position += signedQty
        legFees += fee
        continue
      }

      // Opposite direction: closes some/all of the position, and may flip.
      const closeAmt = Math.min(fill.qty, Math.abs(position))
      closedQty += closeAmt
      closedNotional += fill.price * closeAmt
      exitTime = fill.timestamp
      lastExitFillId = fill.externalId
      position += Math.sign(signedQty) * closeAmt // moves toward 0
      const remainder = fill.qty - closeAmt
      legFees += fill.qty > 0 ? (fee * closeAmt) / fill.qty : 0

      if (position === 0) {
        emit()
        if (remainder > 0) openLeg(Math.sign(signedQty) * remainder, fill.price, fill.timestamp, fill.qty > 0 ? (fee * remainder) / fill.qty : 0)
      }
    }
  }

  return trades.sort((a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime())
}
