import type { Market } from "@/lib/calc"
import { normalizeTradingViewSymbol } from "@/lib/tradingview-webhook"

// Reads what the TradeLoop browser extension posts after it has looked at a
// TradingView paper account. Kept free of database code so it can be
// exercised on its own.
//
// TradingView's paper trading lives on its own servers
// (papertrading.tradingview.com) and answers only to the trader's own
// logged-in browser. The extension runs there, calls the same two endpoints
// TradingView's page does — the account list and each account's fills —
// and forwards the result here as-is. So the shapes below are TradingView's
// (accountId, initialBalance, side "buy"/"sell", …), read defensively: the
// extension does no reshaping, and TradingView can add or rename fields
// without telling anyone.

export interface ExtensionExecution {
  id: string
  symbol: string // bare, e.g. "AAPL" — the exchange prefix is kept in `market`
  market: Market
  action: "Buy" | "Sell"
  quantity: number
  price: number
  filledAt: Date
}

export interface ExtensionAccount {
  accountId: string
  name: string | null
  isDefault: boolean
  currency: string
  balance: number | null
  initialBalance: number | null
  executions: ExtensionExecution[]
}

export interface ExtensionSyncPayload {
  extensionVersion: string | null
  browser: string | null
  accounts: ExtensionAccount[]
}

export class TradingViewExtensionError extends Error {}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function asText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() === "" ? null : value.trim()
  if (typeof value === "number" || typeof value === "bigint") return String(value)
  return null
}

// TradingView hands the fill time over as whatever its server sent —
// an ISO string in practice; a number is read as epoch milliseconds, or
// seconds if it's too small to be milliseconds.
function asTime(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e11 ? value * 1000 : value
    return new Date(ms)
  }
  if (typeof value === "string" && value.trim() !== "") {
    const asNum = Number(value)
    if (Number.isFinite(asNum) && /^\d+$/.test(value.trim())) return asTime(asNum)
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

// Which market a TradingView symbol trades on, from its exchange prefix.
// TradingView's paper account mixes every asset class, so this is per fill,
// not per account. Unknown or missing prefixes are stocks: that's where an
// unqualified ticker on TradingView ends up too.
const FUTURES_EXCHANGES = new Set(["CME", "CME_MINI", "CBOT", "CBOT_MINI", "NYMEX", "NYMEX_MINI", "COMEX", "COMEX_MINI", "CFE", "EUREX", "ICEUS", "ICEEUR", "ICESG", "SGX", "OSE", "HKEX", "MOEX", "NSE_FUT", "MCX", "TOCOM", "B3", "ASX_FUT", "TFEX", "BIST_FUT", "TAIFEX"])
const CRYPTO_EXCHANGES = new Set(["BINANCE", "BINANCEUS", "COINBASE", "KRAKEN", "BITSTAMP", "BITFINEX", "BYBIT", "OKX", "OKEX", "KUCOIN", "GEMINI", "HUOBI", "HTX", "GATEIO", "MEXC", "BITGET", "CRYPTO", "CRYPTOCAP", "BITMEX", "DERIBIT", "PHEMEX", "POLONIEX", "UPBIT", "BITHUMB", "BITFLYER", "WHITEBIT", "CRYPTOCOM", "BINGX", "BITMART", "COINEX", "BTSE", "WOONETWORK", "INDEX", "UNISWAP", "UNISWAP3ETH", "PANCAKESWAP"])
const FOREX_EXCHANGES = new Set(["FX", "FX_IDC", "OANDA", "FXCM", "FOREXCOM", "SAXO", "PEPPERSTONE", "ICMARKETS", "EIGHTCAP", "BLACKBULL", "VANTAGE", "FPMARKETS", "EASYMARKETS", "SKILLING", "ACTIVTRADES", "FUSIONMARKETS", "GLOBALPRIME", "TICKMILL", "IG"])
const CFD_EXCHANGES = new Set(["TVC", "CAPITALCOM", "CURRENCYCOM", "SP", "DJ", "NASDAQ_DLY", "CBOE", "XETR_DLY", "SPREADEX", "CITYINDEX", "PLUS500", "MARKETSCOM", "TRADENATION"])

export function marketForTradingViewSymbol(qualified: string): Market {
  const exchange = qualified.includes(":") ? qualified.slice(0, qualified.indexOf(":")).trim().toUpperCase() : ""
  if (FUTURES_EXCHANGES.has(exchange)) return "futures"
  if (CRYPTO_EXCHANGES.has(exchange)) return "crypto"
  if (FOREX_EXCHANGES.has(exchange)) return "forex"
  if (CFD_EXCHANGES.has(exchange)) return "cfd"
  // A continuous contract ("MNQ1!") on an exchange this list doesn't know
  // is still a futures contract.
  const bare = normalizeTradingViewSymbol(qualified)
  if (/^[A-Z0-9]{1,6}\d!$/.test(bare)) return "futures"
  return "stocks"
}

function parseExecution(raw: unknown): ExtensionExecution | null {
  const record = asRecord(raw)
  if (!record) return null
  const id = asText(record.id)
  const symbolRaw = asText(record.symbol) ?? asText(record.instrument)
  const price = asNumber(record.price)
  const qtyRaw = asNumber(record.qty) ?? asNumber(record.quantity)
  const filledAt = asTime(record.time) ?? asTime(record.timestamp)
  const sideRaw = asText(record.side)?.toLowerCase()
  if (!id || !symbolRaw || price == null || qtyRaw == null || qtyRaw === 0 || !filledAt) return null

  // TradingView reports the side in words and a quantity that may or may
  // not be signed; a signed quantity with no side still tells the direction.
  const action: "Buy" | "Sell" | null =
    sideRaw === "buy" || sideRaw === "1" ? "Buy" : sideRaw === "sell" || sideRaw === "-1" ? "Sell" : qtyRaw > 0 && !sideRaw ? "Buy" : qtyRaw < 0 && !sideRaw ? "Sell" : null
  if (!action) return null

  const symbol = normalizeTradingViewSymbol(symbolRaw.replace(/&amp;/g, "&"))
  if (!symbol) return null

  return { id, symbol, market: marketForTradingViewSymbol(symbolRaw), action, quantity: Math.abs(qtyRaw), price, filledAt }
}

function parseAccount(raw: unknown): ExtensionAccount | null {
  const record = asRecord(raw)
  if (!record) return null
  const accountId = asText(record.accountId) ?? asText(record.id)
  if (!accountId) return null
  const executionsRaw = Array.isArray(record.executions) ? record.executions : []
  const executions: ExtensionExecution[] = []
  for (const item of executionsRaw) {
    const parsed = parseExecution(item)
    if (parsed) executions.push(parsed)
  }
  return {
    accountId,
    name: asText(record.name),
    isDefault: record.default === true || record.isDefault === true,
    currency: asText(record.currency)?.toUpperCase() ?? "USD",
    balance: asNumber(record.balance),
    initialBalance: asNumber(record.initialBalance),
    executions,
  }
}

// The size of one post is bounded by the extension (TradingView returns at
// most 1000 fills per account) — anything wildly bigger isn't the extension.
const MAX_ACCOUNTS = 50
const MAX_EXECUTIONS = 5000

export function parseExtensionSync(body: unknown): ExtensionSyncPayload {
  const record = asRecord(body)
  if (!record) throw new TradingViewExtensionError("The sync body isn't the JSON the extension sends.")
  if (!Array.isArray(record.accounts)) throw new TradingViewExtensionError("The sync body has no accounts list.")
  if (record.accounts.length > MAX_ACCOUNTS) throw new TradingViewExtensionError("Too many accounts in one sync.")

  const accounts: ExtensionAccount[] = []
  let executionCount = 0
  for (const item of record.accounts) {
    const account = parseAccount(item)
    if (!account) continue
    executionCount += account.executions.length
    if (executionCount > MAX_EXECUTIONS) throw new TradingViewExtensionError("Too many fills in one sync.")
    accounts.push(account)
  }

  return {
    extensionVersion: asText(record.version),
    browser: asText(record.browser)?.slice(0, 120) ?? null,
    accounts,
  }
}
