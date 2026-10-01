import { sendFeeProblem } from "./payout-engine"
import { USDT_TRC20_CONTRACT, tronAddressProblem, tronAddressToHex, usdtFromUnits, usdtUnits } from "./tron"
import { headBlock, tronApi } from "./tron-chain"
import { addressFromPrivateKey, buildSignedTransfer, privateKeyValid, refBlock, transferCallData, type SignedTransfer } from "./tron-tx"

// THE PAYOUT WALLET — a hot wallet. This is the one module that touches its
// private key, and it does three things with it: derive the address, sign a
// USDT transfer this code built itself, and nothing else.
//
//   TRON_PAYOUT_PRIVATE_KEY   the wallet's key (64 hex). Environment only:
//                             never in the database, never logged, never sent
//                             to a browser.
//   TRON_PAYOUT_ADDRESS       optional but recommended: the address the key is
//                             expected to belong to. A mismatch (the wrong key
//                             pasted) disables sending instead of paying from
//                             a wallet nobody meant.
//
// It is a hot wallet: whoever can run code on the server can spend what is in
// it. So it should hold a float — a few days of payouts — not the treasury,
// and every transfer is capped (payout-engine.autoSendProblem).

// A transaction is valid for this long after it is built. Long enough to
// broadcast; short enough that a transfer which didn't go through can be
// proven dead, and retried, within minutes.
export const TX_LIFETIME_MS = 5 * 60_000

export type WalletConfig = { ready: true; address: string } | { ready: false; address: string | null; problem: string }

export function payoutWallet(): WalletConfig {
  const key = process.env.TRON_PAYOUT_PRIVATE_KEY
  if (!key) return { ready: false, address: null, problem: "No payout wallet is configured (TRON_PAYOUT_PRIVATE_KEY is not set)." }
  if (!privateKeyValid(key)) return { ready: false, address: null, problem: "TRON_PAYOUT_PRIVATE_KEY isn't a valid key (64 hexadecimal characters)." }
  const address = addressFromPrivateKey(key)
  const expected = process.env.TRON_PAYOUT_ADDRESS?.trim()
  if (expected && expected !== address) return { ready: false, address, problem: "TRON_PAYOUT_PRIVATE_KEY doesn't belong to TRON_PAYOUT_ADDRESS. Sending is disabled until they match." }
  return { ready: true, address }
}

export const payoutWalletReady = () => payoutWallet().ready

type Constant = { result?: { result?: boolean; message?: string }; constant_result?: string[]; energy_used?: number; logs?: { topics?: string[]; data?: string }[] }
const TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

async function constantCall(owner: string, selector: string, parameter: string): Promise<Constant> {
  const res = await tronApi<Constant>("/wallet/triggerconstantcontract", { owner_address: owner, contract_address: USDT_TRC20_CONTRACT, function_selector: selector, parameter, visible: true })
  if (!res) throw new Error("The TRON node returned nothing.")
  return res
}

export type WalletBalances = { usdt: number; trxSun: number; energyAvailable: number }

export async function walletBalances(address: string): Promise<WalletBalances> {
  const account = tronAddressToHex(address)
  if (!account) throw new Error("Invalid wallet address.")
  const [balance, acct, resource] = await Promise.all([
    constantCall(address, "balanceOf(address)", account.padStart(64, "0")),
    tronApi<{ balance?: number }>("/wallet/getaccount", { address, visible: true }),
    tronApi<{ EnergyLimit?: number; EnergyUsed?: number }>("/wallet/getaccountresource", { address, visible: true }),
  ])
  const hex = balance.constant_result?.[0]
  if (!hex || !/^[0-9a-fA-F]{1,64}$/.test(hex)) throw new Error("Couldn't read the wallet's USDT balance.")
  return { usdt: usdtFromUnits(BigInt(`0x${hex}`)), trxSun: acct?.balance ?? 0, energyAvailable: Math.max(0, (resource?.EnergyLimit ?? 0) - (resource?.EnergyUsed ?? 0)) }
}

let energyPrice: { sun: number; at: number } | null = null
async function energyPriceSun(): Promise<number> {
  if (energyPrice && Date.now() - energyPrice.at < 10 * 60_000) return energyPrice.sun
  const res = await tronApi<{ chainParameter?: { key: string; value?: number }[] }>("/wallet/getchainparameters")
  const sun = res?.chainParameter?.find((p) => p.key === "getEnergyFee")?.value
  if (!sun || sun <= 0) throw new Error("Couldn't read the network's energy price.")
  energyPrice = { sun, at: Date.now() }
  return sun
}

export type SendQuote =
  | { ok: true; feeSun: number; balances: WalletBalances }
  // the wallet can't pay this right now (needs USDT or TRX, or the fee is over the limit) — worth trying again later
  | { ok: false; kind: "funds"; reason: string }
  // the transfer itself would fail (e.g. the recipient is frozen by the token) — needs a person
  | { ok: false; kind: "rejected"; reason: string }

// Everything checked BEFORE anything is signed: the wallet holds the USDT, the
// contract would accept the transfer, and the fee is affordable and within the
// limit. Read-only.
export async function quoteSend(to: string, amount: number, feeLimitSun: number): Promise<SendQuote> {
  const wallet = payoutWallet()
  if (!wallet.ready) return { ok: false, kind: "funds", reason: wallet.problem }
  if (tronAddressProblem(to)) return { ok: false, kind: "rejected", reason: "The recipient's wallet address isn't a valid TRON address." }
  if (to === wallet.address) return { ok: false, kind: "rejected", reason: "The recipient is the payout wallet itself." }
  const units = usdtUnits(amount)
  const balances = await walletBalances(wallet.address)
  if (usdtUnits(balances.usdt) < units) return { ok: false, kind: "funds", reason: `The payout wallet holds ${balances.usdt.toFixed(2)} USDT; this payout needs ${amount.toFixed(2)}.` }

  // Ask the contract what the transfer would do, without sending it.
  const sim = await constantCall(wallet.address, "transfer(address,uint256)", transferCallData(to, units).slice(8))
  // The contract's return value can't be used: USDT on TRON returns false
  // even when the transfer succeeds. What a successful simulation does show is
  // the Transfer event itself — to this recipient, for this amount.
  const recipient = tronAddressToHex(to)!
  const transferred = (sim.logs ?? []).some((l) => l.topics?.[0]?.toLowerCase() === TRANSFER_TOPIC && l.topics?.[2]?.slice(-40).toLowerCase() === recipient && /^[0-9a-fA-F]{1,64}$/.test(l.data ?? "") && BigInt(`0x${l.data}`) === units)
  if (sim.result?.message || sim.result?.result !== true || !transferred) {
    return { ok: false, kind: "rejected", reason: `The USDT contract would reject this transfer${sim.result?.message ? ` (${decodeMessage(sim.result.message)})` : ""}.` }
  }
  const fee = sendFeeProblem({ energyNeeded: sim.energy_used ?? 0, energyAvailable: balances.energyAvailable, energyPriceSun: await energyPriceSun(), trxBalanceSun: balances.trxSun, feeLimitSun })
  if (fee.problem) return { ok: false, kind: "funds", reason: fee.problem }
  return { ok: true, feeSun: fee.feeSun, balances }
}

// Node messages are sometimes hex-encoded text.
function decodeMessage(message: string): string {
  if (/^([0-9a-fA-F]{2})+$/.test(message)) {
    try {
      const text = Buffer.from(message, "hex").toString("utf8")
      if (/^[\x20-\x7e]+$/.test(text)) return text
    } catch {}
  }
  return message.slice(0, 200)
}

// Builds and signs the transfer. Nothing has left the building yet: the caller
// records the transaction first, then broadcasts it.
export async function signTransfer(to: string, amount: number, feeLimitSun: number): Promise<SignedTransfer> {
  const wallet = payoutWallet()
  if (!wallet.ready) throw new Error(wallet.problem)
  const head = await headBlock()
  return buildSignedTransfer(
    { from: wallet.address, to, units: usdtUnits(amount), ...refBlock(head.id), expiration: head.timestamp + TX_LIFETIME_MS, timestamp: Date.now(), feeLimit: feeLimitSun },
    process.env.TRON_PAYOUT_PRIVATE_KEY!
  )
}

export type Broadcast = { accepted: boolean; message: string | null }

// Hands a signed transaction to the network. Whatever comes back is only a
// hint: whether the payout happened is decided by looking at the chain. The
// same signed transaction can be broadcast again safely — it is the same
// transaction, so it can only ever be included once.
export async function broadcast(signedHex: string): Promise<Broadcast> {
  const res = await tronApi<{ result?: boolean; code?: string; message?: string }>("/wallet/broadcasthex", { transaction: signedHex })
  if (res?.result === true || res?.code === "SUCCESS" || res?.code === "DUP_TRANSACTION_ERROR") return { accepted: true, message: null }
  return { accepted: false, message: [res?.code, res?.message ? decodeMessage(res.message) : null].filter(Boolean).join(": ") || "The node did not accept the transaction." }
}
