import { test } from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_PAYOUT_SETTINGS,
  MAX_AUTO_ATTEMPTS,
  PAYOUT_GROUPS,
  PAYOUT_STATUSES,
  EXCHANGE_DEAD_MARGIN_MS,
  adminPayoutActions,
  assetAmount,
  autoSendProblem,
  exchangeRequestProvablyDead,
  exchangeSendProblem,
  affiliateCanCancel,
  decideAutoPayout,
  effectiveLimits,
  limitProblem,
  manualPayoutProblem,
  methodHoldUntil,
  methodProblem,
  nextPeriodStart,
  normalizePayoutSettings,
  payoutInFlight,
  payoutLedgerStatus,
  payoutTransitionAllowed,
  periodKey,
  quoteFee,
  sendFeeProblem,
  transactionProvablyDead,
  type AffiliateState,
  type PayoutSettings,
} from "@/lib/affiliates/payout-engine"
import { createHmac } from "node:crypto"
import { CRYPTO, aptosAddressProblem, cryptoSpec, cryptoSpecByNetwork, explorerTxUrl as cryptoExplorerUrl, formatAsset, isCryptoMethod, litecoinAddressProblem } from "@/lib/affiliates/crypto"
import { ledgerBalances } from "@/lib/affiliates/engine"
import { matchWithdrawal, signedHeaders, withdrawalRemark, type Withdrawal } from "@/lib/affiliates/kucoin"
import { abaValid, bankScheme, bicValid, ibanValid, validateMethod } from "@/lib/affiliates/method-validation"
import { StripeError, stripeAccountState, stripeFailurePermanent } from "@/lib/affiliates/stripe-connect"
import { judgeTransaction, usdtTransfers, type TxInfo } from "@/lib/affiliates/tron-chain"
import { INVALID_TRC20_MESSAGE, USDT_TRC20_CONTRACT, base58Decode, base58Encode, explorerTxUrl, isTxHash, maskAddress, maskTxHash, sha256, tronAddressFromHex, tronAddressProblem, tronAddressToHex, usdtFromUnits, usdtUnits } from "@/lib/affiliates/tron"
import { addressFromPrivateKey, buildSignedTransfer, encodeTransferRaw, privateKeyValid, recoverSigner, refBlock, signTransactionId, transactionId, transferCallData } from "@/lib/affiliates/tron-tx"

const NOW = new Date("2026-10-07T12:00:00Z") // a Wednesday
const HOUR = 3_600_000
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex")
const settings = (over: Partial<PayoutSettings> = {}): PayoutSettings => ({ ...DEFAULT_PAYOUT_SETTINGS, autoPayouts: true, ...over })
const affiliate = (over: Partial<AffiliateState> = {}): AffiliateState => ({ status: "approved", payoutHold: false, fraudLock: false, manualPayoutAllowed: true, autoPayout: true, autoPayoutAllowed: true, ...over })
const ACTIVE = { status: "active", holdUntil: null }
const NO_TOTALS = { day: 0, week: 0, month: 0 }

// ------------------------------------------------------------------- TRC-20

test("sha256 matches the standard test vectors", () => {
  assert.equal(hex(sha256(new Uint8Array())), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
  assert.equal(hex(sha256(new TextEncoder().encode("abc"))), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  // longer than one block
  assert.equal(hex(sha256(new TextEncoder().encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))), "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1")
})

test("valid TRC-20 addresses pass: format, length, alphabet and checksum", () => {
  // the USDT contract itself, and TRON's zero ("black hole") address
  assert.equal(tronAddressProblem(USDT_TRC20_CONTRACT), null)
  assert.equal(tronAddressToHex(USDT_TRC20_CONTRACT), "a614f803b6fd780986a42c78ec9c7f77e6ded13c")
  assert.equal(tronAddressProblem("T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"), null)
  assert.equal(tronAddressToHex("T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"), "0".repeat(40))
  // surrounding whitespace from a paste is tolerated
  assert.equal(tronAddressProblem(`  ${USDT_TRC20_CONTRACT}\n`), null)
})

test("invalid TRC-20 addresses are refused, each for its own reason", () => {
  assert.match(tronAddressProblem("")!, /Enter your wallet address/)
  // an Ethereum (ERC-20) and a Bitcoin address: the wrong network entirely
  assert.match(tronAddressProblem("0xdAC17F958D2ee523a2206206994597C13D831ec7")!, /starts with the letter T/)
  assert.match(tronAddressProblem("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")!, /starts with the letter T/)
  assert.match(tronAddressProblem("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6")!, /34 characters/)
  assert.match(tronAddressProblem("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6tt")!, /34 characters/)
  // characters base58 never uses
  assert.match(tronAddressProblem("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj60")!, /characters a TRON address can't have/)
  assert.match(tronAddressProblem("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLjlO")!, /characters a TRON address can't have/)
  // one mistyped character: right shape, wrong checksum
  assert.match(tronAddressProblem("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u")!, /checksum/)
  assert.match(tronAddressProblem("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLk6t")!, /checksum/)
  assert.equal(tronAddressToHex("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u"), null)
  assert.equal(base58Decode("0OIl"), null)
})

test("wallets and transactions are only ever shown masked; explorer links come from a validated hash", () => {
  assert.equal(maskAddress(USDT_TRC20_CONTRACT), "TR7N…Lj6t")
  const hash = "a".repeat(60) + "8921"
  assert.equal(isTxHash(hash), true)
  assert.equal(maskTxHash(hash), "aaaaaa…8921")
  assert.equal(explorerTxUrl("TRON", hash), `https://tronscan.org/#/transaction/${hash}`)
  assert.equal(explorerTxUrl("TRON", hash.toUpperCase()), `https://tronscan.org/#/transaction/${hash}`)
  for (const bad of ["", "abc", `${hash}0`, "javascript:alert(1)", "../../x", null]) assert.equal(explorerTxUrl("TRON", bad as string), null)
  // no link for a network we don't know how to link to
  assert.equal(explorerTxUrl("ETHEREUM", hash), null)
  assert.equal(usdtUnits(420), BigInt(420_000_000))
  assert.equal(usdtUnits(9.8), BigInt(9_800_000))
  assert.equal(usdtFromUnits(BigInt(420_000_000)), 420)
})

// ---------------------------------------------------------- payout methods

const WALLET = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"
const crypto = (over: Record<string, unknown> = {}) => validateMethod("crypto_trc20", { nickname: "Main USDT Wallet", address: WALLET, network: "TRON", asset: "USDT", confirmNetwork: true, confirmTail: WALLET.slice(-6), ...over })

test("adding crypto: explicit network, confirmation and re-typed tail are all required", () => {
  const ok = crypto()
  assert.ok(ok.ok)
  if (ok.ok) {
    assert.deepEqual(ok.method.details, { address: WALLET })
    assert.deepEqual(ok.method.metadata, { network: "TRON", standard: "TRC-20", asset: "USDT", currency: "USDT" })
    assert.equal(ok.method.label, "T9yD…uWwb")
    assert.equal(ok.method.nickname, "Main USDT Wallet")
  }
  const err = (r: ReturnType<typeof crypto>) => (r.ok ? "" : r.error)
  assert.equal(err(crypto({ address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u" })), INVALID_TRC20_MESSAGE)
  assert.equal(err(crypto({ address: "0xdAC17F958D2ee523a2206206994597C13D831ec7" })), INVALID_TRC20_MESSAGE)
  assert.match(err(crypto({ confirmNetwork: false })), /Confirm that this wallet supports USDT on TRC-20/)
  assert.match(err(crypto({ confirmNetwork: "true" })), /Confirm that this wallet/)
  assert.match(err(crypto({ confirmTail: "xxxxxx" })), /last six characters/)
  // another network or asset can't be smuggled into this method
  assert.match(err(crypto({ network: "ETHEREUM" })), /TRON \(TRC-20\) network only/)
  assert.match(err(crypto({ asset: "USDC" })), /USDT only/)
})

test("adding PayPal and Wise", () => {
  const p = validateMethod("paypal", { email: " Pay@Example.com ", accountType: "business", country: "us", currency: "usd", extra: "ignored" })
  assert.ok(p.ok)
  if (p.ok) assert.deepEqual([p.method.details, p.method.metadata, p.method.label, p.method.identity], [{ email: "pay@example.com" }, { accountType: "business", country: "US", currency: "USD" }, "p••@example.com", "paypal:pay@example.com"])
  const bad = (input: Record<string, unknown>, type = "paypal") => {
    const r = validateMethod(type, input)
    return r.ok ? null : r.field
  }
  assert.equal(bad({ email: "nope", accountType: "personal", country: "US", currency: "USD" }), "email")
  assert.equal(bad({ email: "a@b.co", country: "US", currency: "USD" }), "accountType")
  assert.equal(bad({ email: "a@b.co", accountType: "personal", country: "USA?", currency: "USD" }), "country")
  assert.equal(bad({ email: "a@b.co", accountType: "personal", country: "US", currency: "DOGE" }), "currency")
  assert.equal(bad({ email: "a@b.co", holder: "A", country: "DE", currency: "EUR" }, "wise"), "holder")
  assert.equal(validateMethod("wise", { email: "a@b.co", holder: "Alex Partner", country: "DE", currency: "EUR" }).ok, true)
  assert.equal(validateMethod("stripe", {}).ok, false) // Stripe accounts come from Stripe's own onboarding
  assert.equal(validateMethod("venmo", {}).ok, false)
})

test("bank details follow the country: US routing, IBAN, or SWIFT + account", () => {
  assert.deepEqual([bankScheme("US"), bankScheme("DE"), bankScheme("EG"), bankScheme("IN"), bankScheme("CA")], ["us", "iban", "iban", "swift", "swift"])
  assert.equal(ibanValid("GB82 WEST 1234 5698 7654 32"), true)
  assert.equal(ibanValid("DE89370400440532013000"), true)
  assert.equal(ibanValid("DE89370400440532013001"), false) // one digit off
  assert.equal(ibanValid("XX00"), false)
  assert.equal(abaValid("021000021"), true)
  assert.equal(abaValid("021000022"), false)
  assert.equal(abaValid("12345"), false)
  assert.equal(bicValid("DEUTDEFF"), true)
  assert.equal(bicValid("DEUTDEFF500"), true)
  assert.equal(bicValid("DEUT"), false)

  const field = (input: Record<string, unknown>) => {
    const r = validateMethod("bank", input)
    return r.ok ? r.method : r.field
  }
  const us = field({ holder: "Alex Partner", country: "US", currency: "USD", routing: "021000021", account: "000123456789", bankName: "Chase" })
  assert.equal(typeof us, "object")
  if (typeof us === "object") assert.deepEqual([us.label, us.details.accountType, us.metadata.scheme], ["Chase ···· 6789", "checking", "us"])
  assert.equal(field({ holder: "Alex Partner", country: "US", currency: "USD", routing: "021000022", account: "000123456789" }), "routing")
  assert.equal(field({ holder: "Alex Partner", country: "DE", currency: "EUR", iban: "DE89370400440532013001" }), "iban")
  // a valid IBAN from a different country than the one selected
  assert.equal(field({ holder: "Alex Partner", country: "DE", currency: "EUR", iban: "GB82WEST12345698765432" }), "iban")
  const de = field({ holder: "Alex Partner", country: "DE", currency: "EUR", iban: "de89 3704 0044 0532 0130 00" })
  if (typeof de === "object") assert.deepEqual([de.details.iban, de.label], ["DE89370400440532013000", "IBAN ···· 3000"])
  else assert.fail(String(de))
  assert.equal(field({ holder: "Alex Partner", country: "IN", currency: "INR", account: "1234567890", swift: "BAD" }), "swift")
  assert.equal(field({ holder: "Alex Partner", country: "IN", currency: "INR", account: "1234567890", swift: "HDFCINBB" }), "bankName")
  assert.equal(typeof field({ holder: "Alex Partner", country: "IN", currency: "INR", account: "1234567890", swift: "HDFCINBB", bankName: "HDFC" }), "object")
})

test("wallet-change hold: a method added to an account that already had one must wait", () => {
  assert.equal(methodHoldUntil({ hadMethodBefore: false, holdHours: 24, now: NOW }), null)
  assert.equal(methodHoldUntil({ hadMethodBefore: true, holdHours: 0, now: NOW }), null)
  const until = methodHoldUntil({ hadMethodBefore: true, holdHours: 24, now: NOW })!
  assert.equal(until.getTime(), NOW.getTime() + 24 * HOUR)
  assert.match(methodProblem({ status: "active", holdUntil: until }, NOW)!, /newly added payout method can be used from/)
  assert.equal(methodProblem({ status: "active", holdUntil: until }, new Date(until.getTime() + 1)), null)
  assert.equal(methodProblem(ACTIVE, NOW), null)
  assert.match(methodProblem(null, NOW)!, /Add a payout method/)
  for (const status of ["disabled", "rejected", "removed"]) assert.match(methodProblem({ status, holdUntil: null }, NOW)!, /isn't active/)
  assert.match(methodProblem({ status: "pending_verification", holdUntil: null }, NOW)!, /being verified/)
  assert.match(methodProblem({ status: "verification_required", holdUntil: null }, NOW)!, /needs to be verified/)
})

// ----------------------------------------------------------- status machine

test("payout lifecycle: forward only, terminal states are final", () => {
  // manual approval: request → approve → send → complete
  for (const [from, to] of [["pending", "queued"], ["queued", "processing"], ["processing", "paid"], ["queued", "paid"]]) assert.equal(payoutTransitionAllowed(from, to), true, `${from}→${to}`)
  // crypto: submitted → confirming → completed
  for (const [from, to] of [["queued", "submitted"], ["submitted", "confirming"], ["confirming", "paid"], ["submitted", "paid"]]) assert.equal(payoutTransitionAllowed(from, to), true, `${from}→${to}`)
  // failure and retry
  for (const [from, to] of [["processing", "retry_required"], ["retry_required", "queued"], ["retry_required", "failed"], ["confirming", "failed"]]) assert.equal(payoutTransitionAllowed(from, to), true, `${from}→${to}`)
  // hold and release
  for (const [from, to] of [["pending", "on_hold"], ["queued", "on_hold"], ["on_hold", "pending"], ["on_hold", "queued"], ["on_hold", "rejected"]]) assert.equal(payoutTransitionAllowed(from, to), true, `${from}→${to}`)
  // not allowed: skipping approval, cancelling after money may have moved, un-completing
  for (const [from, to] of [["pending", "paid"], ["pending", "processing"], ["processing", "cancelled"], ["submitted", "cancelled"], ["confirming", "cancelled"], ["paid", "pending"], ["paid", "failed"], ["on_hold", "paid"]]) {
    assert.equal(payoutTransitionAllowed(from, to), false, `${from}→${to}`)
  }
  for (const done of ["failed", "cancelled", "rejected", "reversed"]) for (const to of PAYOUT_STATUSES) assert.equal(payoutTransitionAllowed(done, to), false, `${done}→${to}`)
  assert.equal(payoutTransitionAllowed("paid", "reversed"), true)
  assert.equal(payoutTransitionAllowed("nonsense", "paid"), false)
  // an automatic send that provably never happened goes back to the queue — but a payout the chain is confirming never does
  for (const from of ["processing", "submitted"]) assert.equal(payoutTransitionAllowed(from, "queued"), true, `${from}→queued`)
  for (const from of ["confirming", "paid"]) assert.equal(payoutTransitionAllowed(from, "queued"), false, `${from}→queued`)
  // every status sits in exactly one admin tab
  assert.deepEqual(Object.values(PAYOUT_GROUPS).flat().sort(), [...PAYOUT_STATUSES].sort())
  assert.equal(affiliateCanCancel("pending"), true)
  for (const s of ["queued", "processing", "submitted", "on_hold", "paid"]) assert.equal(affiliateCanCancel(s), false)
})

test("ledger reservation: held while in flight or paid, released by any other ending", () => {
  const earned = [{ type: "subscription", amount: 420, status: "available" }]
  const balance = (status: string) => ledgerBalances([...earned, { type: "payout", amount: -420, status: payoutLedgerStatus(status) }])
  for (const s of ["pending", "queued", "processing", "submitted", "confirming", "retry_required", "on_hold"]) {
    assert.equal(payoutInFlight(s), true)
    assert.deepEqual([balance(s).available, balance(s).processing, balance(s).lifetimePaid], [0, 420, 0], s)
  }
  assert.deepEqual([balance("paid").available, balance("paid").processing, balance("paid").lifetimePaid], [0, 0, 420])
  for (const s of ["failed", "cancelled", "rejected", "reversed"]) {
    assert.equal(payoutInFlight(s), false)
    assert.deepEqual([balance(s).available, balance(s).processing, balance(s).lifetimePaid], [420, 0, 0], s)
  }
})

test("admin actions depend on the payout's state and how it is paid", () => {
  const act = (status: string, crypto = false, automated = false) => adminPayoutActions({ status, crypto, automated, hasHash: false })
  assert.deepEqual(act("pending"), ["approve", "reject", "hold", "cancel"])
  assert.deepEqual(act("queued"), ["start", "mark_paid", "hold", "cancel", "fail"])
  // a crypto payout can only complete through a transaction — never "mark paid"
  assert.deepEqual(act("queued", true), ["start", "submit_tx", "hold", "cancel", "fail"])
  assert.ok(!act("processing", true).includes("mark_paid"))
  assert.deepEqual(act("confirming", true), ["check", "fail"])
  assert.deepEqual(act("submitted", true), ["check", "submit_tx", "fail"])
  assert.deepEqual(act("on_hold"), ["release", "reject", "cancel"])
  assert.deepEqual(act("retry_required"), ["retry", "mark_paid", "hold", "cancel", "fail"])
  // an automated provider is never "marked paid" by hand
  assert.deepEqual(act("queued", false, true), ["retry", "hold", "cancel", "fail"])
  assert.deepEqual(act("paid"), ["reverse"])
  assert.deepEqual(act("paid", true), []) // on-chain is final
  for (const s of ["failed", "cancelled", "rejected", "reversed"]) assert.deepEqual(act(s), [])
})

// ------------------------------------------------------------ settings/fees

test("payout settings are clamped; unknown values fall back", () => {
  assert.deepEqual(normalizePayoutSettings(null), DEFAULT_PAYOUT_SETTINGS)
  const s = normalizePayoutSettings({ autoPayouts: "yes", paused: true, approval: "yolo", frequency: "hourly", maxPayout: -5, dailyLimit: "", weeklyLimit: 1000.239, methodHoldHours: 99999, methods: ["crypto_trc20", "venmo", "paypal"], feePolicy: "affiliate", fees: { crypto_trc20: { fixed: 1.5, percent: 900 }, paypal: { fixed: -3 } } })
  assert.equal(s.autoPayouts, false)
  assert.equal(s.paused, true)
  assert.equal(s.approval, "manual")
  assert.equal(s.frequency, "weekly")
  assert.equal(s.maxPayout, null)
  assert.equal(s.dailyLimit, null)
  assert.equal(s.weeklyLimit, 1000.24)
  assert.equal(s.monthlyLimit, null)
  assert.equal(s.methodHoldHours, 720)
  assert.deepEqual(s.methods, ["paypal", "crypto_trc20"])
  assert.deepEqual(s.fees.crypto_trc20, { fixed: 1.5, percent: 50 })
  assert.deepEqual(s.fees.paypal, { fixed: 0, percent: 0 })
  assert.deepEqual(s.fees.bank, { fixed: 0, percent: 0 })
})

test("fees are quoted up front and never silently deducted", () => {
  const fees = { ...DEFAULT_PAYOUT_SETTINGS.fees, paypal: { fixed: 0.3, percent: 2 }, crypto_trc20: { fixed: 1, percent: 0 } }
  // the platform pays: the affiliate receives the full amount
  assert.deepEqual(quoteFee(420, "paypal", settings({ fees })), { amount: 420, fee: 0, net: 420, estimated: false })
  const s = settings({ feePolicy: "affiliate", fees })
  assert.deepEqual(quoteFee(420, "paypal", s), { amount: 420, fee: 8.7, net: 411.3, estimated: false })
  // a network fee is an estimate until the transaction is built
  assert.deepEqual(quoteFee(420, "crypto_trc20", s), { amount: 420, fee: 1, net: 419, estimated: true })
  assert.deepEqual(quoteFee(420, "bank", s), { amount: 420, fee: 0, net: 420, estimated: false })
  // a fee can never exceed the payout
  assert.deepEqual(quoteFee(0.5, "crypto_trc20", s), { amount: 0.5, fee: 0.5, net: 0, estimated: true })
})

test("limits: affiliate overrides win over the program's", () => {
  assert.deepEqual(effectiveLimits({ programMin: 50, settings: settings() }), { min: 50, max: 5000 })
  assert.deepEqual(effectiveLimits({ programMin: 50, settings: settings(), minOverride: 100, maxOverride: 1000 }), { min: 100, max: 1000 })
  assert.deepEqual(effectiveLimits({ programMin: 50, settings: settings({ maxPayout: null }) }), { min: 50, max: null })
  // a maximum below the minimum can't strand a balance
  assert.deepEqual(effectiveLimits({ programMin: 50, settings: settings(), maxOverride: 20 }), { min: 50, max: 50 })
  assert.equal(limitProblem(500, { day: 19_600, week: 0, month: 0 }, settings()), "The program's daily payout limit has been reached. Try again tomorrow.")
  assert.equal(limitProblem(400, { day: 19_600, week: 0, month: 0 }, settings()), null)
  assert.match(limitProblem(10, { day: 0, week: 995, month: 0 }, settings({ weeklyLimit: 1000 }))!, /weekly/)
  assert.match(limitProblem(10, { day: 0, week: 0, month: 995 }, settings({ monthlyLimit: 1000 }))!, /monthly/)
  assert.equal(limitProblem(1e9, { day: 1e9, week: 1e9, month: 1e9 }, settings({ dailyLimit: null })), null)
})

test("frequency: one automatic payout per period", () => {
  assert.equal(periodKey("daily", NOW), "2026-10-07")
  assert.equal(periodKey("immediate", NOW), "2026-10-07")
  assert.equal(periodKey("weekly", NOW), "2026-W41")
  assert.equal(periodKey("monthly", NOW), "2026-10")
  // Monday and Sunday of the same ISO week share a key; the next Monday doesn't
  assert.equal(periodKey("weekly", new Date("2026-10-05T00:00:00Z")), "2026-W41")
  assert.equal(periodKey("weekly", new Date("2026-10-11T23:59:59Z")), "2026-W41")
  assert.equal(periodKey("weekly", new Date("2026-10-12T00:00:00Z")), "2026-W42")
  // year boundaries follow ISO weeks
  assert.equal(periodKey("weekly", new Date("2027-01-01T12:00:00Z")), "2026-W53")
  assert.equal(periodKey("weekly", new Date("2024-12-30T12:00:00Z")), "2025-W01")
  assert.equal(nextPeriodStart("daily", NOW).toISOString(), "2026-10-08T00:00:00.000Z")
  assert.equal(nextPeriodStart("weekly", NOW).toISOString(), "2026-10-12T00:00:00.000Z")
  assert.equal(nextPeriodStart("weekly", new Date("2026-10-11T23:00:00Z")).toISOString(), "2026-10-12T00:00:00.000Z")
  assert.equal(nextPeriodStart("monthly", NOW).toISOString(), "2026-11-01T00:00:00.000Z")
  assert.equal(nextPeriodStart("monthly", new Date("2026-12-15T00:00:00Z")).toISOString(), "2027-01-01T00:00:00.000Z")
})

// ---------------------------------------------------------------- manual

const manual = (over: Partial<Parameters<typeof manualPayoutProblem>[0]> = {}) =>
  manualPayoutProblem({ amount: 100, available: 250, limits: { min: 50, max: 5000 }, settings: settings(), affiliate: affiliate(), method: ACTIVE, hasPayoutInFlight: false, totals: NO_TOTALS, now: NOW, ...over })

test("manual payout request validation", () => {
  assert.equal(manual(), null)
  assert.equal(manual({ amount: 250 }), null)
  assert.match(manual({ amount: 250.01 })!, /more than your available/)
  assert.match(manual({ amount: 49.99 })!, /minimum payout is \$50\.00/)
  assert.match(manual({ amount: 6000, available: 9000 })!, /most you can withdraw in one payout is \$5000\.00/)
  assert.match(manual({ amount: 0 })!, /Enter an amount/)
  assert.match(manual({ amount: -5 })!, /Enter an amount/)
  assert.match(manual({ amount: Number.NaN })!, /Enter an amount/)
  assert.match(manual({ amount: 100.005 })!, /two decimal/)
  assert.match(manual({ method: null })!, /Add a payout method/)
  assert.match(manual({ method: { status: "active", holdUntil: new Date(NOW.getTime() + HOUR) } })!, /newly added payout method/)
  assert.match(manual({ hasPayoutInFlight: true })!, /already have a payout in progress/)
  assert.match(manual({ affiliate: affiliate({ status: "suspended" }) })!, /isn't active/)
  assert.match(manual({ affiliate: affiliate({ payoutHold: true }) })!, /on hold/)
  assert.match(manual({ affiliate: affiliate({ fraudLock: true }) })!, /under review/)
  assert.match(manual({ affiliate: affiliate({ manualPayoutAllowed: false }) })!, /switched off for your account/)
  // the emergency pause stops manual requests too
  assert.match(manual({ settings: settings({ paused: true }) })!, /temporarily paused/)
  assert.match(manual({ totals: { day: 19_950, week: 0, month: 0 } })!, /daily payout limit/)
  // automatic payouts being off (for the program or the affiliate) doesn't block a manual request
  assert.equal(manual({ settings: settings({ autoPayouts: false }), affiliate: affiliate({ autoPayout: false, autoPayoutAllowed: false }) }), null)
})

// ------------------------------------------------------------- automatic

const auto = (over: Partial<Parameters<typeof decideAutoPayout>[0]> = {}) =>
  decideAutoPayout({ settings: settings(), affiliate: affiliate(), available: 420, limits: { min: 50, max: 5000 }, threshold: null, method: ACTIVE, hasPayoutInFlight: false, paidThisPeriod: false, openHighRiskSignals: 0, totals: NO_TOTALS, now: NOW, ...over })
const code = (d: ReturnType<typeof auto>) => (d.ok ? "ok" : d.code)

test("automatic payout: pays the available balance when every check passes", () => {
  assert.deepEqual(auto(), { ok: true, amount: 420 })
  // never a fraction of a cent, never more than the per-payout maximum
  assert.deepEqual(auto({ available: 420.129 }), { ok: true, amount: 420.12 })
  assert.deepEqual(auto({ available: 9000 }), { ok: true, amount: 5000 })
  assert.deepEqual(auto({ available: 9000, limits: { min: 50, max: null } }), { ok: true, amount: 9000 })
})

test("automatic payout OFF means no money moves — at every level", () => {
  // the global switch
  assert.equal(code(auto({ settings: settings({ autoPayouts: false }) })), "auto_off")
  // the emergency pause
  assert.equal(code(auto({ settings: settings({ paused: true }) })), "paused")
  // an admin disabled it for THIS affiliate — even though the affiliate has it on
  assert.equal(code(auto({ affiliate: affiliate({ autoPayout: true, autoPayoutAllowed: false }) })), "admin_disabled")
  // the affiliate never switched it on
  assert.equal(code(auto({ affiliate: affiliate({ autoPayout: false }) })), "opted_out")
  // pause beats everything else
  assert.equal(code(auto({ settings: settings({ paused: true, autoPayouts: false }), affiliate: affiliate({ status: "suspended" }) })), "paused")
})

test("automatic payout: safety checks", () => {
  assert.equal(code(auto({ affiliate: affiliate({ status: "suspended" }) })), "affiliate_inactive")
  assert.equal(code(auto({ affiliate: affiliate({ fraudLock: true }) })), "fraud_hold")
  assert.equal(code(auto({ affiliate: affiliate({ payoutHold: true }) })), "payout_hold")
  assert.equal(code(auto({ openHighRiskSignals: 1 })), "risk_review")
  assert.equal(code(auto({ method: null })), "no_method")
  assert.equal(code(auto({ method: { status: "disabled", holdUntil: null } })), "method_ineligible")
  assert.equal(code(auto({ method: { status: "pending_verification", holdUntil: null } })), "method_ineligible")
  // a wallet changed an hour ago is not paid to
  assert.equal(code(auto({ method: { status: "active", holdUntil: new Date(NOW.getTime() + 23 * HOUR) } })), "method_hold")
  assert.equal(code(auto({ method: { status: "active", holdUntil: new Date(NOW.getTime() - HOUR) } })), "ok")
  // duplicate prevention
  assert.equal(code(auto({ hasPayoutInFlight: true })), "in_flight")
  assert.equal(code(auto({ paidThisPeriod: true })), "already_paid_this_period")
})

test("automatic payout: thresholds and limits", () => {
  assert.equal(code(auto({ available: 49.99 })), "below_threshold")
  assert.equal(code(auto({ available: 50 })), "ok")
  // the affiliate's own, higher threshold
  assert.equal(code(auto({ available: 420, threshold: 500 })), "below_threshold")
  assert.equal(code(auto({ available: 500, threshold: 500 })), "ok")
  // a threshold below the minimum can't undercut it
  assert.equal(code(auto({ available: 30, threshold: 10 })), "below_threshold")
  // an admin's custom minimum for this affiliate
  assert.equal(code(auto({ available: 150, limits: { min: 200, max: 5000 } })), "below_threshold")
  assert.equal(code(auto({ available: -9.8 })), "below_threshold")
  assert.equal(code(auto({ totals: { day: 19_800, week: 0, month: 0 } })), "limit_reached")
  assert.equal(code(auto({ totals: { day: 19_500, week: 0, month: 0 } })), "ok")
})

// ------------------------------------------------------- chain verification

// A real mainnet USDT transfer, exactly as TronGrid returned it (79 USDT).
const REAL_TX: TxInfo = {
  id: "e0acf1a1305799799f336afe9e73e44406a6f9f635ededd7e5baea4962be8ab6",
  blockNumber: 86738346,
  blockTimeStamp: 1790887644000,
  receipt: { result: "SUCCESS" },
  log: [
    {
      address: "a614f803b6fd780986a42c78ec9c7f77e6ded13c",
      topics: ["ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0000000000000000000000002b41b215051fabb8fa7a82348e6802cf43b9e319", "000000000000000000000000e54f448d91153818a4573d6c151171ce8e607bbe"],
      data: "0000000000000000000000000000000000000000000000000000000004b571c0",
    },
  ],
}
const RECIPIENT = "TWsghcMkFXe1hnwZAWVQ9fUrZBtYv2aGJ8" // 0xe54f…7bbe
const SENDER_HEX = "2b41b215051fabb8fa7a82348e6802cf43b9e319"

test("a payout is complete only when the chain shows a matching, irreversible USDT transfer", () => {
  assert.equal(tronAddressToHex(RECIPIENT), "e54f448d91153818a4573d6c151171ce8e607bbe")
  assert.deepEqual(usdtTransfers(REAL_TX), [{ to: "e54f448d91153818a4573d6c151171ce8e607bbe", units: BigInt(79_000_000) }])
  const judge = (info: TxInfo | null, confirmed: boolean, amount = 79, address = RECIPIENT) => judgeTransaction(info, confirmed, { address, amount })
  assert.deepEqual(judge(REAL_TX, true), { state: "confirmed", amount: 79, blockTime: new Date(1790887644000) })
  // seen, but not yet irreversible: not complete
  assert.deepEqual(judge(REAL_TX, false), { state: "confirming", amount: 79 })
  // sending a little more than the payout is fine; less is not
  assert.equal(judge(REAL_TX, true, 50).state, "confirmed")
  assert.deepEqual(judge(REAL_TX, true, 79.01), { state: "mismatch", reason: "That transaction sends 79.00 USDT, but the payout is 79.01 USDT." })
  // a real transaction to someone else
  assert.match((judge(REAL_TX, true, 79, USDT_TRC20_CONTRACT) as { reason: string }).reason, /different wallet/)
  // unknown to the network
  assert.deepEqual(judge(null, false), { state: "not_found" })
  assert.deepEqual(judge({}, true), { state: "not_found" })
})

test("look-alike transactions are not payouts: another token, a reverted call, a non-transfer event", () => {
  const judge = (info: TxInfo) => judgeTransaction(info, true, { address: RECIPIENT, amount: 79 })
  // the same Transfer event emitted by some OTHER contract (a worthless token named USDT)
  const fake = { ...REAL_TX, log: [{ ...REAL_TX.log![0], address: "ab".repeat(20) }] }
  assert.deepEqual(usdtTransfers(fake), [])
  assert.match((judge(fake) as { reason: string }).reason, /doesn't contain a USDT \(TRC-20\) transfer/)
  // reverted on-chain: the log may be there, the money isn't
  assert.match((judge({ ...REAL_TX, receipt: { result: "OUT_OF_ENERGY" } }) as { reason: string }).reason, /failed on-chain \(OUT_OF_ENERGY\)/)
  assert.equal(judge({ ...REAL_TX, result: "FAILED", receipt: {} }).state, "failed")
  // an Approval event, or a transfer FROM the wallet, doesn't count
  const approval = { ...REAL_TX, log: [{ ...REAL_TX.log![0], topics: ["8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925", REAL_TX.log![0].topics![1], REAL_TX.log![0].topics![2]] }] }
  assert.equal(judge(approval).state, "mismatch")
  const outgoing = { ...REAL_TX, log: [{ ...REAL_TX.log![0], topics: [REAL_TX.log![0].topics![0], REAL_TX.log![0].topics![2], `${"0".repeat(24)}${SENDER_HEX}`] }] }
  assert.match((judge(outgoing) as { reason: string }).reason, /different wallet/)
  // several transfers to the wallet in one transaction add up
  const split = { ...REAL_TX, log: [REAL_TX.log![0], REAL_TX.log![0]] }
  assert.deepEqual(judgeTransaction(split, true, { address: RECIPIENT, amount: 158 }), { state: "confirmed", amount: 158, blockTime: new Date(1790887644000) })
  // malformed data is ignored rather than trusted
  assert.deepEqual(usdtTransfers({ ...REAL_TX, log: [{ ...REAL_TX.log![0], data: "zz" }] }), [])
})

test("Stripe Connect states: only a connected account can be paid", () => {
  assert.equal(stripeAccountState({ id: "acct_1", details_submitted: false }), "onboarding")
  assert.equal(stripeAccountState({ id: "acct_1", details_submitted: true, capabilities: { transfers: "active" }, requirements: { disabled_reason: null } }), "connected")
  assert.equal(stripeAccountState({ id: "acct_1", details_submitted: true, capabilities: { transfers: "pending" } }), "restricted")
  assert.equal(stripeAccountState({ id: "acct_1", details_submitted: true, capabilities: { transfers: "active" }, requirements: { disabled_reason: "requirements.past_due" } }), "restricted")
  // which failures are worth retrying
  assert.equal(stripeFailurePermanent(new StripeError("closed", "account_closed", 400)), true)
  assert.equal(stripeFailurePermanent(new StripeError("no funds yet", "balance_insufficient", 400)), false)
  assert.equal(stripeFailurePermanent(new StripeError("slow down", "rate_limit", 429)), false)
  assert.equal(stripeFailurePermanent(new StripeError("oops", "api_error", 500)), false)
  assert.equal(stripeFailurePermanent(new Error("socket hang up")), false)
})

// --------------------------------------------------- automatic USDT sending

// A transfer built by a TRON mainnet node (/wallet/triggersmartcontract) for
// exactly these inputs. Ours must be byte-for-byte the same: the transaction
// id is the hash of these bytes, and the id is what gets signed.
const NODE_TX = {
  from: "TWsghcMkFXe1hnwZAWVQ9fUrZBtYv2aGJ8",
  to: tronAddressFromHex("11".repeat(20)),
  units: BigInt(420_000_000),
  refBlockBytes: "89af",
  refBlockHash: "b9e5b69798475514",
  expiration: 1790890845000,
  timestamp: 1790890785329,
  feeLimit: 40_000_000,
}
const NODE_RAW =
  "0a0289af2208b9e5b6979847551440c8c6a6cb8f345aae01081f12a9010a31747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e54726967676572536d617274436f6e747261637412740a1541e54f448d91153818a4573d6c151171ce8e607bbe121541a614f803b6fd780986a42c78ec9c7f77e6ded13c2244a9059cbb0000000000000000000000001111111111111111111111111111111111111111000000000000000000000000000000000000000000000000000000001908b10070b1f4a2cb8f34900180b48913"
const NODE_TXID = "ebdd855a74eca9d7d4dae735d2f948bf45df2e1a875643906a2b6b630b0da7cc"
// Throwaway keys that exist only in this file. KEY_ONE is the number 1, whose
// account (7e5f…5bdf) is a published vector.
const KEY_ONE = "0".repeat(63) + "1"
const KEY_TWO = "0".repeat(63) + "2"

test("a transfer is encoded exactly as a TRON node encodes it", () => {
  assert.equal(tronAddressToHex(NODE_TX.from), "e54f448d91153818a4573d6c151171ce8e607bbe")
  const raw = encodeTransferRaw(NODE_TX)
  assert.equal(hex(raw), NODE_RAW)
  assert.equal(transactionId(raw), NODE_TXID)
  // the call is transfer(recipient, units) on the USDT contract and nothing else
  assert.equal(transferCallData(NODE_TX.to, NODE_TX.units), "a9059cbb" + "11".repeat(20).padStart(64, "0") + (420_000_000).toString(16).padStart(64, "0"))
  // any change to who, how much, or until when is a different transaction
  for (const other of [{ units: BigInt(420_000_001) }, { to: tronAddressFromHex("22".repeat(20)) }, { expiration: NODE_TX.expiration + 1 }, { feeLimit: 40_000_001 }]) {
    assert.notEqual(transactionId(encodeTransferRaw({ ...NODE_TX, ...other })), NODE_TXID)
  }
  assert.throws(() => transferCallData("not-an-address", BigInt(1)), /valid TRON address/)
  assert.throws(() => transferCallData(NODE_TX.to, BigInt(0)), /positive/)
  // the reference block ties the transaction to the chain's current head
  assert.deepEqual(refBlock("0000000004a289af" + "b9e5b69798475514" + "0".repeat(32)), { refBlockBytes: "89af", refBlockHash: "b9e5b69798475514" })
  assert.throws(() => refBlock("89af"), /Invalid block id/)
})

test("the payout wallet key: its address, its signature, and nobody else's", () => {
  assert.equal(addressFromPrivateKey(KEY_ONE), tronAddressFromHex("7e5f4552091a69125d5dfcb7b8c2659029395bdf"))
  assert.equal(addressFromPrivateKey("0x" + KEY_ONE), addressFromPrivateKey(KEY_ONE))
  assert.equal(tronAddressProblem(addressFromPrivateKey(KEY_ONE)), null)
  for (const bad of ["", "abc", "0".repeat(64), "f".repeat(64), "z".repeat(64), null, undefined]) assert.equal(privateKeyValid(bad), false, String(bad))
  assert.equal(privateKeyValid(KEY_ONE), true)

  const one = addressFromPrivateKey(KEY_ONE)
  const signature = signTransactionId(NODE_TXID, KEY_ONE)
  assert.equal(signature.length, 130) // r, s, v
  assert.ok(["1b", "1c"].includes(signature.slice(128)))
  assert.equal(signTransactionId(NODE_TXID, KEY_ONE), signature) // deterministic: a retry signs the same bytes
  // a node accepts a transaction only if the signature recovers to the sender
  assert.equal(recoverSigner(NODE_TXID, signature), one)
  assert.notEqual(recoverSigner(NODE_TXID, signTransactionId(NODE_TXID, KEY_TWO)), one)
  assert.notEqual(recoverSigner(transactionId(encodeTransferRaw({ ...NODE_TX, units: BigInt(1) })), signature), one) // a signature doesn't carry over to another transfer
  assert.equal(recoverSigner(NODE_TXID, "00"), null)
  assert.equal(recoverSigner(NODE_TXID, signature.slice(0, 128) + "05"), null)
})

test("a signed transfer is only produced by the wallet it is sent from", () => {
  const from = addressFromPrivateKey(KEY_ONE)
  const signed = buildSignedTransfer({ ...NODE_TX, from }, KEY_ONE)
  assert.equal(signed.txId, transactionId(encodeTransferRaw({ ...NODE_TX, from })))
  assert.equal(recoverSigner(signed.txId, signed.signature), from)
  assert.equal(signed.expiration, NODE_TX.expiration)
  // Transaction { raw_data, signature }: the raw bytes, then the 65-byte signature
  assert.ok(signed.signedHex.includes(signed.rawHex))
  assert.ok(signed.signedHex.endsWith("1241" + signed.signature))
  // the wrong key for the configured wallet signs nothing
  assert.throws(() => buildSignedTransfer({ ...NODE_TX, from }, KEY_TWO), /doesn't belong/)
  assert.throws(() => buildSignedTransfer({ ...NODE_TX, from }, "nope"), /64 hexadecimal/)
  // and the key itself never appears in what is stored or broadcast
  assert.ok(!JSON.stringify(signed).includes(KEY_ONE))
})

test("automatic sending: every condition must hold, or the payout waits for a person", () => {
  const on = settings({ cryptoAutoSend: true, cryptoAutoMax: 500, cryptoAutoDaily: 2000, methodHoldHours: 48 })
  const ok = { settings: on, walletReady: true, amount: 420, sentToday: 0, methodAgeHours: 72, openRiskSignals: 0, affiliate: affiliate() }
  assert.equal(autoSendProblem(ok), null)
  // off by default
  assert.equal(DEFAULT_PAYOUT_SETTINGS.cryptoAutoSend, false)
  assert.match(autoSendProblem({ ...ok, settings: settings() })!, /switched off/)
  assert.match(autoSendProblem({ ...ok, settings: { ...on, paused: true } })!, /paused/)
  assert.match(autoSendProblem({ ...ok, walletReady: false })!, /Nothing is configured/)
  // the affiliate
  for (const bad of [{ status: "suspended" }, { fraudLock: true }, { payoutHold: true }]) assert.match(autoSendProblem({ ...ok, affiliate: affiliate(bad) })!, /good standing/)
  assert.match(autoSendProblem({ ...ok, openRiskSignals: 1 })!, /risk signal/)
  // a wallet has to have been on file for the hold period — even the first one
  assert.match(autoSendProblem({ ...ok, methodAgeHours: 47.9 })!, /less than 48 hours/)
  assert.equal(autoSendProblem({ ...ok, methodAgeHours: 48 }), null)
  assert.equal(autoSendProblem({ ...ok, methodAgeHours: 0, settings: { ...on, methodHoldHours: 0 } }), null)
  // the caps: per payout, and per day across everyone
  assert.equal(autoSendProblem({ ...ok, amount: 500 }), null)
  assert.match(autoSendProblem({ ...ok, amount: 500.01 })!, /Above the 500\.00 limit/)
  assert.equal(autoSendProblem({ ...ok, sentToday: 1580 }), null)
  assert.match(autoSendProblem({ ...ok, sentToday: 1580.01 })!, /Today's limit/)
  // the settings themselves are clamped, whatever is posted
  const clamped = normalizePayoutSettings({ cryptoAutoSend: "yes", cryptoAutoMax: -5, cryptoAutoDaily: 1e12, cryptoFeeLimitTrx: 100_000 })
  assert.deepEqual([clamped.cryptoAutoSend, clamped.cryptoAutoMax, clamped.cryptoAutoDaily, clamped.cryptoFeeLimitTrx], [false, 1, 1_000_000, 500])
  assert.equal(MAX_AUTO_ATTEMPTS, 3)
})

test("a transaction is replaced only once the chain proves it can never be included", () => {
  const expiresAt = Date.parse("2026-10-07T12:05:00Z")
  const dead = (solidHeadTime: number, foundOnChain = false) => transactionProvablyDead({ expiresAt, solidHeadTime, foundOnChain })
  assert.equal(dead(expiresAt - 60_000), false) // still valid
  assert.equal(dead(expiresAt), false)
  assert.equal(dead(expiresAt + 30_000), false) // inside the margin
  assert.equal(dead(expiresAt + 30_001), true)
  // found on-chain is never dead, however late
  assert.equal(dead(expiresAt + 3_600_000, true), false)
})

test("network fee: affordable and under the limit, or nothing is signed", () => {
  const fee = (over: Partial<Parameters<typeof sendFeeProblem>[0]> = {}) => sendFeeProblem({ energyNeeded: 64_285, energyAvailable: 0, energyPriceSun: 210, trxBalanceSun: 100_000_000, feeLimitSun: 40_000_000, ...over })
  // 64,285 energy at 210 sun, plus bandwidth: about 13.9 TRX
  assert.deepEqual(fee(), { feeSun: 64_285 * 210 + 400_000, problem: null })
  // a first transfer to an empty wallet costs about double — still under 40 TRX
  assert.equal(fee({ energyNeeded: 130_285 }).problem, null)
  assert.match(fee({ energyNeeded: 130_285, feeLimitSun: 20_000_000 }).problem!, /above the 20\.00 TRX limit/)
  assert.match(fee({ trxBalanceSun: 5_000_000 }).problem!, /needs about 13\.90 TRX .* has 5\.00/)
  // staked energy covers it: only bandwidth is paid
  assert.deepEqual(fee({ energyAvailable: 200_000, trxBalanceSun: 400_000 }), { feeSun: 400_000, problem: null })
})

test("admin actions on a payout sent from the payout wallet", () => {
  const hot = (status: string) => adminPayoutActions({ status, crypto: true, automated: true, hasHash: status !== "queued", hot: true, canAutoSend: true })
  // nothing signed yet: it can be sent, paid by hand instead, held or cancelled
  assert.deepEqual(hot("queued"), ["retry", "submit_tx", "hold", "cancel"])
  // a signed transaction may be on its way: nobody can fail, cancel or re-send it by hand
  for (const s of ["processing", "submitted", "confirming"]) assert.deepEqual(hot(s), ["check"], s)
  assert.deepEqual(hot("retry_required"), ["retry", "submit_tx", "hold", "cancel", "fail"])
  assert.deepEqual(hot("paid"), [])
  // a hand-sent crypto payout can be handed to the wallet — only when there is one
  const byHand = (status: string, canAutoSend: boolean) => adminPayoutActions({ status, crypto: true, automated: false, hasHash: false, canAutoSend })
  assert.deepEqual(byHand("queued", true), ["start", "send_auto", "submit_tx", "hold", "cancel", "fail"])
  assert.ok(!byHand("queued", false).includes("send_auto"))
  assert.ok(!byHand("pending", true).includes("send_auto")) // approval comes first
  assert.ok(!adminPayoutActions({ status: "queued", crypto: false, automated: false, hasHash: false, canAutoSend: true }).includes("send_auto"))
})

// ------------------------------------------- USDT on Aptos, Litecoin, exchange

const APTOS = "0x" + "a1b2c3d4".repeat(8)
// witness program 751e76e8199196d454941c45d1b3a323f1433bd6 — the BIP-173 example key, with Litecoin's prefix
const LTC_SEGWIT = "ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9"
// base58check built from the spec (version byte + 20 bytes + 4 checksum bytes), independent of the validator
const litecoinAddress = (version: number, fill: number) => {
  const payload = new Uint8Array([version, ...new Array(20).fill(fill)])
  return base58Encode(new Uint8Array([...payload, ...sha256(sha256(payload)).subarray(0, 4)]))
}
const LTC_LEGACY = litecoinAddress(0x30, 0x11)
const LTC_SCRIPT = litecoinAddress(0x32, 0x22)

test("each crypto method is one asset on one network", () => {
  assert.deepEqual(Object.keys(CRYPTO), ["crypto_trc20", "crypto_aptos", "crypto_ltc"])
  assert.deepEqual(Object.values(CRYPTO).map((c) => [c.asset, c.network, c.exchangeChain, c.usdPegged, c.verifiable]), [["USDT", "TRON", "trx", true, true], ["USDT", "APTOS", "aptos", true, false], ["LTC", "LITECOIN", "ltc", false, false]])
  for (const t of ["crypto_trc20", "crypto_aptos", "crypto_ltc"]) assert.equal(isCryptoMethod(t), true)
  for (const t of ["paypal", "bank", "crypto_eth", "", null, "toString", "__proto__"]) assert.equal(isCryptoMethod(t as string), false)
  assert.equal(cryptoSpec("paypal"), null)
  assert.equal(cryptoSpecByNetwork("APTOS")?.type, "crypto_aptos")
  assert.equal(formatAsset(1.5, "LTC"), "1.5 LTC")
  assert.equal(formatAsset(120, "USDT", 6), "120 USDT")
  assert.equal(formatAsset(0.00012345, "LTC"), "0.00012345 LTC")
})

test("Aptos addresses: 0x and 64 hex characters, nothing else", () => {
  assert.equal(aptosAddressProblem(APTOS), null)
  assert.equal(aptosAddressProblem(`  ${APTOS.toUpperCase().replace("0X", "0x")}  `), null) // case and stray spaces don't matter
  assert.equal(CRYPTO.crypto_aptos.normalize(` ${APTOS.toUpperCase().replace("0X", "0x")} `), APTOS)
  assert.match(aptosAddressProblem("")!, /Enter your wallet/)
  assert.match(aptosAddressProblem(APTOS.slice(2))!, /starts with 0x/)
  assert.match(aptosAddressProblem(APTOS.slice(0, 65))!, /66 characters/)
  assert.match(aptosAddressProblem(APTOS + "a")!, /66 characters/)
  assert.match(aptosAddressProblem("0x" + "g".repeat(64))!, /digits 0–9 and the letters a–f/)
  assert.match(aptosAddressProblem("0x" + "0".repeat(63) + "1")!, /system address/)
  // the other networks' addresses are not Aptos addresses
  for (const other of ["T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb", LTC_SEGWIT, "0xdAC17F958D2ee523a2206206994597C13D831ec7"]) assert.notEqual(aptosAddressProblem(other), null, other)
})

test("Litecoin addresses: L…, M… and ltc1q…, each with its checksum", () => {
  for (const ok of [LTC_LEGACY, LTC_SCRIPT, LTC_SEGWIT, LTC_SEGWIT.toUpperCase()]) assert.equal(litecoinAddressProblem(ok), null, ok)
  assert.ok(LTC_LEGACY.startsWith("L") && LTC_SCRIPT.startsWith("M"))
  assert.equal(CRYPTO.crypto_ltc.normalize(LTC_SEGWIT.toUpperCase()), LTC_SEGWIT)
  // one changed character anywhere breaks the checksum
  const swap = (a: string, i: number, to: string) => a.slice(0, i) + (a[i] === to ? "q" : to) + a.slice(i + 1)
  for (const [a, i, to] of [[LTC_LEGACY, 10, "x"], [LTC_SCRIPT, 20, "y"], [LTC_SEGWIT, 12, "z"], [LTC_SEGWIT, 40, "p"]] as const) assert.match(litecoinAddressProblem(swap(a, i, to))!, /typo|can't have/, a)
  // a segwit address is stored in lower case however it was typed
  assert.equal(CRYPTO.crypto_ltc.normalize("Ltc1Qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9"), LTC_SEGWIT)
  // what this method does not pay to, each with its own reason
  assert.match(litecoinAddressProblem(litecoinAddress(0x05, 0x33))!, /M… form/)
  assert.match(litecoinAddressProblem("ltcmweb1qq" + "q".repeat(40))!, /MWEB/)
  assert.match(litecoinAddressProblem("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")!, /starts with L, M or ltc1/) // a Bitcoin address
  assert.match(litecoinAddressProblem("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")!, /starts with L, M or ltc1/)
  assert.match(litecoinAddressProblem("T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb")!, /starts with L, M or ltc1/)
  assert.match(litecoinAddressProblem(litecoinAddress(0x30, 0x11).slice(0, 20))!, /26 to 35/)
  assert.match(litecoinAddressProblem("")!, /Enter your wallet/)
})

test("adding a USDT (Aptos) or Litecoin wallet: fixed network, confirmation and re-typed tail", () => {
  const aptos = { address: APTOS, network: "APTOS", asset: "USDT", confirmNetwork: true, confirmTail: APTOS.slice(-6).toUpperCase() }
  const a = validateMethod("crypto_aptos", aptos)
  assert.ok(a.ok)
  assert.deepEqual([a.method.details, a.method.metadata, a.method.label, a.method.identity], [{ address: APTOS }, { network: "APTOS", standard: "Aptos", asset: "USDT", currency: "USDT" }, "0xa1…c3d4", `crypto_aptos:${APTOS}`])
  // a TRON address is not accepted by the Aptos method, nor the other way round
  assert.equal(validateMethod("crypto_aptos", { ...aptos, address: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb" }).ok, false)
  assert.equal(validateMethod("crypto_trc20", { ...aptos, network: "TRON" }).ok, false)
  const refused = (over: Record<string, unknown>, field: string, type = "crypto_aptos", base: Record<string, unknown> = aptos) => {
    const r = validateMethod(type, { ...base, ...over })
    assert.ok(!r.ok && r.field === field, `${type} ${JSON.stringify(over)}`)
  }
  refused({ network: "TRON" }, "network")
  refused({ asset: "USDC" }, "asset")
  refused({ confirmNetwork: false }, "confirmNetwork")
  refused({ confirmTail: "000000" }, "confirmTail")

  const ltc = { address: LTC_SEGWIT, network: "LITECOIN", asset: "LTC", confirmNetwork: true, confirmTail: LTC_SEGWIT.slice(-6) }
  const l = validateMethod("crypto_ltc", ltc)
  assert.ok(l.ok)
  assert.deepEqual([l.method.metadata, l.method.label, l.method.nickname], [{ network: "LITECOIN", standard: "Litecoin", asset: "LTC", currency: "LTC" }, "ltc1…n4n9", "Litecoin wallet"])
  refused({ asset: "USDT" }, "asset", "crypto_ltc", ltc)
  refused({ address: APTOS }, "address", "crypto_ltc", ltc)
  // a base58 address is case-sensitive: the tail has to match exactly
  assert.equal(validateMethod("crypto_ltc", { ...ltc, address: LTC_LEGACY, confirmTail: LTC_LEGACY.slice(-6) }).ok, true)
  refused({ address: LTC_LEGACY, confirmTail: LTC_LEGACY.slice(-6).toLowerCase() === LTC_LEGACY.slice(-6) ? "zzzzzz" : LTC_LEGACY.slice(-6).toLowerCase() }, "confirmTail", "crypto_ltc", ltc)
  // the new methods have fees and can be switched on, but are not offered until an admin does
  const s = normalizePayoutSettings({ methods: ["crypto_aptos", "crypto_ltc", "dogecoin"], cryptoMaxFeeUsd: 1000 })
  assert.deepEqual([s.methods, s.fees.crypto_aptos, s.cryptoMaxFeeUsd], [["crypto_aptos", "crypto_ltc"], { fixed: 0, percent: 0 }, 100])
  assert.ok(!DEFAULT_PAYOUT_SETTINGS.methods.includes("crypto_aptos") && !DEFAULT_PAYOUT_SETTINGS.methods.includes("crypto_ltc"))
})

test("explorer links: only for the payout's own network and a real transaction id", () => {
  const h = "ab".repeat(32)
  assert.equal(cryptoExplorerUrl("TRON", h), `https://tronscan.org/#/transaction/${h}`)
  assert.equal(cryptoExplorerUrl("APTOS", `0x${h}`), `https://explorer.aptoslabs.com/txn/0x${h}?network=mainnet`)
  assert.equal(cryptoExplorerUrl("LITECOIN", h.toUpperCase()), `https://blockchair.com/litecoin/transaction/${h}`)
  for (const bad of ["javascript:alert(1)", `${h}/../x`, `x ${h}`, h.slice(1), "", null]) assert.equal(cryptoExplorerUrl("LITECOIN", bad), null, String(bad))
  assert.equal(cryptoExplorerUrl("ETHEREUM", h), null)
  // what an exchange reports can carry more than the id; only the id is taken
  assert.equal(CRYPTO.crypto_trc20.hashFrom(`${h}@TXYZ`), h)
  assert.equal(CRYPTO.crypto_aptos.hashFrom(`0x${h}`), `0x${h}`)
  assert.equal(CRYPTO.crypto_ltc.hashFrom("Internal transfer 99812"), null)
  assert.equal(CRYPTO.crypto_ltc.hashFrom(null), null)
})

test("exchange requests are signed over the time, the method, the path and the exact body", () => {
  const input = { key: "key-1", secret: "secret-1", passphrase: "phrase-1", timestamp: 1790000000000, method: "post", path: "/api/v3/withdrawals", body: '{"currency":"USDT","amount":"120"}' }
  const h = signedHeaders(input)
  const mac = (text: string) => createHmac("sha256", "secret-1").update(text).digest("base64")
  assert.deepEqual(h, { "KC-API-KEY": "key-1", "KC-API-SIGN": mac(`1790000000000POST/api/v3/withdrawals${input.body}`), "KC-API-TIMESTAMP": "1790000000000", "KC-API-PASSPHRASE": mac("phrase-1"), "KC-API-KEY-VERSION": "3" })
  // nothing about the request can change without the signature changing
  for (const other of [{ body: '{"currency":"USDT","amount":"121"}' }, { path: "/api/v1/withdrawals" }, { method: "GET" }, { timestamp: 1790000000001 }]) assert.notEqual(signedHeaders({ ...input, ...other })["KC-API-SIGN"], h["KC-API-SIGN"])
  // the secret and the passphrase never travel
  assert.ok(!JSON.stringify(h).includes("secret-1") && !JSON.stringify(h).includes("phrase-1"))
  assert.equal(signedHeaders({ ...input, version: "2" })["KC-API-KEY-VERSION"], "2")
})

test("a withdrawal whose answer was lost is recognised in the account's history", () => {
  const w = (over: Partial<Withdrawal>): Withdrawal => ({ id: "w1", currency: "USDT", chain: "aptos", status: "PROCESSING", address: APTOS, amount: 120, fee: 0.5, txId: null, remark: "", inner: false, createdAt: 1_000_000, ...over })
  const want = { remark: withdrawalRemark(12, 345), address: APTOS, amount: 120, since: 1_000_000 }
  assert.equal(withdrawalRemark(12, 345), "TL-PO-12-345")
  // by its tag — whatever else is in the history
  assert.equal(matchWithdrawal([w({ id: "other", address: "0xother", amount: 5 }), w({ id: "mine", remark: "TL-PO-12-345", amount: 999 })], want)?.id, "mine")
  // without the tag: the same address and amount, made after the attempt began
  assert.equal(matchWithdrawal([w({ id: "mine" })], want)?.id, "mine")
  assert.equal(matchWithdrawal([w({ address: APTOS.toUpperCase().replace("0X", "0x") })], want), null)
  assert.equal(matchWithdrawal([w({ address: APTOS.toUpperCase().replace("0X", "0x") })], { ...want, caseInsensitive: true })?.id, "w1")
  // not: another amount, another address, or one made before this attempt
  for (const other of [{ amount: 120.01 }, { address: "0x" + "b".repeat(64) }, { createdAt: 1_000_000 - 61_000 }, { remark: "TL-PO-12-344", amount: 5 }]) assert.equal(matchWithdrawal([w(other)], want), null, JSON.stringify(other))
  assert.equal(matchWithdrawal([], want), null)
})

test("an exchange attempt is repeated only once it is proven it created nothing", () => {
  const expiresAt = Date.parse("2026-10-07T12:01:00Z")
  const dead = (lookedUpAt: number, found = false) => exchangeRequestProvablyDead({ expiresAt, lookedUpAt, found })
  assert.equal(dead(expiresAt - 30_000), false) // the request could still be accepted
  assert.equal(dead(expiresAt + EXCHANGE_DEAD_MARGIN_MS), false) // inside the margin
  assert.equal(dead(expiresAt + EXCHANGE_DEAD_MARGIN_MS + 1), true)
  assert.equal(dead(expiresAt + 3_600_000, true), false) // found is never dead
})

test("what is checked before the exchange is asked to send", () => {
  const ok = { asset: "USDT", network: "Aptos", amount: 120, available: 500, fee: 0.5, min: 1, enabled: true, priceUsd: 1, maxFeeUsd: 5 }
  assert.equal(exchangeSendProblem(ok), null)
  assert.equal(exchangeSendProblem({ ...ok, available: 120.5 }), null) // exactly the amount plus the fee
  assert.deepEqual(exchangeSendProblem({ ...ok, available: 120.49 }), { kind: "funds", reason: "The exchange account has 120.49 USDT available; this payout needs 120 plus a 0.5 USDT fee." })
  assert.deepEqual([exchangeSendProblem({ ...ok, enabled: false })?.kind, exchangeSendProblem({ ...ok, enabled: false })?.reason.includes("switched off")], ["funds", true])
  assert.equal(exchangeSendProblem({ ...ok, amount: 0.5 })?.kind, "rejected") // below the minimum: waiting doesn't fix it
  assert.equal(exchangeSendProblem({ ...ok, amount: 0 })?.kind, "rejected")
  // the fee is judged in dollars, whatever the asset
  assert.match(exchangeSendProblem({ ...ok, fee: 5.5 })!.reason, /above the \$5\.00 limit/)
  const ltc = { ...ok, asset: "LTC", network: "Litecoin", amount: 1.5, available: 2, fee: 0.006, min: 0.012, priceUsd: 80 }
  assert.equal(exchangeSendProblem(ltc), null) // 0.006 LTC ≈ $0.48
  assert.equal(exchangeSendProblem({ ...ltc, priceUsd: 1000 })?.kind, "funds") // ≈ $6
  assert.match(exchangeSendProblem({ ...ltc, available: 1.5 })!.reason, /1\.5 LTC available; this payout needs 1\.5 plus a 0\.006 LTC fee/)

  // dollars → the asset, never rounded up
  assert.equal(assetAmount(120, 1, 6), 120)
  assert.equal(assetAmount(120, 80, 8), 1.5)
  assert.equal(assetAmount(100, 68.15, 8), 1.46735143) // 1.467351430667…
  assert.equal(assetAmount(100, 3, 2), 33.33)
  assert.equal(assetAmount(100, 0, 8), 0)
  assert.equal(assetAmount(-5, 80, 8), 0)
})

test("admin actions: a payout only the exchange can send has no by-hand route", () => {
  const act = (status: string, over: Record<string, unknown> = {}) => adminPayoutActions({ status, crypto: true, automated: true, hasHash: false, verifiable: false, ...over })
  // waiting for approval: approving is what sends it
  assert.deepEqual(act("pending", { hot: true }), ["approve", "reject", "hold", "cancel"])
  assert.deepEqual(act("queued", { hot: true }), ["retry", "hold", "cancel"])
  for (const s of ["processing", "submitted", "confirming"]) assert.deepEqual(act(s, { hot: true }), ["check"], s)
  assert.deepEqual(act("retry_required", { hot: true }), ["retry", "hold", "cancel", "fail"])
  assert.deepEqual(act("paid", { hot: true }), [])
  for (const s of ["pending", "queued", "processing", "submitted", "retry_required"]) assert.ok(!act(s).includes("submit_tx") && !act(s).includes("mark_paid"), s)
  // USDT on TRON keeps its by-hand route, and can be handed to the exchange
  assert.deepEqual(adminPayoutActions({ status: "queued", crypto: true, automated: false, hasHash: false, canAutoSend: true, verifiable: true }), ["start", "send_auto", "submit_tx", "hold", "cancel", "fail"])
})
