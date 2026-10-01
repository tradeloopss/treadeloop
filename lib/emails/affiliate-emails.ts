import { appUrl, siteUrl, type Block, type EmailDoc, type Sender } from "./layout"

// The affiliate program's transactional emails, as data. Each function takes
// the facts of one event and returns an EmailDoc (layout.ts renders it). Pure:
// previews and tests call these with sample data, the live code with real data.
//
// Senders: everything about the application and the affiliate account comes
// from TradeLoop Affiliates; everything about money — payouts, payout methods,
// wallets — from TradeLoop Payments.

const money = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(v)
const when = (d: Date | null | undefined) => (d ? `${d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC` : null)
const hello = (firstName: string) => `Hello ${firstName.trim() || "there"},`
const shortHash = (hash: string) => (hash.length > 18 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash)

export const applicationRef = (affiliateId: number) => `APP-${String(affiliateId).padStart(5, "0")}`
export const affiliateRef = (affiliateId: number) => `AFF-${String(affiliateId).padStart(5, "0")}`
export const payoutRef = (payoutId: number) => `PO-${payoutId}`

const AFFILIATE_TEAM = "TradeLoop Affiliate Team"
const PAYMENTS_TEAM = "TradeLoop Payments"

// --- Application ----------------------------------------------------------------

export function applicationReceived(d: { firstName: string; affiliateId: number; submittedAt: Date; channel: string | null }): EmailDoc {
  return {
    template: "application-received",
    sender: "affiliate",
    subject: "We received your TradeLoop Affiliate application",
    preview: "Your application has been received and is now under review.",
    badge: { label: "Application received", tone: "info" },
    headline: "Your application is under review",
    greeting: hello(d.firstName),
    intro: ["Thank you for applying to the TradeLoop Affiliate Program.", "We've successfully received your application and our team will review the information you provided."],
    blocks: [
      { kind: "info", title: "Application details", rows: [["Application ID", applicationRef(d.affiliateId)], ["Submitted", when(d.submittedAt)], ["Website / Channel", d.channel], ["Application Status", "Under Review"]] },
      { kind: "notice", title: "What happens next?", lines: ["Our team will review your application and the information you provided.", "If additional information is required, we'll contact you by email."] },
      { kind: "cta", label: "View Affiliate Dashboard", url: appUrl("/affiliate") },
    ],
    closing: ["Thank you for your interest in partnering with TradeLoop."],
    signature: AFFILIATE_TEAM,
  }
}

export function applicationApproved(d: { firstName: string; affiliateId: number; link: string | null; onboarded: boolean }): EmailDoc {
  return {
    template: "application-approved",
    sender: "affiliate",
    subject: "You're approved — Welcome to the TradeLoop Affiliate Program",
    preview: "Your TradeLoop affiliate account is now active.",
    badge: { label: "Application approved", tone: "success" },
    headline: "Welcome to TradeLoop",
    greeting: hello(d.firstName),
    intro: [
      "Great news — your application to the TradeLoop Affiliate Program has been approved.",
      d.onboarded ? "Your affiliate account is now active and you can start sharing your referral link and earning commissions." : "Your affiliate account is now active. Finish the short setup to choose your referral code and get your link — then you can start earning commissions.",
    ],
    blocks: [
      { kind: "info", rows: [["Affiliate ID", affiliateRef(d.affiliateId)], ["Status", "Approved"]] },
      // The link only exists once they have chosen their code.
      { kind: "code", label: "Your affiliate link", value: d.onboarded ? d.link : null },
      {
        kind: "steps",
        title: "Next steps",
        items: [...(d.onboarded ? [] : ["Finish setting up your account and choose your referral code"]), "Share your affiliate link", "Send qualified users to TradeLoop", "Track clicks, signups and conversions", "Earn eligible commissions", "Receive payouts through your selected payout method"],
      },
      { kind: "cta", label: d.onboarded ? "Open Affiliate Dashboard" : "Finish Setup", url: appUrl(d.onboarded ? "/affiliate" : "/affiliate/onboarding") },
    ],
    signature: AFFILIATE_TEAM,
  }
}

export function applicationDenied(d: { firstName: string; affiliateId: number; reviewedAt: Date; reason: string | null }): EmailDoc {
  return {
    template: "application-denied",
    sender: "affiliate",
    subject: "Update regarding your TradeLoop Affiliate application",
    preview: "We've completed our review of your affiliate application.",
    badge: { label: "Application not approved", tone: "neutral" },
    headline: "An update on your application",
    greeting: hello(d.firstName),
    intro: ["Thank you for your interest in the TradeLoop Affiliate Program.", "We've completed our review of your application. At this time, we're unable to approve your application."],
    blocks: [
      { kind: "info", rows: [["Application ID", applicationRef(d.affiliateId)], ["Reviewed", when(d.reviewedAt)], ["Status", "Not Approved"]] },
      { kind: "notice", title: "Review message", lines: [d.reason] },
      { kind: "text", lines: ["We appreciate your interest in TradeLoop.", "Depending on the reason for the decision, you may be able to submit a new application in the future."] },
      { kind: "cta", label: "View Application", url: appUrl("/affiliate/apply") },
    ],
    signature: AFFILIATE_TEAM,
  }
}

// --- Payouts --------------------------------------------------------------------

export type PayoutFacts = {
  id: number
  amount: number
  fee: number
  net: number
  // "PayPal (e•••@example.com)" — the method and its masked destination
  method: string
  // true when the worker created it on schedule rather than the affiliate asking
  automatic?: boolean
  // present for a crypto payout only; the other methods have no such section
  crypto?: {
    asset: string
    network: string // "TRON (TRC-20)"
    wallet: string // masked
    hash?: string | null
    explorerUrl?: string | null
    // the exact amount of the asset that was sent, when that differs from the dollar figure ("1.5 LTC")
    sent?: string | null
  } | null
}

const payoutRows = (p: PayoutFacts, last: [string, string | null]): [string, string | null][] => [
  ["Payout ID", payoutRef(p.id)],
  ["Amount", money(p.amount)],
  // "Fee: $0.00" is noise; the fee row and the net row appear when there is one.
  ["Fee", p.fee > 0 ? money(p.fee) : null],
  ["Net Amount", p.fee > 0 ? money(p.net) : null],
  ["Payout Method", p.method],
  last,
]

const cryptoRows = (p: PayoutFacts, fullHash = false): [string, string | null][] =>
  p.crypto ? [["Asset", p.crypto.asset], ["Network", p.crypto.network], ["Wallet", p.crypto.wallet], ["Transaction", p.crypto.hash ? (fullHash ? p.crypto.hash : shortHash(p.crypto.hash)) : null]] : []

const viewPayout: Block = { kind: "cta", label: "View Payout", url: appUrl("/affiliate/payouts") }

export function payoutRequested(d: { firstName: string; payout: PayoutFacts; requestedAt: Date; sending?: boolean }): EmailDoc {
  const auto = !!d.payout.automatic
  return {
    template: "payout-requested",
    sender: "payments",
    subject: auto ? "Your TradeLoop automatic payout has been created" : "Your TradeLoop payout request has been received",
    preview: auto ? "An automatic payout of your affiliate earnings has been created." : "We've received your payout request and it's now being processed.",
    badge: { label: auto ? "Automatic payout created" : "Payout requested", tone: "info" },
    headline: auto ? "Your automatic payout is on its way" : "We've received your payout request",
    greeting: hello(d.firstName),
    intro: auto
      ? ["An automatic payout of your affiliate earnings has been created.", "It is now being processed according to the TradeLoop payout policy."]
      : ["We've received your payout request.", "Your request has been successfully created and is now being processed according to the TradeLoop payout policy."],
    blocks: [
      { kind: "info", title: "Payout details", rows: [...payoutRows(d.payout, [auto ? "Created" : "Requested", when(d.requestedAt)]), ["Status", d.sending ? "Being sent" : "Pending"]] },
      {
        kind: "notice",
        title: "What happens next?",
        lines: d.sending
          ? ["Your payout was approved and is being sent to your wallet now.", "We'll send you another email with the transaction details as soon as the network confirms it."]
          : ["Your payout will go through the required validation and approval process.", "Once the payout is approved and sent, we'll send you another email with the transaction details."],
      },
      viewPayout,
    ],
    signature: PAYMENTS_TEAM,
  }
}

export function payoutApproved(d: { firstName: string; payout: PayoutFacts; approvedAt: Date }): EmailDoc {
  return {
    template: "payout-approved",
    sender: "payments",
    subject: "Your TradeLoop payout has been approved",
    preview: "Your payout has been approved and is being prepared for delivery.",
    badge: { label: "Payout approved", tone: "success" },
    headline: "Your payout has been approved",
    greeting: hello(d.firstName),
    intro: ["Your TradeLoop affiliate payout has been approved.", "The payout is now being prepared for processing."],
    blocks: [
      { kind: "info", title: "Payout details", rows: payoutRows(d.payout, ["Approved", when(d.approvedAt)]) },
      { kind: "notice", title: "Next step", lines: ["Your payout is now being processed.", "Once the funds have been successfully sent, you'll receive a confirmation email containing the transaction details."] },
      viewPayout,
    ],
    signature: PAYMENTS_TEAM,
  }
}

export function payoutDenied(d: { firstName: string; payout: PayoutFacts; reviewedAt: Date; reason: string | null }): EmailDoc {
  return {
    template: "payout-denied",
    sender: "payments",
    subject: "Update regarding your TradeLoop payout request",
    preview: "There is an update regarding your recent payout request.",
    badge: { label: "Payout not approved", tone: "danger" },
    headline: "We couldn't approve this payout",
    greeting: hello(d.firstName),
    intro: ["We've reviewed your payout request and, at this time, we're unable to process it."],
    blocks: [
      { kind: "info", title: "Payout details", rows: [["Payout ID", payoutRef(d.payout.id)], ["Requested Amount", money(d.payout.amount)], ["Payout Method", d.payout.method], ["Reviewed", when(d.reviewedAt)]] },
      { kind: "notice", title: "Reason", lines: [d.reason] },
      { kind: "text", lines: ["The amount associated with this payout request has been returned to your available affiliate balance."] },
      { kind: "cta", label: "Contact Support", url: appUrl("/affiliate/support") },
    ],
    signature: PAYMENTS_TEAM,
  }
}

// One "sent" email per payout, in the form that fits it: a crypto payout gets
// the wallet-and-transaction email; an automatic payout by another method says
// it was automatic; the rest get the plain "payout sent".
export function payoutSent(d: { firstName: string; payout: PayoutFacts; completedAt: Date }): EmailDoc {
  const p = d.payout
  if (p.crypto) return cryptoPayoutSent(d)
  if (p.automatic) return automaticPayoutSent(d)
  return {
    template: "payout-sent",
    sender: "payments",
    subject: "Your TradeLoop payout has been sent",
    preview: "Your affiliate earnings have been sent to your selected payout destination.",
    badge: { label: "Payout sent", tone: "success" },
    headline: "Your payout has been sent",
    greeting: hello(d.firstName),
    intro: ["Your TradeLoop affiliate payout has been successfully sent.", "Your funds are now on their way to your selected payout destination."],
    blocks: [{ kind: "amount", label: "Amount", value: money(p.net) }, { kind: "info", title: "Payout details", rows: payoutRows(p, ["Completed", when(d.completedAt)]) }, viewPayout],
    signature: PAYMENTS_TEAM,
  }
}

function cryptoPayoutSent(d: { firstName: string; payout: PayoutFacts; completedAt: Date }): EmailDoc {
  const p = d.payout
  const c = p.crypto!
  const amount = c.sent ?? `${p.net.toFixed(2)} ${c.asset}`
  return {
    template: p.automatic ? "automatic-payout-sent" : "crypto-payout-sent",
    sender: "payments",
    subject: p.automatic ? "Your TradeLoop automatic payout has been sent" : `Your TradeLoop ${c.asset} payout has been sent`,
    preview: p.automatic ? "Your affiliate earnings have been automatically sent to your selected payout method." : "Your affiliate earnings have been sent to your wallet.",
    badge: { label: p.automatic ? "Automatic payout sent" : "Payout sent", tone: "success" },
    headline: "Your funds have been sent to your wallet",
    greeting: hello(d.firstName),
    intro: [p.automatic ? "Your automatic TradeLoop affiliate payout has been successfully processed." : "Your TradeLoop affiliate payout has been successfully sent to your wallet."],
    blocks: [
      { kind: "amount", label: "Amount", value: amount, note: c.sent ? money(p.net) : null },
      { kind: "info", title: "Transaction", rows: [["Payout ID", payoutRef(p.id)], ...cryptoRows(p, true), ["Fee", p.fee > 0 ? money(p.fee) : null], ["Completed", when(d.completedAt)], ["Status", "Confirmed"]] },
      ...(c.explorerUrl ? [{ kind: "cta", label: "View Transaction", url: c.explorerUrl } as Block] : [viewPayout]),
      { kind: "warning", title: "Important", lines: [`Always verify that your wallet supports ${c.asset} on the ${c.network} network.`, "Depending on your wallet or exchange, it may take a few more confirmations before the funds show in your balance."] },
    ],
    signature: PAYMENTS_TEAM,
  }
}

function automaticPayoutSent(d: { firstName: string; payout: PayoutFacts; completedAt: Date }): EmailDoc {
  const p = d.payout
  return {
    template: "automatic-payout-sent",
    sender: "payments",
    subject: "Your TradeLoop automatic payout has been sent",
    preview: "Your affiliate earnings have been automatically sent to your selected payout method.",
    badge: { label: "Automatic payout sent", tone: "success" },
    headline: "Your automatic payout has been sent",
    greeting: hello(d.firstName),
    intro: ["Your automatic TradeLoop affiliate payout has been successfully processed.", "Your funds have been sent to your selected payout destination."],
    blocks: [{ kind: "amount", label: "Amount", value: money(p.net) }, { kind: "info", title: "Payout details", rows: payoutRows(p, ["Completed", when(d.completedAt)]) }, viewPayout],
    signature: PAYMENTS_TEAM,
  }
}

export function payoutFailed(d: { firstName: string; payout: PayoutFacts; reason: string | null }): EmailDoc {
  return {
    template: "payout-failed",
    sender: "payments",
    subject: "Action required — Your TradeLoop payout could not be completed",
    preview: "We couldn't complete your recent payout.",
    badge: { label: "Payout failed", tone: "danger" },
    headline: "Your payout could not be completed",
    greeting: hello(d.firstName),
    intro: ["We were unable to complete your recent TradeLoop payout."],
    blocks: [
      { kind: "info", title: "Payout details", rows: [["Payout ID", payoutRef(d.payout.id)], ["Amount", money(d.payout.amount)], ["Method", d.payout.method]] },
      { kind: "notice", title: "What happened?", lines: [d.reason] },
      { kind: "text", lines: ["If action is required, please review your payout method and update any incorrect information.", "The amount is back in your available balance, and you can request it again once the issue is resolved."] },
      { kind: "cta", label: "Review Payout Method", url: appUrl("/affiliate/payouts") },
    ],
    signature: PAYMENTS_TEAM,
  }
}

// The remaining changes an affiliate should hear about by email: a payout put
// on hold, cancelled, or returned after it was sent.
export function payoutUpdate(d: { firstName: string; payout: PayoutFacts; status: "on_hold" | "cancelled" | "reversed"; reason: string | null }): EmailDoc {
  const copy = {
    on_hold: { subject: "Your TradeLoop payout is on hold", label: "Payout on hold", tone: "warning" as const, headline: "Your payout is on hold", intro: "Your payout is on hold while we review it. You don't need to do anything right now.", after: "The amount stays reserved for this payout. We'll email you as soon as there's an update." },
    cancelled: { subject: "Your TradeLoop payout was cancelled", label: "Payout cancelled", tone: "neutral" as const, headline: "Your payout was cancelled", intro: "Your payout was cancelled before it was sent.", after: "The amount is back in your available affiliate balance." },
    reversed: { subject: "Your TradeLoop payout was returned", label: "Payout returned", tone: "warning" as const, headline: "Your payout was returned", intro: "A payout that had been sent to you came back and could not be delivered.", after: "The amount is back in your available affiliate balance. Please check your payout method before requesting it again." },
  }[d.status]
  return {
    template: `payout-${d.status.replace("_", "-")}`,
    sender: "payments",
    subject: copy.subject,
    preview: copy.intro,
    badge: { label: copy.label, tone: copy.tone },
    headline: copy.headline,
    greeting: hello(d.firstName),
    intro: [copy.intro],
    blocks: [{ kind: "info", title: "Payout details", rows: [["Payout ID", payoutRef(d.payout.id)], ["Amount", money(d.payout.amount)], ["Method", d.payout.method]] }, { kind: "notice", title: "Details", lines: [d.reason] }, { kind: "text", lines: [copy.after] }, viewPayout],
    signature: PAYMENTS_TEAM,
  }
}

// --- Payout methods -------------------------------------------------------------

type MethodFacts = {
  firstName: string
  method: string // "PayPal"
  destination: string // masked
  // false = the first method ever added to the account
  changed: boolean
  changedAt: Date
  holdUntil: Date | null
  crypto?: { asset: string; network: string } | null
}

export function payoutMethodChanged(d: MethodFacts): EmailDoc {
  if (d.crypto) return walletChanged(d)
  return {
    template: "payout-method-changed",
    sender: "payments",
    subject: d.changed ? "Your TradeLoop payout method was changed" : "A payout method was added to your TradeLoop account",
    preview: d.changed ? "Your payout destination has been updated." : "A payout method has been added to your affiliate account.",
    badge: { label: d.changed ? "Payout method changed" : "Payout method added", tone: "info" },
    headline: d.changed ? "Your payout method was changed" : "A payout method was added",
    greeting: hello(d.firstName),
    intro: [d.changed ? "Your TradeLoop payout method was changed." : "A payout method was added to your TradeLoop affiliate account."],
    blocks: [
      { kind: "info", rows: [["Method", d.method], ["Account", d.destination], [d.changed ? "Changed" : "Added", when(d.changedAt)]] },
      { kind: "notice", title: "Security hold", lines: [d.holdUntil ? `For your protection, payouts to the new method start after ${when(d.holdUntil)}.` : null] },
      { kind: "warning", title: "Security notice", lines: ["If you did not make this change, contact TradeLoop Support immediately and review your account security."] },
      { kind: "cta", label: "Review Payout Methods", url: appUrl("/affiliate/payouts") },
    ],
    signature: PAYMENTS_TEAM,
  }
}

function walletChanged(d: MethodFacts): EmailDoc {
  const c = d.crypto!
  return {
    template: "wallet-changed",
    sender: "payments",
    subject: d.changed ? "Your TradeLoop crypto payout wallet was changed" : "A crypto payout wallet was added to your TradeLoop account",
    preview: d.changed ? `Your ${c.asset} payout wallet has been updated.` : `A ${c.asset} payout wallet has been added to your affiliate account.`,
    badge: { label: d.changed ? "Wallet changed" : "Wallet added", tone: "info" },
    headline: d.changed ? "Your crypto payout wallet was changed" : "A crypto payout wallet was added",
    greeting: hello(d.firstName),
    intro: [d.changed ? "Your TradeLoop crypto payout wallet was changed." : "A crypto payout wallet was added to your TradeLoop affiliate account."],
    blocks: [
      { kind: "info", rows: [[d.changed ? "New Wallet" : "Wallet", d.destination], ["Asset", c.asset], ["Network", c.network], ["Date", when(d.changedAt)]] },
      {
        kind: "notice",
        title: "Security hold",
        lines: [d.holdUntil ? `For your protection, payouts to the new wallet are held until ${when(d.holdUntil)}.` : "For your protection, automatic payouts to a newly added wallet may be temporarily held according to your account security policy."],
      },
      { kind: "warning", title: "If you did not make this change", lines: ["Secure your account now: change your password, review your sign-in sessions, and contact TradeLoop Support."] },
      { kind: "cta", label: "Secure My Account", url: appUrl("/settings") },
    ],
    signature: PAYMENTS_TEAM,
  }
}

// --- Everything else ------------------------------------------------------------

// Any other notice to an affiliate (a new referral, a commission, an account
// change…), in the same layout and from the right sender.
export function generalNotice(d: { firstName: string; sender: Sender; title: string; body: string; href?: string | null }): EmailDoc {
  const paragraphs = d.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  return {
    template: "notice",
    sender: d.sender,
    subject: `${d.title} — TradeLoop`,
    preview: (paragraphs[0] ?? d.title).slice(0, 140),
    badge: { label: d.sender === "payments" ? "Payments" : "Affiliate program", tone: "info" },
    headline: d.title,
    greeting: hello(d.firstName),
    intro: paragraphs,
    blocks: d.href ? [{ kind: "cta", label: "Open Affiliate Dashboard", url: appUrl(d.href.startsWith("/") ? d.href : "/affiliate") }] : [],
    signature: d.sender === "payments" ? PAYMENTS_TEAM : AFFILIATE_TEAM,
  }
}

// --- Previews -------------------------------------------------------------------
// Every template with realistic sample data. Rendered on the admin preview
// page and checked by the tests; nothing here is ever sent.

export function emailPreviews(now = new Date("2026-10-02T14:05:00Z")): { id: string; name: string; doc: EmailDoc }[] {
  const firstName = "Alex"
  const earlier = new Date(now.getTime() - 26 * 3_600_000)
  const paypal: PayoutFacts = { id: 1042, amount: 420, fee: 0, net: 420, method: "PayPal (a••••@example.com)" }
  const withFee: PayoutFacts = { id: 1043, amount: 200, fee: 4.3, net: 195.7, method: "Wise (a••••@example.com)" }
  const hash = "a3f19c2e7b5d4081f6e2c9a7d3b1e5f48c0a2d6e9b7f1c3a5e8d2b4f6a0c8921"
  const usdt: PayoutFacts = { id: 1044, amount: 420, fee: 0, net: 420, method: "Crypto — USDT (TRC-20) (TXYZ…8291)", crypto: { asset: "USDT", network: "TRON (TRC-20)", wallet: "TXYZ…8291", hash, explorerUrl: `https://tronscan.org/#/transaction/${hash}` } }
  return [
    { id: "application-received", name: "Application Received", doc: applicationReceived({ firstName, affiliateId: 128, submittedAt: now, channel: "youtube.com/@alextrades" }) },
    { id: "application-approved", name: "Application Approved", doc: applicationApproved({ firstName, affiliateId: 128, link: siteUrl("/?ref=alex"), onboarded: true }) },
    { id: "application-denied", name: "Application Denied", doc: applicationDenied({ firstName, affiliateId: 128, reviewedAt: now, reason: "We couldn't verify the audience on the channel you listed. You're welcome to apply again once it's public." }) },
    { id: "payout-requested", name: "Payout Requested", doc: payoutRequested({ firstName, payout: withFee, requestedAt: earlier }) },
    { id: "payout-approved", name: "Payout Approved", doc: payoutApproved({ firstName, payout: withFee, approvedAt: now }) },
    { id: "payout-denied", name: "Payout Denied", doc: payoutDenied({ firstName, payout: paypal, reviewedAt: now, reason: "The PayPal account couldn't receive payments. Please verify it and request the payout again." }) },
    { id: "payout-sent", name: "Payout Sent", doc: payoutSent({ firstName, payout: withFee, completedAt: now }) },
    { id: "crypto-payout-sent", name: "Crypto Payout Sent", doc: payoutSent({ firstName, payout: usdt, completedAt: now }) },
    { id: "automatic-payout-sent", name: "Automatic Payout Sent", doc: payoutSent({ firstName, payout: { ...paypal, automatic: true }, completedAt: now }) },
    { id: "payout-failed", name: "Payout Failed", doc: payoutFailed({ firstName, payout: paypal, reason: "PayPal rejected the transfer: the receiving account is restricted." }) },
    { id: "payout-method-changed", name: "Payout Method Changed", doc: payoutMethodChanged({ firstName, method: "PayPal", destination: "a••••@example.com", changed: true, changedAt: now, holdUntil: new Date(now.getTime() + 24 * 3_600_000) }) },
    { id: "wallet-changed", name: "Wallet Changed", doc: payoutMethodChanged({ firstName, method: "Crypto — USDT (TRC-20)", destination: "TXYZ…8291", changed: true, changedAt: now, holdUntil: new Date(now.getTime() + 24 * 3_600_000), crypto: { asset: "USDT", network: "TRON (TRC-20)" } }) },
  ]
}
