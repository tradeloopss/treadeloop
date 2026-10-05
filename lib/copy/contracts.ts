import { FUTURES_CONTRACTS } from "@/lib/calc"

// The contracts Copy Trading knows the specification of. Sizing by risk needs
// the real value of a price move for the instrument being traded — an NQ
// contract and an MNQ contract are not the same trade — so nothing here is
// assumed: a symbol whose contract size isn't known is imported as "other" and
// the risk engine refuses to size it by risk rather than guess.

export type ContractType = "future" | "forex" | "metal" | "other"

export type ContractSpec = {
  symbol: string
  // the instrument without its expiry: MNQ for MNQH6
  root: string
  name: string
  exchange: string | null
  type: ContractType
  // YYYY-MM for a future (the exchange sets the day); null otherwise
  expiration: string | null
  tickSize: number
  // value of one tick for one contract / lot, in USD; null when it depends on the price
  tickValue: number | null
  // value of a 1.00 price move for one contract / lot, in USD; null when it depends on the price
  pointValue: number | null
  contractMultiplier: number
  minimumQuantity: number
  quantityStep: number
}

const EXCHANGES: Record<string, string> = { ES: "CME", MES: "CME", NQ: "CME", MNQ: "CME", RTY: "CME", M2K: "CME", "6E": "CME", "6J": "CME", YM: "CBOT", MYM: "CBOT", ZB: "CBOT", ZN: "CBOT", CL: "NYMEX", MCL: "NYMEX", NG: "NYMEX", GC: "COMEX", MGC: "COMEX", SI: "COMEX", HG: "COMEX" }
// The months each future is listed for (CME month codes).
const QUARTERLY = "HMUZ"
const CYCLES: Record<string, string> = { CL: "FGHJKMNQUVXZ", MCL: "FGHJKMNQUVXZ", NG: "FGHJKMNQUVXZ", GC: "GJMQVZ", MGC: "GJMQVZ", SI: "HKNUZ", HG: "HKNUZ" }
const MONTH_CODES = "FGHJKMNQUVXZ"
// A micro and its full-size contract: same price, a tenth of the size.
const FAMILIES: [string, string][] = [["NQ", "MNQ"], ["ES", "MES"], ["YM", "MYM"], ["RTY", "M2K"], ["CL", "MCL"], ["GC", "MGC"]]

// Spot FX and metals as brokers quote them: one lot is this many units.
const SPOT: Record<string, { name: string; size: number; tick: number; type: ContractType }> = {
  EURUSD: { name: "Euro / US Dollar", size: 100_000, tick: 0.00001, type: "forex" },
  GBPUSD: { name: "British Pound / US Dollar", size: 100_000, tick: 0.00001, type: "forex" },
  AUDUSD: { name: "Australian Dollar / US Dollar", size: 100_000, tick: 0.00001, type: "forex" },
  NZDUSD: { name: "New Zealand Dollar / US Dollar", size: 100_000, tick: 0.00001, type: "forex" },
  USDJPY: { name: "US Dollar / Japanese Yen", size: 100_000, tick: 0.001, type: "forex" },
  USDCHF: { name: "US Dollar / Swiss Franc", size: 100_000, tick: 0.00001, type: "forex" },
  USDCAD: { name: "US Dollar / Canadian Dollar", size: 100_000, tick: 0.00001, type: "forex" },
  EURJPY: { name: "Euro / Japanese Yen", size: 100_000, tick: 0.001, type: "forex" },
  GBPJPY: { name: "British Pound / Japanese Yen", size: 100_000, tick: 0.001, type: "forex" },
  EURGBP: { name: "Euro / British Pound", size: 100_000, tick: 0.00001, type: "forex" },
  XAUUSD: { name: "Gold / US Dollar", size: 100, tick: 0.01, type: "metal" },
  XAGUSD: { name: "Silver / US Dollar", size: 5_000, tick: 0.001, type: "metal" },
}

const clean = (symbol: string) => symbol.trim().toUpperCase()
// EURUSDm, XAUUSD.r, EURUSD-ECN: the pair without the broker's suffix
const spotRoot = (symbol: string) => Object.keys(SPOT).find((k) => clean(symbol).startsWith(k)) ?? null

// The future a symbol is a contract of ("MNQH6" -> MNQ, H, 6), longest root first.
function parseFuture(symbol: string): { root: string; code: string | null; year: number | null } | null {
  const s = clean(symbol)
  for (const root of Object.keys(FUTURES_CONTRACTS).sort((a, b) => b.length - a.length)) {
    if (s === root) return { root, code: null, year: null }
    const m = s.startsWith(root) ? s.slice(root.length).match(/^([FGHJKMNQUVXZ])(\d{1,2})$/) : null
    if (m) return { root, code: m[1], year: Number(m[2]) }
  }
  return null
}

function futureSpec(root: string, symbol: string, expiration: string | null): ContractSpec {
  const c = FUTURES_CONTRACTS[root]
  return { symbol, root, name: c.name, exchange: EXCHANGES[root] ?? null, type: "future", expiration, tickSize: c.tickSize, tickValue: round(c.tickSize * c.multiplier), pointValue: c.multiplier, contractMultiplier: c.multiplier, minimumQuantity: 1, quantityStep: 1 }
}

const round = (v: number) => Math.round(v * 1e8) / 1e8

// The next expirations a future is listed for, nearest first.
export function listedContracts(root: string, now = new Date(), count = 4): ContractSpec[] {
  if (!FUTURES_CONTRACTS[root]) return []
  const cycle = CYCLES[root] ?? QUARTERLY
  const out: ContractSpec[] = []
  let year = now.getUTCFullYear()
  let month = now.getUTCMonth()
  while (out.length < count) {
    const code = MONTH_CODES[month]
    if (cycle.includes(code)) out.push(futureSpec(root, `${root}${code}${year % 10}`, `${year}-${String(month + 1).padStart(2, "0")}`))
    month++
    if (month > 11) {
      month = 0
      year++
    }
  }
  return out
}

// The specification of any symbol. A symbol that isn't recognised still gets
// one — type "other", with no point value — so it can be copied by quantity.
export function specFor(symbol: string, now = new Date()): ContractSpec {
  const s = clean(symbol)
  const fut = parseFuture(s)
  if (fut) {
    let expiration: string | null = null
    if (fut.code && fut.year != null) {
      // the year digit, read as the nearest year that isn't in the past decade
      const base = now.getUTCFullYear()
      let year = fut.year >= 10 ? 2000 + fut.year : Math.floor(base / 10) * 10 + fut.year
      if (fut.year < 10 && year < base - 1) year += 10
      expiration = `${year}-${String(MONTH_CODES.indexOf(fut.code) + 1).padStart(2, "0")}`
    }
    return futureSpec(fut.root, s, expiration)
  }
  const spot = spotRoot(s)
  if (spot) {
    const c = SPOT[spot]
    const usdQuoted = spot.endsWith("USD")
    return { symbol: s, root: spot, name: c.name, exchange: null, type: c.type, expiration: null, tickSize: c.tick, tickValue: usdQuoted ? round(c.tick * c.size) : null, pointValue: usdQuoted ? c.size : null, contractMultiplier: c.size, minimumQuantity: 0.01, quantityStep: 0.01 }
  }
  return { symbol: s, root: s, name: s, exchange: null, type: "other", expiration: null, tickSize: 0.01, tickValue: null, pointValue: null, contractMultiplier: 1, minimumQuantity: 0.01, quantityStep: 0.01 }
}

// What a 1.00 price move is worth for one contract / lot, in USD, at a price.
// null when it can't be known from the price alone (a cross such as EURGBP, or
// a symbol whose contract size isn't known).
export function pointValueAt(spec: ContractSpec, price: number | null): number | null {
  if (spec.pointValue != null) return spec.pointValue
  if (spec.type === "forex" && spec.root.startsWith("USD") && price && price > 0) return spec.contractMultiplier / price
  return null
}

export const isExpired = (spec: ContractSpec, now = new Date()) => spec.expiration != null && spec.expiration < `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`

// Contract search: by symbol, root or name.
export function searchContracts(query: string, now = new Date()): (ContractSpec & { known: boolean })[] {
  const q = clean(query)
  if (!q) return []
  const words = q.toLowerCase()
  const out: (ContractSpec & { known: boolean })[] = []
  for (const [root, c] of Object.entries(FUTURES_CONTRACTS)) {
    const hit = root.startsWith(q) || q.startsWith(root) || root.includes(q) || c.name.toLowerCase().includes(words)
    if (!hit) continue
    for (const spec of listedContracts(root, now)) if (!q.startsWith(root) || q === root || spec.symbol.startsWith(q)) out.push({ ...spec, known: true })
  }
  for (const [symbol, c] of Object.entries(SPOT)) if (symbol.includes(q) || c.name.toLowerCase().includes(words)) out.push({ ...specFor(symbol, now), known: true })
  // exactly what was typed, when it is a symbol nothing above covers
  if (/^[A-Z0-9._-]{2,15}$/.test(q) && !out.some((s) => s.symbol === q)) {
    const typed = specFor(q, now)
    out.push({ ...typed, known: typed.type !== "other" })
  }
  // the closest matches first: a symbol that starts with the query, then roots, then names
  const rank = (s: ContractSpec) => (s.symbol === q ? 0 : s.symbol.startsWith(q) ? 1 : s.root.startsWith(q) ? 2 : 3)
  return out.sort((a, b) => rank(a) - rank(b) || a.root.length - b.root.length || (a.expiration ?? "").localeCompare(b.expiration ?? "")).slice(0, 24)
}

// The micro of a full-size future and the other way round, with how many of
// the follower's contracts make one of the leader's.
export function relatedSymbol(symbol: string): { symbol: string; ratio: number } | null {
  const fut = parseFuture(symbol)
  if (!fut) return null
  const suffix = clean(symbol).slice(fut.root.length)
  for (const [full, micro] of FAMILIES) {
    if (fut.root === full) return { symbol: `${micro}${suffix}`, ratio: 10 }
    if (fut.root === micro) return { symbol: `${full}${suffix}`, ratio: 0.1 }
  }
  return null
}

// Whether two symbols trade at the same price (the same instrument, or a
// micro and its full-size contract): a stop can then be copied as a price.
export function samePriceScale(a: string, b: string): boolean {
  const x = specFor(a)
  const y = specFor(b)
  if (x.root === y.root) return true
  return FAMILIES.some(([full, micro]) => (x.root === full && y.root === micro) || (x.root === micro && y.root === full))
}

export const unitLabel = (spec: Pick<ContractSpec, "type">, quantity: number) => (spec.type === "future" ? (quantity === 1 ? "contract" : "contracts") : quantity === 1 ? "lot" : "lots")
export const formatQuantity = (quantity: number) => (Number.isInteger(quantity) ? String(quantity) : String(Math.round(quantity * 100) / 100))
