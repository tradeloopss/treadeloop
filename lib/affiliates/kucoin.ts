import { createHmac } from "node:crypto"
import https from "node:https"

// THE EXCHANGE ACCOUNT — crypto payouts are withdrawn from a KuCoin account
// through its API, so no wallet key ever lives on this server.
//
//   KUCOIN_API_KEY / KUCOIN_API_SECRET / KUCOIN_API_PASSPHRASE
//       An API key with the General and Withdrawal permissions and NOTHING
//       else (no trading). KuCoin only allows the Withdrawal permission on a
//       key restricted to fixed IP addresses. Environment only: never in the
//       database, never logged, never sent to a browser.
//   KUCOIN_RELAY   host:port of the static-IP relay the key is restricted to.
//       The relay passes the TLS stream through untouched (it never sees the
//       key), and the certificate is still verified as api.kucoin.com here.
//   KUCOIN_API_KEY_VERSION   optional, "3" unless KuCoin issued an older key.
//
// What can leave is bounded twice: by the limits checked before every send
// (payout-engine) and by what is kept in the account's Funding balance.

const HOST = "api.kucoin.com"
export const EXCHANGE_PROVIDER = "kucoin"
export const EXCHANGE_NAME = "KuCoin"

export type ExchangeConfig = { ready: true } | { ready: false; problem: string }

export function exchangeConfig(): ExchangeConfig {
  const set = [process.env.KUCOIN_API_KEY, process.env.KUCOIN_API_SECRET, process.env.KUCOIN_API_PASSPHRASE].filter((v) => v?.trim()).length
  if (set === 0) return { ready: false, problem: "No KuCoin account is connected (KUCOIN_API_KEY, KUCOIN_API_SECRET and KUCOIN_API_PASSPHRASE are not set)." }
  if (set < 3) return { ready: false, problem: "The KuCoin connection is incomplete: KUCOIN_API_KEY, KUCOIN_API_SECRET and KUCOIN_API_PASSPHRASE are all needed." }
  return { ready: true }
}

export const exchangeReady = () => exchangeConfig().ready

// KuCoin answered, and the answer was no: nothing happened on its side.
export class ExchangeRefused extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "ExchangeRefused"
    this.code = code
  }
}

// No usable answer (timeout, dropped connection, a 5xx): the request may or
// may not have been carried out. Never treated as "it didn't happen".
export class ExchangeUnreachable extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ExchangeUnreachable"
  }
}

const hmac = (secret: string, text: string) => createHmac("sha256", secret).update(text).digest("base64")

// The headers KuCoin authenticates a request by. The signature covers the
// timestamp, the method, the path with its query, and the exact body sent.
export function signedHeaders(input: { key: string; secret: string; passphrase: string; version?: string; timestamp: number; method: string; path: string; body: string }): Record<string, string> {
  return {
    "KC-API-KEY": input.key,
    "KC-API-SIGN": hmac(input.secret, `${input.timestamp}${input.method.toUpperCase()}${input.path}${input.body}`),
    "KC-API-TIMESTAMP": String(input.timestamp),
    "KC-API-PASSPHRASE": hmac(input.secret, input.passphrase),
    "KC-API-KEY-VERSION": input.version || "3",
  }
}

type Raw = { status: number; text: string }
const TIMEOUT_MS = 15_000

// Through the relay: a TLS connection to the relay's address that asks for
// (and verifies) api.kucoin.com, which the relay pipes through by its name.
function viaRelay(relay: string, method: string, path: string, headers: Record<string, string>, body: string): Promise<Raw> {
  const [host, port] = relay.split(":")
  return new Promise((resolve, reject) => {
    const req = https.request({ host, port: Number(port) || 8443, servername: HOST, method, path, headers: { ...headers, host: HOST, ...(body ? { "content-length": String(Buffer.byteLength(body)) } : {}) }, timeout: TIMEOUT_MS, rejectUnauthorized: true, agent: false }, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (c: Buffer) => chunks.push(c))
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }))
      res.on("error", reject)
    })
    req.on("timeout", () => req.destroy(new Error("timed out")))
    req.on("error", reject)
    if (body) req.write(body)
    req.end()
  })
}

async function direct(method: string, path: string, headers: Record<string, string>, body: string): Promise<Raw> {
  const res = await fetch(`https://${HOST}${path}`, { method, headers, body: body || undefined, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" })
  return { status: res.status, text: await res.text() }
}

async function call<T>(method: "GET" | "POST", path: string, opts: { body?: Record<string, unknown>; auth?: boolean } = {}): Promise<T> {
  const body = opts.body ? JSON.stringify(opts.body) : ""
  const headers: Record<string, string> = { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) }
  if (opts.auth !== false) {
    const config = exchangeConfig()
    if (!config.ready) throw new ExchangeRefused("not_configured", config.problem)
    Object.assign(headers, signedHeaders({ key: process.env.KUCOIN_API_KEY!.trim(), secret: process.env.KUCOIN_API_SECRET!.trim(), passphrase: process.env.KUCOIN_API_PASSPHRASE!.trim(), version: process.env.KUCOIN_API_KEY_VERSION?.trim(), timestamp: Date.now(), method, path, body }))
  }
  const relay = process.env.KUCOIN_RELAY?.trim()
  let raw: Raw
  try {
    raw = relay ? await viaRelay(relay, method, path, headers, body) : await direct(method, path, headers, body)
  } catch (e) {
    throw new ExchangeUnreachable(`KuCoin couldn't be reached (${e instanceof Error ? e.message : "network error"}).`)
  }
  let json: { code?: string | number; msg?: string; data?: T } | null = null
  try {
    json = JSON.parse(raw.text)
  } catch {}
  if (raw.status >= 500 || !json || json.code == null) throw new ExchangeUnreachable(`KuCoin gave no usable answer (HTTP ${raw.status}).`)
  if (String(json.code) !== "200000") throw new ExchangeRefused(String(json.code), String(json.msg ?? "The request was refused.").slice(0, 300))
  return json.data as T
}

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export type Quota = {
  available: number // what can be withdrawn right now (Funding account)
  fee: number // KuCoin's fee for one withdrawal on this network, in the asset
  min: number // smallest withdrawal
  precision: number // decimal places an amount may have
  enabled: boolean
}

// One call tells us everything needed before a withdrawal: the balance, the
// fee, the minimum, and whether withdrawals on this network are open.
export async function withdrawalQuota(currency: string, chain: string): Promise<Quota> {
  const d = await call<Record<string, unknown>>("GET", `/api/v1/withdrawals/quotas?currency=${encodeURIComponent(currency)}&chain=${encodeURIComponent(chain)}`)
  return { available: num(d.availableAmount), fee: num(d.withdrawMinFee), min: num(d.withdrawMinSize), precision: Math.max(0, Math.min(8, Math.trunc(num(d.precision)))), enabled: d.isWithdrawEnabled === true }
}

// The market price of an asset in USDT (taken as US dollars).
export async function assetPriceUsd(asset: string): Promise<number> {
  const d = await call<{ price?: string }>("GET", `/api/v1/market/orderbook/level1?symbol=${encodeURIComponent(asset)}-USDT`, { auth: false })
  const price = num(d?.price)
  if (!(price > 0)) throw new ExchangeUnreachable(`KuCoin returned no ${asset} price.`)
  return price
}

export type Withdrawal = {
  id: string
  currency: string
  chain: string
  // PROCESSING / WALLET_PROCESSING / REVIEW: not final. SUCCESS: sent. FAILURE: not sent, funds returned.
  status: string
  address: string
  amount: number
  fee: number
  txId: string | null
  remark: string
  inner: boolean
  createdAt: number
}

const withdrawal = (r: Record<string, unknown>): Withdrawal => ({
  id: String(r.id ?? r.withdrawalId ?? ""),
  currency: String(r.currency ?? ""),
  chain: String(r.chain ?? "").toLowerCase(),
  status: String(r.status ?? "").toUpperCase(),
  address: String(r.address ?? r.toAddress ?? ""),
  amount: num(r.amount),
  fee: num(r.fee),
  txId: r.walletTxId ? String(r.walletTxId) : null,
  remark: String(r.remark ?? ""),
  inner: r.isInner === true,
  createdAt: num(r.createdAt),
})

export type WithdrawalRequest = { currency: string; chain: string; address: string; amount: string; remark: string }

// Asks KuCoin to send. The fee is taken from the account on top of the amount
// (EXTERNAL), so the recipient receives exactly `amount`. Throws
// ExchangeRefused when KuCoin said no (nothing was created) and
// ExchangeUnreachable when there was no answer (it may exist — look it up).
export async function applyWithdrawal(w: WithdrawalRequest): Promise<{ withdrawalId: string }> {
  const d = await call<{ withdrawalId?: string }>("POST", "/api/v3/withdrawals", { body: { currency: w.currency, toAddress: w.address, amount: w.amount, withdrawType: "ADDRESS", chain: w.chain, isInner: false, remark: w.remark, feeDeductType: "EXTERNAL" } })
  if (!d?.withdrawalId) throw new ExchangeUnreachable("KuCoin accepted the request but returned no withdrawal id.")
  return { withdrawalId: String(d.withdrawalId) }
}

export async function getWithdrawal(id: string): Promise<Withdrawal | null> {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return null
  const d = await call<Record<string, unknown> | null>("GET", `/api/v1/withdrawals/${id}`)
  return d && (d.id || d.status) ? withdrawal({ id, ...d }) : null
}

// Every withdrawal of one currency since a moment, newest first (one page is
// far more than a single payout's attempts).
export async function listWithdrawals(currency: string, since: number): Promise<Withdrawal[]> {
  const d = await call<{ items?: Record<string, unknown>[] }>("GET", `/api/v1/withdrawals?currency=${encodeURIComponent(currency)}&startAt=${Math.trunc(since)}&currentPage=1&pageSize=100`)
  return (d?.items ?? []).map(withdrawal)
}

// The tag a withdrawal carries so it can be recognised in the account's
// history even when the answer to the request that made it was lost.
export const withdrawalRemark = (payoutId: number, attemptId: number) => `TL-PO-${payoutId}-${attemptId}`

// The withdrawal that belongs to one attempt, in a history listing: by its tag,
// or — should the tag not have been kept — the same asset, address and amount
// made after the attempt began. Erring towards "found" is the safe side: it can
// delay a retry, never cause a second send.
export type WithdrawalMatch = { remark: string; address: string; amount: number; since: number; caseInsensitive?: boolean }

export function matchWithdrawal(items: Withdrawal[], want: WithdrawalMatch): Withdrawal | null {
  const same = (a: string, b: string) => (want.caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b)
  return items.find((w) => w.remark === want.remark) ?? items.find((w) => same(w.address, want.address) && Math.abs(w.amount - want.amount) < 1e-8 && w.createdAt >= want.since - 60_000) ?? null
}

// Where one attempt stands at KuCoin: by its id when we have one, otherwise by
// finding it in the account's history. null = KuCoin has no such withdrawal.
// Throws when KuCoin can't be asked — which proves nothing either way.
export async function lookupWithdrawal(want: WithdrawalMatch & { id?: string | null; currency: string }): Promise<Withdrawal | null> {
  if (want.id) {
    try {
      const found = await getWithdrawal(want.id)
      if (found) return found
    } catch (e) {
      // "no such id" is answered by the history below; anything else is unknown
      if (!(e instanceof ExchangeRefused)) throw e
    }
  }
  const items = await listWithdrawals(want.currency, want.since - 5 * 60_000)
  return (want.id ? items.find((w) => w.id === want.id) : null) ?? matchWithdrawal(items, want)
}
