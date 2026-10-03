// Affiliate Dashboard V2 (beta): who gets it, which dashboard each affiliate
// sees, and the rules behind its goals, achievements and insights. Pure — no
// database — so the server, the pages and the tests share one definition.
// The admin edits the config at /admin/affiliates/dashboard (app_settings
// "affiliate_dashboard_v2").

export type DashboardVersion = "classic" | "v2"
export type V2Rollout = "all" | "selected" | "percent"
export type V2Feature = "wallet" | "goals" | "achievements" | "leaderboard"
export const V2_FEATURES: { key: V2Feature; label: string; description: string }[] = [
  { key: "wallet", label: "Wallet", description: "Balances, payout methods and transaction history in one place." },
  { key: "goals", label: "Goals & challenges", description: "Monthly targets with progress from real results." },
  { key: "achievements", label: "Achievements", description: "Badges for milestones reached." },
  { key: "leaderboard", label: "Leaderboard", description: "Rankings of the affiliates who choose to appear on it." },
]

export type V2Goals = { monthlyCustomers: number; challengeCustomers: number; challengeClicks: number; challengeEarnings: number }

export type V2Config = {
  enabled: boolean
  rollout: V2Rollout
  percent: number // of affiliates, for "percent"
  selected: number[] // affiliate ids, for "selected"
  defaultVersion: DashboardVersion // for an affiliate who hasn't chosen
  features: Record<V2Feature, boolean>
  goals: V2Goals
}

export const DEFAULT_V2_CONFIG: V2Config = {
  enabled: true,
  rollout: "all",
  percent: 100,
  selected: [],
  defaultVersion: "classic",
  features: { wallet: true, goals: true, achievements: true, leaderboard: true },
  goals: { monthlyCustomers: 10, challengeCustomers: 5, challengeClicks: 100, challengeEarnings: 500 },
}

const int = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

// Stored values are never trusted as-is.
export function normalizeV2Config(raw: unknown): V2Config {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_V2_CONFIG
  const f = (r.features && typeof r.features === "object" ? r.features : {}) as Record<string, unknown>
  const g = (r.goals && typeof r.goals === "object" ? r.goals : {}) as Record<string, unknown>
  const selected = Array.isArray(r.selected) ? [...new Set(r.selected.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 2000) : []
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    rollout: r.rollout === "selected" || r.rollout === "percent" ? r.rollout : "all",
    percent: int(r.percent, d.percent, 0, 100),
    selected,
    defaultVersion: r.defaultVersion === "v2" ? "v2" : "classic",
    features: Object.fromEntries(V2_FEATURES.map((x) => [x.key, f[x.key] !== false])) as Record<V2Feature, boolean>,
    goals: {
      monthlyCustomers: int(g.monthlyCustomers, d.goals.monthlyCustomers, 1, 10000),
      challengeCustomers: int(g.challengeCustomers, d.goals.challengeCustomers, 1, 10000),
      challengeClicks: int(g.challengeClicks, d.goals.challengeClicks, 1, 10_000_000),
      challengeEarnings: int(g.challengeEarnings, d.goals.challengeEarnings, 1, 10_000_000),
    },
  }
}

// A stable 0–99 bucket per affiliate, so a percentage rollout always picks the same people.
export const rolloutBucket = (affiliateId: number) => (Math.imul(affiliateId, 2654435761) >>> 0) % 100

export function v2Open(config: V2Config, affiliateId: number): boolean {
  if (!config.enabled) return false
  if (config.rollout === "all") return true
  if (config.rollout === "selected") return config.selected.includes(affiliateId)
  return rolloutBucket(affiliateId) < config.percent
}

// The dashboard an affiliate sees: their own choice, else the default — and
// always Classic when V2 isn't open to them.
export function effectiveVersion(config: V2Config, affiliate: { id: number; dashboardVersion: string | null }): DashboardVersion {
  if (!v2Open(config, affiliate.id)) return "classic"
  if (affiliate.dashboardVersion === "classic" || affiliate.dashboardVersion === "v2") return affiliate.dashboardVersion
  return config.defaultVersion
}

// --- Addresses ------------------------------------------------------------------

// Sections both dashboards have, in their in-app form.
const SHARED = ["analytics", "referrals", "campaigns", "links", "coupons", "earnings", "payouts", "resources", "announcements", "support", "settings"]

// A Classic page's V2 counterpart ("/affiliate/payouts" → "/affiliate/v2/payouts"), or null.
export function classicToV2(pathname: string): string | null {
  if (pathname === "/affiliate" || pathname === "/affiliate/") return "/affiliate/v2"
  const m = /^\/affiliate\/([a-z-]+)(\/.*)?$/.exec(pathname)
  return m && SHARED.includes(m[1]) ? `/affiliate/v2/${m[1]}${m[2] ?? ""}` : null
}

// Where "Switch to Classic" lands from a V2 page.
export function v2ToClassic(pathname: string): string {
  const m = /^\/affiliate\/v2(?:\/([a-z-]+))?/.exec(pathname)
  const section = m?.[1]
  if (!section) return "/affiliate"
  if (SHARED.includes(section)) return `/affiliate/${section}`
  if (section === "wallet") return "/affiliate/payouts"
  return "/affiliate"
}

// --- Achievements -----------------------------------------------------------------

export type AchievementStats = { referrals: number; customers: number; clicks: number; lifetimeEarned: number; payoutsPaid: number }
export type AchievementTier = { id: number; name: string; minCustomers: number; style: string }
export type Achievement = {
  key: string
  title: string
  description: string
  icon: "referral" | "customer" | "money" | "clicks" | "payout" | "tier"
  style?: string
  value: number
  target: number
  state: "locked" | "in_progress" | "unlocked"
  progress: number // 0–1
}

export function achievements(stats: AchievementStats, tiers: AchievementTier[]): Achievement[] {
  const defs: Omit<Achievement, "state" | "progress">[] = [
    { key: "first_referral", title: "First referral", description: "Someone signed up through your link.", icon: "referral", value: stats.referrals, target: 1 },
    { key: "first_customer", title: "First customer", description: "A referral became a paying customer.", icon: "customer", value: stats.customers, target: 1 },
    { key: "first_100", title: "First $100 earned", description: "$100 in commission, all time.", icon: "money", value: stats.lifetimeEarned, target: 100 },
    { key: "clicks_1000", title: "1,000 clicks", description: "Your links were visited 1,000 times.", icon: "clicks", value: stats.clicks, target: 1000 },
    { key: "ten_customers", title: "10 customers", description: "Ten paying customers referred.", icon: "customer", value: stats.customers, target: 10 },
    { key: "first_payout", title: "First payout", description: "Your first payout was sent.", icon: "payout", value: stats.payoutsPaid, target: 1 },
    { key: "earned_1000", title: "$1,000 earned", description: "$1,000 in commission, all time.", icon: "money", value: stats.lifetimeEarned, target: 1000 },
    // One badge per tier above the first (where everyone starts).
    ...tiers
      .filter((t) => t.minCustomers > 1)
      .sort((a, b) => a.minCustomers - b.minCustomers)
      .map((t) => ({ key: `tier_${t.id}`, title: `${t.name} affiliate`, description: `Reach ${t.minCustomers} paying customers.`, icon: "tier" as const, style: t.style, value: stats.customers, target: t.minCustomers })),
  ]
  return defs.map((d) => {
    const progress = Math.max(0, Math.min(1, d.value / d.target))
    return { ...d, progress, state: d.value >= d.target ? "unlocked" : d.value > 0 ? "in_progress" : "locked" }
  })
}

// --- Goals ---------------------------------------------------------------------------

export type MonthProgress = { customers: number; clicks: number; commission: number }
export type Goal = { key: string; title: string; description: string; value: number; target: number; money: boolean; deadline: string; done: boolean; progress: number }

const monthEnd = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59))

// This month's goal and challenges: fixed targets (set by the admin), progress
// from what actually happened this month.
export function monthlyGoals(goals: V2Goals, month: MonthProgress, now: Date): { goal: Goal; challenges: Goal[]; monthLabel: string } {
  const deadline = monthEnd(now).toISOString()
  const monthLabel = now.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })
  const make = (key: string, title: string, description: string, value: number, target: number, money = false): Goal => ({ key, title, description, value, target, money, deadline, done: value >= target, progress: Math.max(0, Math.min(1, value / target)) })
  return {
    monthLabel,
    goal: make("month_customers", `${monthLabel} goal`, `Get ${goals.monthlyCustomers} paying customers`, month.customers, goals.monthlyCustomers),
    challenges: [
      make("challenge_customers", `Get ${goals.challengeCustomers} new customers`, "New paying customers this month", month.customers, goals.challengeCustomers),
      make("challenge_clicks", `Generate ${goals.challengeClicks.toLocaleString("en-US")} clicks`, "Visits through your links this month", month.clicks, goals.challengeClicks),
      make("challenge_earnings", `Earn $${goals.challengeEarnings.toLocaleString("en-US")}`, "Commission earned this month", month.commission, goals.challengeEarnings, true),
    ],
  }
}

// --- Insights -------------------------------------------------------------------------

export type InsightInput = {
  nextRelease: { amount: number; at: Date } | null
  nextTier: { name: string; needed: number } | null
  sources: { label: string; customers: number; signups: number }[]
  current: { clicks: number; customers: number }
  previous: { clicks: number; customers: number } | null
  bestLink: { label: string; customers: number } | null
  linkCount: number
}
export type Insight = { key: string; kind: "money" | "tier" | "source" | "conversion" | "link"; text: string; href: string }

const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
const SOURCE_NAMES: Record<string, string> = { direct: "Direct visits", coupon: "Your coupon", youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok", x: "X", twitter: "X", telegram: "Telegram", discord: "Discord", facebook: "Facebook", google: "Google" }
export const sourceName = (label: string) => SOURCE_NAMES[label.toLowerCase()] ?? label.replace(/^https?:\/\//, "").replace(/^www\./, "")

// Only what the numbers support; nothing when there isn't enough to say.
export function insights(input: InsightInput, now: Date): Insight[] {
  const out: Insight[] = []
  if (input.nextRelease && input.nextRelease.amount > 0) {
    const days = Math.max(0, Math.ceil((input.nextRelease.at.getTime() - now.getTime()) / 86_400_000))
    out.push({ key: "release", kind: "money", text: days === 0 ? `${usd(input.nextRelease.amount)} commission becomes available today` : `${usd(input.nextRelease.amount)} commission becomes available in ${days} day${days === 1 ? "" : "s"}`, href: "/affiliate/v2/earnings" })
  }
  if (input.nextTier && input.nextTier.needed > 0) {
    out.push({ key: "tier", kind: "tier", text: `You're ${input.nextTier.needed} customer${input.nextTier.needed === 1 ? "" : "s"} away from ${input.nextTier.name}`, href: "/affiliate/v2/achievements" })
  }
  // A share of conversions means something from a handful of them up.
  const customers = input.sources.reduce((s, r) => s + r.customers, 0)
  const signups = input.sources.reduce((s, r) => s + r.signups, 0)
  const by = customers >= 3 ? "customers" : signups >= 5 ? "signups" : null
  if (by) {
    const total = by === "customers" ? customers : signups
    const top = [...input.sources].sort((a, b) => b[by] - a[by])[0]
    if (top && top[by] > 0 && input.sources.filter((s) => s[by] > 0).length > 1) {
      out.push({ key: "source", kind: "source", text: `${sourceName(top.label)} generated ${Math.round((top[by] / total) * 100)}% of your ${by === "customers" ? "conversions" : "sign-ups"}`, href: "/affiliate/v2/analytics" })
    }
  }
  if (input.previous && input.previous.clicks >= 20 && input.current.clicks >= 20) {
    const now_ = input.current.customers / input.current.clicks
    const then = input.previous.customers / input.previous.clicks
    if (then > 0 && now_ > 0) {
      const delta = (now_ - then) / then
      if (Math.abs(delta) >= 0.1) out.push({ key: "conversion", kind: "conversion", text: `Your conversion rate ${delta > 0 ? "rose" : "fell"} ${Math.round(Math.abs(delta) * 100)}% vs the previous period`, href: "/affiliate/v2/analytics" })
    }
  }
  if (input.bestLink && input.bestLink.customers > 0 && input.linkCount > 1) {
    out.push({ key: "link", kind: "link", text: `Your best-performing link is ${input.bestLink.label}`, href: "/affiliate/v2/links" })
  }
  return out
}

// --- Feedback ---------------------------------------------------------------------------

export const FEEDBACK_RATINGS = [
  { key: "love", emoji: "😍", label: "Love it" },
  { key: "good", emoji: "🙂", label: "Good" },
  { key: "improve", emoji: "😐", label: "Needs improvement" },
  { key: "difficult", emoji: "😕", label: "Difficult to use" },
] as const
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number]["key"]
export const isFeedbackRating = (v: unknown): v is FeedbackRating => FEEDBACK_RATINGS.some((r) => r.key === v)
export const FEEDBACK_MAX = 2000
