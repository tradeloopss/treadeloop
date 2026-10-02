import { test } from "node:test"
import assert from "node:assert/strict"
import { MESSAGE_MAX, SUPPORT_CATEGORIES, SUPPORT_LIMITS, categoryLabel, cleanPage, emailValid, looksAutomated, messageProblem, rateLimited, readSupportRequest, ticketIdFromRef, ticketRef, ticketSubject } from "@/lib/support/request"
import { renderEmail } from "@/lib/emails/layout"
import { senderAddress, supportInbox } from "@/lib/emails/policy"
import { supportReply, supportRequestNotification, supportRequestReceived } from "@/lib/emails/support-emails"

// The Contact Support window's rules and emails. (What happens to a request in
// the database — the ticket, the rate limit, the outbox — is covered against a
// real Postgres in the integration suite.)

const ok = { category: "payout", message: "I requested a payout but haven't received it yet.", email: "User@Example.com", name: "  John   Doe " }

test("a valid request: trimmed, email lower-cased, name tidied", () => {
  const r = readSupportRequest({ ...ok, page: "affiliate.tradeloop.pro/payouts?token=abc#x" })
  assert.deepEqual(r, { ok: true, value: { category: "payout", message: "I requested a payout but haven't received it yet.", email: "user@example.com", name: "John Doe", page: "affiliate.tradeloop.pro/payouts" } })
  // the name is optional
  const anon = readSupportRequest({ ...ok, name: "" })
  assert.equal(anon.ok && anon.value.name, null)
})

test("what is wrong with a request, one field at a time", () => {
  const bad = (over: Record<string, unknown>) => {
    const r = readSupportRequest({ ...ok, ...over })
    return r.ok ? null : [r.field, r.error]
  }
  assert.deepEqual(bad({ category: "" }), ["category", "Please select a subject."])
  assert.deepEqual(bad({ category: "vip" }), ["category", "Please select a subject."])
  assert.deepEqual(bad({ message: "   " }), ["message", "Please describe your issue."])
  assert.deepEqual(bad({ message: "help" }), ["message", "Please describe your issue in a little more detail."])
  assert.deepEqual(bad({ message: "x".repeat(MESSAGE_MAX + 1) }), ["message", "Your message must be 2,000 characters or fewer."])
  assert.equal(bad({ message: "x".repeat(MESSAGE_MAX) }), null) // exactly at the limit is fine
  for (const email of ["", "user", "user@", "user@example", "a b@example.com", "user@example.com, other@example.com", "<user@example.com>"]) assert.deepEqual(bad({ email }), ["email", "Please enter a valid email address."], email)
  assert.deepEqual(bad({ name: "n".repeat(81) }), ["name", "Keep your name under 80 characters."])
  assert.equal(emailValid("first.last+tag@sub.example.co"), true)
  // the same message check the form uses while typing
  assert.equal(messageProblem("A perfectly reasonable question."), null)
})

test("what is stored is plain text: control characters dropped, line breaks kept", () => {
  const r = readSupportRequest({ ...ok, message: "Line one\r\nLine two\u0000\u0007 <script>alert(1)</script>" })
  assert.equal(r.ok && r.value.message, "Line one\nLine two <script>alert(1)</script>") // escaped wherever it is shown, never run
})

test("the page a request came from: a host and a path, never a query string", () => {
  assert.equal(cleanPage("www.tradeloop.pro/pricing"), "www.tradeloop.pro/pricing")
  assert.equal(cleanPage("localhost:3000/affiliate/apply"), "localhost:3000/affiliate/apply")
  assert.equal(cleanPage("app.tradeloop.pro/reset-password?token=SECRET"), "app.tradeloop.pro/reset-password")
  for (const bad of ["", "javascript:alert(1)", "www.tradeloop.pro", `www.tradeloop.pro/"><script>`, `x/${"a".repeat(300)}`, null]) assert.equal(cleanPage(bad), null, String(bad))
})

test("a form filled in by a script is recognised by the field no person sees", () => {
  assert.equal(looksAutomated({ ...ok }), false)
  assert.equal(looksAutomated({ ...ok, company: "" }), false)
  assert.equal(looksAutomated({ ...ok, company: "Acme Ltd" }), true)
})

test("subjects: the fourteen categories, and the line a ticket is listed by", () => {
  assert.deepEqual(SUPPORT_CATEGORIES.map((c) => c.label), ["Account & Profile", "Billing & Subscription", "Affiliate Program", "Payout", "Trading Account", "Trade Manager", "Prop Firm Tracker", "Backtesting", "Technical Issue", "Bug Report", "Feature Request", "Data / Sync", "Security", "Other"])
  assert.equal(categoryLabel("sync"), "Data / Sync")
  assert.equal(categoryLabel("nope"), "Support")
  assert.equal(ticketSubject("payout", "I requested a payout but haven't received it.\nMore detail here."), "Payout: I requested a payout but haven't received it.")
  const long = ticketSubject("billing", "word ".repeat(60))
  assert.ok(long.startsWith("Billing & Subscription: word word") && long.endsWith("…") && long.length <= 140)
})

test("ticket numbers: SUP-10291 for the customer, an id for the database", () => {
  assert.equal(ticketRef(291), "SUP-10291")
  assert.equal(ticketRef(1), "SUP-10001")
  for (const text of ["SUP-10291", "#SUP-10291", "sup-10291", "sup10291", "10291", "  #SUP-10291 "]) assert.equal(ticketIdFromRef(text), 291, text)
  for (const text of ["", "SUP-", "SUP-9999", "payout", "user@example.com", "SUP-10291x"]) assert.equal(ticketIdFromRef(text), null, text)
})

test("rate limit: a few requests an hour, more in a day, per sender and per network", () => {
  const none = { hour: 0, day: 0, ipHour: 0, ipDay: 0 }
  assert.equal(rateLimited(none), false)
  assert.equal(rateLimited({ ...none, hour: SUPPORT_LIMITS.perHour - 1, day: SUPPORT_LIMITS.perDay - 1 }), false)
  assert.equal(rateLimited({ ...none, hour: SUPPORT_LIMITS.perHour }), true)
  assert.equal(rateLimited({ ...none, day: SUPPORT_LIMITS.perDay }), true)
  // many addresses from one network
  assert.equal(rateLimited({ ...none, ipHour: SUPPORT_LIMITS.ipPerHour }), true)
  assert.equal(rateLimited({ ...none, ipDay: SUPPORT_LIMITS.ipPerDay }), true)
})

// ---------------------------------------------------------------------- emails

const facts = { ticketId: 291, ref: "SUP-10291", category: "Payout", message: "I requested a payout but haven't received it.\n<b>Thanks</b>", name: "John Doe", email: "user@example.com", signedIn: false, submittedAt: new Date("2026-10-02T09:30:00Z") }

test("support emails come from TradeLoop Support, and requests go to the support inbox", () => {
  const before = { from: process.env.SUPPORT_FROM_EMAIL, to: process.env.SUPPORT_EMAIL }
  try {
    delete process.env.SUPPORT_FROM_EMAIL
    delete process.env.SUPPORT_EMAIL
    assert.equal(senderAddress("support"), "TradeLoop Support <support@tradeloop.pro>")
    assert.equal(supportInbox(), "support@tradeloop.pro")
    // never the affiliate or payments senders
    for (const doc of [supportRequestReceived(facts), supportRequestNotification({ ...facts, account: null, page: null, priority: false }), supportReply({ ticketId: 291, ref: "SUP-10291", subject: "Payout: …", reply: "Hi", name: null, signedIn: false })]) assert.equal(doc.sender, "support", doc.template)
    assert.notEqual(senderAddress("support"), senderAddress("affiliate"))
    assert.notEqual(senderAddress("support"), senderAddress("payments"))
    // configurable in one place; junk falls back to the real address
    process.env.SUPPORT_EMAIL = "help@tradeloop.pro"
    process.env.SUPPORT_FROM_EMAIL = "help@tradeloop.pro"
    assert.deepEqual([supportInbox(), senderAddress("support")], ["help@tradeloop.pro", "TradeLoop Support <help@tradeloop.pro>"])
    process.env.SUPPORT_EMAIL = "not an address"
    assert.equal(supportInbox(), "support@tradeloop.pro")
  } finally {
    for (const [k, v] of [["SUPPORT_FROM_EMAIL", before.from], ["SUPPORT_EMAIL", before.to]] as const) v == null ? delete process.env[k] : (process.env[k] = v)
  }
})

test("the confirmation: ticket, subject, the message as typed — and no link to a page that doesn't exist", () => {
  const doc = supportRequestReceived(facts)
  assert.equal(doc.subject, "We received your TradeLoop support request")
  const { html, text } = renderEmail(doc)
  for (const part of ["Hi John,", "#SUP-10291", "Payout", "I requested a payout but haven't received it.", "TradeLoop Support"]) assert.ok(text.includes(part), part)
  // what the customer typed is shown, never run
  assert.ok(html.includes("&lt;b&gt;Thanks&lt;/b&gt;") && !html.includes("<b>Thanks</b>"))
  // without an account there is no request page: the email says to reply instead
  assert.ok(text.includes("You can reply to this email") && !html.includes("/support/291"))
  // with one, it links to the request in the app
  const mine = renderEmail(supportRequestReceived({ ...facts, signedIn: true }))
  assert.ok(mine.html.includes('href="https://app.tradeloop.pro/support/291"') && !mine.text.includes("You can reply to this email"))
  // support's footer is its own: nothing about the affiliate portal
  assert.ok(!html.includes("/affiliate") && !html.includes("Affiliate Dashboard") && html.includes("because a support request was sent to TradeLoop with this address"))
  // only our own https links
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) assert.ok(/^https:\/\/(app|www|help)\.tradeloop\.pro(\/|$)/.test(href), href)
  assert.equal(supportRequestReceived({ ...facts, name: null }).greeting, "Hi there,")
})

test("the notification to the team: who, what, where from — and a way to open it", () => {
  const doc = supportRequestNotification({ ...facts, account: "TradeLoop account · Pro plan", page: "affiliate.tradeloop.pro/payouts", priority: false })
  assert.equal(doc.subject, "[TradeLoop Support] Payout — SUP-10291")
  const { html, text } = renderEmail(doc)
  for (const part of ["Ticket: #SUP-10291", "Category: Payout", "Name: John Doe", "Email: user@example.com", "Account: TradeLoop account · Pro plan", "Page: affiliate.tradeloop.pro/payouts", "Submitted: October 2, 2026", "I requested a payout"]) assert.ok(text.includes(part), part)
  assert.ok(html.includes('href="https://app.tradeloop.pro/admin/support/291"'))
  // someone without an account
  assert.ok(renderEmail(supportRequestNotification({ ...facts, account: null, page: null, priority: false })).text.includes("Account: Not signed in"))
  assert.equal(supportRequestNotification({ ...facts, account: null, page: null, priority: true }).badge.label, "Priority request")
})

test("the team's reply reaches the customer with the ticket number", () => {
  const doc = supportReply({ ticketId: 291, ref: "SUP-10291", subject: "Payout: I requested a payout", reply: "We've sent it now.\nSorry for the wait.", name: "John Doe", signedIn: false })
  assert.equal(doc.subject, "Re: Payout: I requested a payout [SUP-10291]")
  const { text } = renderEmail(doc)
  assert.ok(text.includes("We've sent it now.") && text.includes("You can reply to this email to continue the conversation."))
  assert.ok(renderEmail(supportReply({ ticketId: 291, ref: "SUP-10291", subject: "x", reply: "y", name: null, signedIn: true })).html.includes("/support/291"))
})
