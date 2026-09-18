import Papa from "papaparse"
import type { ImportedTrade } from "@/lib/trade-import"

// Parses the CSV NinjaTrader 8 exports from Control Center → Trade
// Performance → Trades tab → Export. Unlike Tradovate's raw fill export,
// each row here is already a complete round-trip trade (entry + exit +
// profit), so no position reconstruction is needed.
//
// Column names are inferred from NinjaTrader's own terminology for this grid
// (Instrument, Account, Market pos., Qty, Entry price, Exit price, Entry
// time, Exit time, Commission) rather than one confirmed sample export —
// matching is done on normalized (lowercased, punctuation-stripped) headers
// with common aliases to stay resilient to minor wording differences.

export type ParseResult = {
  trades: ImportedTrade[]
  totalRows: number
  skippedRows: number
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[.#]/g, "").replace(/\s+/g, " ").trim()
}

function pick(normalizedRow: Record<string, string>, ...aliases: string[]): string | undefined {
  for (const alias of aliases) {
    const v = normalizedRow[normalizeHeader(alias)]
    if (v != null && v !== "") return v
  }
  return undefined
}

// Handles currency-formatted numbers like "$1,234.56" or "($50.00)" (parens = negative).
function parseMoney(raw: string | undefined): number {
  if (!raw) return 0
  const negative = raw.trim().startsWith("(")
  const n = Number(raw.replace(/[^0-9.-]/g, ""))
  if (!Number.isFinite(n)) return 0
  return negative ? -Math.abs(n) : n
}

export function isNinjaTraderCsv(headerRow: string[]): boolean {
  const normalized = new Set(headerRow.map(normalizeHeader))
  return normalized.has("instrument") && normalized.has("entry price") && normalized.has("exit price")
}

export function parseNinjaTraderTradesCsv(csvText: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true })

  const trades: ImportedTrade[] = []
  let skippedRows = 0

  for (const row of parsed.data) {
    const normalizedRow: Record<string, string> = {}
    for (const [k, v] of Object.entries(row)) normalizedRow[normalizeHeader(k)] = v

    const instrument = pick(normalizedRow, "Instrument")
    const account = pick(normalizedRow, "Account")
    const marketPos = pick(normalizedRow, "Market pos.", "Market pos", "Market Position", "Direction")
    const qtyRaw = pick(normalizedRow, "Qty", "Quantity")
    const entryPriceRaw = pick(normalizedRow, "Entry price")
    const exitPriceRaw = pick(normalizedRow, "Exit price")
    const entryTime = pick(normalizedRow, "Entry time")
    const exitTime = pick(normalizedRow, "Exit time")
    const feeRaw = pick(normalizedRow, "Commission", "Fee", "Fees")

    const qty = qtyRaw ? Math.abs(Number(qtyRaw.replace(/[^0-9.-]/g, ""))) : 0
    const entryPrice = entryPriceRaw ? parseMoney(entryPriceRaw) : NaN
    const exitPrice = exitPriceRaw ? parseMoney(exitPriceRaw) : NaN

    if (!instrument || !account || !marketPos || !entryTime || !exitTime || !qty || !Number.isFinite(entryPrice) || !Number.isFinite(exitPrice)) {
      skippedRows++
      continue
    }
    const entryDate = new Date(entryTime)
    const exitDate = new Date(exitTime)
    if (Number.isNaN(entryDate.getTime()) || Number.isNaN(exitDate.getTime())) {
      skippedRows++
      continue
    }

    const side: "long" | "short" = marketPos.trim().toUpperCase().startsWith("L") ? "long" : "short"

    trades.push({
      externalId: `ninjatrader:${account.trim()}:${instrument.trim()}:${entryDate.toISOString()}:${exitDate.toISOString()}`,
      account: account.trim(),
      symbol: instrument.trim(),
      side,
      quantity: qty,
      entryPrice,
      exitPrice,
      entryTime: entryDate.toISOString(),
      exitTime: exitDate.toISOString(),
      fees: Math.abs(parseMoney(feeRaw)),
    })
  }

  return { trades, totalRows: parsed.data.length, skippedRows }
}
