import type { AssetClass, NormalizedExecution, NormalizedOrder, NormalizedPosition } from "@/lib/providers/types"

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
export const MAX_ORDERS = 5000
export const MAX_POSITIONS = 500
export const ENVIRONMENT = "desktop"

export interface NtClient {
  version: string | null
  machine: string | null
  timeZone: string | null
  os: string | null
  installationId: string | null
  queued: number | null // events the add-on still has to send (its local queue depth)
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
  // Orders and positions are supplementary context (Phase 2): the journal
  // trades are still built from executions alone. Both are optional in the
  // payload, so an older add-on that posts only executions keeps working.
  orders: NormalizedOrder[]
  positions: NormalizedPosition[]
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

// NinjaTrader's OrderState enum → a provider-neutral lifecycle status. The
// full lifecycle is observed because the add-on posts every OrderUpdate, not
// just the final state; one provider_orders row per order holds the latest.
export function orderStatusOf(state: string | null): string {
  switch ((state ?? "").toLowerCase()) {
    case "initialized":
    case "submitted":
    case "pendingsubmit":
      return "submitted"
    case "accepted":
      return "accepted"
    case "working":
    case "changepending":
    case "triggerpending":
      return "working"
    case "partfilled":
      return "partially_filled"
    case "filled":
      return "filled"
    case "cancelled":
    case "canceled":
    case "cancelpending":
      return "cancelled"
    case "rejected":
      return "rejected"
    default:
      return "unknown"
  }
}

// NinjaTrader's OrderType enum → a provider-neutral type. The exact NinjaTrader
// value is kept in raw.ntType for stop/target classification (Phase 3).
export function orderTypeOf(type: string | null): string | null {
  switch ((type ?? "").toLowerCase()) {
    case "market":
      return "market"
    case "limit":
      return "limit"
    case "stopmarket":
    case "stop":
      return "stop"
    case "stoplimit":
      return "stop_limit"
    case "mit":
    case "marketiftouched":
      return "market_if_touched"
    default:
      return type ? type.toLowerCase().slice(0, 32) : null
  }
}

// Stop-loss / take-profit classification (Phase 3). Only a reliable signal
// classifies an order; anything else stays "unknown" — a plain order is never
// guessed to be a stop or a target. Reliable signals:
//   • NinjaTrader's own protective order names (ATM / strategy orders are named
//     "Stop loss", "Profit target", "Stop1", "Target1", …).
//   • A clear OCO bracket: a stop-type and a limit-type leg sharing one OCO
//     group — then the stop leg is the stop and the limit leg is the target.
// An OCO of two stops (a breakout) has no limit leg, so it stays "unknown".
export type OrderPurpose = "stop" | "target" | "unknown"
const STOP_NAME = /stop\s*loss|stoploss|^stop\s*\d*$/i
const TARGET_NAME = /profit\s*target|take\s*profit|^target\s*\d*$|^tp\s*\d*$/i
const STOP_TYPE = /^stop/i // StopMarket, StopLimit
const LIMIT_TYPE = /^limit$/i
const raw = (o: NormalizedOrder, k: string): string | null => {
  const v = o.raw[k]
  return typeof v === "string" && v !== "" ? v : null
}

function purposeFromName(name: string | null): OrderPurpose {
  if (name && STOP_NAME.test(name)) return "stop"
  if (name && TARGET_NAME.test(name)) return "target"
  return "unknown"
}

// Sets raw.purpose on each order, in place.
export function classifyOrderPurposes(orders: NormalizedOrder[]): void {
  // OCO groups that look like a bracket: they carry both a stop-type leg and a limit-type leg
  const group = new Map<string, { stop: boolean; limit: boolean }>()
  for (const o of orders) {
    const oco = raw(o, "oco")
    const ntType = raw(o, "ntType")
    if (!oco || !ntType) continue
    const g = group.get(oco) ?? { stop: false, limit: false }
    if (STOP_TYPE.test(ntType)) g.stop = true
    else if (LIMIT_TYPE.test(ntType)) g.limit = true
    group.set(oco, g)
  }
  for (const o of orders) {
    let purpose = purposeFromName(raw(o, "name"))
    if (purpose === "unknown") {
      const oco = raw(o, "oco")
      const ntType = raw(o, "ntType")
      const g = oco ? group.get(oco) : undefined
      if (g && g.stop && g.limit && ntType) {
        if (STOP_TYPE.test(ntType)) purpose = "stop"
        else if (LIMIT_TYPE.test(ntType)) purpose = "target"
      }
    }
    o.raw.purpose = purpose
  }
}

export function parsePayload(body: unknown, now = new Date()): ParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Body must be a JSON object." }
  const b = body as Record<string, unknown>
  if (b.v !== PAYLOAD_VERSION) return { ok: false, error: `Unsupported payload version — update the TradeLoop add-on.` }
  const rawAccounts = Array.isArray(b.accounts) ? b.accounts : []
  const rawExecutions = Array.isArray(b.executions) ? b.executions : []
  const rawOrders = Array.isArray(b.orders) ? b.orders : []
  const rawPositions = Array.isArray(b.positions) ? b.positions : []
  if (rawAccounts.length > MAX_ACCOUNTS) return { ok: false, error: `Too many accounts in one request (max ${MAX_ACCOUNTS}).` }
  if (rawExecutions.length > MAX_EXECUTIONS) return { ok: false, error: `Too many executions in one request (max ${MAX_EXECUTIONS}).` }
  if (rawOrders.length > MAX_ORDERS) return { ok: false, error: `Too many orders in one request (max ${MAX_ORDERS}).` }
  if (rawPositions.length > MAX_POSITIONS) return { ok: false, error: `Too many positions in one request (max ${MAX_POSITIONS}).` }

  const c = (b.client ?? {}) as Record<string, unknown>
  const client: NtClient = { version: str(c.version, 32), machine: str(c.machine, 64), timeZone: str(c.timeZone, 64), os: str(c.os, 64), installationId: str(c.install, 64), queued: num(c.queued) }

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
  // Orders — supplementary; an invalid one is dropped quietly (the journal does
  // not depend on orders). providerOrderId is NinjaTrader's own order id, which
  // is unique within one NinjaTrader instance (one instance = one connection),
  // so it is not namespaced — it matches the orderId carried on executions.
  const orders: NormalizedOrder[] = []
  for (const raw of rawOrders) {
    if (!raw || typeof raw !== "object") continue
    const o = raw as Record<string, unknown>
    const account = str(o.account)
    const id = str(o.id, 200)
    const root = str(o.root, 32)
    if (!account || !id || !root) continue
    const { symbol } = symbolFor(root, str(o.expiry, 16), str(o.instrumentType, 32))
    const submitted = typeof o.time === "string" ? new Date(o.time) : null
    const ntState = str(o.state, 32)
    const ntType = str(o.orderType, 32)
    orders.push({
      provider: "ninjatrader",
      environment: ENVIRONMENT,
      providerOrderId: id,
      providerAccountId: account,
      symbol,
      contractId: null,
      side: o.side === "buy" || o.side === "sell" ? o.side : null,
      quantity: num(o.qty),
      orderType: orderTypeOf(ntType),
      limitPrice: num(o.limitPrice),
      stopPrice: num(o.stopPrice),
      status: orderStatusOf(ntState),
      submittedAt: submitted && !Number.isNaN(submitted.getTime()) && submitted.getUTCFullYear() >= 2000 ? submitted : null,
      // raw keeps what stop/target classification (Phase 3) and the UI need
      raw: { ntState, ntType, name: str(o.name, 64), oco: str(o.oco, 64), filled: num(o.filled), avgFillPrice: num(o.avgFillPrice), timeInForce: str(o.tif, 16) },
    })
  }

  // Positions — the current snapshot for the accounts the add-on reports.
  // netQuantity is signed; a flat position (0) tells the store to clear it.
  const positions: NormalizedPosition[] = []
  for (const raw of rawPositions) {
    if (!raw || typeof raw !== "object") continue
    const p = raw as Record<string, unknown>
    const account = str(p.account)
    const root = str(p.root, 32)
    if (!account || !root) continue
    const { symbol } = symbolFor(root, str(p.expiry, 16), str(p.instrumentType, 32))
    const market = (str(p.marketPosition, 16) ?? "").toLowerCase()
    const qty = Math.abs(num(p.qty) ?? 0)
    const netQuantity = market === "short" ? -qty : market === "long" ? qty : 0
    positions.push({
      provider: "ninjatrader",
      environment: ENVIRONMENT,
      providerAccountId: account,
      contractId: symbol,
      symbol,
      netQuantity,
      averagePrice: num(p.avgPrice),
      updatedAt: now,
    })
  }

  // classify stop-loss / take-profit, reliably or not at all (Phase 3)
  classifyOrderPurposes(orders)

  return { ok: true, value: { client, accounts, executions, orders, positions, rejected } }
}
