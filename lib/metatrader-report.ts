import { parse as parseHtml, type HTMLElement } from "node-html-parser"
import type { ImportedTrade } from "@/lib/trade-import"

// Parses the HTML "Save as Report" export from MetaTrader 4/5's Account
// History tab — MetaTrader has no built-in CSV export for trade history.
// MT4 history rows are already closed round-trip trades; MT5's "Deals" table
// is raw fills (an "in" deal opens, an "out" deal closes) that need pairing,
// same shape as Tradovate's fill stream. Column layout is inferred from
// MetaTrader's own documented field order and a third-party technical
// article (not a verified live sample), so rows are matched defensively by
// position + content shape (a numeric-looking Type/Direction pair) rather
// than by header text, which MT reports reuse ambiguously ("Time" appears
// twice, "Price" twice).
//
// Both formats report their own accurate Profit/Commission/Swap per trade,
// so — unlike Tradovate/NinjaTrader — this parser carries that P&L through
// directly instead of recomputing it from price × a futures point value,
// which doesn't apply to forex/CFD lot sizes.

export type ParseResult = {
  trades: ImportedTrade[]
  totalRows: number
  skippedRows: number
  format: "MT4" | "MT5" | null
}

function cellTexts(row: HTMLElement): string[] {
  return row.querySelectorAll("td").map((td) => td.text.replace(/\s+/g, " ").trim())
}

function num(raw: string | undefined): number {
  if (!raw) return 0
  const n = Number(raw.replace(/[^0-9.-]/g, ""))
  return Number.isFinite(n) ? n : 0
}

// MetaTrader dates are "YYYY.MM.DD HH:mm:ss" — convert dots to dashes so
// the JS Date constructor accepts it.
function parseMtDate(raw: string | undefined): Date | null {
  if (!raw) return null
  const d = new Date(raw.trim().replace(/\./g, "-"))
  return Number.isNaN(d.getTime()) ? null : d
}

function findAccountLabel(html: string): string {
  const match = html.match(/Account:?\s*(?:<[^>]*>\s*)*([0-9][\w .()-]{0,40})/i)
  return match ? match[1].trim() : "MetaTrader"
}

export function isMetaTraderReport(fileText: string): boolean {
  const head = fileText.slice(0, 2000).toLowerCase()
  return head.includes("<html") || head.includes("<!doctype html") || head.includes("<table")
}

export function parseMetaTraderReport(html: string): ParseResult {
  const root = parseHtml(html)
  const rows = root.querySelectorAll("tr")
  const account = findAccountLabel(html)

  const mt4Trades: ImportedTrade[] = []
  const mt5Fills: { symbol: string; action: "Buy" | "Sell"; qty: number; price: number; time: Date; profit: number; fees: number; dealId: string }[] = []
  let totalDataRows = 0

  for (const row of rows) {
    const cells = cellTexts(row)
    if (cells.length < 12) continue

    // MT5 "Deals" row: Time, Deal, Symbol, Type, Direction, Volume, Price, Order, Commission, Swap, Profit, Balance, Comment
    const type5 = cells[3]?.toLowerCase()
    const direction5 = cells[4]?.toLowerCase()
    if ((type5 === "buy" || type5 === "sell") && /^(in|out|in\/out|inout)$/.test(direction5 ?? "") && cells.length >= 13) {
      const time = parseMtDate(cells[0])
      const price = num(cells[6])
      const qty = num(cells[5])
      if (time && price > 0 && qty > 0) {
        totalDataRows++
        mt5Fills.push({
          dealId: cells[1] || String(mt5Fills.length),
          symbol: cells[2],
          action: type5 === "buy" ? "Buy" : "Sell",
          qty,
          price,
          time,
          fees: Math.abs(num(cells[cells.length - 5])) + Math.abs(num(cells[cells.length - 4])), // commission + swap
          profit: num(cells[cells.length - 3]), // profit
        })
        continue
      }
    }

    // MT4 closed-trade row: Order, OpenTime, Type, Size, Symbol, OpenPrice, S/L, T/P, CloseTime, ClosePrice, Commission, Taxes, Swap, Profit, Comment
    const type4 = cells[2]?.toLowerCase()
    if ((type4 === "buy" || type4 === "sell") && cells.length >= 14) {
      const openTime = parseMtDate(cells[1])
      const closeTime = parseMtDate(cells[8])
      const openPrice = num(cells[5])
      const closePrice = num(cells[9])
      const qty = num(cells[3])
      if (openTime && closeTime && openPrice > 0 && closePrice > 0 && qty > 0) {
        totalDataRows++
        // Commission always immediately follows the close price (index 10);
        // the optional Taxes column sits between it and Swap, so Swap/Profit
        // are anchored from the end instead, where their position is fixed.
        const commission = num(cells[10])
        const swap = num(cells[cells.length - 3])
        const profit = num(cells[cells.length - 2])
        mt4Trades.push({
          externalId: `metatrader4:${account}:${cells[0]}`,
          account,
          symbol: cells[4],
          side: type4 === "buy" ? "long" : "short",
          quantity: qty,
          entryPrice: openPrice,
          exitPrice: closePrice,
          entryTime: openTime.toISOString(),
          exitTime: closeTime.toISOString(),
          fees: Math.abs(commission) + Math.abs(swap),
          pnl: profit - Math.abs(commission) - Math.abs(swap),
        })
      }
    }
  }

  if (mt5Fills.length > 0) {
    // Average-cost position tracking, grouped by symbol — same approach as
    // Tradovate, but each closing fill's own reported profit/fees is carried
    // straight through to the trade it closes instead of being recomputed.
    const bySymbol = new Map<string, typeof mt5Fills>()
    for (const f of mt5Fills) {
      if (!bySymbol.has(f.symbol)) bySymbol.set(f.symbol, [])
      bySymbol.get(f.symbol)!.push(f)
    }

    const trades: ImportedTrade[] = []
    for (const [symbol, fills] of bySymbol) {
      const sorted = [...fills].sort((a, b) => a.time.getTime() - b.time.getTime())
      let position = 0
      let entryQty = 0
      let entryNotional = 0
      let entryFees = 0 // commission+swap charged on the opening side, not yet attributed to a closed trade
      let entryTime: Date | null = null

      for (const fill of sorted) {
        const signedQty = fill.action === "Buy" ? fill.qty : -fill.qty

        if (position === 0) {
          position = signedQty
          entryQty = fill.qty
          entryNotional = fill.price * fill.qty
          entryFees = fill.fees
          entryTime = fill.time
          continue
        }

        const isAdding = Math.sign(signedQty) === Math.sign(position)
        if (isAdding) {
          entryNotional += fill.price * fill.qty
          entryQty += fill.qty
          entryFees += fill.fees
          position += signedQty
          continue
        }

        const closingQty = Math.min(fill.qty, Math.abs(position))
        const avgEntryPrice = entryNotional / entryQty
        const side: "long" | "short" = position > 0 ? "long" : "short"
        // Opening-side commission is charged once per lot regardless of how many
        // fills later close it, so apportion it by the fraction being closed now.
        const apportionedEntryFees = entryFees * (closingQty / entryQty)
        const fees = apportionedEntryFees + fill.fees

        trades.push({
          externalId: `metatrader5:${account}:${fill.dealId}`,
          account,
          symbol,
          side,
          quantity: closingQty,
          entryPrice: avgEntryPrice,
          exitPrice: fill.price,
          entryTime: entryTime!.toISOString(),
          exitTime: fill.time.toISOString(),
          fees,
          pnl: fill.profit - fees,
        })

        const remainderQty = fill.qty - closingQty
        position += signedQty
        if (remainderQty > 0) {
          entryQty = remainderQty
          entryNotional = fill.price * remainderQty
          entryFees = 0
          entryTime = fill.time
        } else if (position === 0) {
          entryQty = 0
          entryNotional = 0
          entryFees = 0
          entryTime = null
        } else {
          entryQty -= closingQty
          entryNotional = avgEntryPrice * entryQty
          entryFees -= apportionedEntryFees
        }
      }
    }

    return {
      trades: trades.sort((a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime()),
      totalRows: totalDataRows,
      skippedRows: 0,
      format: "MT5",
    }
  }

  if (mt4Trades.length > 0) {
    return { trades: mt4Trades, totalRows: totalDataRows, skippedRows: 0, format: "MT4" }
  }

  return { trades: [], totalRows: 0, skippedRows: 0, format: null }
}
