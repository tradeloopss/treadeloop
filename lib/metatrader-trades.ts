// Pure MT5 deal → trade logic (no database), used by lib/metatrader-sync.ts.
import { serverTimeToUtc } from "@/lib/metatrader-time"

// The fields of a stored deal (metatrader_deals) this needs.
export interface DealRow {
  ticket: string
  time: Date // broker server time, as stored
  type: number
  entry: number
  symbol: string | null
  volume: string
  price: string
  profit: string
  commission: string
  swap: string
  fee: string
  stopLoss: string | null
  takeProfit: string | null
}

// MT5 enums (ENUM_DEAL_TYPE / ENUM_DEAL_ENTRY).
const DEAL_BUY = 0
const DEAL_SELL = 1
export const DEAL_BALANCE = 2
const ENTRY_IN = 0
const ENTRY_OUT = 1
const ENTRY_INOUT = 2
const ENTRY_OUT_BY = 3

const EPSILON = 1e-9
const round2 = (n: number) => Math.round(n * 100) / 100

const CURRENCIES = new Set(["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD", "SEK", "NOK", "DKK", "SGD", "HKD", "CNH", "MXN", "ZAR", "TRY", "PLN", "HUF", "CZK"])
const CRYPTO = /^(BTC|ETH|LTC|XRP|SOL|DOGE|BNB|ADA|DOT|LINK|AVAX|MATIC|TRX|BCH|XLM|UNI|SHIB|TON)/

// A label for the trades list; P&L comes straight from the broker, so this
// doesn't feed any math. Broker suffixes (EURUSDm, EURUSD.r) are ignored.
export function marketForSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace(/[^A-Z]/g, "")
  if (CRYPTO.test(s)) return "crypto"
  if (s.length >= 6 && CURRENCIES.has(s.slice(0, 3)) && CURRENCIES.has(s.slice(3, 6))) return "forex"
  return "cfd"
}

export interface BuiltTrade {
  externalId: string
  symbol: string
  side: "long" | "short"
  quantity: number
  entryPrice: number
  exitPrice: number
  entryTime: Date
  exitTime: Date
  fees: number
  pnl: number
  stopLoss: number | null
  takeProfit: number | null
}

interface Cycle {
  symbol: string
  side: "long" | "short"
  openQty: number
  entryQty: number
  entryNotional: number
  exitQty: number
  exitNotional: number
  profit: number
  costs: number // commission + swap + fee, as MT5 signs them (costs negative)
  entryTime: Date
  exitTime: Date
  stopLoss: number | null
  takeProfit: number | null
}

// One trade per flat→flat cycle of an MT5 position. A hedging account's
// position is a single cycle; a netting account can reverse through an
// IN/OUT deal, which closes the open volume and opens the rest the other way.
// Scale-ins and partial closes blend into the cycle's average prices. A cycle
// still open is left for a later sync, as is one whose entry fell outside the
// imported history window. `key` ("mt5:<login>" / "mt4:<login>") prefixes each
// trade's externalId.
export function buildPositionTrades(key: string, positionId: string, deals: DealRow[], zone: string | null): BuiltTrade[] {
  const fills = deals
    .filter((d) => d.type === DEAL_BUY || d.type === DEAL_SELL)
    .sort((a, b) => a.time.getTime() - b.time.getTime() || a.ticket.localeCompare(b.ticket, undefined, { numeric: true }))
  const out: BuiltTrade[] = []
  let cycle: Cycle | null = null

  const emit = (c: Cycle) => {
    out.push({
      externalId: `${key}:${positionId}${out.length > 0 ? `:${out.length}` : ""}`,
      symbol: c.symbol,
      side: c.side,
      quantity: Number(c.entryQty.toFixed(4)),
      entryPrice: c.entryNotional / c.entryQty,
      exitPrice: c.exitNotional / c.exitQty,
      entryTime: c.entryTime,
      exitTime: c.exitTime,
      fees: round2(-c.costs),
      pnl: round2(c.profit + c.costs),
      stopLoss: c.stopLoss,
      takeProfit: c.takeProfit,
    })
  }

  for (const d of fills) {
    const volume = Number(d.volume)
    const price = Number(d.price)
    const costs = Number(d.commission) + Number(d.swap) + Number(d.fee)
    const time = new Date(serverTimeToUtc(d.time.getTime(), zone))
    const open = (qty: number): Cycle => ({
      symbol: d.symbol ?? "UNKNOWN",
      side: d.type === DEAL_BUY ? "long" : "short",
      openQty: qty,
      entryQty: qty,
      entryNotional: qty * price,
      exitQty: 0,
      exitNotional: 0,
      profit: 0,
      costs: 0,
      entryTime: time,
      exitTime: time,
      stopLoss: d.stopLoss == null ? null : Number(d.stopLoss),
      takeProfit: d.takeProfit == null ? null : Number(d.takeProfit),
    })

    if (d.entry === ENTRY_IN) {
      if (!cycle) {
        cycle = open(volume)
      } else {
        cycle.openQty += volume
        cycle.entryQty += volume
        cycle.entryNotional += volume * price
      }
      cycle.profit += Number(d.profit)
      cycle.costs += costs
    } else if (d.entry === ENTRY_OUT || d.entry === ENTRY_OUT_BY) {
      if (!cycle) continue
      cycle.openQty -= volume
      cycle.exitQty += volume
      cycle.exitNotional += volume * price
      cycle.profit += Number(d.profit)
      cycle.costs += costs
      cycle.exitTime = time
      if (cycle.openQty <= EPSILON) {
        emit(cycle)
        cycle = null
      }
    } else if (d.entry === ENTRY_INOUT) {
      if (!cycle) {
        cycle = open(volume)
        cycle.costs += costs
        continue
      }
      const closing: number = cycle.openQty
      cycle.exitQty += closing
      cycle.exitNotional += closing * price
      cycle.profit += Number(d.profit)
      cycle.costs += costs
      cycle.exitTime = time
      emit(cycle)
      const rest: number = volume - closing
      cycle = rest > EPSILON ? open(rest) : null
    }
  }
  return out
}
