// A support request, as rules: what can be asked about, what a valid request
// looks like, how a ticket is referred to, and when too many have been sent.
// Pure — the same checks run in the browser (for inline feedback) and on the
// server (the ones that count), and the tests call them directly.

export const SUPPORT_CATEGORIES = [
  { id: "account", label: "Account & Profile" },
  { id: "billing", label: "Billing & Subscription" },
  { id: "affiliate", label: "Affiliate Program" },
  { id: "payout", label: "Payout" },
  { id: "trading_account", label: "Trading Account" },
  { id: "trade_manager", label: "Trade Manager" },
  { id: "prop_firm", label: "Prop Firm Tracker" },
  { id: "backtesting", label: "Backtesting" },
  { id: "technical", label: "Technical Issue" },
  { id: "bug", label: "Bug Report" },
  { id: "feature", label: "Feature Request" },
  { id: "sync", label: "Data / Sync" },
  { id: "security", label: "Security" },
  { id: "other", label: "Other" },
] as const
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]["id"]

export const isSupportCategory = (v: unknown): v is SupportCategory => SUPPORT_CATEGORIES.some((c) => c.id === v)
export const categoryLabel = (id: string | null | undefined) => SUPPORT_CATEGORIES.find((c) => c.id === id)?.label ?? "Support"

export const MESSAGE_MAX = 2000
export const MESSAGE_MIN = 10
export const NAME_MAX = 80

const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/
export const emailValid = (v: string) => v.length <= 254 && EMAIL.test(v)

// Text as it is stored: line endings normalised, control characters dropped.
const clean = (v: unknown) =>
  String(v ?? "")
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()

// The page the request was sent from: a host and a path, never a query string
// (those can carry tokens). Anything else is dropped rather than stored.
export function cleanPage(v: unknown): string | null {
  const raw = String(v ?? "").trim().split(/[?#]/)[0]
  return raw.length <= 200 && /^[a-z0-9.:-]*\/[^\s<>"']*$/i.test(raw) ? raw : null
}

export type SupportInput = { category?: unknown; message?: unknown; email?: unknown; name?: unknown; page?: unknown; company?: unknown }
export type SupportRequest = { category: SupportCategory; message: string; email: string; name: string | null; page: string | null }
export type SupportField = "category" | "message" | "email" | "name"
export type SupportProblem = { field: SupportField; error: string }

export function messageProblem(message: string): string | null {
  const text = clean(message)
  if (!text) return "Please describe your issue."
  if (text.length > MESSAGE_MAX) return `Your message must be ${MESSAGE_MAX.toLocaleString("en-US")} characters or fewer.`
  if (text.length < MESSAGE_MIN) return "Please describe your issue in a little more detail."
  return null
}

// What was submitted → a request, or the first thing wrong with it.
export function readSupportRequest(input: SupportInput): { ok: true; value: SupportRequest } | ({ ok: false } & SupportProblem) {
  if (!isSupportCategory(input.category)) return { ok: false, field: "category", error: "Please select a subject." }
  const message = clean(input.message)
  const problem = messageProblem(message)
  if (problem) return { ok: false, field: "message", error: problem }
  const email = clean(input.email).toLowerCase()
  if (!emailValid(email)) return { ok: false, field: "email", error: "Please enter a valid email address." }
  const name = clean(input.name).replace(/\s+/g, " ")
  if (name.length > NAME_MAX) return { ok: false, field: "name", error: `Keep your name under ${NAME_MAX} characters.` }
  return { ok: true, value: { category: input.category, message, email, name: name || null, page: cleanPage(input.page) } }
}

// A form field no person sees or fills in. Something that does is not a person.
export const looksAutomated = (input: SupportInput) => String(input.company ?? "").trim() !== ""

// The line a ticket is listed by: what it is about, and how the message starts.
export function ticketSubject(category: SupportCategory, message: string): string {
  const first = message.split("\n")[0].trim()
  const excerpt = first.length > 72 ? `${first.slice(0, 71).trimEnd()}…` : first
  return `${categoryLabel(category)}: ${excerpt}`.slice(0, 140)
}

// "SUP-10291" — the number a customer and the team both use for a ticket.
const REF_BASE = 10000
export const ticketRef = (id: number) => `SUP-${REF_BASE + id}`
export function ticketIdFromRef(text: string): number | null {
  const m = /^#?\s*(?:SUP-?)?(\d{4,9})$/i.exec(text.trim())
  if (!m) return null
  const id = Number(m[1]) - REF_BASE
  return Number.isInteger(id) && id > 0 ? id : null
}

// How many requests one sender may make. Enforced on the server from the
// tickets already on record, so it holds across every instance.
export const SUPPORT_LIMITS = { perHour: 3, perDay: 8, ipPerHour: 6, ipPerDay: 20 }
export type RecentCounts = { hour: number; day: number; ipHour: number; ipDay: number }
export function rateLimited(c: RecentCounts): boolean {
  return c.hour >= SUPPORT_LIMITS.perHour || c.day >= SUPPORT_LIMITS.perDay || c.ipHour >= SUPPORT_LIMITS.ipPerHour || c.ipDay >= SUPPORT_LIMITS.ipPerDay
}
