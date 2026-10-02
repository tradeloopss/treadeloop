import { round2 } from "./engine"
import { cryptoSpec, formatAsset, isCryptoMethod } from "./crypto"
import { PAYOUT_METHOD_LABELS, PAYOUT_METHOD_TYPES, type PayoutMethodType } from "./types"

// The payout rules as pure functions: the status machine, the settings an
// admin controls, fees, limits, and the single decision "may an automatic
// payout be created for this affiliate right now". The server code
// (payouts.ts, auto-payouts.ts) loads rows, asks these, and writes the answer;
// nothing here reads a clock, a database or the network.

// ------------------------------------------------------------ status machine

export const PAYOUT_STATUSES = ["pending", "queued", "processing", "submitted", "confirming", "paid", "failed", "retry_required", "on_hold", "cancelled", "rejected", "reversed"] as const
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number]

// pending         requested, waiting for an admin to approve (manual approval mode)
// queued          approved; waiting to be sent by the provider (or by a person)
// processing      being sent
// submitted       the provider / chain has a transaction for it
// confirming      seen on-chain, not yet irreversible
// paid            confirmed by the provider / chain — COMPLETED
// retry_required  an attempt failed in a way that may be retried; funds stay reserved
// on_hold         parked by an admin; funds stay reserved
// failed / cancelled / rejected / reversed   terminal; the reservation is released
const NEXT: Record<PayoutStatus, PayoutStatus[]> = {
  pending: ["queued", "rejected", "cancelled", "on_hold"],
  queued: ["processing", "submitted", "confirming", "paid", "failed", "retry_required", "cancelled", "on_hold"],
  // (→ queued: only for an automatic send whose transaction provably never
  // happened; it is put back to be sent again.)
  processing: ["submitted", "confirming", "paid", "failed", "retry_required", "queued"],
  submitted: ["confirming", "paid", "failed", "retry_required", "queued"],
  confirming: ["paid", "failed", "retry_required"],
  retry_required: ["queued", "processing", "submitted", "confirming", "paid", "failed", "cancelled", "on_hold"],
  on_hold: ["pending", "queued", "cancelled", "rejected"],
  paid: ["reversed"],
  failed: [],
  cancelled: [],
  rejected: [],
  reversed: [],
}

export const payoutTransitionAllowed = (from: string, to: string) => (NEXT[from as PayoutStatus] ?? []).includes(to as PayoutStatus)

// Payouts that still hold a reservation and aren't finished.
export const PAYOUT_IN_FLIGHT: PayoutStatus[] = ["pending", "queued", "processing", "submitted", "confirming", "retry_required", "on_hold"]
export const payoutInFlight = (status: string) => (PAYOUT_IN_FLIGHT as string[]).includes(status)
// Once money may have left, an affiliate can no longer cancel.
export const affiliateCanCancel = (status: string) => status === "pending"

// The status of a payout's ledger row. The reservation is the negative row
// itself: it counts while the payout is in flight or paid, and stops counting
// (which is what releases the money) when the payout ends any other way.
export function payoutLedgerStatus(status: string): "pending" | "processing" | "paid" | "cancelled" {
  if (status === "paid") return "paid"
  if (status === "pending") return "pending"
  return payoutInFlight(status) ? "processing" : "cancelled"
}

export type PayoutGroup = "pending" | "processing" | "completed" | "failed" | "on_hold"
export const PAYOUT_GROUPS: Record<PayoutGroup, PayoutStatus[]> = {
  pending: ["pending"],
  processing: ["queued", "processing", "submitted", "confirming", "retry_required"],
  completed: ["paid"],
  failed: ["failed", "rejected", "cancelled", "reversed"],
  on_hold: ["on_hold"],
}

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  pending: "Awaiting approval",
  queued: "Queued",
  processing: "Processing",
  submitted: "Submitted",
  confirming: "Confirming",
  paid: "Completed",
  failed: "Failed",
  retry_required: "Retry required",
  on_hold: "On hold",
  cancelled: "Cancelled",
  rejected: "Rejected",
  reversed: "Reversed",
}

// What an admin may do to a payout in a given state. `crypto` payouts complete
// only through an on-chain transaction; the others through the admin's (or the
// provider's) confirmation. The UI shows exactly these; the server enforces them.
export type AdminPayoutAction = "approve" | "reject" | "hold" | "release" | "cancel" | "start" | "mark_paid" | "submit_tx" | "check" | "fail" | "retry" | "reverse" | "send_auto"

// `hot` = the payout is being sent automatically (from the payout wallet or
// the exchange account).
// `canAutoSend` = an automatic sender is configured, so a crypto payout an
// admin is about to pay by hand can be handed to it instead.
// `verifiable` = a transaction sent by hand can be checked on-chain here, so
// "pay by hand and submit the hash" is on offer (USDT on TRON; defaults to
// `crypto`). The others can only be sent by the exchange.
export function adminPayoutActions(p: { status: string; crypto: boolean; automated: boolean; hasHash: boolean; hot?: boolean; canAutoSend?: boolean; verifiable?: boolean }): AdminPayoutAction[] {
  const byHand = p.verifiable ?? p.crypto
  if (p.hot) {
    const hand = byHand ? (["submit_tx"] as AdminPayoutAction[]) : []
    switch (p.status as PayoutStatus) {
      case "pending":
        return ["approve", "reject", "hold", "cancel"]
      case "queued":
        // nothing has been signed for it: it can still be stopped, or paid by hand
        return ["retry", ...hand, "hold", "cancel"]
      case "processing":
      case "submitted":
      case "confirming":
        // a signed transaction may be on its way: only the chain may decide now
        return ["check"]
      case "retry_required":
        return ["retry", ...hand, "hold", "cancel", "fail"]
      case "on_hold":
        return ["release", "reject", "cancel"]
      default:
        return []
    }
  }
  const auto = p.crypto && p.canAutoSend ? (["send_auto"] as AdminPayoutAction[]) : []
  const sendable = p.crypto ? ([...auto, ...(byHand ? ["submit_tx"] : [])] as AdminPayoutAction[]) : p.automated ? [] : (["mark_paid"] as AdminPayoutAction[])
  switch (p.status as PayoutStatus) {
    case "pending":
      return ["approve", "reject", "hold", "cancel"]
    case "queued":
      return [...(p.automated ? (["retry"] as AdminPayoutAction[]) : (["start"] as AdminPayoutAction[])), ...sendable, "hold", "cancel", "fail"]
    case "processing":
      return [...sendable, "fail"]
    case "submitted":
    case "confirming":
      return p.crypto ? ["check", ...(p.status === "submitted" && byHand ? (["submit_tx"] as AdminPayoutAction[]) : []), "fail"] : ["check", "fail"]
    case "retry_required":
      return ["retry", ...sendable, "hold", "cancel", "fail"]
    case "on_hold":
      return ["release", "reject", "cancel"]
    case "paid":
      // An on-chain transfer is final; a bank/PayPal payment can bounce.
      return p.crypto ? [] : ["reverse"]
    default:
      return []
  }
}

// ------------------------------------------------------------------ settings

export const PAYOUT_FREQUENCIES = ["immediate", "daily", "weekly", "monthly"] as const
export type PayoutFrequency = (typeof PAYOUT_FREQUENCIES)[number]
export const FREQUENCY_LABELS: Record<PayoutFrequency, string> = { immediate: "As soon as the threshold is reached", daily: "Daily", weekly: "Weekly", monthly: "Monthly" }

export type FeeRule = { fixed: number; percent: number }
export type PayoutSettings = {
  // Master switch for the automatic payout worker.
  autoPayouts: boolean
  // Emergency stop: no NEW payout is created or sent, automatic or manual.
  paused: boolean
  // manual = every payout waits for an admin; automatic = straight to the queue.
  approval: "manual" | "automatic"
  frequency: PayoutFrequency
  maxPayout: number | null // per payout
  dailyLimit: number | null // program-wide totals
  weeklyLimit: number | null
  monthlyLimit: number | null
  // platform = TradeLoop absorbs fees; affiliate = the fee comes out of the payout.
  feePolicy: "platform" | "affiliate"
  fees: Record<PayoutMethodType, FeeRule>
  // Hours a newly added method must wait before it can be paid to, when the
  // account already had one. 0 switches the hold off.
  methodHoldHours: number
  methods: PayoutMethodType[] // offered to affiliates
  // The least one payout by this method can be, in the method's OWN unit: US
  // dollars, or the coin itself for a crypto method (5 USDT, 0.1 LTC). 0 = the
  // method has no minimum of its own. It never lowers the program's (or an
  // affiliate's own) minimum: the higher of the two applies.
  methodMin: Record<PayoutMethodType, number>
  // Crypto sent automatically (from the exchange account, or the payout
  // wallet), with no approval step, for payouts inside these caps. Everything
  // above them, and anything that looks unusual, still waits for a person.
  cryptoAutoSend: boolean
  cryptoAutoMax: number // per payout, USD
  cryptoAutoDaily: number // total sent automatically per UTC day, USD
  cryptoFeeLimitTrx: number // payout wallet: the most TRX one transfer may burn
  cryptoMaxFeeUsd: number // exchange: the highest withdrawal fee worth paying, USD
}

const noFee = (): FeeRule => ({ fixed: 0, percent: 0 })
export const DEFAULT_PAYOUT_SETTINGS: PayoutSettings = {
  autoPayouts: false,
  paused: false,
  approval: "manual",
  frequency: "weekly",
  maxPayout: 5000,
  dailyLimit: 20000,
  weeklyLimit: null,
  monthlyLimit: null,
  feePolicy: "platform",
  fees: { paypal: noFee(), wise: noFee(), bank: noFee(), stripe: noFee(), crypto_trc20: noFee(), crypto_aptos: noFee(), crypto_ltc: noFee() },
  methodHoldHours: 24,
  methods: ["paypal", "wise", "bank", "crypto_trc20"],
  methodMin: { paypal: 0, wise: 0, bank: 0, stripe: 0, crypto_trc20: 5, crypto_aptos: 10, crypto_ltc: 0.1 },
  cryptoAutoSend: false,
  cryptoAutoMax: 500,
  cryptoAutoDaily: 2000,
  cryptoFeeLimitTrx: 40,
  cryptoMaxFeeUsd: 5,
}

const clamp = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}
const limit = (v: unknown, fallback: number | null, present: boolean): number | null => {
  if (!present) return fallback
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? round2(Math.min(n, 10_000_000)) : null
}

// Stored and submitted settings are never trusted as-is.
export function normalizePayoutSettings(raw: unknown): PayoutSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_PAYOUT_SETTINGS
  const rawFees = (r.fees && typeof r.fees === "object" ? r.fees : {}) as Record<string, { fixed?: unknown; percent?: unknown } | undefined>
  const fees = {} as Record<PayoutMethodType, FeeRule>
  for (const t of PAYOUT_METHOD_TYPES) fees[t] = { fixed: round2(clamp(rawFees[t]?.fixed, 0, 0, 1000)), percent: clamp(rawFees[t]?.percent, 0, 0, 50) }
  const methods = Array.isArray(r.methods) ? PAYOUT_METHOD_TYPES.filter((t) => (r.methods as unknown[]).includes(t)) : d.methods
  // A method that was never given a minimum gets the default one; an empty or
  // zero value means "none".
  const rawMin = (r.methodMin && typeof r.methodMin === "object" ? r.methodMin : {}) as Record<string, unknown>
  const methodMin = {} as Record<PayoutMethodType, number>
  for (const t of PAYOUT_METHOD_TYPES) methodMin[t] = t in rawMin ? Math.round(clamp(rawMin[t] === "" || rawMin[t] === null ? 0 : rawMin[t], d.methodMin[t], 0, 100_000) * 1e8) / 1e8 : d.methodMin[t]
  return {
    autoPayouts: typeof r.autoPayouts === "boolean" ? r.autoPayouts : d.autoPayouts,
    paused: typeof r.paused === "boolean" ? r.paused : d.paused,
    approval: r.approval === "automatic" ? "automatic" : r.approval === "manual" ? "manual" : d.approval,
    frequency: (PAYOUT_FREQUENCIES as readonly string[]).includes(r.frequency as string) ? (r.frequency as PayoutFrequency) : d.frequency,
    maxPayout: limit(r.maxPayout, d.maxPayout, "maxPayout" in r),
    dailyLimit: limit(r.dailyLimit, d.dailyLimit, "dailyLimit" in r),
    weeklyLimit: limit(r.weeklyLimit, d.weeklyLimit, "weeklyLimit" in r),
    monthlyLimit: limit(r.monthlyLimit, d.monthlyLimit, "monthlyLimit" in r),
    feePolicy: r.feePolicy === "affiliate" ? "affiliate" : "platform",
    fees,
    methodHoldHours: Math.round(clamp(r.methodHoldHours, d.methodHoldHours, 0, 720)),
    methods,
    methodMin,
    cryptoAutoSend: typeof r.cryptoAutoSend === "boolean" ? r.cryptoAutoSend : d.cryptoAutoSend,
    cryptoAutoMax: round2(clamp(r.cryptoAutoMax, d.cryptoAutoMax, 1, 100_000)),
    cryptoAutoDaily: round2(clamp(r.cryptoAutoDaily, d.cryptoAutoDaily, 1, 1_000_000)),
    cryptoFeeLimitTrx: Math.round(clamp(r.cryptoFeeLimitTrx, d.cryptoFeeLimitTrx, 5, 500)),
    cryptoMaxFeeUsd: round2(clamp(r.cryptoMaxFeeUsd, d.cryptoMaxFeeUsd, 0.5, 100)),
  }
}

// ---------------------------------------------------------------------- fees

export type FeeQuote = { amount: number; fee: number; net: number; estimated: boolean }

// Never a silent deduction: the quote is shown before the request and stored
// on the payout. With the platform paying, the fee is 0 for the affiliate.
export function quoteFee(amount: number, type: string, settings: PayoutSettings): FeeQuote {
  const rule = settings.fees[type as PayoutMethodType]
  if (settings.feePolicy !== "affiliate" || !rule || !(amount > 0)) return { amount: round2(amount), fee: 0, net: round2(amount), estimated: false }
  const fee = Math.min(round2(rule.fixed + (amount * rule.percent) / 100), round2(amount))
  // A network fee isn't known to the cent until the transaction is built.
  return { amount: round2(amount), fee, net: round2(amount - fee), estimated: isCryptoMethod(type) && fee > 0 }
}

// -------------------------------------------------------------------- limits

// `minWhy` — the sentence to show when the minimum that applies is the payout
// method's own. `minUnknown` — the method's minimum is set in a coin whose
// price couldn't be read, so nothing can be checked against it right now.
export type Limits = { min: number; max: number | null; minWhy?: string; minUnknown?: boolean }

// A payout method's own minimum: as it is set ("0.1 LTC") and in US dollars.
// `usd` is null when the coin's price isn't known.
export type MethodMinimum = { units: number; asset: string; text: string; usd: number | null; title: string }

export function methodMinimum(type: string | null | undefined, settings: PayoutSettings, prices: Record<string, number> = {}): MethodMinimum | null {
  const units = settings.methodMin[type as PayoutMethodType]
  if (!type || !(units > 0)) return null
  const coin = cryptoSpec(type)
  const title = coin?.title ?? PAYOUT_METHOD_LABELS[type as PayoutMethodType] ?? type
  if (!coin) return { units, asset: "USD", text: `$${units.toFixed(2)}`, usd: round2(units), title }
  const text = formatAsset(units, coin.asset)
  if (coin.usdPegged) return { units, asset: coin.asset, text, usd: round2(units), title }
  const price = prices[coin.asset]
  // Rounded UP to the cent: an amount that passes is never short of the coin minimum.
  return { units, asset: coin.asset, text, usd: price > 0 ? Math.ceil(units * price * 100 - 1e-6) / 100 : null, title }
}

// An affiliate's own minimum/maximum when an admin set one, else the program's
// — and never below the minimum of the method the payout is sent by.
export function effectiveLimits(input: { programMin: number; settings: PayoutSettings; minOverride?: number | null; maxOverride?: number | null; method?: MethodMinimum | null }): Limits {
  const base = input.minOverride != null && input.minOverride > 0 ? input.minOverride : input.programMin
  const max = input.maxOverride != null && input.maxOverride > 0 ? input.maxOverride : input.settings.maxPayout
  const m = input.method
  if (m && m.usd == null) return { min: base, max: max != null && max < base ? base : max, minUnknown: true }
  const min = m && m.usd! > base ? m.usd! : base
  const minWhy = m && m.usd! > base ? `The minimum payout to ${m.title} is ${m.text}${m.asset === "USD" || m.usd === m.units ? "" : ` (about $${m.usd!.toFixed(2)} right now)`}.` : undefined
  return { min, max: max != null && max < min ? min : max, ...(minWhy ? { minWhy } : {}) }
}

export type WindowTotals = { day: number; week: number; month: number }

// Program-wide caps on what is paid out in a day / week / month.
export function limitProblem(amount: number, totals: WindowTotals, settings: PayoutSettings): string | null {
  if (settings.dailyLimit != null && totals.day + amount > settings.dailyLimit + 0.001) return "The program's daily payout limit has been reached. Try again tomorrow."
  if (settings.weeklyLimit != null && totals.week + amount > settings.weeklyLimit + 0.001) return "The program's weekly payout limit has been reached. Try again next week."
  if (settings.monthlyLimit != null && totals.month + amount > settings.monthlyLimit + 0.001) return "The program's monthly payout limit has been reached. Try again next month."
  return null
}

// ----------------------------------------------------------------- frequency

const pad = (n: number) => String(n).padStart(2, "0")

// The period an automatic payout belongs to (UTC). It is part of the payout's
// idempotency key, so a worker that runs twice in a period creates ONE payout.
// "immediate" still allows at most one a day.
export function periodKey(frequency: PayoutFrequency, now: Date): string {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const d = now.getUTCDate()
  if (frequency === "monthly") return `${y}-${pad(m + 1)}`
  if (frequency === "weekly") {
    // ISO week: the week with the year's first Thursday is week 1.
    const t = new Date(Date.UTC(y, m, d))
    const day = t.getUTCDay() || 7
    t.setUTCDate(t.getUTCDate() + 4 - day)
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
    const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
    return `${t.getUTCFullYear()}-W${pad(week)}`
  }
  return `${y}-${pad(m + 1)}-${pad(d)}`
}

// When the next period opens (UTC) — the earliest the next automatic payout
// can be created once this period's has been.
export function nextPeriodStart(frequency: PayoutFrequency, now: Date): Date {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const d = now.getUTCDate()
  if (frequency === "monthly") return new Date(Date.UTC(y, m + 1, 1))
  if (frequency === "weekly") return new Date(Date.UTC(y, m, d + (8 - (now.getUTCDay() || 7))))
  return new Date(Date.UTC(y, m, d + 1))
}

// ------------------------------------------------------------ payout methods

export type MethodState = { status: string; holdUntil: Date | null }

// Only an ACTIVE method that is past its security hold can be paid to.
export function methodProblem(method: MethodState | null | undefined, now: Date): string | null {
  if (!method) return "Add a payout method first."
  if (method.status === "pending_verification") return "That payout method is still being verified."
  if (method.status === "verification_required") return "That payout method needs to be verified before it can be used."
  if (method.status !== "active") return "That payout method isn't active."
  if (method.holdUntil && method.holdUntil > now) {
    return `For your security, a newly added payout method can be used from ${method.holdUntil.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC.`
  }
  return null
}

// A method added to an account that already had one waits out the hold.
export function methodHoldUntil(input: { hadMethodBefore: boolean; holdHours: number; now: Date }): Date | null {
  return input.hadMethodBefore && input.holdHours > 0 ? new Date(input.now.getTime() + input.holdHours * 3_600_000) : null
}

// ------------------------------------------------------------ manual request

export type AffiliateState = {
  status: string
  payoutHold: boolean
  fraudLock: boolean
  manualPayoutAllowed: boolean
  autoPayout: boolean
  autoPayoutAllowed: boolean
}

// A payout an affiliate asks for. Returns the reason it can't be made, or null.
export function manualPayoutProblem(input: {
  amount: number
  available: number
  limits: Limits
  settings: PayoutSettings
  affiliate: AffiliateState
  method: MethodState | null
  hasPayoutInFlight: boolean
  totals: WindowTotals
  now: Date
}): string | null {
  const { amount, affiliate, limits } = input
  if (input.settings.paused) return "Payouts are temporarily paused. Your balance is safe — please try again later."
  if (affiliate.status !== "approved") return "Your affiliate account isn't active, so payouts are unavailable."
  if (affiliate.fraudLock) return "Payouts are paused while your account is under review."
  if (affiliate.payoutHold) return "Payouts are on hold for your account. Contact affiliate support."
  if (!affiliate.manualPayoutAllowed) return "Payout requests are switched off for your account. Contact affiliate support."
  const m = methodProblem(input.method, input.now)
  if (m) return m
  if (input.hasPayoutInFlight) return "You already have a payout in progress. You can request another once it's complete."
  if (!Number.isFinite(amount) || amount <= 0) return "Enter an amount."
  if (round2(amount) !== amount) return "Use at most two decimal places."
  if (limits.minUnknown) return "The current price for this payout method couldn't be read, so its minimum can't be checked right now. Please try again in a minute."
  if (amount < limits.min) return limits.minWhy ?? `The minimum payout is $${limits.min.toFixed(2)}.`
  if (limits.max != null && amount > limits.max) return `The most you can withdraw in one payout is $${limits.max.toFixed(2)}.`
  if (amount > input.available) return "That's more than your available balance."
  return limitProblem(amount, input.totals, input.settings)
}

// ---------------------------------------------------------- automatic payout

export type AutoSkip =
  | "paused"
  | "auto_off"
  | "affiliate_inactive"
  | "admin_disabled"
  | "opted_out"
  | "fraud_hold"
  | "payout_hold"
  | "risk_review"
  | "no_method"
  | "method_ineligible"
  | "method_hold"
  | "in_flight"
  | "already_paid_this_period"
  | "below_threshold"
  | "price_unavailable"
  | "limit_reached"

export type AutoDecision = { ok: true; amount: number } | { ok: false; code: AutoSkip; message: string }

const skip = (code: AutoSkip, message: string): AutoDecision => ({ ok: false, code, message })

// THE gate for automatic payouts. Every check the worker makes is here, in the
// order a human would ask them, and any "no" means no money moves. It runs
// twice per payout: once to pick candidates, and again inside the database
// lock immediately before the payout row is written.
export function decideAutoPayout(input: {
  settings: PayoutSettings
  affiliate: AffiliateState
  available: number
  limits: Limits
  threshold: number | null // the affiliate's own; null = the minimum
  method: MethodState | null
  hasPayoutInFlight: boolean
  paidThisPeriod: boolean
  openHighRiskSignals: number
  totals: WindowTotals
  now: Date
}): AutoDecision {
  const { settings, affiliate, limits } = input
  if (settings.paused) return skip("paused", "All payouts are paused.")
  if (!settings.autoPayouts) return skip("auto_off", "Automatic payouts are switched off for the program.")
  if (affiliate.status !== "approved") return skip("affiliate_inactive", "The affiliate account isn't active.")
  if (!affiliate.autoPayoutAllowed) return skip("admin_disabled", "Automatic payouts are disabled for this affiliate.")
  if (!affiliate.autoPayout) return skip("opted_out", "The affiliate hasn't switched automatic payouts on.")
  if (affiliate.fraudLock) return skip("fraud_hold", "The account is under a fraud lock.")
  if (affiliate.payoutHold) return skip("payout_hold", "Payouts are on hold for this affiliate.")
  // A serious open signal waits for a person: a pause for review, not a verdict.
  if (input.openHighRiskSignals > 0) return skip("risk_review", "A high-risk signal is waiting for review.")
  if (!input.method) return skip("no_method", "No default payout method.")
  if (input.method.status !== "active") return skip("method_ineligible", "The default payout method isn't active.")
  if (input.method.holdUntil && input.method.holdUntil > input.now) return skip("method_hold", "The payout method is inside its security hold.")
  if (input.hasPayoutInFlight) return skip("in_flight", "A payout is already in progress.")
  if (input.paidThisPeriod) return skip("already_paid_this_period", "This period's automatic payout was already created.")
  // Tried again on the next run; nothing is created against a minimum that can't be checked.
  if (limits.minUnknown) return skip("price_unavailable", "The price needed to check the payout method's minimum couldn't be read.")
  const threshold = Math.max(limits.min, input.threshold ?? limits.min)
  if (!(input.available >= threshold)) return skip("below_threshold", `Available balance is below the $${threshold.toFixed(2)} threshold.`)
  // Whole cents, never more than the maximum for one payout.
  const amount = Math.floor(Math.min(input.available, limits.max ?? Infinity) * 100 + 1e-6) / 100
  if (!(amount >= limits.min)) return skip("below_threshold", "Available balance is below the minimum payout.")
  if (limitProblem(amount, input.totals, settings)) return skip("limit_reached", "A program payout limit has been reached.")
  return { ok: true, amount }
}

// ------------------------------------------------- automatic crypto sending

// Whether a crypto payout may skip approval and be sent straight away (from
// the exchange account or the payout wallet). Returns the reason it may not (it
// then follows the normal approval path instead — it isn't refused), or null.
// Each "no" is a control on the one thing that makes automatic sending
// dangerous: money leaving with nobody looking. `walletReady` = a sender for
// this payout's network is configured.
export function autoSendProblem(input: {
  settings: PayoutSettings
  walletReady: boolean
  amount: number // what would be sent (net)
  sentToday: number // already sent automatically today
  methodAgeHours: number
  openRiskSignals: number // open medium/high signals on the affiliate
  affiliate: AffiliateState
}): string | null {
  const { settings } = input
  if (!settings.cryptoAutoSend) return "Automatic crypto sending is switched off."
  if (settings.paused) return "All payouts are paused."
  if (!input.walletReady) return "Nothing is configured to send this payout automatically."
  if (input.affiliate.status !== "approved" || input.affiliate.fraudLock || input.affiliate.payoutHold) return "The affiliate's account isn't in good standing."
  if (input.openRiskSignals > 0) return "A risk signal on this affiliate is waiting for review."
  // Even a first wallet has to have been on file for the hold period: a
  // hijacked account can't add a wallet and drain the balance in one sitting.
  if (settings.methodHoldHours > 0 && input.methodAgeHours < settings.methodHoldHours) return `The wallet was added less than ${settings.methodHoldHours} hours ago.`
  if (input.amount > settings.cryptoAutoMax + 0.001) return `Above the ${settings.cryptoAutoMax.toFixed(2)} limit for automatic sending.`
  if (input.sentToday + input.amount > settings.cryptoAutoDaily + 0.001) return "Today's limit for automatic sending has been reached."
  return null
}

// A TRON transaction carries an expiration; no block after it can include the
// transaction. So once the chain's IRREVERSIBLE head has passed the expiration
// (plus a margin) and the transaction still isn't on-chain, it never will be —
// and only then is it safe to sign a replacement. Until that is proven, a
// payout with a signed transaction is never signed again.
export const TX_DEAD_MARGIN_MS = 30_000
export function transactionProvablyDead(input: { expiresAt: number; solidHeadTime: number; foundOnChain: boolean }): boolean {
  return !input.foundOnChain && input.solidHeadTime > input.expiresAt + TX_DEAD_MARGIN_MS
}

// What one automatic transfer may cost, and whether the wallet can pay it.
export function sendFeeProblem(input: { energyNeeded: number; energyAvailable: number; energyPriceSun: number; trxBalanceSun: number; feeLimitSun: number }): { feeSun: number; problem: string | null } {
  // bandwidth for a ~350-byte transaction when the free allowance is used up
  const BANDWIDTH_SUN = 400_000
  const feeSun = Math.max(0, input.energyNeeded - input.energyAvailable) * input.energyPriceSun + BANDWIDTH_SUN
  const trx = (sun: number) => (sun / 1_000_000).toFixed(2)
  if (feeSun > input.feeLimitSun) return { feeSun, problem: `The network fee would be about ${trx(feeSun)} TRX, above the ${trx(input.feeLimitSun)} TRX limit.` }
  if (input.trxBalanceSun < feeSun) return { feeSun, problem: `The payout wallet needs about ${trx(feeSun)} TRX for the network fee and has ${trx(input.trxBalanceSun)}.` }
  return { feeSun, problem: null }
}

// ------------------------------------------------- sending from the exchange

// A request to the exchange is only valid for a moment after it is signed (the
// exchange rejects one whose timestamp is more than a few seconds old). So a
// request whose answer was lost either created a withdrawal within this window
// — which then shows in the account's history — or never will.
export const EXCHANGE_REQUEST_WINDOW_MS = 60_000
export const EXCHANGE_DEAD_MARGIN_MS = 120_000

// True only when it is PROVEN that an attempt never became a withdrawal: its
// window (plus a margin) has passed, and a history lookup made after that
// found nothing. Until then the payout is never requested again.
export function exchangeRequestProvablyDead(input: { expiresAt: number; lookedUpAt: number; found: boolean }): boolean {
  return !input.found && input.lookedUpAt > input.expiresAt + EXCHANGE_DEAD_MARGIN_MS
}

// How much of the asset a payout of `usd` is, at `priceUsd` per unit — rounded
// DOWN to what the network can carry, so a payout is never rounded up.
export function assetAmount(usd: number, priceUsd: number, precision: number): number {
  if (!(usd > 0) || !(priceUsd > 0)) return 0
  const scale = 10 ** Math.max(0, Math.min(8, Math.trunc(precision)))
  return Math.floor((usd / priceUsd) * scale + 1e-7) / scale
}

// Checked before the exchange is asked to send anything.
//   funds     it can't be sent right now, and waiting (or a top-up) fixes it
//   rejected  it can't be sent as it is: a person decides
export function exchangeSendProblem(input: { asset: string; network: string; amount: number; available: number; fee: number; min: number; enabled: boolean; priceUsd: number; maxFeeUsd: number }): { kind: "funds" | "rejected"; reason: string } | null {
  const show = (n: number) => n.toFixed(8).replace(/\.?0+$/, "")
  if (!input.enabled) return { kind: "funds", reason: `The exchange has ${input.asset} withdrawals on ${input.network} switched off right now.` }
  if (!(input.amount > 0)) return { kind: "rejected", reason: "The payout amount couldn't be converted." }
  if (input.amount < input.min) return { kind: "rejected", reason: `${show(input.amount)} ${input.asset} is below the exchange's minimum withdrawal of ${show(input.min)} ${input.asset} on ${input.network}.` }
  const feeUsd = input.fee * input.priceUsd
  if (feeUsd > input.maxFeeUsd + 0.001) return { kind: "funds", reason: `The exchange's withdrawal fee on ${input.network} is ${show(input.fee)} ${input.asset} (about $${feeUsd.toFixed(2)}), above the $${input.maxFeeUsd.toFixed(2)} limit.` }
  if (input.available + 1e-9 < input.amount + input.fee) return { kind: "funds", reason: `The exchange account has ${show(input.available)} ${input.asset} available; this payout needs ${show(input.amount)} plus a ${show(input.fee)} ${input.asset} fee.` }
  return null
}

// After this many automatic attempts a person takes over.
export const MAX_AUTO_ATTEMPTS = 3

export const AUTO_SKIP_LABELS: Record<AutoSkip, string> = {
  paused: "All payouts are paused",
  auto_off: "Automatic payouts are off for the program",
  affiliate_inactive: "Account isn't active",
  admin_disabled: "Disabled for this affiliate by an admin",
  opted_out: "Not switched on by the affiliate",
  fraud_hold: "Fraud lock",
  payout_hold: "Payout hold",
  risk_review: "Waiting for a risk review",
  no_method: "No default payout method",
  method_ineligible: "Default method isn't active",
  method_hold: "New method security hold",
  in_flight: "A payout is in progress",
  already_paid_this_period: "Already paid this period",
  below_threshold: "Below the threshold",
  price_unavailable: "The coin's price couldn't be read",
  limit_reached: "Program limit reached",
}
