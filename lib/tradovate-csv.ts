import Papa from "papaparse"
import { reconstructTrades as reconstructTradesShared, type ParsedFill } from "@/lib/fill-reconstruction"
import type { ImportedTrade } from "@/lib/trade-import"

export type { ParsedFill }

// Parses the CSV Tradovate exports from Reports → Orders → Download. Column
// names are confirmed from independent broker-import guides (TradeZella,
// Journalit) since Tradovate's own docs don't list them directly. Both
// "human readable" (Account, B/S, Contract, Filled Qty, Avg Fill Price, Fill
// Time) and raw internal (orderId, avgPrice, filledQty, Timestamp) column
// variants have been seen in exports, so both are read defensively.

export type ParseResult = {
  fills: ParsedFill[]
  totalRows: number
  skippedRows: number
}

function pick(row: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    if (row[k] != null && row[k] !== "") return row[k]
  }
  return undefined
}

// Cheap signature check used to route an uploaded file to this parser vs. NinjaTrader's.
export function isTradovateCsv(headerRow: string[]): boolean {
  const normalized = new Set(headerRow.map((h) => h.trim().toLowerCase()))
  return normalized.has("b/s") && normalized.has("contract")
}

export function parseTradovateOrdersCsv(csvText: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  })

  const fills: ParsedFill[] = []
  let skippedRows = 0

  for (const row of parsed.data) {
    const orderId = pick(row, "Order ID", "orderId")
    const account = pick(row, "Account")
    const contract = pick(row, "Contract")
    const sideRaw = pick(row, "B/S")
    const qtyRaw = pick(row, "Filled Qty", "filledQty", "Quantity")
    const priceRaw = pick(row, "Avg Fill Price", "avgPrice")
    const timestamp = pick(row, "Fill Time", "Timestamp", "Date")

    const qty = qtyRaw ? Number(qtyRaw) : 0
    const price = priceRaw ? Number(priceRaw) : NaN

    // Skip unfilled/cancelled orders and rows we can't make sense of.
    if (!orderId || !account || !contract || !sideRaw || !timestamp || !qty || !Number.isFinite(price)) {
      skippedRows++
      continue
    }
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) {
      skippedRows++
      continue
    }

    const action: "Buy" | "Sell" = sideRaw.trim().toUpperCase().startsWith("B") ? "Buy" : "Sell"

    fills.push({
      externalId: orderId,
      account: account.trim(),
      symbol: contract.trim(),
      timestamp: date.toISOString(),
      action,
      qty,
      price,
    })
  }

  return { fills, totalRows: parsed.data.length, skippedRows }
}

// Turns a fill stream into round-trip trades — shared with Rithmic's live
// sync, since both are raw fill feeds needing the same avg-cost
// reconstruction. Tradovate's orders export has no commission column, so
// fees are always 0.
export function reconstructTrades(fills: ParsedFill[]): ImportedTrade[] {
  return reconstructTradesShared(fills, "tradovate")
}
