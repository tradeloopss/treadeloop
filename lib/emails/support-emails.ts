import { appUrl, type EmailDoc } from "./layout"

// TradeLoop Support's emails, as data (layout.ts renders them). All three come
// from TradeLoop Support <support@tradeloop.pro> — never from the affiliate or
// payments senders. Pure: the tests call these with sample data.
//
// Nothing here adds to what the customer wrote: no account secrets, no session
// details. The message itself is shown as the customer typed it, escaped.

const SUPPORT_TEAM = "TradeLoop Support"
const when = (d: Date) => `${d.toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC`
const hello = (name: string | null | undefined) => `Hi ${name?.trim().split(/\s+/)[0] || "there"},`

export type SupportMailFacts = {
  ticketId: number
  ref: string // SUP-10291
  category: string // "Payout"
  message: string
  name: string | null
  email: string
  // a TradeLoop account sent it: they can follow the request in the app
  signedIn: boolean
  submittedAt: Date
}

// To the customer: we have it.
export function supportRequestReceived(d: SupportMailFacts): EmailDoc {
  return {
    template: "support-received",
    sender: "support",
    subject: "We received your TradeLoop support request",
    preview: `Ticket ${d.ref} — we'll get back to you as soon as possible.`,
    badge: { label: "Support request", tone: "info" },
    headline: "We've received your request",
    greeting: hello(d.name),
    intro: ["We've received your support request. Our team will review your message and respond as soon as possible."],
    blocks: [
      { kind: "info", title: "Request details", rows: [["Ticket", `#${d.ref}`], ["Subject", d.category], ["Submitted", when(d.submittedAt)]] },
      { kind: "notice", title: "Your message", lines: [d.message] },
      // Someone with an account follows it in the app. Without one there is no
      // page to link to, so the email says how to add to the request instead.
      d.signedIn ? { kind: "cta", label: "View Support Request", url: appUrl(`/support/${d.ticketId}`) } : { kind: "text", lines: ["You can reply to this email if you'd like to add anything to your request."] },
    ],
    closing: ["Thank you,"],
    signature: SUPPORT_TEAM,
  }
}

// To the support inbox: a new request, with what is needed to act on it.
export function supportRequestNotification(d: SupportMailFacts & { account: string | null; page: string | null; priority: boolean }): EmailDoc {
  return {
    template: "support-notification",
    sender: "support",
    subject: `[TradeLoop Support] ${d.category} — ${d.ref}`,
    preview: `${d.name || d.email}: ${d.message.split("\n")[0].slice(0, 110)}`,
    badge: d.priority ? { label: "Priority request", tone: "warning" } : { label: "New request", tone: "info" },
    headline: "TradeLoop Support Request",
    greeting: "A new support request came in.",
    intro: [],
    blocks: [
      { kind: "info", title: "Request", rows: [["Ticket", `#${d.ref}`], ["Category", d.category], ["Name", d.name], ["Email", d.email], ["Account", d.account ?? "Not signed in"], ["Page", d.page], ["Submitted", when(d.submittedAt)]] },
      { kind: "notice", title: "Message", lines: [d.message] },
      { kind: "cta", label: "View support request", url: appUrl(`/admin/support/${d.ticketId}`) },
    ],
    closing: ["Replying to this email writes to the customer directly. Replying from the admin page keeps the answer on the ticket."],
    signature: SUPPORT_TEAM,
  }
}

// To the customer: the team answered.
export function supportReply(d: { ticketId: number; ref: string; subject: string; reply: string; name: string | null; signedIn: boolean }): EmailDoc {
  return {
    template: "support-reply",
    sender: "support",
    subject: `Re: ${d.subject} [${d.ref}]`,
    preview: d.reply.split("\n")[0].slice(0, 120),
    badge: { label: "Reply from support", tone: "success" },
    headline: "TradeLoop Support replied",
    greeting: hello(d.name),
    intro: [`We've replied to your request #${d.ref}.`],
    blocks: [
      { kind: "notice", title: "Our reply", lines: [d.reply] },
      d.signedIn ? { kind: "cta", label: "View Support Request", url: appUrl(`/support/${d.ticketId}`) } : { kind: "text", lines: ["You can reply to this email to continue the conversation."] },
    ],
    closing: ["Thank you,"],
    signature: SUPPORT_TEAM,
  }
}
