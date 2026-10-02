import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliates } from "@/lib/db/schema"
import { tierFor, type TierPerk, type TierPerks } from "./engine"
import { loadTiers, paidCustomerCount } from "./program"

// "Does this user's affiliate tier include X?" — the read side of tier perks,
// kept apart from perks.ts (which also creates coupons and grants plans) so the
// app shell can ask without pulling the checkout provider in with it.

// The perks of the tier this user's affiliate account sits in — {} for anyone
// who isn't an approved affiliate. Never throws: a perk is an extra, and a
// failed lookup must not take a page down with it.
export async function perksForUser(userId: string): Promise<TierPerks> {
  try {
    const [aff] = await db.select({ id: affiliates.id, status: affiliates.status, tierId: affiliates.tierId }).from(affiliates).where(eq(affiliates.userId, userId))
    if (!aff || aff.status !== "approved") return {}
    const [tiers, customers] = await Promise.all([loadTiers(), paidCustomerCount(aff.id)])
    return tierFor(tiers, customers, aff.tierId)?.perks ?? {}
  } catch (e) {
    console.error("[affiliates] perks couldn't be read:", e instanceof Error ? e.message : e)
    return {}
  }
}

export const userHasPerk = async (userId: string, perk: TierPerk) => (await perksForUser(userId))[perk] === true
