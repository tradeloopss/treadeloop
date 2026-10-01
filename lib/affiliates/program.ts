import { and, eq, isNotNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliateReferrals, affiliateRules, affiliateTiers, affiliates } from "@/lib/db/schema"
import { getAppSetting, setAppSetting } from "@/lib/app-settings"
import { normalizeProgram, type ProgramSettings } from "./types"
import { resolveRule, type ResolvedRule, type RuleRow, type TierRow } from "./engine"

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

export async function loadTiers(): Promise<TierRow[]> {
  const rows = await db.select().from(affiliateTiers).orderBy(affiliateTiers.sortOrder, affiliateTiers.id)
  return rows.map((t) => ({ id: t.id, name: t.name, minCustomers: t.minCustomers, ratePercent: Number(t.ratePercent), sortOrder: t.sortOrder, enabled: t.enabled }))
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
