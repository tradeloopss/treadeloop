import { and, eq, isNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { adminAuditLog, affiliateReferrals, affiliates, subscriptions, user } from "@/lib/db/schema"
import { ensurePermanentCoupon } from "./coupons"
import { TIER_PERKS, tierFor, tierHasPerk, type TierPerk, type TierRow } from "./engine"
import { loadTiers, paidCustomerCount } from "./program"
import type { ProgramSettings } from "./types"

// What an affiliate's tier unlocks besides its rate (engine.TIER_PERKS), and
// the two perks that have to be GIVEN rather than just checked:
//
//   coupon       the personal discount code is created when the tier is reached
//   freeAccount  a Pro plan with no end date is granted, once
//
// The other two are looked up where they matter (perk-access.ts): `beta` by
// lib/beta.ts, `prioritySupport` when a support ticket is opened.
//
// Only an APPROVED affiliate has perks. What was already given is not taken
// back by anything here: a code keeps working, and the free account stays until
// an admin revokes it (Admin → the user → Subscriptions).

// The words for a perk, wherever a tier's benefits are listed.
export function perkLabel(perk: TierPerk, program: Pick<ProgramSettings, "permanentCouponPercent">): string {
  if (perk === "coupon") return `Personalized ${program.permanentCouponPercent}% off coupon code for your audience`
  if (perk === "beta") return "Beta feature access"
  if (perk === "freeAccount") return "Free-forever TradeLoop account"
  return "Priority access to support & feature requests"
}

export type PerksGiven = { tier: TierRow | null; couponCode: string | null; freeAccount: boolean }

// The free account: a Pro plan with no end date, as an admin grant so every
// screen that shows or revokes a granted plan already knows it. Given ONCE per
// affiliate (affiliates.freeAccountAt is the claim): if an admin revokes it
// later, the next run does not hand it back. Returns whether it was given now.
async function grantFreeAccount(aff: { id: number; userId: string; email: string }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [claimed] = await tx.update(affiliates).set({ freeAccountAt: new Date() }).where(and(eq(affiliates.id, aff.id), isNull(affiliates.freeAccountAt))).returning({ id: affiliates.id })
    if (!claimed) return false
    const [account] = await tx.select({ email: user.email }).from(user).where(eq(user.id, aff.userId))
    await tx.insert(subscriptions).values({ userId: aff.userId, email: account?.email ?? aff.email, plan: "pro", status: "active", source: "admin", currentPeriodEnd: null })
    await tx.insert(adminAuditLog).values({ actorId: "system", actorEmail: "affiliate program", action: "plan.grant", targetUserId: aff.userId, details: { plan: "pro", until: null, note: "Affiliate tier perk: free-forever account", affiliateId: aff.id } })
    return true
  })
}

// Puts in place what the affiliate's current tier unlocks. Safe to call as
// often as you like — each perk is given once.
export async function syncTierPerks(affiliateId: number): Promise<PerksGiven> {
  const none: PerksGiven = { tier: null, couponCode: null, freeAccount: false }
  const [aff] = await db.select({ id: affiliates.id, userId: affiliates.userId, email: affiliates.email, status: affiliates.status, tierId: affiliates.tierId }).from(affiliates).where(eq(affiliates.id, affiliateId))
  if (!aff || aff.status !== "approved") return none
  const [tiers, customers] = await Promise.all([loadTiers(), paidCustomerCount(aff.id)])
  const tier = tierFor(tiers, customers, aff.tierId)
  if (!tier) return none
  // The code is minted on Whop; if that fails now, the daily run tries again.
  const coupon = tierHasPerk(tier, "coupon") ? await ensurePermanentCoupon(aff.id).catch(() => null) : null
  const freeAccount = tierHasPerk(tier, "freeAccount") ? await grantFreeAccount(aff) : false
  return { tier, couponCode: coupon && coupon.status === "active" ? coupon.code : null, freeAccount }
}

// The daily run: every approved affiliate whose tier unlocks something that is
// given — whoever reached it while the code couldn't be minted, was moved into
// a tier by hand, or sits in a tier that had a perk added.
export async function syncAllTierPerks(limit = 300): Promise<{ checked: number; freeAccounts: number }> {
  const tiers = await loadTiers()
  if (!tiers.some((t) => t.enabled && (tierHasPerk(t, "coupon") || tierHasPerk(t, "freeAccount")))) return { checked: 0, freeAccounts: 0 }
  const rows = await db
    .select({ id: affiliates.id, tierId: affiliates.tierId, customers: sql<number>`(select count(*)::int from ${affiliateReferrals} r where r."affiliateId" = ${affiliates.id} and r."firstPaymentAt" is not null)` })
    .from(affiliates)
    .where(eq(affiliates.status, "approved"))
    .orderBy(affiliates.id)
  const out = { checked: 0, freeAccounts: 0 }
  for (const r of rows) {
    const tier = tierFor(tiers, r.customers, r.tierId)
    if (!tierHasPerk(tier, "coupon") && !tierHasPerk(tier, "freeAccount")) continue
    if (out.checked >= limit) break
    out.checked++
    try {
      if ((await syncTierPerks(r.id)).freeAccount) out.freeAccounts++
    } catch (e) {
      console.error("[affiliates] tier perks couldn't be applied:", r.id, e instanceof Error ? e.message : e)
    }
  }
  return out
}

// What a tier unlocks, as lines for a message — with what was actually given
// (the code itself, the account being live) when that is known.
export function perkLines(tier: TierRow, given: PerksGiven | null, program: Pick<ProgramSettings, "permanentCouponPercent">): string[] {
  return TIER_PERKS.filter((k) => tierHasPerk(tier, k)).map((k) => {
    if (k === "coupon" && given?.couponCode) return `${perkLabel(k, program)}: ${given.couponCode}`
    if (k === "freeAccount" && given?.freeAccount) return `${perkLabel(k, program)} — it's active now. If you pay for a subscription you can cancel it and keep full access.`
    return perkLabel(k, program)
  })
}
