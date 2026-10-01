import { USDT_TRC20_CONTRACT, isTxHash, tronAddressToHex, usdtFromUnits, usdtUnits } from "./tron"

// Reads the TRON chain (through TronGrid's public full-node API) to confirm
// that a USDT payout really happened. READ-ONLY: this file holds no keys and
// sends nothing — it only looks transactions up. A crypto payout is marked
// complete because of what this returns, never because someone says so.

const BASE = (process.env.TRONGRID_API_URL ?? "https://api.trongrid.io").replace(/\/+$/, "")
// keccak256("Transfer(address,address,uint256)") — the TRC-20 transfer event.
const TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

export type TxInfo = {
  id?: string
  blockNumber?: number
  blockTimeStamp?: number
  result?: string // "FAILED" when the transaction reverted
  receipt?: { result?: string }
  log?: { address?: string; topics?: string[]; data?: string }[]
}

export type UsdtTransfer = { to: string; units: bigint }

// The USDT transfers inside a transaction (hex recipients, raw units). A
// transfer of some OTHER token to the same address is not a USDT payout, so
// the emitting contract is checked, not just the event shape.
export function usdtTransfers(info: TxInfo): UsdtTransfer[] {
  const usdt = tronAddressToHex(USDT_TRC20_CONTRACT)
  const out: UsdtTransfer[] = []
  for (const log of info.log ?? []) {
    const topics = log.topics ?? []
    if ((log.address ?? "").toLowerCase() !== usdt || topics.length < 3 || topics[0].toLowerCase() !== TRANSFER_TOPIC) continue
    const data = (log.data ?? "").replace(/^0x/, "")
    if (!/^[0-9a-fA-F]{1,64}$/.test(data)) continue
    out.push({ to: topics[2].slice(-40).toLowerCase(), units: BigInt(`0x${data}`) })
  }
  return out
}

export type ChainVerdict =
  // irreversible on-chain and matches the payout
  | { state: "confirmed"; amount: number; blockTime: Date | null }
  // on-chain and matching, but not yet irreversible
  | { state: "confirming"; amount: number }
  // not known to the network (yet)
  | { state: "not_found" }
  // the transaction itself failed — no money moved
  | { state: "failed"; reason: string }
  // a real transaction, but not this payout (wrong wallet, token or amount)
  | { state: "mismatch"; reason: string }

// Whether a looked-up transaction settles a payout of `amount` USDT to `address`.
export function judgeTransaction(info: TxInfo | null, confirmed: boolean, expect: { address: string; amount: number }): ChainVerdict {
  if (!info?.id) return { state: "not_found" }
  if (info.result === "FAILED" || (info.receipt?.result && info.receipt.result !== "SUCCESS")) {
    return { state: "failed", reason: `The transaction failed on-chain (${info.receipt?.result ?? info.result}). No USDT was transferred.` }
  }
  const want = tronAddressToHex(expect.address)
  if (!want) return { state: "mismatch", reason: "The payout's wallet address is not a valid TRON address." }
  const transfers = usdtTransfers(info)
  if (transfers.length === 0) return { state: "mismatch", reason: "That transaction doesn't contain a USDT (TRC-20) transfer." }
  const mine = transfers.filter((t) => t.to === want)
  if (mine.length === 0) return { state: "mismatch", reason: "That transaction sends USDT to a different wallet than this payout's." }
  const units = mine.reduce((sum, t) => sum + t.units, BigInt(0))
  if (units < usdtUnits(expect.amount)) {
    return { state: "mismatch", reason: `That transaction sends ${usdtFromUnits(units).toFixed(2)} USDT, but the payout is ${expect.amount.toFixed(2)} USDT.` }
  }
  const amount = usdtFromUnits(units)
  return confirmed ? { state: "confirmed", amount, blockTime: info.blockTimeStamp ? new Date(info.blockTimeStamp) : null } : { state: "confirming", amount }
}

// One POST to the TRON full-node API. Throws when the node can't be reached
// or answers with an error status — a failed lookup is never read as an answer.
export async function tronApi<T = Record<string, unknown>>(path: string, payload: Record<string, unknown> = {}, attempt = 0): Promise<T | null> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(process.env.TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY } : {}) },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8_000),
  })
  // Without an API key TronGrid throttles bursts. Wait and ask again rather
  // than report a failure for what is only a busy moment.
  if (res.status === 429 && attempt < 2) {
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
    return tronApi<T>(path, payload, attempt + 1)
  }
  if (!res.ok) throw new Error(`TRON network lookup failed (HTTP ${res.status}). Try again in a moment.`)
  const body = (await res.json().catch(() => null)) as T | null
  return body && typeof body === "object" ? body : null
}

const call = (path: string, hash: string) => tronApi<TxInfo>(path, { value: hash })

// Where a transaction stands, raw: in an irreversible block, in a recent one,
// or nowhere.
export async function lookupTransaction(hash: string): Promise<{ solid: TxInfo | null; latest: TxInfo | null }> {
  const id = hash.trim().toLowerCase()
  const solid = await call("/walletsolidity/gettransactioninfobyid", id)
  if (solid?.id) return { solid, latest: solid }
  const latest = await call("/wallet/gettransactioninfobyid", id)
  return { solid: null, latest: latest?.id ? latest : null }
}

type Block = { blockID?: string; block_header?: { raw_data?: { number?: number; timestamp?: number } } }
const blockOf = (b: Block | null) => {
  const id = b?.blockID
  const raw = b?.block_header?.raw_data
  if (!id || !raw?.timestamp) throw new Error("The TRON node returned no block.")
  return { id, number: raw.number ?? 0, timestamp: raw.timestamp }
}
// The chain's current head, and its irreversible ("solidified") head.
export const headBlock = async () => blockOf(await tronApi<Block>("/wallet/getnowblock"))
export const solidHeadBlock = async () => blockOf(await tronApi<Block>("/walletsolidity/getnowblock"))

// Looks a transaction up — first among solidified (irreversible) blocks, then
// among the latest ones — and judges it against the payout. Throws only when
// the network can't be reached, so "couldn't check" is never mistaken for
// "not found".
export async function verifyUsdtPayment(hash: string, expect: { address: string; amount: number }): Promise<ChainVerdict> {
  if (!isTxHash(hash)) return { state: "mismatch", reason: "That isn't a TRON transaction hash (64 hexadecimal characters)." }
  const id = hash.trim().toLowerCase()
  const solid = await call("/walletsolidity/gettransactioninfobyid", id)
  if (solid?.id) return judgeTransaction(solid, true, expect)
  return judgeTransaction(await call("/wallet/gettransactioninfobyid", id), false, expect)
}
