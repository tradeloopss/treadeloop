// Shared constants + types for the affiliate program. Pure (no server
// imports), so both server code and client components can use it.

export type AffiliateStatus = "pending" | "review" | "approved" | "rejected" | "suspended"
export const AFFILIATE_STATUSES: AffiliateStatus[] = ["pending", "review", "approved", "rejected", "suspended"]

export const TRAFFIC_SOURCES = ["YouTube", "Website", "Instagram", "TikTok", "X", "Discord", "Telegram", "Email", "Community", "Paid Ads", "SEO", "Other"] as const
export const AUDIENCE_SIZES = ["Under 1,000", "1,000 – 10,000", "10,000 – 50,000", "50,000 – 250,000", "250,000+"] as const
export const SOCIAL_KEYS = ["youtube", "instagram", "tiktok", "x", "discord", "telegram"] as const
export const SOCIAL_LABELS: Record<(typeof SOCIAL_KEYS)[number], string> = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok", x: "X", discord: "Discord", telegram: "Telegram" }

// The public pages a tracking link may land on.
export const LANDING_PAGES = [
  { path: "/", label: "Home page" },
  { path: "/pricing", label: "Pricing" },
  { path: "/brokers", label: "Supported brokers" },
] as const

export const ANNOUNCEMENT_CATEGORIES = ["update", "promotion", "product", "policy"] as const
export const RESOURCE_CATEGORY_LABELS: Record<string, string> = { brand: "Brand assets", social: "Social media", creative: "Banners & creatives", product: "Product screenshots", video: "Video", copy: "Copy & swipe files" }

export const RESOURCE_CATEGORIES =["brand", "social", "creative", "product", "video", "copy"] as const
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number]

export const PAYOUT_METHOD_TYPES = ["paypal", "wise", "bank", "stripe", "crypto_trc20", "crypto_aptos", "crypto_ltc"] as const
export type PayoutMethodType = (typeof PAYOUT_METHOD_TYPES)[number]
export const PAYOUT_METHOD_LABELS: Record<PayoutMethodType, string> = { paypal: "PayPal", wise: "Wise", bank: "Bank transfer", stripe: "Stripe Connect", crypto_trc20: "Crypto — USDT (TRC-20)", crypto_aptos: "Crypto — USDT (Aptos)", crypto_ltc: "Crypto — Litecoin (LTC)" }
// What the method picker says under each name.
export const PAYOUT_METHOD_BLURBS: Record<PayoutMethodType, { tagline: string; timing: string }> = {
  paypal: { tagline: "Fast and secure payments", timing: "2–5 business days" },
  wise: { tagline: "Low-fee global transfers", timing: "1–3 business days" },
  bank: { tagline: "Direct to your bank account", timing: "3–7 business days" },
  stripe: { tagline: "For eligible countries", timing: "2–5 business days" },
  crypto_trc20: { tagline: "USDT on the TRON network", timing: "TRON / TRC-20" },
  crypto_aptos: { tagline: "USDT on the Aptos network", timing: "Aptos" },
  crypto_ltc: { tagline: "Litecoin, at the market price", timing: "Litecoin / LTC" },
}
export const methodLabel = (type: string) => PAYOUT_METHOD_LABELS[type as PayoutMethodType] ?? type
// "PayPal, Wise, bank transfer or USDT" — the methods actually on offer, for copy.
const SHORT: Record<PayoutMethodType, string> = { paypal: "PayPal", wise: "Wise", bank: "bank transfer", stripe: "Stripe", crypto_trc20: "USDT (TRC-20)", crypto_aptos: "USDT (Aptos)", crypto_ltc: "Litecoin" }
export function methodList(types: readonly string[]): string {
  const names = types.map((t) => SHORT[t as PayoutMethodType]).filter(Boolean)
  if (names.length === 0) return "the payout methods on offer"
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`
}
// The currency an account receives in (the payout itself is calculated in USD).
export const PAYOUT_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "CHF", "AED", "SAR", "EGP", "INR", "SGD", "JPY", "MXN", "BRL", "ZAR", "TRY", "PLN", "SEK", "NOK", "DKK"] as const

export type LedgerType = "subscription" | "bonus" | "adjustment" | "refund" | "reversal" | "payout"
export type LedgerStatus = "pending" | "approved" | "available" | "paid" | "reversed" | "refunded" | "cancelled"
export type ReferralStatus = "signup" | "trial" | "active" | "cancelled" | "refunded"

// The program rules an admin controls at /admin/affiliates/rules. Stored as
// JSON in app_settings under "affiliate_program".
export type ProgramSettings = {
  defaultRate: number // percent
  commissionType: "recurring" | "one_time"
  durationMonths: number | null // how long a referral keeps earning; null = lifetime
  cookieDays: number
  minPayout: number
  holdDays: number
  refundReversal: boolean
  attribution: "first_touch" | "last_touch"
  autoApprove: boolean
  couponsEnabled: boolean
  maxCouponPercent: number
  payoutEta: string
}

export const DEFAULT_PROGRAM: ProgramSettings = {
  defaultRate: 30,
  commissionType: "recurring",
  durationMonths: null,
  cookieDays: 30,
  minPayout: 50,
  holdDays: 30,
  refundReversal: true,
  attribution: "first_touch",
  autoApprove: false,
  couponsEnabled: true,
  maxCouponPercent: 30,
  payoutEta: "2–5 business days",
}

const num = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

// Never trust stored/submitted settings blindly — clamp everything.
export function normalizeProgram(raw: unknown): ProgramSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_PROGRAM
  const duration = r.durationMonths === null || r.durationMonths === undefined || r.durationMonths === "" ? null : Math.round(num(r.durationMonths, 12, 1, 240))
  return {
    defaultRate: num(r.defaultRate, d.defaultRate, 0, 90),
    commissionType: r.commissionType === "one_time" ? "one_time" : "recurring",
    durationMonths: "durationMonths" in r ? duration : d.durationMonths,
    cookieDays: Math.round(num(r.cookieDays, d.cookieDays, 1, 365)),
    minPayout: num(r.minPayout, d.minPayout, 1, 100000),
    holdDays: Math.round(num(r.holdDays, d.holdDays, 0, 180)),
    refundReversal: typeof r.refundReversal === "boolean" ? r.refundReversal : d.refundReversal,
    attribution: r.attribution === "last_touch" ? "last_touch" : "first_touch",
    autoApprove: typeof r.autoApprove === "boolean" ? r.autoApprove : d.autoApprove,
    couponsEnabled: typeof r.couponsEnabled === "boolean" ? r.couponsEnabled : d.couponsEnabled,
    maxCouponPercent: num(r.maxCouponPercent, d.maxCouponPercent, 1, 100),
    payoutEta: typeof r.payoutEta === "string" && r.payoutEta.trim() ? r.payoutEta.trim().slice(0, 60) : d.payoutEta,
  }
}

// Which emails/notifications an affiliate wants. Missing key = default.
export const NOTIFICATION_PREFS = [
  { key: "referral", label: "New referral", description: "Someone signed up through your link.", default: true },
  { key: "commission", label: "Commission generated", description: "A referred customer paid and you earned a commission.", default: true },
  { key: "commissionApproved", label: "Commission approved", description: "A commission cleared its holding period.", default: true },
  { key: "payout", label: "Payout processed", description: "A payout was sent, or couldn't be.", default: true },
  { key: "announcements", label: "Announcements", description: "News and updates about the program.", default: true },
  { key: "monthlyReport", label: "Monthly report", description: "A monthly summary of your performance.", default: true },
] as const
export type NotificationPref = (typeof NOTIFICATION_PREFS)[number]["key"]

export const RANGES = ["7d", "30d", "90d", "6m", "1y", "all"] as const
export type Range = (typeof RANGES)[number]
export const RANGE_LABELS: Record<Range, string> = { "7d": "7D", "30d": "30D", "90d": "90D", "6m": "6M", "1y": "1Y", all: "ALL" }

export function rangeStart(range: Range, now: Date = new Date()): Date | null {
  const days = { "7d": 7, "30d": 30, "90d": 90, "6m": 183, "1y": 365, all: 0 }[range]
  return days ? new Date(now.getTime() - days * 86_400_000) : null
}

export const parseRange = (v: unknown): Range => (RANGES.includes(v as Range) ? (v as Range) : "30d")

export const money = (v: number | string | null | undefined, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: 2 }).format(Number(v ?? 0))
export const signedMoney = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${money(Math.abs(v))}`
export const count = (v: number | null | undefined) => Number(v ?? 0).toLocaleString("en-US")
export const pct = (v: number) => `${(Math.round(v * 10000) / 100).toFixed(2)}%`
