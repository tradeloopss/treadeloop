import { test } from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_V2_CONFIG,
  achievements,
  classicToV2,
  effectiveVersion,
  insights,
  isFeedbackRating,
  monthlyGoals,
  normalizeV2Config,
  rolloutBucket,
  sourceName,
  v2Open,
  v2ToClassic,
  type V2Config,
} from "@/lib/affiliates/v2/config"

// Affiliate Dashboard V2 (beta): who gets it, which dashboard an affiliate
// sees, where its pages live, and the rules behind achievements, goals and
// insights — none of which may invent a number.

const cfg = (over: Partial<V2Config> = {}): V2Config => ({ ...DEFAULT_V2_CONFIG, ...over })

test("defaults: the beta is open to everyone, and Classic stays the default", () => {
  assert.deepEqual(normalizeV2Config(null), DEFAULT_V2_CONFIG)
  assert.equal(DEFAULT_V2_CONFIG.defaultVersion, "classic")
  assert.equal(effectiveVersion(DEFAULT_V2_CONFIG, { id: 7, dashboardVersion: null }), "classic")
  assert.equal(effectiveVersion(DEFAULT_V2_CONFIG, { id: 7, dashboardVersion: "v2" }), "v2")
})

test("stored settings are cleaned, never trusted", () => {
  const c = normalizeV2Config({ enabled: "yes", rollout: "everyone", percent: 250, selected: [3, "4", -1, 3, "x", 2.5], defaultVersion: "v3", features: { wallet: false, leaderboard: "no" }, goals: { monthlyCustomers: 0, challengeClicks: "250" } })
  assert.equal(c.enabled, true) // not a boolean → the default
  assert.equal(c.rollout, "all")
  assert.equal(c.percent, 100)
  assert.deepEqual(c.selected, [3, 4])
  assert.equal(c.defaultVersion, "classic")
  assert.deepEqual(c.features, { wallet: false, goals: true, achievements: true, leaderboard: true })
  assert.deepEqual(c.goals, { monthlyCustomers: 1, challengeCustomers: 5, challengeClicks: 250, challengeEarnings: 500 })
})

test("rollout: off, selected affiliates, and a stable percentage", () => {
  assert.equal(v2Open(cfg({ enabled: false }), 1), false)
  assert.equal(v2Open(cfg({ rollout: "selected", selected: [4, 9] }), 9), true)
  assert.equal(v2Open(cfg({ rollout: "selected", selected: [4, 9] }), 5), false)
  // a percentage always picks the same people, and roughly that share of them
  const ids = Array.from({ length: 2000 }, (_, i) => i + 1)
  const open = ids.filter((id) => v2Open(cfg({ rollout: "percent", percent: 25 }), id))
  assert.ok(open.length > 400 && open.length < 600, `25% of 2000 ≈ 500, got ${open.length}`)
  assert.deepEqual(open, ids.filter((id) => rolloutBucket(id) < 25))
  assert.equal(v2Open(cfg({ rollout: "percent", percent: 0 }), 12), false)
  assert.equal(v2Open(cfg({ rollout: "percent", percent: 100 }), 12), true)
  // whoever is in at 25% is still in at 50%
  assert.ok(open.every((id) => v2Open(cfg({ rollout: "percent", percent: 50 }), id)))
})

test("the dashboard an affiliate sees: their choice, the default, and never V2 when it isn't open to them", () => {
  const a = (dashboardVersion: string | null, id = 5) => ({ id, dashboardVersion })
  assert.equal(effectiveVersion(cfg({ defaultVersion: "v2" }), a(null)), "v2")
  assert.equal(effectiveVersion(cfg({ defaultVersion: "v2" }), a("classic")), "classic")
  assert.equal(effectiveVersion(cfg({ enabled: false }), a("v2")), "classic")
  assert.equal(effectiveVersion(cfg({ rollout: "selected", selected: [1] }), a("v2")), "classic")
  assert.equal(effectiveVersion(cfg({ rollout: "selected", selected: [5] }), a("v2")), "v2")
  assert.equal(effectiveVersion(cfg(), a("something-else")), "classic")
})

test("addresses: every Classic section has its V2 page, and back again", () => {
  assert.equal(classicToV2("/affiliate"), "/affiliate/v2")
  for (const s of ["analytics", "referrals", "campaigns", "links", "coupons", "earnings", "payouts", "resources", "announcements", "support", "settings"]) {
    assert.equal(classicToV2(`/affiliate/${s}`), `/affiliate/v2/${s}`)
    assert.equal(v2ToClassic(`/affiliate/v2/${s}`), `/affiliate/${s}`)
  }
  // not portal pages: left alone (the application, onboarding, the terms, exports, V2 itself)
  for (const p of ["/affiliate/apply", "/affiliate/onboarding", "/affiliate/terms", "/affiliate/export/payouts", "/affiliate/v2", "/affiliate/v2/wallet", "/dashboard"]) assert.equal(classicToV2(p), null, p)
  // V2-only pages go somewhere sensible in Classic
  assert.equal(v2ToClassic("/affiliate/v2"), "/affiliate")
  assert.equal(v2ToClassic("/affiliate/v2/wallet"), "/affiliate/payouts")
  assert.equal(v2ToClassic("/affiliate/v2/leaderboard"), "/affiliate")
  assert.equal(v2ToClassic("/affiliate/v2/campaigns/12"), "/affiliate/campaigns")
})

test("achievements: locked, in progress, unlocked — from real totals and the live tiers", () => {
  const tiers = [
    { id: 1, name: "Bronze", minCustomers: 1, style: "bronze" },
    { id: 2, name: "Silver", minCustomers: 11, style: "silver" },
    { id: 3, name: "Gold", minCustomers: 100, style: "gold" },
  ]
  const none = achievements({ referrals: 0, customers: 0, clicks: 0, lifetimeEarned: 0, payoutsPaid: 0 }, tiers)
  assert.ok(none.every((a) => a.state === "locked" && a.progress === 0))
  // the first tier is where everyone starts: no badge for it
  assert.deepEqual(none.filter((a) => a.icon === "tier").map((a) => a.title), ["Silver affiliate", "Gold affiliate"])

  const some = Object.fromEntries(achievements({ referrals: 4, customers: 6, clicks: 250, lifetimeEarned: 140, payoutsPaid: 0 }, tiers).map((a) => [a.key, a]))
  assert.equal(some.first_referral.state, "unlocked")
  assert.equal(some.first_100.state, "unlocked")
  assert.equal(some.ten_customers.state, "in_progress")
  assert.equal(some.ten_customers.progress, 0.6)
  assert.equal(some.clicks_1000.progress, 0.25)
  assert.equal(some.first_payout.state, "locked")
  assert.equal(some.tier_2.state, "in_progress")
  assert.equal(some.earned_1000.progress, 0.14)
  // progress never passes 100%
  assert.equal(achievements({ referrals: 50, customers: 500, clicks: 9999, lifetimeEarned: 99999, payoutsPaid: 9 }, tiers).every((a) => a.state === "unlocked" && a.progress === 1), true)
})

test("goals: fixed targets, progress from this month, a deadline at the month's end", () => {
  const now = new Date("2026-10-03T12:00:00Z")
  const g = monthlyGoals(DEFAULT_V2_CONFIG.goals, { customers: 6, clicks: 42, commission: 320 }, now)
  assert.equal(g.monthLabel, "October")
  assert.deepEqual([g.goal.title, g.goal.description, g.goal.value, g.goal.target, g.goal.progress, g.goal.done], ["October goal", "Get 10 paying customers", 6, 10, 0.6, false])
  assert.equal(g.goal.deadline, "2026-10-31T23:59:59.000Z")
  assert.deepEqual(g.challenges.map((c) => [c.title, c.value, c.target, c.done]), [["Get 5 new customers", 6, 5, true], ["Generate 100 clicks", 42, 100, false], ["Earn $500", 320, 500, false]])
  assert.equal(g.challenges[0].progress, 1)
  assert.equal(g.challenges[2].money, true)
})

test("insights: only what the numbers support", () => {
  const now = new Date("2026-10-03T00:00:00Z")
  const base = { nextRelease: null, nextTier: null, sources: [], current: { clicks: 0, customers: 0 }, previous: null, bestLink: null, linkCount: 1 }
  // nothing to say → nothing said ("Not enough data yet" is the page's job)
  assert.deepEqual(insights(base, now), [])
  const full = insights(
    {
      nextRelease: { amount: 320, at: new Date("2026-10-07T00:00:00Z") },
      nextTier: { name: "Silver", needed: 4 },
      sources: [{ label: "youtube", customers: 17, signups: 40 }, { label: "direct", customers: 5, signups: 9 }, { label: "instagram", customers: 3, signups: 4 }],
      current: { clicks: 400, customers: 31 },
      previous: { clicks: 400, customers: 25 },
      bestLink: { label: "YouTube October", customers: 9 },
      linkCount: 3,
    },
    now
  )
  assert.deepEqual(full.map((i) => i.text), [
    "$320 commission becomes available in 4 days",
    "You're 4 customers away from Silver",
    "YouTube generated 68% of your conversions",
    "Your conversion rate rose 24% vs the previous period",
    "Your best-performing link is YouTube October",
  ])
  // a share of one or two conversions isn't an insight; nor a rate on a handful of clicks
  const thin = insights({ ...base, sources: [{ label: "youtube", customers: 1, signups: 2 }, { label: "direct", customers: 1, signups: 1 }], current: { clicks: 9, customers: 2 }, previous: { clicks: 8, customers: 1 } }, now)
  assert.deepEqual(thin, [])
  // a single source isn't "x% of your conversions"; a single link isn't "best"
  assert.deepEqual(insights({ ...base, sources: [{ label: "youtube", customers: 9, signups: 20 }], bestLink: { label: "main", customers: 9 }, linkCount: 1 }, now), [])
  assert.equal(insights({ ...base, nextRelease: { amount: 12.5, at: new Date("2026-10-03T10:00:00Z") } }, now)[0].text, "$12.50 commission becomes available in 1 day")
  assert.equal(sourceName("https://www.example.com"), "example.com")
})

test("feedback ratings are a fixed set", () => {
  for (const r of ["love", "good", "improve", "difficult"]) assert.equal(isFeedbackRating(r), true)
  assert.equal(isFeedbackRating("meh"), false)
  assert.equal(isFeedbackRating(undefined), false)
})
