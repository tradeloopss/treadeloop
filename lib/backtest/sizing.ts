// Position sizing — from a fixed quantity or from a risk %. Instrument specs
// come from lib/calc.ts's FUTURES_CONTRACTS (the same table the live journal
// uses), so nothing about NQ/ES/etc. is hardcoded here; a symbol the table
// doesn't know falls back to a 1x multiplier (crypto/FX/stocks trade 1 unit =
// 1 currency per point).
import { FUTURES_CONTRACTS } from "@/lib/calc"
import { contractRootFor } from "@/lib/market-data/instruments"

export interface InstrumentSpec {
  multiplier: number // dollar value of a 1.00 price move per 1 unit/contract
  tickSize: number
}

export function instrumentSpec(symbol: string, market: string): InstrumentSpec {
  const root = contractRootFor(symbol)
  const known = FUTURES_CONTRACTS[root as keyof typeof FUTURES_CONTRACTS]
  if (known) return { multiplier: known.multiplier, tickSize: known.tickSize }
  const tickSize = market === "forex" ? 0.0001 : market === "crypto" ? 0.01 : 0.01
  return { multiplier: 1, tickSize }
}

export function tickValue(spec: InstrumentSpec): number {
  return spec.multiplier * spec.tickSize
}

// Quantity that risks `riskPct` of `balance` given the entry→stop distance.
// Futures trade in whole contracts (floored); anything with a 1x multiplier
// (crypto/FX/stocks) can be fractional.
export function sizeFromRisk(params: {
  balance: number
  riskPct: number
  entryPrice: number
  stopPrice: number
  spec: InstrumentSpec
}): number {
  const { balance, riskPct, entryPrice, stopPrice, spec } = params
  const riskAmount = balance * (riskPct / 100)
  const perUnitRisk = Math.abs(entryPrice - stopPrice) * spec.multiplier
  if (!(perUnitRisk > 0) || !(riskAmount > 0)) return 0
  const qty = riskAmount / perUnitRisk
  return spec.multiplier > 1 ? Math.max(0, Math.floor(qty)) : Number(qty.toFixed(4))
}

// The dollar amount put at risk by a given size and entry→stop distance —
// what the panel shows next to the qty.
export function riskAmountFor(params: {
  qty: number
  entryPrice: number
  stopPrice: number
  spec: InstrumentSpec
}): number {
  const { qty, entryPrice, stopPrice, spec } = params
  return Math.abs(entryPrice - stopPrice) * spec.multiplier * qty
}
