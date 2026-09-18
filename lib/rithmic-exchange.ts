// Maps a stored trade symbol to the root ticker + exchange Rithmic's
// RequestTimeBarReplay needs. Broker exports never normalize symbols (see
// lib/tradovate-csv.ts, lib/ninjatrader-csv.ts) — futures come through as
// full contract codes with an expiry suffix (e.g. "ESZ5", "MESZ5",
// "ES 12-25"), so the root has to be extracted first.
const FUTURES_ROOT_TO_EXCHANGE: Record<string, string> = {
  ES: "CME", MES: "CME",
  NQ: "CME", MNQ: "CME",
  RTY: "CME", M2K: "CME",
  YM: "CBOT", MYM: "CBOT",
  CL: "NYMEX", MCL: "NYMEX", NG: "NYMEX",
  GC: "COMEX", MGC: "COMEX", SI: "COMEX", SIL: "COMEX",
  ZB: "CBOT", ZN: "CBOT", ZF: "CBOT", ZT: "CBOT",
  ZC: "CBOT", ZS: "CBOT", ZW: "CBOT",
  "6E": "CME", "6B": "CME", "6J": "CME", "6A": "CME", "6C": "CME",
}

function futuresRoot(symbol: string): string | null {
  const spaced = symbol.match(/^([A-Z0-9]{1,3})\s+\d{1,2}-\d{2,4}$/)
  if (spaced) return spaced[1]
  const coded = symbol.match(/^([A-Z0-9]{1,3})[FGHJKMNQUVXZ]\d{1,2}$/)
  if (coded) return coded[1]
  return null
}

export function toRithmicSymbol(symbol: string): { symbol: string; exchange: string } | null {
  const trimmed = symbol.trim().toUpperCase()
  const root = futuresRoot(trimmed) ?? (FUTURES_ROOT_TO_EXCHANGE[trimmed] ? trimmed : null)
  if (!root) return null
  const exchange = FUTURES_ROOT_TO_EXCHANGE[root]
  if (!exchange) return null
  return { symbol: root, exchange }
}
