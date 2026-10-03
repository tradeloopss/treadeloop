import { test } from "node:test"
import assert from "node:assert/strict"
import { CODE_TTL_MS, MAX_CODES_PER_HOUR, MAX_CODE_ATTEMPTS, RESEND_AFTER_MS, cleanCode, codeLive, isCode, issueProblem, issueProblemText, methodSubject, payoutSubject, wrongCodeText } from "@/lib/affiliates/action-code-rules"
import { DEFAULT_PAYOUT_SETTINGS, normalizePayoutSettings } from "@/lib/affiliates/payout-engine"
import { totpMatches } from "@/lib/affiliates/totp"
import { verificationCode } from "@/lib/emails/affiliate-emails"
import { renderEmail } from "@/lib/emails/layout"

// The verification code in front of a payout and a new payout method: what a
// code is, how long it lives, how many tries and how many codes there are, and
// what it is tied to.

const NOW = new Date("2026-10-03T12:00:00Z")
const ago = (ms: number) => new Date(NOW.getTime() - ms)

test("the setting: on by default, and only a real boolean switches it off", () => {
  assert.equal(DEFAULT_PAYOUT_SETTINGS.confirmCode, true)
  assert.equal(normalizePayoutSettings({}).confirmCode, true) // settings saved before this existed
  assert.equal(normalizePayoutSettings({ confirmCode: false }).confirmCode, false)
  for (const junk of ["false", 0, null, undefined, "no"]) assert.equal(normalizePayoutSettings({ confirmCode: junk }).confirmCode, true, String(junk))
})

test("a code is six digits, however it was typed or pasted", () => {
  assert.equal(cleanCode("123 456"), "123456")
  assert.equal(cleanCode(" 12-34-56 "), "123456")
  assert.equal(cleanCode("1234567890"), "123456")
  assert.equal(cleanCode("abc"), "")
  assert.equal(cleanCode(null), "")
  assert.equal(cleanCode(482915), "482915")
  assert.ok(isCode("000000") && isCode("482915"))
  for (const bad of ["", "12345", "1234567", "12345a", " 123456"]) assert.ok(!isCode(bad), bad)
})

test("a code is tied to what it was asked for", () => {
  assert.equal(payoutSubject(12, 10), "12:10.00")
  assert.equal(payoutSubject(12, 10.5), "12:10.50")
  assert.notEqual(payoutSubject(12, 10), payoutSubject(12, 10.01)) // another amount
  assert.notEqual(payoutSubject(12, 10), payoutSubject(13, 10)) // another destination
  assert.equal(methodSubject("crypto_trc20"), "crypto_trc20")
  assert.notEqual(methodSubject("paypal"), methodSubject("crypto_trc20"))
})

test("a code lives ten minutes, five tries, one use", () => {
  assert.equal(CODE_TTL_MS, 10 * 60_000)
  assert.equal(MAX_CODE_ATTEMPTS, 5)
  const fresh = { attempts: 0, expiresAt: new Date(NOW.getTime() + 1000), usedAt: null }
  assert.equal(codeLive(fresh, NOW), true)
  assert.equal(codeLive({ ...fresh, attempts: 4 }, NOW), true)
  assert.equal(codeLive({ ...fresh, attempts: 5 }, NOW), false) // out of tries
  assert.equal(codeLive({ ...fresh, expiresAt: NOW }, NOW), false) // expired
  assert.equal(codeLive({ ...fresh, usedAt: ago(1) }, NOW), false) // spent
  assert.equal(wrongCodeText(1), "That code isn't right. 4 tries left.")
  assert.equal(wrongCodeText(4), "That code isn't right. 1 try left.")
  assert.equal(wrongCodeText(5), "Too many wrong codes. Ask for a new code.")
  assert.equal(wrongCodeText(9), "Too many wrong codes. Ask for a new code.")
})

test("asking for codes: one email every 30 seconds, eight an hour", () => {
  assert.equal(issueProblem([], "email", NOW), null)
  // an email was sent 10 seconds ago
  const soon = issueProblem([{ createdAt: ago(10_000) }], "email", NOW)
  assert.deepEqual([soon?.reason, soon?.retryAt.getTime()], ["wait", NOW.getTime() + RESEND_AFTER_MS - 10_000])
  assert.equal(issueProblemText(soon!, NOW), "You can ask for a new code in 20 seconds.")
  assert.equal(issueProblem([{ createdAt: ago(RESEND_AFTER_MS) }], "email", NOW), null)
  // an authenticator code costs nothing to ask for: no wait between them…
  assert.equal(issueProblem([{ createdAt: ago(1000) }], "app", NOW), null)
  // …but the hourly cap holds for both, counted over the last hour only
  const eight = Array.from({ length: MAX_CODES_PER_HOUR }, (_, i) => ({ createdAt: ago((i + 1) * 5 * 60_000) }))
  for (const channel of ["email", "app"] as const) {
    const capped = issueProblem(eight, channel, NOW)
    assert.equal(capped?.reason, "hour", channel)
    // free again an hour after the oldest of the eight
    assert.equal(capped?.retryAt.getTime(), eight[7].createdAt.getTime() + 3_600_000)
    assert.equal(issueProblemText(capped!, NOW), "Too many codes were requested. Try again in 20 minutes.")
  }
  assert.equal(issueProblem([...eight.slice(0, 7), { createdAt: ago(61 * 60_000) }], "email", NOW), null)
})

test("authenticator codes: the standard's own test values, with one step of clock drift", () => {
  // RFC 6238 appendix B (SHA-1, secret "12345678901234567890"), last six digits
  const secret = "12345678901234567890"
  const cases: [number, string][] = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ]
  for (const [seconds, code] of cases) assert.equal(totpMatches(secret, code, seconds * 1000, 0), true, `${seconds}`)
  // the code of the step before and after is accepted (a slightly-off clock); two steps away is not
  assert.equal(totpMatches(secret, "287082", (59 + 30) * 1000), true)
  assert.equal(totpMatches(secret, "287082", (59 - 30) * 1000), true)
  assert.equal(totpMatches(secret, "287082", (59 + 90) * 1000), false)
  assert.equal(totpMatches(secret, "287083", 59 * 1000), false)
  assert.equal(totpMatches(secret, "", 59 * 1000), false)
  assert.equal(totpMatches(secret, "28708", 59 * 1000), false)
  assert.equal(totpMatches("", "287082", 59 * 1000), false)
  assert.equal(totpMatches("another-secret", "287082", 59 * 1000), false)
})

test("the code email: from payments, the code in the body only, and what it is for", () => {
  const payout = verificationCode({ firstName: "Alex", code: "482915", minutes: 10, purpose: "payout", amount: "$420.00", method: "USDT · TRON (TRC-20)", destination: "TXYZ…8291" })
  assert.deepEqual([payout.template, payout.sender, payout.subject], ["payout-code", "payments", "Your TradeLoop payout verification code"])
  // a locked phone shows the subject and the preview line: the code is in neither
  assert.ok(!payout.subject.includes("482915") && !payout.preview.includes("482915"))
  const { html, text } = renderEmail(payout)
  for (const body of [html, text]) for (const word of ["482915", "$420.00", "TXYZ…8291", "10 minutes"]) assert.ok(body.includes(word), word)
  assert.ok(text.includes("TradeLoop will never ask you for it"))
  const method = verificationCode({ firstName: "Alex", code: "730164", minutes: 10, purpose: "method", method: "PayPal" })
  assert.deepEqual([method.template, method.subject], ["payout-method-code", "Your TradeLoop verification code"])
  const body = renderEmail(method).text
  assert.ok(body.includes("730164") && body.includes("PayPal") && !body.includes("Amount") && !/undefined|null/.test(body))
})
