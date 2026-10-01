import { StripeError, createTransfer, retrieveTransfer, stripeConfigured, stripeFailurePermanent } from "./stripe-connect"
import { TRON_NETWORK, USDT_ASSET, tronAddressProblem } from "./tron"
import { verifyUsdtPayment, type ChainVerdict } from "./tron-chain"
import { payoutWallet, payoutWalletReady, walletBalances } from "./tron-wallet"
import type { PayoutMethodType } from "./types"

// The payout provider abstraction: everything that actually moves money sits
// behind this, so the ledger and the status machine never know (or care) how
// a payout is sent.
//
//   manual       PayPal / Wise / bank — a person sends it and records the result.
//   tron_manual  USDT on TRON — a person sends it from the company wallet and
//                submits the transaction hash; the payout completes only when
//                the chain confirms a matching USDT transfer.
//   tron_hot     USDT on TRON, sent automatically from the payout wallet (a
//                hot wallet whose key lives in the environment — see
//                tron-wallet.ts). The send itself is orchestrated by
//                payouts.sendFromPayoutWallet, which records the signed
//                transaction before it is broadcast.
//   stripe       Stripe Connect — sent by API, when configured.
//
// An external crypto custodian (Fireblocks, a payments API…) would plug in as
// another CryptoPayoutProvider.

export type ProviderPayout = { id: number; amount: number; currency: string; methodType: string; details: Record<string, string>; idempotencyKey: string }

export type ProviderOutcome =
  // accepted, nothing sent yet: a person will send it
  | { state: "queued" }
  // the provider confirms the money has been sent
  | { state: "paid"; reference: string }
  // the provider has a transaction for it; completion comes later
  | { state: "submitted"; reference: string; hash?: string }
  // failed in a way worth retrying (funds stay reserved)
  | { state: "retry"; reason: string }
  // failed for good (the reservation is released)
  | { state: "failed"; reason: string }

export interface PayoutProvider {
  readonly name: string
  // true when createPayout() itself moves the money
  readonly automated: boolean
  createPayout(payout: ProviderPayout): Promise<ProviderOutcome>
  getPayoutStatus(reference: string): Promise<ProviderOutcome | null>
  cancelPayout(reference: string): Promise<boolean>
}

export interface CryptoPayoutProvider extends PayoutProvider {
  readonly network: string
  readonly asset: string
  validateAddress(address: string): string | null
  // What the sending wallet holds, when the provider has custody of one.
  getBalance(): Promise<{ available: number | null }>
  getTransaction(hash: string, expect: { address: string; amount: number }): Promise<ChainVerdict>
  estimateFee(amount: number): Promise<{ fee: number | null; estimated: boolean }>
}

const manual: PayoutProvider = {
  name: "manual",
  automated: false,
  async createPayout() {
    return { state: "queued" }
  },
  async getPayoutStatus() {
    return null
  },
  async cancelPayout() {
    return true
  },
}

const tronManual: CryptoPayoutProvider = {
  name: "tron_manual",
  automated: false,
  network: TRON_NETWORK,
  asset: USDT_ASSET,
  validateAddress: tronAddressProblem,
  // No custody: the company wallet lives outside the app.
  async getBalance() {
    return { available: null }
  },
  async createPayout() {
    return { state: "queued" }
  },
  async getPayoutStatus() {
    return null
  },
  async cancelPayout() {
    return true
  },
  getTransaction: verifyUsdtPayment,
  // The sender pays TRON's network fee in TRX; it isn't known until the
  // transaction is built, so nothing is promised here.
  async estimateFee() {
    return { fee: null, estimated: true }
  },
}

const stripe: PayoutProvider = {
  name: "stripe",
  automated: true,
  async createPayout(p) {
    const accountId = p.details.accountId
    if (!accountId) return { state: "failed", reason: "The Stripe account for this payout method is missing." }
    try {
      const transfer = await createTransfer({ amount: p.amount, accountId, payoutId: p.id, idempotencyKey: p.idempotencyKey })
      return { state: "paid", reference: transfer.id }
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Stripe request failed"
      // Unreachable / rate-limited / out of balance: the same request, with the
      // same idempotency key, is safe to send again later.
      return stripeFailurePermanent(err) ? { state: "failed", reason } : { state: "retry", reason: err instanceof StripeError ? reason : "Stripe couldn't be reached. The payout will be retried." }
    }
  },
  async getPayoutStatus(reference) {
    const t = await retrieveTransfer(reference)
    return t.reversed ? { state: "failed", reason: "The Stripe transfer was reversed." } : { state: "paid", reference: t.id }
  },
  async cancelPayout() {
    return false
  },
}

export const HOT_PROVIDER = "tron_hot"

const tronHot: CryptoPayoutProvider = {
  ...tronManual,
  name: HOT_PROVIDER,
  automated: true,
  async getBalance() {
    const wallet = payoutWallet()
    return { available: wallet.ready ? (await walletBalances(wallet.address)).usdt : null }
  },
}

export const isCryptoMethod = (type: string) => type === "crypto_trc20"

// A payout remembers which provider it was created for.
export function providerByName(name: string): PayoutProvider {
  return name === HOT_PROVIDER ? tronHot : name === "tron_manual" ? tronManual : name === "stripe" ? stripe : manual
}

export const hotWalletReady = payoutWalletReady

export function providerFor(methodType: PayoutMethodType | string): PayoutProvider {
  if (methodType === "crypto_trc20") return tronManual
  if (methodType === "stripe") return stripe
  return manual
}

export const cryptoProvider = (): CryptoPayoutProvider => tronManual

// Which methods can be offered at all on this deployment.
export const methodAvailable = (type: PayoutMethodType | string) => (type === "stripe" ? stripeConfigured() : true)
