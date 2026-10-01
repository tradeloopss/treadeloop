import { test } from "node:test"
import assert from "node:assert/strict"
import {
  attributionValid,
  buildTrackingUrl,
  canAttribute,
  chooseAttribution,
  cleanLandingPage,
  cleanUtm,
  codeValid,
  commissionEligible,
  computeCommission,
  couponCodeValid,
  decideCommission,
  deviceFrom,
  fraudFindings,
  ledgerBalances,
  maskEmail,
  monthsBetween,
  normalizeMailbox,
  planReversal,
  refundShare,
  resolveRule,
  sameMailbox,
  settleFifo,
  shouldCountClick,
  tierFor,
  type LedgerEntry,
  type RuleRow,
  type TierRow,
} from "@/lib/affiliates/engine"
import { DEFAULT_PROGRAM, normalizeProgram, parseRange, rangeStart, type ProgramSettings } from "@/lib/affiliates/types"
import { attributionCookieDomain, claimable, signAttribution, verifyAttribution } from "@/lib/affiliates/token"
import { csvCell, toCsv } from "@/lib/affiliates/csv"
import { payoutLedgerStatus } from "@/lib/affiliates/payout-engine"

const NOW = new Date("2026-06-15T12:00:00Z")
const DAY = 86_400_000
const program = (over: Partial<ProgramSettings> = {}): ProgramSettings => ({ ...DEFAULT_PROGRAM, ...over })

const TIERS: TierRow[] = [
  { id: 1, name: "Starter", minCustomers: 0, ratePercent: 20, sortOrder: 0, enabled: true },
  { id: 2, name: "Growth", minCustomers: 10, ratePercent: 25, sortOrder: 10, enabled: true },
  { id: 3, name: "Pro", minCustomers: 50, ratePercent: 30, sortOrder: 50, enabled: true },
  { id: 4, name: "Elite", minCustomers: 100, ratePercent: 35, sortOrder: 100, enabled: true },
]
const rule = (over: Partial<RuleRow>): RuleRow => ({ id: 1, scope: "affiliate", campaignId: null, couponId: null, ratePercent: 40, durationMonths: null, startsAt: null, endsAt: null, enabled: true, ...over })

// ------------------------------------------------------------- attribution

const claim = (over: Partial<Parameters<typeof canAttribute>[0]> = {}) =>
  canAttribute({ affiliateUserId: "aff-user", affiliateStatus: "approved", userId: "new-user", userCreatedAtMs: NOW.getTime(), clickedAtMs: NOW.getTime() - DAY, cookieDays: 30, now: NOW, hasReferral: false, ...over })

test("attribution: a new account inside the cookie window is attributed", () => {
  assert.deepEqual(claim(), { ok: true })
})

test("attribution: expired cookie is refused", () => {
  assert.deepEqual(claim({ clickedAtMs: NOW.getTime() - 31 * DAY }), { ok: false, reason: "expired" })
  assert.equal(attributionValid(NOW.getTime() - 30 * DAY, 30, NOW), true)
  assert.equal(attributionValid(NOW.getTime() - 30 * DAY - 1, 30, NOW), false)
  // a click "from the future" (forged timestamp) is never valid
  assert.equal(attributionValid(NOW.getTime() + DAY, 30, NOW), false)
})

test("attribution: self-referral is refused — same account or the same mailbox", () => {
  assert.equal(claim({ userId: "aff-user" }).reason, "self")
  assert.equal(claim({ affiliateEmail: "alex@gmail.com", userEmail: "a.lex+promo@googlemail.com" }).reason, "self")
  assert.equal(claim({ affiliateEmail: "alex@gmail.com", userEmail: "someone@gmail.com" }).ok, true)
})

test("attribution: an account that existed before the click is not a referral", () => {
  assert.equal(claim({ userCreatedAtMs: NOW.getTime() - 10 * DAY }).reason, "preexisting")
  // small clock skew between the click row and the user row is tolerated
  assert.equal(claim({ userCreatedAtMs: NOW.getTime() - DAY - 60_000 }).ok, true)
})

test("attribution: a customer belongs to one affiliate; inactive affiliates get nothing", () => {
  assert.equal(claim({ hasReferral: true }).reason, "existing")
  for (const status of ["suspended", "pending", "rejected", "review"]) assert.equal(claim({ affiliateStatus: status }).reason, "inactive")
})

test("attribution model: first touch keeps the original, last touch replaces it", () => {
  const existing = { affiliateId: 1, ts: NOW.getTime() - 5 * DAY }
  assert.equal(chooseAttribution({ existing, model: "first_touch", cookieDays: 30, now: NOW }), "keep")
  assert.equal(chooseAttribution({ existing, model: "last_touch", cookieDays: 30, now: NOW }), "replace")
  // an expired first touch no longer protects anything
  assert.equal(chooseAttribution({ existing: { affiliateId: 1, ts: NOW.getTime() - 40 * DAY }, model: "first_touch", cookieDays: 30, now: NOW }), "replace")
  assert.equal(chooseAttribution({ existing: null, model: "first_touch", cookieDays: 30, now: NOW }), "replace")
})

test("click dedupe: a refresh inside 30 minutes isn't a new click", () => {
  assert.equal(shouldCountClick(null, NOW), true)
  assert.equal(shouldCountClick(new Date(NOW.getTime() - 10 * 60_000), NOW), false)
  assert.equal(shouldCountClick(new Date(NOW.getTime() - 31 * 60_000), NOW), true)
})

test("attribution cookie: signed, tamper-evident, and useless with another secret", () => {
  const payload = { a: 7, l: 3, c: null, k: 99, v: "visitor-1", t: NOW.getTime() }
  const token = signAttribution(payload, "secret")
  assert.deepEqual(verifyAttribution(token, "secret"), payload)
  assert.equal(verifyAttribution(token, "other-secret"), null)
  // swapping the affiliate id in the body breaks the signature
  const forged = `${Buffer.from(JSON.stringify({ ...payload, a: 8 })).toString("base64url")}.${token.split(".")[1]}`
  assert.equal(verifyAttribution(forged, "secret"), null)
  for (const junk of [null, undefined, "", "abc", "a.b", `${token}x`]) assert.equal(verifyAttribution(junk, "secret"), null)
})

test("claimable: only accounts created after the click may claim it", () => {
  const token = signAttribution({ a: 1, l: null, c: null, k: null, v: "v", t: NOW.getTime() }, "s")
  assert.equal(claimable(token, new Date(NOW.getTime() + 60_000), "s"), true)
  assert.equal(claimable(token, new Date(NOW.getTime() - DAY), "s"), false)
  assert.equal(claimable("garbage", NOW, "s"), false)
})

test("cookie domain spans the marketing site and the app, but not previews", () => {
  const saved = process.env.AUTH_COOKIE_DOMAIN
  delete process.env.AUTH_COOKIE_DOMAIN
  assert.equal(attributionCookieDomain("tradeloop.pro"), ".tradeloop.pro")
  assert.equal(attributionCookieDomain("app.tradeloop.pro:443"), ".tradeloop.pro")
  assert.equal(attributionCookieDomain("localhost:3000"), null)
  assert.equal(attributionCookieDomain("tradeloop-git-x.vercel.app"), null)
  assert.equal(attributionCookieDomain("127.0.0.1"), null)
  process.env.AUTH_COOKIE_DOMAIN = ".example.com"
  assert.equal(attributionCookieDomain("anything.test"), ".example.com")
  if (saved === undefined) delete process.env.AUTH_COOKIE_DOMAIN
  else process.env.AUTH_COOKIE_DOMAIN = saved
})

test("mailbox normalisation", () => {
  assert.equal(normalizeMailbox("A.Lex+tag@GoogleMail.com"), "alex@gmail.com")
  assert.equal(normalizeMailbox("first.last+x@company.com"), "first.last@company.com")
  assert.equal(normalizeMailbox("nope"), null)
  assert.equal(sameMailbox(null, null), false)
})

// ---------------------------------------------------------------- rule engine

test("tiers: highest threshold reached, or a manual override", () => {
  assert.equal(tierFor(TIERS, 0)?.name, "Starter")
  assert.equal(tierFor(TIERS, 9)?.name, "Starter")
  assert.equal(tierFor(TIERS, 10)?.name, "Growth")
  assert.equal(tierFor(TIERS, 250)?.name, "Elite")
  assert.equal(tierFor(TIERS, 0, 3)?.name, "Pro")
  // a disabled tier is skipped, even as an override
  const disabled = TIERS.map((t) => (t.id === 2 ? { ...t, enabled: false } : t))
  assert.equal(tierFor(disabled, 12)?.name, "Starter")
  assert.equal(tierFor(disabled, 12, 2)?.name, "Starter")
  assert.equal(tierFor([], 5), null)
})

test("rule priority: affiliate → campaign → coupon → tier → default", () => {
  const rules = [rule({ id: 1, scope: "affiliate", ratePercent: 40 }), rule({ id: 2, scope: "campaign", campaignId: 5, ratePercent: 33 }), rule({ id: 3, scope: "coupon", couponId: 9, ratePercent: 28 })]
  const base = { program: program(), tiers: TIERS, customers: 12, now: NOW }
  assert.deepEqual(pick(resolveRule({ ...base, rules, campaignId: 5, couponId: 9 })), [40, "affiliate"])
  assert.deepEqual(pick(resolveRule({ ...base, rules: rules.slice(1), campaignId: 5, couponId: 9 })), [33, "campaign"])
  assert.deepEqual(pick(resolveRule({ ...base, rules: rules.slice(2), campaignId: 5, couponId: 9 })), [28, "coupon"])
  assert.deepEqual(pick(resolveRule({ ...base, rules: [], campaignId: 5 })), [25, "tier"])
  assert.deepEqual(pick(resolveRule({ ...base, rules: [], tiers: [] })), [30, "default"])
  // a campaign rule doesn't leak onto another campaign
  assert.deepEqual(pick(resolveRule({ ...base, rules: rules.slice(1), campaignId: 6 })), [25, "tier"])
})
const pick = (r: { ratePercent: number; source: string }) => [r.ratePercent, r.source]

test("rules: disabled, not-yet-started and ended rules are ignored; newest wins", () => {
  const base = { program: program(), tiers: TIERS, customers: 0, now: NOW }
  assert.equal(resolveRule({ ...base, rules: [rule({ enabled: false })] }).source, "tier")
  assert.equal(resolveRule({ ...base, rules: [rule({ startsAt: new Date(NOW.getTime() + DAY) })] }).source, "tier")
  assert.equal(resolveRule({ ...base, rules: [rule({ endsAt: new Date(NOW.getTime() - DAY) })] }).source, "tier")
  assert.equal(resolveRule({ ...base, rules: [rule({ id: 1, ratePercent: 35 }), rule({ id: 2, ratePercent: 45 })] }).ratePercent, 45)
  // a rule's own duration overrides the program's
  assert.equal(resolveRule({ ...base, program: program({ durationMonths: 12 }), rules: [rule({ durationMonths: 6 })] }).durationMonths, 6)
  assert.equal(resolveRule({ ...base, program: program({ durationMonths: 12 }), rules: [rule({})] }).durationMonths, 12)
})

// -------------------------------------------------------------- commissions

test("commission is computed in cents from the server-side amount", () => {
  assert.equal(computeCommission(49, 30), 14.7)
  assert.equal(computeCommission(29.99, 25), 7.5)
  assert.equal(computeCommission(0, 30), 0)
  assert.equal(computeCommission(-10, 30), 0)
  assert.equal(computeCommission(49, 0), 0)
})

test("recurring: every payment earns; one-time: only the first", () => {
  const first = new Date("2026-01-10T00:00:00Z")
  const later = new Date("2026-05-10T00:00:00Z")
  assert.equal(commissionEligible({ program: program(), durationMonths: null, firstPaymentAt: null, paidAt: first }).ok, true)
  assert.equal(commissionEligible({ program: program(), durationMonths: null, firstPaymentAt: first, paidAt: later }).ok, true)
  const once = program({ commissionType: "one_time" })
  assert.equal(commissionEligible({ program: once, durationMonths: null, firstPaymentAt: null, paidAt: first }).ok, true)
  assert.equal(commissionEligible({ program: once, durationMonths: null, firstPaymentAt: first, paidAt: later }).ok, false)
})

test("earning window: payments after the window stop earning", () => {
  const first = new Date("2026-01-10T00:00:00Z")
  const inside = commissionEligible({ program: program(), durationMonths: 6, firstPaymentAt: first, paidAt: new Date("2026-07-09T00:00:00Z") })
  const outside = commissionEligible({ program: program(), durationMonths: 6, firstPaymentAt: first, paidAt: new Date("2026-07-10T00:00:00Z") })
  assert.equal(inside.ok, true)
  assert.equal(outside.ok, false)
  assert.equal(monthsBetween(first, new Date("2026-02-09T00:00:00Z")), 0)
  assert.equal(monthsBetween(first, new Date("2026-02-10T00:00:00Z")), 1)
})

test("decideCommission: amount, rate, source and hold date in one decision", () => {
  const paidAt = new Date("2026-03-01T00:00:00Z")
  const r = resolveRule({ program: program(), tiers: TIERS, rules: [], customers: 10, now: paidAt })
  const d = decideCommission({ program: program({ holdDays: 30 }), rule: r, affiliateStatus: "approved", firstPaymentAt: null, paidAt, baseAmount: 49 })
  assert.deepEqual(d, { ok: true, amount: 12.25, ratePercent: 25, source: "tier", holdUntil: new Date("2026-03-31T00:00:00Z") })
})

test("a suspended (or otherwise inactive) affiliate earns nothing", () => {
  const r = resolveRule({ program: program(), tiers: TIERS, rules: [], customers: 0, now: NOW })
  for (const status of ["suspended", "pending", "rejected"]) {
    assert.equal(decideCommission({ program: program(), rule: r, affiliateStatus: status, firstPaymentAt: null, paidAt: NOW, baseAmount: 49 }).ok, false)
  }
  // nothing to pay on a zero payment (e.g. a 100% coupon)
  assert.equal(decideCommission({ program: program(), rule: r, affiliateStatus: "approved", firstPaymentAt: null, paidAt: NOW, baseAmount: 0 }).ok, false)
})

// ------------------------------------------------------------------- ledger

const L = (type: string, amount: number, status: string): LedgerEntry => ({ type, amount, status })

test("balances are derived from the ledger", () => {
  const b = ledgerBalances([L("subscription", 10, "pending"), L("subscription", 5, "approved"), L("subscription", 30, "available"), L("subscription", 50, "paid"), L("bonus", 20, "available"), L("payout", -50, "paid"), L("payout", -25, "pending")])
  assert.deepEqual(b, { pending: 15, available: 25, processing: 25, lifetimeEarned: 115, lifetimePaid: 50 })
})

test("a failed or cancelled payout returns the money to the balance", () => {
  const rows = [L("subscription", 100, "available")]
  assert.equal(ledgerBalances([...rows, L("payout", -100, "pending")]).available, 0)
  assert.equal(ledgerBalances([...rows, L("payout", -100, payoutLedgerStatus("failed"))]).available, 100)
  assert.equal(ledgerBalances([...rows, L("payout", -100, payoutLedgerStatus("cancelled"))]).available, 100)
  assert.equal(payoutLedgerStatus("processing"), "processing")
})

test("refund of an unpaid commission: fully reversed, both rows kept, nothing counted", () => {
  const plan = planReversal({ amount: 14.7, status: "pending" }, 1, "refund")
  assert.deepEqual(plan, { originalStatus: "refunded", closeEarlier: false, entry: { type: "refund", amount: -14.7, status: "refunded" } })
  const b = ledgerBalances([L("subscription", 14.7, plan!.originalStatus!), L(plan!.entry.type, plan!.entry.amount, plan!.entry.status)])
  assert.deepEqual(b, { pending: 0, available: 0, processing: 0, lifetimeEarned: 0, lifetimePaid: 0 })
})

test("partial refund: the commission is reduced by the refunded share, in the same state", () => {
  const plan = planReversal({ amount: 20, status: "pending" }, 0.25, "refund")
  assert.deepEqual(plan, { originalStatus: null, closeEarlier: false, entry: { type: "refund", amount: -5, status: "pending" } })
  assert.equal(ledgerBalances([L("subscription", 20, "pending"), L("refund", -5, "pending")]).pending, 15)
})

test("refund after the commission was paid out: clawed back from the available balance", () => {
  const plan = planReversal({ amount: 30, status: "paid" }, 1, "refund")
  assert.deepEqual(plan, { originalStatus: null, closeEarlier: false, entry: { type: "refund", amount: -30, status: "available" } })
  // paid 30 out, then the 30 is reversed: the affiliate owes 30, offset by what they earn next
  const b = ledgerBalances([L("subscription", 30, "paid"), L("payout", -30, "paid"), L("refund", -30, "available"), L("subscription", 12, "available")])
  assert.equal(b.available, -18)
  assert.equal(b.lifetimePaid, 30)
})

test("chargeback reverses like a refund, marked as a reversal", () => {
  assert.deepEqual(planReversal({ amount: 14.7, status: "available" }, 1, "chargeback"), { originalStatus: "reversed", closeEarlier: false, entry: { type: "reversal", amount: -14.7, status: "reversed" } })
})

test("idempotency of reversals: an already-reversed commission can't be reversed again", () => {
  for (const status of ["refunded", "reversed", "cancelled"]) assert.equal(planReversal({ amount: 10, status }, 1, "refund"), null)
  assert.equal(planReversal({ amount: 0, status: "pending" }, 1, "refund"), null)
  assert.equal(planReversal({ amount: -5, status: "pending" }, 1, "refund"), null)
  assert.equal(planReversal({ amount: 10, status: "pending" }, 0, "refund"), null)
})

test("refund share of a payment; unknown amounts mean all of it", () => {
  assert.equal(refundShare(49, 49), 1)
  assert.equal(refundShare(12.25, 49), 0.25)
  assert.equal(refundShare(80, 49), 1)
  // a chargeback or a manual reversal carries no amounts
  assert.equal(refundShare(0, 0), 1)
  assert.equal(refundShare(10, 0), 1)
})

test("several reversals can never take back more than the commission, and the last one closes it", () => {
  // 20 earned, 15 already reversed by partial refunds, then a full refund arrives
  const last = planReversal({ amount: 20, status: "pending" }, 1, "refund", -15)
  assert.deepEqual(last, { originalStatus: "refunded", closeEarlier: true, entry: { type: "refund", amount: -5, status: "refunded" } })
  // a second partial that still leaves something stays partial
  assert.deepEqual(planReversal({ amount: 20, status: "pending" }, 0.25, "refund", -5), { originalStatus: null, closeEarlier: false, entry: { type: "refund", amount: -5, status: "pending" } })
  // nothing left to take
  assert.equal(planReversal({ amount: 20, status: "pending" }, 1, "refund", -20), null)
  // a chargeback after a partial refund reverses the remainder and closes the lot
  assert.deepEqual(planReversal({ amount: 9.8, status: "pending" }, 1, "chargeback", -4.9), { originalStatus: "reversed", closeEarlier: true, entry: { type: "reversal", amount: -4.9, status: "reversed" } })
  // an already-paid commission is clawed back for what is left, without touching earlier rows
  assert.deepEqual(planReversal({ amount: 30, status: "paid" }, 1, "refund", -10), { originalStatus: null, closeEarlier: false, entry: { type: "refund", amount: -20, status: "available" } })
})

// ------------------------------------------------------------------ payouts

test("a paid payout settles the oldest cleared commissions, never more than it paid", () => {
  const rows = [{ id: 1, amount: 20 }, { id: 2, amount: 30 }, { id: 3, amount: 40 }]
  assert.deepEqual(settleFifo(rows, 50), [1, 2])
  assert.deepEqual(settleFifo(rows, 60), [1, 2])
  assert.deepEqual(settleFifo(rows, 19.99), [])
  assert.deepEqual(settleFifo(rows, 90), [1, 2, 3])
})

// -------------------------------------------------------------------- fraud

const quiet = { clicks: 200, signups: 20, paidCustomers: 8, refunds: 0, chargebacks: 0, sameIpSignups: 0, signupsLastHour: 1, couponOnlyShare: 0.1 }

test("fraud signals: normal activity raises nothing; each pattern raises its own signal", () => {
  assert.deepEqual(fraudFindings(quiet), [])
  const types = (s: Partial<typeof quiet>) => fraudFindings({ ...quiet, ...s }).map((f) => f.type)
  assert.deepEqual(types({ sameIpSignups: 3 }), ["same_device"])
  assert.deepEqual(types({ clicks: 30, signups: 25 }), ["abnormal_conversion"])
  assert.deepEqual(types({ clicks: 2, signups: 6 }), ["unusual_traffic"])
  assert.deepEqual(types({ signupsLastHour: 12 }), ["repeated_signups"])
  assert.deepEqual(types({ refunds: 4 }), ["repeated_refunds"])
  assert.deepEqual(types({ chargebacks: 1 }), ["chargeback"])
  assert.equal(fraudFindings({ ...quiet, chargebacks: 2 })[0].risk, "high")
})

// ------------------------------------------------------- links, codes, input

test("tracking links are built from the affiliate's code on a same-site path only", () => {
  assert.equal(buildTrackingUrl({ base: "https://tradeloop.pro/", code: "alex123" }), "https://tradeloop.pro/?ref=alex123")
  assert.equal(
    buildTrackingUrl({ base: "https://tradeloop.pro", code: "alex123", landingPage: "/pricing", linkToken: "abc123def456", utm: { source: "youtube", campaign: "review" } }),
    "https://tradeloop.pro/pricing?ref=alex123&lk=abc123def456&utm_source=youtube&utm_campaign=review"
  )
  for (const evil of ["https://evil.example/x", "//evil.example", "javascript:alert(1)", "\\\\evil", "pricing"]) assert.equal(cleanLandingPage(evil), "/")
  assert.equal(cleanLandingPage("/pricing?x=1#top"), "/pricing")
  assert.equal(new URL(buildTrackingUrl({ base: "https://tradeloop.pro", code: "a1b", landingPage: "https://evil.example" })).host, "tradeloop.pro")
})

test("codes, UTM tags, devices and masking", () => {
  assert.equal(codeValid("alex-123"), true)
  for (const bad of ["ab", "Alex", "-alex", "a b c", "x".repeat(25)]) assert.equal(codeValid(bad), false)
  assert.equal(couponCodeValid("ALEX20"), true)
  for (const bad of ["alex20", "A", "ALEX 20"]) assert.equal(couponCodeValid(bad), false)
  assert.equal(cleanUtm("  You Tube <script> "), "you-tube-script")
  assert.equal(cleanUtm(""), null)
  assert.equal(deviceFrom("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), "mobile")
  assert.equal(deviceFrom("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"), "tablet")
  assert.equal(deviceFrom("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "desktop")
  assert.equal(maskEmail("alexander@example.com"), "a••••••@example.com")
  assert.equal(maskEmail("nope"), "—")
})

test("program settings are clamped, never trusted as submitted", () => {
  assert.deepEqual(normalizeProgram(null), DEFAULT_PROGRAM)
  const p = normalizeProgram({ defaultRate: 500, cookieDays: -3, holdDays: 9999, minPayout: 0, commissionType: "hack", attribution: "x", durationMonths: "", maxCouponPercent: 1000, autoApprove: "yes" })
  assert.equal(p.defaultRate, 90)
  assert.equal(p.cookieDays, 1)
  assert.equal(p.holdDays, 180)
  assert.equal(p.minPayout, 1)
  assert.equal(p.commissionType, "recurring")
  assert.equal(p.attribution, "first_touch")
  assert.equal(p.durationMonths, null)
  assert.equal(p.maxCouponPercent, 100)
  assert.equal(p.autoApprove, false)
  assert.equal(normalizeProgram({ durationMonths: 12 }).durationMonths, 12)
  assert.equal(parseRange("nonsense"), "30d")
  assert.equal(rangeStart("all"), null)
  assert.equal(rangeStart("7d", NOW)!.getTime(), NOW.getTime() - 7 * DAY)
})

test("CSV export escapes quotes and neutralises spreadsheet formulas", () => {
  assert.equal(csvCell('He said "hi", twice'), '"He said ""hi"", twice"')
  assert.equal(csvCell("=HYPERLINK(\"http://evil\")"), "\"'=HYPERLINK(\"\"http://evil\"\")\"")
  assert.equal(csvCell("+1 555"), "'+1 555")
  assert.equal(csvCell("@cmd"), "'@cmd")
  // real negative numbers stay numbers
  assert.equal(csvCell(-14.7), "-14.7")
  assert.equal(csvCell(null), "")
  assert.equal(toCsv(["a", "b"], [[1, "x,y"]]), 'a,b\r\n1,"x,y"\r\n')
})
