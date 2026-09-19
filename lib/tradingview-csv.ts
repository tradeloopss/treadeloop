import Papa from "papaparse"
import type { ParsedFill } from "@/lib/fill-reconstruction"

// Parses the CSV TradingView's Trading Panel exports (Export data… → Order
// history / History → Filled). Which columns are in the file is chosen by
// the trader in that dialog's column picker, so nothing here assumes a fixed
// header row: every field is looked up across the names TradingView and the
// journaling guides for it use, and a file missing something essential is
// reported rather than half-imported.
//
// This covers the paper trades taken by hand in TradingView, which fire no
// alert and so never reach the webhook (app/api/tradingview/[token]).

export type ParseResult = {
  fills: ParsedFill[]
  totalRows: number
  skippedRows: number
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]/g, "")
}

function pick(row: Record<string, string>, ...keys: string[]): string | undefined {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(row)) normalized[normalizeHeader(key)] = value
  for (const key of keys) {
    const value = normalized[normalizeHeader(key)]
    if (value != null && value.trim() !== "") return value.trim()
  }
  return undefined
}

// A TradingView export is recognised by a side column next to a fill price
// or an order id — the pairing no other export this app reads has
// (Tradovate uses B/S with Contract, NinjaTrader uses Entry/Exit price).
export function isTradingViewCsv(headerRow: string[]): boolean {
  const normalized = new Set(headerRow.map(normalizeHeader))
  const hasSide = normalized.has("side")
  const hasSymbol = normalized.has("symbol") || normalized.has("instrument") || normalized.has("ticker")
  const hasFill = normalized.has("fillprice") || normalized.has("avgfillprice")
  const hasOrderId = normalized.has("orderid")
  if (normalized.has("contract") || normalized.has("entryprice")) return false
  return hasSide && hasSymbol && (hasFill || hasOrderId)
}

// TradingView writes numbers by the account's locale, so a thousands
// separator or a comma decimal both turn up.
function parseNumber(value: string | undefined): number | null {
  if (value == null) return null
  const cleaned = value.replace(/[\s'’]/g, "").replace(/,(?=\d{3}\b)/g, "")
  const n = Number(cleaned.includes(",") ? cleaned.replace(",", ".") : cleaned)
  return Number.isFinite(n) ? n : null
}

function normalizeSymbol(raw: string): string {
  const afterExchange = raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw
  return afterExchange.trim().toUpperCase()
}

export function parseTradingViewCsv(csvText: string, accountName = "TradingView Paper"): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true })

  const fills: ParsedFill[] = []
  let skippedRows = 0
  let rowNumber = 0

  for (const row of parsed.data) {
    rowNumber++
    const status = pick(row, "status")
    // The History tab lists working and cancelled orders next to filled
    // ones; only a fill moved the position.
    if (status && !/fill/i.test(status)) {
      skippedRows++
      continue
    }

    const symbolRaw = pick(row, "symbol", "instrument", "ticker")
    const sideRaw = pick(row, "side", "action")
    const qtyRaw = pick(row, "qty", "quantity", "filledqty", "size")
    // The fill price is what the position actually moved at; the order's
    // limit price is only a fallback for an export without that column.
    const priceRaw = pick(row, "fillprice", "avgfillprice", "price", "avgprice")
    const timeRaw = pick(row, "closingtime", "filltime", "time", "date", "placingtime", "closedate")
    const orderId = pick(row, "orderid", "id")

    const qty = parseNumber(qtyRaw)
    const price = parseNumber(priceRaw)

    if (!symbolRaw || !sideRaw || !timeRaw || qty == null || qty <= 0 || price == null || price <= 0) {
      skippedRows++
      continue
    }

    const filledAt = new Date(timeRaw)
    if (Number.isNaN(filledAt.getTime())) {
      skippedRows++
      continue
    }

    const side = sideRaw.trim().toLowerCase()
    const action: "Buy" | "Sell" = side.startsWith("b") || side === "long" ? "Buy" : "Sell"

    fills.push({
      // An export without an order id still has to dedupe against a second
      // upload of the same range, so the row's own contents stand in.
      externalId: orderId ?? `${filledAt.toISOString()}:${normalizeSymbol(symbolRaw)}:${action}:${qty}:${price}:${rowNumber}`,
      account: accountName,
      symbol: normalizeSymbol(symbolRaw),
      timestamp: filledAt.toISOString(),
      action,
      qty,
      price,
    })
  }

  return { fills, totalRows: parsed.data.length, skippedRows }
}
