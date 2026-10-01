import type { ProgramSettings } from "./types"

// The affiliate program's rules as pure functions — no database, no clock of
// its own — so every money and attribution decision is unit-tested
// (tests/affiliates.test.ts). The server code in this folder only loads rows,
// calls these, and writes the result.

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

// ------------------------------------------------------------ rule engine

export type TierRow = { id: number; name: string; minCustomers: number; ratePercent: number; sortOrder: number; enabled: boolean }
export type RuleRow = {
  id: number
  scope: "affiliate" | "campaign" | "coupon"
  campaignId: number | null
  couponId: number | null
  ratePercent: number
  durationMonths: number | null
  startsAt: Date | null
  endsAt: Date | null
  enabled: boolean
}
export type RuleSource = "affiliate" | "campaign" | "coupon" | "tier" | "default"
export type ResolvedRule = { ratePercent: number; source: RuleSource; durationMonths: number | null; ruleId: number | null; tier: TierRow | null }

// The tier an affiliate sits in: a manual override if one is set (and still
// enabled), otherwise the highest enabled tier whose threshold they've reached.
export function tierFor(tiers: TierRow[], customers: number, overrideId?: number | null): TierRow | null {
  const enabled = tiers.filter((t) => t.enabled)
  if (overrideId != null) {
    const forced = enabled.find((t) => t.id === overrideId)
    if (forced) return forced
  }
  let best: TierRow | null = null
  for (const t of enabled) if (customers >= t.minCustomers && (!best || t.minCustomers > best.minCustomers)) best = t
  return best
}

const ruleLive = (r: RuleRow, now: Date) => r.enabled && (!r.startsAt || r.startsAt <= now) && (!r.endsAt || r.endsAt > now)

// Which commission rate applies to a payment. PRIORITY, highest first:
//   1. an affiliate-specific rule   (e.g. "Alex — 35% for 6 months")
//   2. a rule on the campaign the customer came through
//   3. a rule on the coupon the customer used
//   4. the affiliate's tier
//   5. the program default
// Within a level the newest rule wins. A rule's own duration overrides the
// program's; otherwise the program duration applies.
export function resolveRule(input: {
  program: ProgramSettings
  tiers: TierRow[]
  rules: RuleRow[]
  customers: number
  tierOverrideId?: number | null
  campaignId?: number | null
  couponId?: number | null
  now: Date
}): ResolvedRule {
  const live = input.rules.filter((r) => ruleLive(r, input.now)).sort((a, b) => b.id - a.id)
  const pick = (r: RuleRow | undefined, source: RuleSource): ResolvedRule | null =>
    r ? { ratePercent: r.ratePercent, source, durationMonths: r.durationMonths ?? input.program.durationMonths, ruleId: r.id, tier: null } : null

  const byAffiliate = pick(live.find((r) => r.scope === "affiliate"), "affiliate")
  if (byAffiliate) return byAffiliate
  if (input.campaignId != null) {
    const byCampaign = pick(live.find((r) => r.scope === "campaign" && r.campaignId === input.campaignId), "campaign")
    if (byCampaign) return byCampaign
  }
  if (input.couponId != null) {
    const byCoupon = pick(live.find((r) => r.scope === "coupon" && r.couponId === input.couponId), "coupon")
    if (byCoupon) return byCoupon
  }
  const tier = tierFor(input.tiers, input.customers, input.tierOverrideId)
  if (tier) return { ratePercent: tier.ratePercent, source: "tier", durationMonths: input.program.durationMonths, ruleId: null, tier }
  return { ratePercent: input.program.defaultRate, source: "default", durationMonths: input.program.durationMonths, ruleId: null, tier: null }
}

export function monthsBetween(from: Date, to: Date): number {
  const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  return to.getDate() < from.getDate() ? months - 1 : months
}

// Whether a payment from a referred customer still earns a commission.
export function commissionEligible(input: {
  program: ProgramSettings
  durationMonths: number | null
  firstPaymentAt: Date | null // the referral's first payment (null = this is it)
  paidAt: Date
}): { ok: boolean; reason?: string } {
  const first = input.firstPaymentAt
  if (!first) return { ok: true }
  if (input.program.commissionType === "one_time") return { ok: false, reason: "One-time program: only the first payment earns." }
  if (input.durationMonths != null && monthsBetween(first, input.paidAt) >= input.durationMonths) {
    return { ok: false, reason: `Commission window (${input.durationMonths} months) has ended.` }
  }
  return { ok: true }
}

// Commission on a payment, in whole cents. Always computed server-side.
export function computeCommission(baseAmount: number, ratePercent: number): number {
  if (!(baseAmount > 0) || !(ratePercent > 0)) return 0
  return round2((baseAmount * ratePercent) / 100)
}

export type CommissionDecision =
  | { ok: true; amount: number; ratePercent: number; source: RuleSource; holdUntil: Date }
  | { ok: false; reason: string }

// The whole "does this payment earn, and how much" decision in one place.
// Only an APPROVED affiliate earns: a suspended or rejected one keeps the
// referral on record but gets no commission for payments made meanwhile.
export function decideCommission(input: {
  program: ProgramSettings
  rule: ResolvedRule
  affiliateStatus: string
  firstPaymentAt: Date | null
  paidAt: Date
  baseAmount: number
}): CommissionDecision {
  if (input.affiliateStatus !== "approved") return { ok: false, reason: "Affiliate isn't active." }
  const eligible = commissionEligible({ program: input.program, durationMonths: input.rule.durationMonths, firstPaymentAt: input.firstPaymentAt, paidAt: input.paidAt })
  if (!eligible.ok) return { ok: false, reason: eligible.reason ?? "Not eligible." }
  const amount = computeCommission(input.baseAmount, input.rule.ratePercent)
  if (amount <= 0) return { ok: false, reason: "Nothing to pay a commission on." }
  return { ok: true, amount, ratePercent: input.rule.ratePercent, source: input.rule.source, holdUntil: new Date(input.paidAt.getTime() + input.program.holdDays * 86_400_000) }
}

// The share of a payment a refund gives back. Unknown amounts (a chargeback,
// a manual reversal, an event that doesn't say) mean all of it.
export function refundShare(refundAmount: number, paymentTotal: number): number {
  return paymentTotal > 0 && refundAmount > 0 ? Math.min(1, refundAmount / paymentTotal) : 1
}

// ------------------------------------------------------------------ ledger

export type LedgerEntry = { type: string; amount: number; status: string }
export type Balances = { pending: number; available: number; processing: number; lifetimeEarned: number; lifetimePaid: number }

// Statuses whose entries count toward money that has cleared the hold.
const CLEARED = ["available", "paid"]
const HELD = ["pending", "approved"]
const PAYOUT_LIVE = ["pending", "processing", "paid"]

// Balances are DERIVED from ledger rows — there is no stored balance.
//  pending       commissions still in the hold period (pending / approved)
//  available     cleared commissions and clawbacks, minus every payout that is
//                requested, in flight or paid
//  processing    payouts requested but not yet paid
//  lifetimeEarned  everything earned and not reversed
//  lifetimePaid  payouts actually paid
// Entries marked reversed / refunded / cancelled count for nothing: a reversal
// of an unpaid commission takes the original out of the sums, and both rows
// stay in the ledger as the record of what happened.
export function ledgerBalances(entries: LedgerEntry[]): Balances {
  let pending = 0
  let cleared = 0
  let payoutsLive = 0
  let processing = 0
  let lifetimePaid = 0
  for (const e of entries) {
    if (e.type === "payout") {
      if (PAYOUT_LIVE.includes(e.status)) payoutsLive += e.amount
      if (e.status === "pending" || e.status === "processing") processing += -e.amount
      if (e.status === "paid") lifetimePaid += -e.amount
      continue
    }
    if (HELD.includes(e.status)) pending += e.amount
    else if (CLEARED.includes(e.status)) cleared += e.amount
  }
  return {
    pending: round2(pending),
    available: round2(cleared + payoutsLive),
    processing: round2(processing),
    lifetimeEarned: round2(pending + cleared),
    lifetimePaid: round2(lifetimePaid),
  }
}

export type ReversalKind = "refund" | "chargeback" | "manual"
export type ReversalPlan = {
  // New status for the original commission, or null to leave it as it is.
  originalStatus: "refunded" | "reversed" | null
  // True when this reversal finishes off a commission that earlier partial
  // reversals had already reduced: those earlier rows are closed with it.
  closeEarlier: boolean
  entry: { type: "refund" | "reversal"; amount: number; status: string }
}

// How to undo (all or part of) a commission. Financial rows are never deleted:
//  - unpaid, and this takes back everything that is left → the original is
//    marked refunded/reversed (it stops counting) and the negative row that
//    records the reversal carries the same terminal status;
//  - unpaid, partially reversed → the original keeps its status and a negative
//    row in the SAME status nets against it through the hold;
//  - already paid → the original stays paid and a negative "available" row
//    claws the amount back out of the affiliate's available balance.
// `share` is the fraction of the commission to undo; `alreadyReversed` is what
// earlier reversals took (so the total can never exceed the commission).
// Returns null when there is nothing left to reverse.
export function planReversal(original: { amount: number; status: string }, share: number, kind: ReversalKind, alreadyReversed = 0): ReversalPlan | null {
  if (!(original.amount > 0)) return null
  if (["reversed", "refunded", "cancelled"].includes(original.status)) return null
  const left = round2(original.amount - Math.abs(alreadyReversed))
  const take = Math.min(round2(original.amount * Math.min(1, Math.max(0, share))), left)
  if (!(take > 0)) return null
  const type = kind === "refund" ? "refund" : "reversal"
  const terminal = kind === "refund" ? "refunded" : "reversed"
  if (original.status === "paid") return { originalStatus: null, closeEarlier: false, entry: { type, amount: -take, status: "available" } }
  if (take >= left - 0.005) return { originalStatus: terminal, closeEarlier: Math.abs(alreadyReversed) > 0, entry: { type, amount: -take, status: terminal } }
  return { originalStatus: null, closeEarlier: false, entry: { type, amount: -take, status: original.status } }
}

// ------------------------------------------------------------------ payouts
// (The payout status machine, limits and the automatic-payout decision live in
// payout-engine.ts.)

// Which cleared commissions a paid payout settles: oldest first, whole rows
// only, never more than the payout. Purely a label ("paid") plus the payout
// link — available and paid rows count the same toward the balance.
export function settleFifo(rows: { id: number; amount: number }[], payoutAmount: number): number[] {
  const out: number[] = []
  let left = round2(payoutAmount)
  for (const r of rows) {
    if (!(r.amount > 0)) continue
    if (r.amount > left + 0.001) break
    out.push(r.id)
    left = round2(left - r.amount)
  }
  return out
}

// -------------------------------------------------------------- attribution

// A page refresh or a second visit within the window isn't a new click.
export function shouldCountClick(lastClickAt: Date | null, now: Date, windowMinutes = 30): boolean {
  if (!lastClickAt) return true
  return now.getTime() - lastClickAt.getTime() > windowMinutes * 60_000
}

export function attributionValid(clickedAtMs: number, cookieDays: number, now: Date): boolean {
  const age = now.getTime() - clickedAtMs
  return age >= 0 && age <= cookieDays * 86_400_000
}

// A visitor who already carries an attribution clicks another affiliate's
// link. First-touch keeps the original while it is still inside the cookie
// window; last-touch always takes the newest click.
export function chooseAttribution(input: { existing: { affiliateId: number; ts: number } | null; model: ProgramSettings["attribution"]; cookieDays: number; now: Date }): "keep" | "replace" {
  if (!input.existing || !attributionValid(input.existing.ts, input.cookieDays, input.now)) return "replace"
  return input.model === "first_touch" ? "keep" : "replace"
}

// Whether a signed-up user may be attributed to the click they carry.
// PRECEDENCE between a link and a coupon: a customer has exactly one referral
// (UNIQUE userId). A valid link attribution is recorded at sign-up and wins; a
// coupon only attributes a customer who has no referral yet when they pay.
export function canAttribute(input: {
  affiliateUserId: string
  affiliateStatus: string
  userId: string
  userCreatedAtMs: number
  clickedAtMs: number
  cookieDays: number
  now: Date
  hasReferral: boolean
  // When both are given, an account on the affiliate's own mailbox
  // (alex+2@gmail.com for alex@gmail.com) counts as the affiliate themself.
  affiliateEmail?: string | null
  userEmail?: string | null
}): { ok: boolean; reason?: "inactive" | "self" | "existing" | "expired" | "preexisting" } {
  if (input.affiliateStatus !== "approved") return { ok: false, reason: "inactive" }
  if (input.hasReferral) return { ok: false, reason: "existing" }
  if (input.affiliateUserId === input.userId || sameMailbox(input.affiliateEmail, input.userEmail)) return { ok: false, reason: "self" }
  if (!attributionValid(input.clickedAtMs, input.cookieDays, input.now)) return { ok: false, reason: "expired" }
  // Only NEW accounts are attributed: someone who already had an account
  // before they clicked wasn't brought in by the affiliate. (5 min tolerance
  // for clock skew between the click and the account row.)
  if (input.userCreatedAtMs < input.clickedAtMs - 5 * 60_000) return { ok: false, reason: "preexisting" }
  return { ok: true }
}

// The mailbox an address really delivers to: case, "+tag" suffixes and (for
// Gmail) dots don't make a different person.
export function normalizeMailbox(email: string | null | undefined): string | null {
  const v = (email ?? "").trim().toLowerCase()
  const at = v.lastIndexOf("@")
  if (at <= 0 || at === v.length - 1) return null
  let local = v.slice(0, at).split("+")[0]
  let domain = v.slice(at + 1)
  if (domain === "googlemail.com") domain = "gmail.com"
  if (domain === "gmail.com") local = local.replace(/\./g, "")
  return local ? `${local}@${domain}` : null
}

export function sameMailbox(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeMailbox(a)
  return x != null && x === normalizeMailbox(b)
}

// --------------------------------------------------------------------- fraud

export type FraudFinding = { type: string; risk: "low" | "medium" | "high"; details: Record<string, unknown> }

// Signals for a human to review. A single signal never punishes anyone — it
// only shows up on the admin fraud page.
export function fraudFindings(s: {
  clicks: number
  signups: number
  paidCustomers: number
  refunds: number
  chargebacks: number
  sameIpSignups: number
  signupsLastHour: number
  couponOnlyShare: number // share of paid customers attributed by coupon alone
}): FraudFinding[] {
  const out: FraudFinding[] = []
  if (s.sameIpSignups >= 2) out.push({ type: "same_device", risk: s.sameIpSignups >= 4 ? "high" : "medium", details: { signupsFromAffiliateNetwork: s.sameIpSignups } })
  if (s.clicks >= 20 && s.signups / s.clicks > 0.6) out.push({ type: "abnormal_conversion", risk: "medium", details: { clicks: s.clicks, signups: s.signups } })
  if (s.signups >= 5 && s.clicks < s.signups) out.push({ type: "unusual_traffic", risk: "medium", details: { clicks: s.clicks, signups: s.signups } })
  if (s.signupsLastHour >= 10) out.push({ type: "repeated_signups", risk: "high", details: { signupsLastHour: s.signupsLastHour } })
  if (s.refunds >= 3 && s.paidCustomers > 0 && s.refunds / s.paidCustomers >= 0.3) out.push({ type: "repeated_refunds", risk: "high", details: { refunds: s.refunds, paidCustomers: s.paidCustomers } })
  if (s.chargebacks >= 1) out.push({ type: "chargeback", risk: s.chargebacks >= 2 ? "high" : "medium", details: { chargebacks: s.chargebacks } })
  if (s.paidCustomers >= 5 && s.couponOnlyShare >= 0.9 && s.clicks < 5) out.push({ type: "suspicious_coupon", risk: "low", details: { couponOnlyShare: s.couponOnlyShare } })
  return out
}

// ------------------------------------------------------------------ helpers

export function maskEmail(email: string | null | undefined): string {
  if (!email || !email.includes("@")) return "—"
  const [name, domain] = email.split("@")
  return `${name.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(6, name.length - 1)))}@${domain}`
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "")

// A referral code suggestion from a name, e.g. "alex" + 3 digits.
export function suggestCode(firstName: string, lastName: string, salt: number): string {
  const base = (slug(firstName) || slug(lastName) || "partner").slice(0, 12)
  return `${base}${String(100 + (Math.abs(salt) % 900))}`
}

export const codeValid = (code: string) => /^[a-z0-9][a-z0-9_-]{2,23}$/.test(code)
export const couponCodeValid = (code: string) => /^[A-Z0-9][A-Z0-9_-]{2,19}$/.test(code)

// What an affiliate may do with coupons right now: whether the Coupons section
// of their portal is open (the program allows coupons AND an admin opened it
// for them), and the largest discount they may offer (their own ceiling when an
// admin set one, else the program's).
export function couponAccess(aff: { couponsEnabled: boolean; maxCouponPercent: number | null }, program: { couponsEnabled: boolean; maxCouponPercent: number }): { enabled: boolean; maxPercent: number } {
  const own = aff.maxCouponPercent
  return { enabled: program.couponsEnabled && aff.couponsEnabled, maxPercent: own != null && own >= 1 ? Math.min(100, own) : program.maxCouponPercent }
}

// Only same-site paths are accepted as landing pages — never a full URL.
export function cleanLandingPage(value: string | null | undefined): string {
  const v = (value ?? "").trim()
  if (!v.startsWith("/") || v.startsWith("//") || v.includes("\\") || v.length > 200) return "/"
  return v.split(/[?#]/)[0] || "/"
}

export const cleanUtm = (value: string | null | undefined) => {
  const v = (value ?? "").trim().toLowerCase().replace(/[^a-z0-9_.\-+ ]/g, "").replace(/\s+/g, "-").slice(0, 60)
  return v || null
}

export function buildTrackingUrl(input: { base: string; code: string; landingPage?: string | null; linkToken?: string | null; utm?: { source?: string | null; medium?: string | null; campaign?: string | null; content?: string | null } }): string {
  const url = new URL(cleanLandingPage(input.landingPage), input.base.replace(/\/+$/, "") + "/")
  url.searchParams.set("ref", input.code)
  if (input.linkToken) url.searchParams.set("lk", input.linkToken)
  const u = input.utm ?? {}
  if (u.source) url.searchParams.set("utm_source", u.source)
  if (u.medium) url.searchParams.set("utm_medium", u.medium)
  if (u.campaign) url.searchParams.set("utm_campaign", u.campaign)
  if (u.content) url.searchParams.set("utm_content", u.content)
  return url.toString()
}

export function deviceFrom(userAgent: string | null | undefined): "mobile" | "tablet" | "desktop" {
  const ua = (userAgent ?? "").toLowerCase()
  if (/ipad|tablet|kindle|silk|playbook/.test(ua) || (/android/.test(ua) && !/mobile/.test(ua))) return "tablet"
  if (/mobi|iphone|ipod|android|phone/.test(ua)) return "mobile"
  return "desktop"
}

export const rate = (part: number, whole: number) => (whole > 0 ? part / whole : 0)
