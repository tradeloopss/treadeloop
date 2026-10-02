import { and, eq, isNotNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliateReferrals, affiliateRules, affiliateTiers, affiliates } from "@/lib/db/schema"
import { getAppSetting, setAppSetting } from "@/lib/app-settings"
import { normalizeProgram, type ProgramSettings } from "./types"
import { TIER_STYLES, cleanPerks, resolveRule, tierFor, type ResolvedRule, type RuleRow, type TierRow, type TierStyle } from "./engine"
import { normalizePayoutSettings, type PayoutSettings } from "./payout-engine"

// Program-level configuration and the rows the rule engine needs.

const KEY = "affiliate_program"

// Where referral links point: the public marketing site. www is the canonical
// host (the apex 308s to it), so links go there directly rather than through
// a redirect.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.tradeloop.pro").replace(/\/+$/, "")

export async function getProgram(): Promise<ProgramSettings> {
  return normalizeProgram(await getAppSetting(KEY).catch(() => null))
}

export async function saveProgram(next: unknown): Promise<ProgramSettings> {
  const clean = normalizeProgram(next)
  await setAppSetting(KEY, clean)
  return clean
}

// Payout controls (automatic payouts, the emergency pause, approval mode,
// limits, fees) — a separate setting from the commission rules, so pausing
// payouts never rewrites what the program pays.
const PAYOUT_KEY = "affiliate_payouts"

export async function getPayoutSettings(): Promise<PayoutSettings> {
  // No catch here on purpose: if the settings can't be read, the payout code
  // must fail rather than fall back to defaults that would lift a pause.
  return normalizePayoutSettings(await getAppSetting(PAYOUT_KEY))
}

export async function savePayoutSettings(next: unknown): Promise<PayoutSettings> {
  const clean = normalizePayoutSettings(next)
  await setAppSetting(PAYOUT_KEY, clean)
  return clean
}

export const tierRow = (t: typeof affiliateTiers.$inferSelect): TierRow => ({
  id: t.id,
  name: t.name,
  minCustomers: t.minCustomers,
  ratePercent: Number(t.ratePercent),
  introMonths: t.introMonths,
  afterPercent: t.afterPercent == null ? null : Number(t.afterPercent),
  perks: cleanPerks(t.perks),
  tagline: t.tagline,
  style: (TIER_STYLES as readonly string[]).includes(t.style) ? (t.style as TierStyle) : "plain",
  sortOrder: t.sortOrder,
  enabled: t.enabled,
})

export async function loadTiers(): Promise<TierRow[]> {
  const rows = await db.select().from(affiliateTiers).orderBy(affiliateTiers.sortOrder, affiliateTiers.id)
  return rows.map(tierRow)
}

export async function loadRules(affiliateId: number): Promise<RuleRow[]> {
  const rows = await db.select().from(affiliateRules).where(eq(affiliateRules.affiliateId, affiliateId))
  return rows.map((r) => ({
    id: r.id,
    scope: r.scope as RuleRow["scope"],
    campaignId: r.campaignId,
    couponId: r.couponId,
    ratePercent: Number(r.ratePercent),
    durationMonths: r.durationMonths,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    enabled: r.enabled,
  }))
}

// Customers who have actually paid — what tiers are measured in.
export async function paidCustomerCount(affiliateId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(affiliateReferrals)
    .where(and(eq(affiliateReferrals.affiliateId, affiliateId), isNotNull(affiliateReferrals.firstPaymentAt)))
  return row?.n ?? 0
}

// The tier an affiliate sits in right now: the one set by hand on their page,
// else by their paying customers.
export async function affiliateTier(affiliateId: number): Promise<TierRow | null> {
  const [tiers, customers, [aff]] = await Promise.all([loadTiers(), paidCustomerCount(affiliateId), db.select({ tierId: affiliates.tierId }).from(affiliates).where(eq(affiliates.id, affiliateId))])
  return tierFor(tiers, customers, aff?.tierId ?? null)
}

// The rate that would apply for this affiliate right now (optionally for a
// specific campaign / coupon). One place, used by the commission engine and
// by every screen that shows "your commission".
export async function currentRule(affiliateId: number, ctx: { campaignId?: number | null; couponId?: number | null; program?: ProgramSettings } = {}): Promise<ResolvedRule> {
  const [program, tiers, rules, customers, [aff]] = await Promise.all([
    ctx.program ? Promise.resolve(ctx.program) : getProgram(),
    loadTiers(),
    loadRules(affiliateId),
    paidCustomerCount(affiliateId),
    db.select({ tierId: affiliates.tierId }).from(affiliates).where(eq(affiliates.id, affiliateId)),
  ])
  return resolveRule({ program, tiers, rules, customers, tierOverrideId: aff?.tierId ?? null, campaignId: ctx.campaignId, couponId: ctx.couponId, now: new Date() })
}
