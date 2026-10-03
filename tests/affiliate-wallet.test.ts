import { test } from "node:test"
import assert from "node:assert/strict"
import { ledgerBalances } from "@/lib/affiliates/engine"
import { cents, cleanAmount, describeMethod, inHold, methodUnavailable, quickAmounts, readAmount, usable } from "@/lib/affiliates/payout-form"
import { TX_FILTERS, balanceTrend, countsTowardBalance, feeCharged, feeRows, payoutRef, txCounts, txFilter, txGroup, txRef } from "@/lib/affiliates/v2/wallet"

// The Wallet (manage and track) and the Payout form (withdraw), V2: the amount
// rules the form shows before the server applies them again, how the ledger is
// grouped under the Transaction History filters, and the balance history —
// which may never show a figure the ledger doesn't add up to.

const NOW = Date.UTC(2026, 9, 3, 12)
const iso = (ms: number) => new Date(ms).toISOString()

test("amount: every reason a typed amount can't be requested, in the order a person meets them", () => {
  const limits = { min: 10, max: 500, available: 250 }
  assert.deepEqual(readAmount("", limits), { value: null, problem: "Enter an amount." })
  assert.deepEqual(readAmount("   ", limits), { value: null, problem: "Enter an amount." })
  for (const bad of ["abc", "1e3", "-5", "12,5", ".", "1.2.3"]) assert.equal(readAmount(bad, limits).problem, "Enter a valid amount.", bad)
  assert.equal(readAmount("10.555", limits).problem, "Use at most two decimal places.")
  assert.equal(readAmount("0", limits).problem, "The amount must be greater than $0.")
  assert.deepEqual(readAmount("9.99", limits), { value: 9.99, problem: "The minimum payout is $10.00." })
  // a method's own minimum is said in its own words
  assert.equal(readAmount("4", { ...limits, min: 5, minWhy: "The minimum payout to USDT (TRC-20) is 5 USDT." }).problem, "The minimum payout to USDT (TRC-20) is 5 USDT.")
  assert.equal(readAmount("250.01", limits).problem, "That's more than your available balance.")
  assert.equal(readAmount("600", { ...limits, available: 1000 }).problem, "The most you can withdraw in one payout is $500.00.")
  assert.deepEqual(readAmount("10", limits), { value: 10, problem: null })
  assert.deepEqual(readAmount(" 250.00 ", limits), { value: 250, problem: null })
  assert.deepEqual(readAmount("125.5", { ...limits, max: null }), { value: 125.5, problem: null })
})

test("amount: a pasted figure is cleaned, and the quick picks never round up past the balance", () => {
  assert.equal(cleanAmount("$1,245.32"), "1245.32")
  assert.equal(cleanAmount(" 50 "), "50")
  assert.equal(cleanAmount("12abc"), "12abc") // left as typed, so the form can say it isn't valid
  assert.equal(cents(2.5025), 2.5)
  assert.equal(cents(0.29), 0.29) // 0.29 * 100 is 28.999… in floating point
  assert.deepEqual(quickAmounts(10.01), [["25%", 2.5], ["50%", 5], ["75%", 7.5], ["Max", 10.01]])
  for (const [, v] of quickAmounts(1250)) assert.ok(v <= 1250)
  assert.deepEqual(quickAmounts(0).map(([, v]) => v), [0, 0, 0, 0])
})

test("methods: only an active method past its security hold can be chosen, and each says why not", () => {
  const soon = iso(Date.now() + 3600_000)
  const past = iso(Date.now() - 3600_000)
  assert.equal(usable({ status: "active", holdUntil: null }), true)
  assert.equal(usable({ status: "active", holdUntil: past }), true)
  assert.equal(usable({ status: "active", holdUntil: soon }), false)
  assert.equal(inHold({ holdUntil: soon }), true)
  // handed straight to .filter(): the index must not be mistaken for anything
  const list = [{ status: "active", holdUntil: past }, { status: "active", holdUntil: soon }, { status: "disabled", holdUntil: null }, { status: "active", holdUntil: null }]
  assert.deepEqual(list.filter(usable), [list[0], list[3]])
  assert.equal(list.find(inHold), list[1])
  assert.equal(methodUnavailable({ status: "active", holdUntil: null }), null)
  assert.match(methodUnavailable({ status: "active", holdUntil: soon })!, /^Security hold until /)
  assert.equal(methodUnavailable({ status: "disabled", holdUntil: null }), "Disabled")
  assert.equal(methodUnavailable({ status: "pending_verification", holdUntil: null }), "Being verified")
  assert.equal(methodUnavailable({ status: "verification_required", holdUntil: null }), "Needs verification")
  assert.equal(methodUnavailable({ status: "rejected", holdUntil: null }), "Not available")
  // what a method is called — only ever with its masked destination
  assert.deepEqual(describeMethod({ type: "crypto_trc20", label: "TXYZ…8291", nickname: null }), { name: "USDT", detail: "TRON (TRC-20) · TXYZ…8291" })
  assert.deepEqual(describeMethod({ type: "crypto_trc20", label: "TXYZ…8291", nickname: "Main wallet" }), { name: "Main wallet", detail: "TRON (TRC-20) · TXYZ…8291" })
  assert.deepEqual(describeMethod({ type: "paypal", label: "e•••@example.com", nickname: null }), { name: "PayPal", detail: "e•••@example.com" })
  assert.deepEqual(describeMethod({ type: "paypal", label: "e•••@example.com", nickname: "Business" }), { name: "Business", detail: "PayPal · e•••@example.com" })
})

test("transaction filters: All, Earnings, Payouts, Bonuses, Adjustments, Fees — every ledger type has one home", () => {
  assert.deepEqual(TX_FILTERS.map((f) => f.label), ["All", "Earnings", "Payouts", "Bonuses", "Adjustments", "Fees"])
  assert.equal(txFilter("payouts").key, "payouts")
  assert.equal(txFilter("nonsense").key, "all")
  assert.equal(txFilter(undefined).key, "all")
  const types = ["subscription", "bonus", "adjustment", "refund", "reversal", "payout"]
  assert.deepEqual(types.map(txGroup), ["earnings", "bonuses", "adjustments", "adjustments", "adjustments", "payouts"])
  // each filter's types land back under that filter
  for (const f of TX_FILTERS) for (const t of f.types ?? []) assert.equal(txGroup(t), f.key)
  assert.deepEqual(txCounts({ subscription: 4, bonus: 1, payout: 2, refund: 1, reversal: 2, adjustment: 1 }, 3), { all: 11, earnings: 4, payouts: 2, bonuses: 1, adjustments: 4, fees: 3 })
  assert.deepEqual(txCounts({}, 0), { all: 0, earnings: 0, payouts: 0, bonuses: 0, adjustments: 0, fees: 0 })
  // references: a commission keeps the one it has everywhere else
  assert.equal(txRef("subscription", 4829), "C-04829")
  assert.equal(txRef("bonus", 12), "TX-00012")
  assert.equal(txRef("payout", 123456), "TX-123456")
  assert.equal(txRef("fee", 77), "FEE-00077")
  assert.equal(payoutRef(10921), "PO-10921")
})

test("fees: listed only for a payout that went out or is on its way — never invented", () => {
  const p = (id: number, fee: number, status: string) => ({ id, fee, status, requestedAt: iso(NOW - id * 1000), completedAt: status === "paid" ? iso(NOW) : null })
  assert.equal(feeCharged({ fee: 2, status: "paid" }), true)
  assert.equal(feeCharged({ fee: 2, status: "processing" }), true)
  assert.equal(feeCharged({ fee: 2, status: "pending" }), true)
  assert.equal(feeCharged({ fee: 0, status: "paid" }), false)
  for (const status of ["failed", "cancelled", "rejected", "reversed"]) assert.equal(feeCharged({ fee: 2, status }), false, status)
  const rows = feeRows([p(1, 2.5, "paid"), p(2, 0, "paid"), p(3, 1, "failed"), p(4, 1, "confirming")])
  assert.deepEqual(rows.map((r) => [r.id, r.type, r.amount, r.status, r.payoutId]), [[1, "fee", -2.5, "paid", 1], [4, "fee", -1, "processing", 4]])
  assert.equal(rows[0].createdAt, iso(NOW))
  assert.deepEqual(feeRows([]), [])
})

test("balance history: the rows that count are exactly the ones the balance is made of", () => {
  const entries = [
    { type: "subscription", status: "pending", amount: 16.5 },
    { type: "subscription", status: "approved", amount: 40 },
    { type: "subscription", status: "available", amount: 120 },
    { type: "subscription", status: "paid", amount: 300 },
    { type: "subscription", status: "reversed", amount: 55 },
    { type: "subscription", status: "refunded", amount: 9 },
    { type: "bonus", status: "available", amount: 25 },
    { type: "refund", status: "available", amount: -7.5 },
    { type: "refund", status: "refunded", amount: -9 },
    { type: "adjustment", status: "cancelled", amount: 50 },
    { type: "payout", status: "paid", amount: -200 },
    { type: "payout", status: "processing", amount: -60 },
    { type: "payout", status: "pending", amount: -15 },
    { type: "payout", status: "cancelled", amount: -500 },
  ]
  const b = ledgerBalances(entries)
  const counted = entries.filter((e) => countsTowardBalance(e.type, e.status)).reduce((s, e) => s + e.amount, 0)
  assert.equal(Math.round(counted * 100) / 100, Math.round((b.available + b.pending) * 100) / 100)
  assert.equal(countsTowardBalance("payout", "cancelled"), false)
  assert.equal(countsTowardBalance("subscription", "reversed"), false)
})

test("balance history: one point per day ending on today's balance; a change only against a real balance", () => {
  const now = new Date(NOW)
  const t = balanceTrend(
    [
      { day: "2026-01-10", amount: 100 }, // long before the window
      { day: "2026-09-03", amount: 20 }, // exactly 30 days ago: part of the opening balance
      { day: "2026-09-20", amount: 80 },
      { day: "2026-09-20", amount: -50 }, // same day, summed
      { day: "2026-10-03", amount: 30 }, // today
    ],
    now
  )
  assert.equal(t.points.length, 31)
  assert.equal(t.points[0].day, "2026-09-03")
  assert.equal(t.points[30].day, "2026-10-03")
  assert.equal(t.start, 120)
  assert.equal(t.points.find((p) => p.day === "2026-09-19")!.total, 120)
  assert.equal(t.points.find((p) => p.day === "2026-09-20")!.total, 150)
  assert.equal(t.end, 180)
  assert.equal(t.change, 0.5)

  // nothing 30 days ago: no percentage (never "infinite growth")
  const fresh = balanceTrend([{ day: "2026-10-01", amount: 11 }], now)
  assert.deepEqual([fresh.start, fresh.end, fresh.change], [0, 11, null])
  // no ledger at all: a flat line at zero
  const empty = balanceTrend([], now)
  assert.equal(empty.points.every((p) => p.total === 0), true)
  assert.equal(empty.change, null)
  // a row dated just past "today" still belongs to the balance
  const ahead = balanceTrend([{ day: "2026-09-01", amount: 10 }, { day: "2026-10-04", amount: 5 }], now)
  assert.equal(ahead.end, 15)
  // a balance that fell
  const down = balanceTrend([{ day: "2026-08-01", amount: 200 }, { day: "2026-09-25", amount: -150 }], now)
  assert.equal(down.change, -0.75)
  // shorter windows
  assert.equal(balanceTrend([], now, 7).points.length, 8)
})
