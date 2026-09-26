import type { AssetClass, NormalizedExecution } from "@/lib/providers/types"

// What the TradeLoop add-on for NinjaTrader 8 posts (lib/ninjatrader/addon-source.ts),
// validated and turned into the provider-neutral model. Pure, so it's tested
// without a database.
//
// NinjaTrader is the trader's own desktop platform. Prop-firm Tradovate
// accounts (Apex, Tradeify, MyFundedFutures…) connect to it through its
// "NinjaTrader" connection, and the add-on reads their executions through
// NinjaScript — NinjaTrader's public add-on API — on the trader's machine.
// No Tradovate API, password or session is involved.

export const PAYLOAD_VERSION = 1
export const MAX_EXECUTIONS = 5000
export const MAX_ACCOUNTS = 200
export const ENVIRONMENT = "desktop"

export interface NtClient {
  version: string | null
  machine: string | null
  timeZone: string | null
}

export interface NtAccount {
  name: string
  provider: string | null // NinjaTrader's connection provider: "NinjaTrader", "Tradovate", "Rithmic", "Simulator"…
  connection: string | null // the connection's own name in NinjaTrader
  status: string | null
  currency: string
  cashValue: number | null
  netLiquidation: number | null
  realizedPnl: number | null
}

export interface NtParsed {
  client: NtClient
  accounts: NtAccount[]
  executions: NormalizedExecution[]
  rejected: { index: number; reason: string }[]
}

export type ParseResult = { ok: true; value: NtParsed } | { ok: false; error: string }

const str = (v: unknown, max = 128): string | null => {
  if (typeof v !== "string") return null
  const s = v.trim()
  return s === "" ? null : s.slice(0, max)
}
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

const CURRENCIES: Record<string, string> = {
  usdollar: "USD",
  euro: "EUR",
  britishpound: "GBP",
  japaneseyen: "JPY",
  canadiandollar: "CAD",
  australiandollar: "AUD",
  swissfranc: "CHF",
  newzealanddollar: "NZD",
  hongkongdollar: "HKD",
  singaporedollar: "SGD",
}

// NinjaTrader's Currency enum name ("UsDollar") → ISO code.
export function currencyCode(v: unknown): string {
  const s = str(v, 32)
  if (!s) return "USD"
  if (/^[A-Z]{3}$/.test(s)) return s
  return CURRENCIES[s.toLowerCase()] ?? "USD"
}

const MONTH_CODES = "FGHJKMNQUVXZ"

// NinjaTrader names a future "ES 12-25"; Tradovate, Rithmic and the rest of
// the journal call it "ESZ5". Built from the master instrument's name and
// the contract's expiry month ("2025-12") so the two agree.
export function symbolFor(root: string, expiry: string | null, instrumentType: string | null): { symbol: string; contractMonth: string | null } {
  const base = root.toUpperCase().replace(/[^A-Z0-9./-]/g, "")
  const m = expiry ? /^(\d{4})-(\d{2})$/.exec(expiry) : null
  const isFuture = (instrumentType ?? "future").toLowerCase() === "future"
  if (isFuture && m) {
    const year = Number(m[1])
    const month = Number(m[2])
    if (year >= 2000 && month >= 1 && month <= 12) return { symbol: `${base}${MONTH_CODES[month - 1]}${year % 10}`, contractMonth: `${m[1]}-${m[2]}` }
  }
  return { symbol: base, contractMonth: null }
}

export function assetClassFor(instrumentType: string | null): AssetClass {
  switch ((instrumentType ?? "").toLowerCase()) {
    case "stock":
      return "stock"
    case "forex":
      return "forex"
    case "cfd":
      return "cfd"
    case "option":
    case "futureoption":
      return "option"
    case "cryptocurrency":
      return "crypto"
    default:
      return "future"
  }
}

// NinjaTrader's own local simulation (Sim101, playback) isn't a real account
// anywhere — prop-firm evaluation accounts are, and they come through the
// "NinjaTrader"/"Tradovate" connections, so they're kept.
export function skipReason(account: Pick<NtAccount, "name" | "provider">): string | null {
  const provider = (account.provider ?? "").toLowerCase()
  if (provider === "simulator" || provider === "playback") return "local_simulation"
  if (/^(sim101|playback101|backtest)$/i.test(account.name)) return "local_simulation"
  return null
}

// Which broker the journal account shows. Prop-firm Tradovate accounts come
// through NinjaTrader's "NinjaTrader" connection (the older one is labelled
// "Tradovate"); other connections keep their own name.
export function brokerFor(provider: string | null): string {
  const p = (provider ?? "").toLowerCase()
  if (p === "" || p === "ninjatrader" || p === "tradovate") return "Tradovate"
  if (p === "rithmic") return "Rithmic"
  if (p === "interactivebrokers") return "Interactive Brokers"
  if (p === "cqg") return "CQG"
  return provider!.slice(0, 40)
}

export function parsePayload(body: unknown, now = new Date()): ParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Body must be a JSON object." }
  const b = body as Record<string, unknown>
  if (b.v !== PAYLOAD_VERSION) return { ok: false, error: `Unsupported payload version — update the TradeLoop add-on.` }
  const rawAccounts = Array.isArray(b.accounts) ? b.accounts : []
  const rawExecutions = Array.isArray(b.executions) ? b.executions : []
  if (rawAccounts.length > MAX_ACCOUNTS) return { ok: false, error: `Too many accounts in one request (max ${MAX_ACCOUNTS}).` }
  if (rawExecutions.length > MAX_EXECUTIONS) return { ok: false, error: `Too many executions in one request (max ${MAX_EXECUTIONS}).` }

  const c = (b.client ?? {}) as Record<string, unknown>
  const client: NtClient = { version: str(c.version, 32), machine: str(c.machine, 64), timeZone: str(c.timeZone, 64) }

  const accounts: NtAccount[] = []
  const seen = new Set<string>()
  for (const raw of rawAccounts) {
    if (!raw || typeof raw !== "object") continue
    const a = raw as Record<string, unknown>
    const name = str(a.name)
    if (!name || seen.has(name)) continue
    seen.add(name)
    accounts.push({
      name,
      provider: str(a.provider, 64),
      connection: str(a.connection, 128),
      status: str(a.status, 32),
      currency: currencyCode(a.currency),
      cashValue: num(a.cashValue),
      netLiquidation: num(a.netLiquidation),
      realizedPnl: num(a.realizedPnl),
    })
  }
  const currencyOf = new Map(accounts.map((a) => [a.name, a.currency]))

  const executions: NormalizedExecution[] = []
  const rejected: { index: number; reason: string }[] = []
  const latest = now.getTime() + 24 * 60 * 60 * 1000
  rawExecutions.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return void rejected.push({ index, reason: "not an object" })
    const e = raw as Record<string, unknown>
    const account = str(e.account)
    const id = str(e.id, 200)
    const root = str(e.root, 32)
    const side = e.side === "buy" || e.side === "sell" ? e.side : null
    const qty = num(e.qty)
    const price = num(e.price)
    const time = typeof e.time === "string" ? new Date(e.time) : null
    if (!account || !id) return void rejected.push({ index, reason: "missing account or execution id" })
    if (!root) return void rejected.push({ index, reason: "missing instrument" })
    if (!side) return void rejected.push({ index, reason: "side must be buy or sell" })
    if (qty == null || qty <= 0) return void rejected.push({ index, reason: "quantity must be positive" })
    if (price == null) return void rejected.push({ index, reason: "missing price" })
    if (!time || Number.isNaN(time.getTime()) || time.getUTCFullYear() < 2000 || time.getTime() > latest) return void rejected.push({ index, reason: "invalid time" })
    const instrumentType = str(e.instrumentType, 32)
    const { symbol, contractMonth } = symbolFor(root, str(e.expiry, 16), instrumentType)
    const pointValue = num(e.pointValue)
    const commission = num(e.commission)
    executions.push({
      provider: "ninjatrader",
      environment: ENVIRONMENT,
      providerAccountId: account,
      // Execution ids are unique per broker; the account keeps two
      // connections' ids apart all the same.
      providerExecutionId: `${account}|${id}`,
      providerOrderId: str(e.orderId, 200),
      symbol,
      contractMonth,
      assetClass: assetClassFor(instrumentType),
      side,
      quantity: qty,
      price,
      pointValue: pointValue != null && pointValue > 0 ? pointValue : null,
      timestamp: time,
      commission: commission != null ? Math.round(Math.abs(commission) * 100) / 100 : null,
      currency: currencyOf.get(account) ?? "USD",
      active: true,
      metadata: { fullName: str(e.fullName, 64), tickSize: num(e.tickSize) },
    })
  })
  return { ok: true, value: { client, accounts, executions, rejected } }
}
