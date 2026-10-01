import { test } from "node:test"
import assert from "node:assert/strict"
import { affiliateRef, applicationApproved, applicationDenied, applicationRef, emailPreviews, generalNotice, payoutDenied, payoutMethodChanged, payoutRequested, payoutSent, type PayoutFacts } from "@/lib/emails/affiliate-emails"
import { renderEmail } from "@/lib/emails/layout"
import { MAX_EMAIL_ATTEMPTS, retryDelayMs, senderAddress } from "@/lib/emails/policy"
import { couponAccess } from "@/lib/affiliates/engine"
import { DEFAULT_PROGRAM, normalizeProgram } from "@/lib/affiliates/types"

const NOW = new Date("2026-10-02T14:05:00Z")
const paypal: PayoutFacts = { id: 7, amount: 420, fee: 0, net: 420, method: "PayPal (a••••@example.com)" }
const usdt: PayoutFacts = { id: 8, amount: 420, fee: 0, net: 420, method: "Crypto — USDT (TRC-20) (TXYZ…8291)", crypto: { asset: "USDT", network: "TRON (TRC-20)", wallet: "TXYZ…8291", hash: "ab".repeat(32), explorerUrl: `https://tronscan.org/#/transaction/${"ab".repeat(32)}` } }

// ------------------------------------------------------------------ senders

test("affiliate emails come from affiliate@, payment emails from payments@ — never the no-reply address", () => {
  for (const k of ["AFFILIATE_FROM_EMAIL", "PAYMENTS_FROM_EMAIL"]) delete process.env[k]
  assert.equal(senderAddress("affiliate"), "TradeLoop Affiliates <affiliate@tradeloop.pro>")
  assert.equal(senderAddress("payments"), "TradeLoop Payments <payments@tradeloop.pro>")
  // configurable, by address only
  process.env.AFFILIATE_FROM_EMAIL = "partners@tradeloop.pro"
  process.env.PAYMENTS_FROM_EMAIL = " payouts@tradeloop.pro "
  assert.equal(senderAddress("affiliate"), "TradeLoop Affiliates <partners@tradeloop.pro>")
  assert.equal(senderAddress("payments"), "TradeLoop Payments <payouts@tradeloop.pro>")
  // anything that isn't a plain address falls back to the program's own sender
  for (const bad of ["", "not-an-address", "Evil <x@y.com>", "a@b", "x@y.com\nBcc: z@z.com"]) {
    process.env.PAYMENTS_FROM_EMAIL = bad
    assert.equal(senderAddress("payments"), "TradeLoop Payments <payments@tradeloop.pro>", JSON.stringify(bad))
  }
  for (const k of ["AFFILIATE_FROM_EMAIL", "PAYMENTS_FROM_EMAIL"]) delete process.env[k]

  const bySender = (id: string) => emailPreviews(NOW).find((p) => p.id === id)!.doc.sender
  for (const id of ["application-received", "application-approved", "application-denied"]) assert.equal(bySender(id), "affiliate", id)
  for (const id of ["payout-requested", "payout-approved", "payout-denied", "payout-sent", "crypto-payout-sent", "automatic-payout-sent", "payout-failed", "payout-method-changed", "wallet-changed"]) assert.equal(bySender(id), "payments", id)
  for (const p of emailPreviews(NOW)) {
    const from = senderAddress(p.doc.sender)
    assert.ok(/<(affiliate|payments)@tradeloop\.pro>$/.test(from) && !/noreply|support@|admin@/.test(from), p.id)
  }
})

// ---------------------------------------------------------------- templates

test("all twelve emails: the subject, a preview line, and nothing unfilled", () => {
  const previews = emailPreviews(NOW)
  assert.deepEqual(
    previews.map((p) => [p.id, p.doc.subject]),
    [
      ["application-received", "We received your TradeLoop Affiliate application"],
      ["application-approved", "You're approved — Welcome to the TradeLoop Affiliate Program"],
      ["application-denied", "Update regarding your TradeLoop Affiliate application"],
      ["payout-requested", "Your TradeLoop payout request has been received"],
      ["payout-approved", "Your TradeLoop payout has been approved"],
      ["payout-denied", "Update regarding your TradeLoop payout request"],
      ["payout-sent", "Your TradeLoop payout has been sent"],
      ["crypto-payout-sent", "Your TradeLoop USDT payout has been sent"],
      ["automatic-payout-sent", "Your TradeLoop automatic payout has been sent"],
      ["payout-failed", "Action required — Your TradeLoop payout could not be completed"],
      ["payout-method-changed", "Your TradeLoop payout method was changed"],
      ["wallet-changed", "Your TradeLoop crypto payout wallet was changed"],
    ]
  )
  for (const p of previews) {
    const { html, text } = renderEmail(p.doc)
    for (const body of [html, text]) {
      assert.ok(!/undefined|\bnull\b|NaN|\{\{|\}\}|\[object/.test(body), `${p.id}: something was left unfilled`)
      assert.ok(body.includes("Hello Alex,"), p.id)
      assert.ok(body.includes("Trading smarter. Journaling better."), p.id)
      assert.ok(body.includes("You are receiving this email because you have an account or affiliate relationship with TradeLoop."), p.id)
      for (const link of ["Affiliate Dashboard", "Support", "Payouts", "Manage Email Preferences", "Privacy Policy", "Terms"]) assert.ok(body.includes(link), `${p.id}: ${link}`)
    }
    assert.ok(p.doc.preview.length > 20 && html.includes(p.doc.preview.replace(/'/g, "&#39;")), `${p.id}: preview line`)
    // email-safe: a 640px table layout, inline styles only, the logo with alt text
    assert.ok(html.startsWith("<!doctype html>") && html.includes('width="640"') && html.includes('alt="TradeLoop"') && !/<style|<script|<link/i.test(html), p.id)
    assert.ok(html.includes(`© ${new Date().getUTCFullYear()} TradeLoop. All rights reserved.`), p.id)
    // every link goes to TradeLoop or the transaction's explorer page, over https
    for (const [, href] of html.matchAll(/href="([^"]+)"/g)) assert.ok(/^https:\/\/(app\.tradeloop\.pro|www\.tradeloop\.pro|tronscan\.org)\//.test(href), `${p.id}: ${href}`)
  }
})

test("sections that don't apply are left out, not left empty", () => {
  // a PayPal payout has no blockchain section; a USDT one does
  const plain = renderEmail(payoutSent({ firstName: "Alex", payout: paypal, completedAt: NOW }))
  for (const word of ["Network", "Wallet", "Transaction", "Asset", "TRC-20"]) assert.ok(!plain.html.includes(word) && !plain.text.includes(word), word)
  const crypto = renderEmail(payoutSent({ firstName: "Alex", payout: usdt, completedAt: NOW }))
  for (const word of ["Asset", "USDT", "Network", "TRON (TRC-20)", "Wallet", "TXYZ…8291", "Transaction", "ab".repeat(32), "View Transaction", "Your funds have been sent to your wallet"]) assert.ok(crypto.html.includes(word), word)
  assert.ok(crypto.html.includes("420.00 USDT"))
  // without a fee there is no fee row and no separate net row
  assert.ok(!plain.html.includes(">Fee<") && !plain.html.includes("Net Amount"))
  const fee = renderEmail(payoutSent({ firstName: "Alex", payout: { ...paypal, amount: 200, fee: 4.3, net: 195.7 }, completedAt: NOW }))
  for (const word of [">Fee<", "$4.30", "Net Amount", "$195.70", "$200.00"]) assert.ok(fee.html.includes(word), word)
  // a denial with no reason has no empty "Reason" box
  const noReason = renderEmail(payoutDenied({ firstName: "Alex", payout: paypal, reviewedAt: NOW, reason: null }))
  assert.ok(!noReason.html.includes("Reason") && !noReason.text.includes("REASON"))
  assert.ok(renderEmail(payoutDenied({ firstName: "Alex", payout: paypal, reviewedAt: NOW, reason: "The account is restricted." })).html.includes("The account is restricted."))
  // an asset that isn't dollar-pegged shows what was actually sent
  const ltc = renderEmail(payoutSent({ firstName: "Alex", payout: { ...usdt, crypto: { asset: "LTC", network: "Litecoin", wallet: "ltc1…n4n9", hash: null, explorerUrl: null, sent: "1.5 LTC" } }, completedAt: NOW }))
  assert.ok(ltc.html.includes("1.5 LTC") && ltc.html.includes("$420.00") && ltc.html.includes("View Payout") && !ltc.html.includes("View Transaction"))
  // an automatic payout says so, whatever the method
  assert.equal(payoutSent({ firstName: "Alex", payout: { ...paypal, automatic: true }, completedAt: NOW }).template, "automatic-payout-sent")
  assert.equal(payoutSent({ firstName: "Alex", payout: { ...usdt, automatic: true }, completedAt: NOW }).subject, "Your TradeLoop automatic payout has been sent")
  assert.equal(payoutRequested({ firstName: "Alex", payout: { ...paypal, automatic: true }, requestedAt: NOW }).badge.label, "Automatic payout created")
})

test("the approval email: the link only once they have one; ids are stable", () => {
  assert.deepEqual([applicationRef(128), affiliateRef(128)], ["APP-00128", "AFF-00128"])
  const ready = renderEmail(applicationApproved({ firstName: "Alex", affiliateId: 128, onboarded: true, link: "https://www.tradeloop.pro/?ref=alex" }))
  assert.ok(ready.html.includes("https://www.tradeloop.pro/?ref=alex") && ready.html.includes("Open Affiliate Dashboard") && ready.html.includes("AFF-00128"))
  const setup = renderEmail(applicationApproved({ firstName: "Alex", affiliateId: 128, onboarded: false, link: null }))
  assert.ok(!setup.html.includes("?ref=") && setup.html.includes("Finish Setup") && setup.html.includes("/affiliate/onboarding") && setup.html.includes("choose your referral code"))
})

test("whatever a person typed is shown as text, never as markup", () => {
  const nasty = `<script>alert(1)</script><img src=x onerror=alert(2)> "quoted" & 'single'`
  for (const doc of [applicationDenied({ firstName: nasty, affiliateId: 1, reviewedAt: NOW, reason: nasty }), payoutDenied({ firstName: "Alex", payout: { ...paypal, method: nasty }, reviewedAt: NOW, reason: nasty }), generalNotice({ firstName: "Alex", sender: "affiliate", title: nasty, body: nasty, href: "javascript:alert(1)" })]) {
    const { html } = renderEmail(doc)
    assert.ok(!/<script|<img src=x|onerror=alert\(2\)>/.test(html), doc.template)
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), doc.template)
    assert.ok(!html.includes('href="javascript:'), doc.template)
  }
  // a link that isn't ours isn't linked to
  assert.ok(!renderEmail(payoutSent({ firstName: "Alex", payout: { ...usdt, crypto: { ...usdt.crypto!, explorerUrl: "http://evil.example/x" } }, completedAt: NOW })).html.includes("evil.example"))
})

test("a wallet change is its own email, with the hold it starts", () => {
  const hold = new Date(NOW.getTime() + 24 * 3_600_000)
  const wallet = payoutMethodChanged({ firstName: "Alex", method: "Crypto — USDT (TRC-20)", destination: "TXYZ…8291", changed: true, changedAt: NOW, holdUntil: hold, crypto: { asset: "USDT", network: "TRON (TRC-20)" } })
  assert.deepEqual([wallet.template, wallet.subject], ["wallet-changed", "Your TradeLoop crypto payout wallet was changed"])
  const html = renderEmail(wallet).html
  for (const word of ["TXYZ…8291", "TRON (TRC-20)", "Secure My Account", "Oct 3, 2026"]) assert.ok(html.includes(word), word)
  const first = payoutMethodChanged({ firstName: "Alex", method: "PayPal", destination: "a••••@example.com", changed: false, changedAt: NOW, holdUntil: null })
  assert.deepEqual([first.template, first.subject, first.badge.label], ["payout-method-changed", "A payout method was added to your TradeLoop account", "Payout method added"])
  assert.ok(!renderEmail(first).html.includes("Security hold")) // no hold → no hold section
})

// -------------------------------------------------------------------- retry

test("a failed delivery is retried further apart each time, then given up on", () => {
  assert.equal(MAX_EMAIL_ATTEMPTS, 6)
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => retryDelayMs(n) / 60_000), [1, 5, 30, 120, 360])
  assert.equal(retryDelayMs(0), 60_000)
  assert.equal(retryDelayMs(99), 360 * 60_000)
})

// ------------------------------------------------------------------ coupons

test("the Coupons section is closed unless an admin opened it for that affiliate", () => {
  const program = { couponsEnabled: true, maxCouponPercent: 30 }
  // the default for every affiliate
  assert.deepEqual(couponAccess({ couponsEnabled: false, maxCouponPercent: null }, program), { enabled: false, maxPercent: 30 })
  assert.deepEqual(couponAccess({ couponsEnabled: true, maxCouponPercent: null }, program), { enabled: true, maxPercent: 30 })
  // their own ceiling wins over the program's, either way
  assert.deepEqual(couponAccess({ couponsEnabled: true, maxCouponPercent: 95 }, program), { enabled: true, maxPercent: 95 })
  assert.equal(couponAccess({ couponsEnabled: true, maxCouponPercent: 10 }, program).maxPercent, 10)
  assert.equal(couponAccess({ couponsEnabled: true, maxCouponPercent: 500 }, program).maxPercent, 100)
  assert.equal(couponAccess({ couponsEnabled: true, maxCouponPercent: 0 }, program).maxPercent, 30)
  // the program switch still closes it for everyone
  assert.equal(couponAccess({ couponsEnabled: true, maxCouponPercent: 95 }, { ...program, couponsEnabled: false }).enabled, false)
})

test("the permanent code: 20% by default, configurable, and can be switched off", () => {
  assert.deepEqual([DEFAULT_PROGRAM.permanentCouponPercent, DEFAULT_PROGRAM.permanentCouponMonths], [20, 1])
  // settings saved before this existed pick up the defaults
  assert.deepEqual([normalizeProgram({ defaultRate: 30 }).permanentCouponPercent, normalizeProgram({}).permanentCouponMonths], [20, 1])
  assert.deepEqual([normalizeProgram({ permanentCouponPercent: 0 }).permanentCouponPercent, normalizeProgram({ permanentCouponPercent: 250 }).permanentCouponPercent, normalizeProgram({ permanentCouponPercent: 12.6 }).permanentCouponPercent], [0, 100, 13])
  assert.deepEqual([normalizeProgram({ permanentCouponMonths: 0 }).permanentCouponMonths, normalizeProgram({ permanentCouponMonths: 99 }).permanentCouponMonths], [1, 12])
})
