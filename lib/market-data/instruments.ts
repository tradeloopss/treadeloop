import type { InstrumentInfo } from "./types"

// The instruments offered in the backtester's symbol picker. Symbols are the
// provider's own ids (Yahoo here). Futures roots line up with lib/calc.ts's
// FUTURES_CONTRACTS so position sizing gets the real multiplier/tick size — see
// lib/backtest/sizing.ts. Extend freely; nothing here is hardcoded into the
// engine.
export const INSTRUMENTS: InstrumentInfo[] = [
  { symbol: "NQ=F", name: "E-mini Nasdaq 100", market: "futures" },
  { symbol: "ES=F", name: "E-mini S&P 500", market: "futures" },
  { symbol: "YM=F", name: "E-mini Dow", market: "futures" },
  { symbol: "RTY=F", name: "E-mini Russell 2000", market: "futures" },
  { symbol: "CL=F", name: "Crude Oil", market: "futures" },
  { symbol: "GC=F", name: "Gold", market: "futures" },
  { symbol: "SI=F", name: "Silver", market: "futures" },
  { symbol: "NG=F", name: "Natural Gas", market: "futures" },
  { symbol: "BTC-USD", name: "Bitcoin", market: "crypto" },
  { symbol: "ETH-USD", name: "Ethereum", market: "crypto" },
  { symbol: "EURUSD=X", name: "EUR / USD", market: "forex" },
  { symbol: "GBPUSD=X", name: "GBP / USD", market: "forex" },
]

// Maps a Yahoo futures symbol like "NQ=F" back to the calc.ts root ("NQ"), so
// sizing can look up the contract's multiplier/tick size. Non-futures return
// the symbol unchanged.
export function contractRootFor(symbol: string): string {
  const m = symbol.match(/^([A-Z0-9]+)=F$/)
  return m ? m[1] : symbol
}

export function instrumentMarket(symbol: string): InstrumentInfo["market"] {
  return INSTRUMENTS.find((i) => i.symbol === symbol)?.market ?? "futures"
}
