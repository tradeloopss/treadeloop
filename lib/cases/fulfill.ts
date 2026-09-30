import { and, desc, eq, gt, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { dropClaims, dropRewards, subscriptions } from "@/lib/db/schema"
import { createPromoCode, deletePromoCode } from "@/lib/admin/whop"

export type FulfillOutcome = { status: "fulfilled" | "pending" | "failed" | "none"; ref: string | null; error?: string }

// Provision a freshly claimed prize:
//  - free_subscription / free_month → activated immediately: a
//    source="cases" subscription row that lapses after N months. No code.
//  - discount → nothing public is created yet ("pending"). A discount is only
//    ever redeemable by the person who opened the case, so the promo code is
//    minted at checkout time and locked to that user's own one-off checkout
//    plan (bindPrizeToCheckout) — a shared code is useless to anyone else.
// Best-effort: a failure is recorded on the claim but never voids the prize.
export async function fulfillPrize(input: {
  userId: string
  userEmail: string
  reward: { type: string; subscriptionPlan: string | null; subscriptionMonths: number | null }
}): Promise<FulfillOutcome> {
  const { reward } = input
  try {
    if (reward.type === "free_subscription" || reward.type === "free_month") {
      const plan = reward.subscriptionPlan === "pro" ? "pro" : "essential"
      const months = Math.max(1, reward.subscriptionMonths ?? 1)
      const until = new Date()
      until.setMonth(until.getMonth() + months)
      const [row] = await db
        .insert(subscriptions)
        .values({ userId: input.userId, email: input.userEmail, plan, status: "active", source: "cases", currentPeriodEnd: until })
        .returning({ id: subscriptions.id })
      return { status: "fulfilled", ref: `sub:${row.id}` }
    }
    if (reward.type === "discount") return { status: "pending", ref: null }
    return { status: "none", ref: null }
  } catch (e) {
    return { status: "failed", ref: null, error: e instanceof Error ? e.message : "Fulfillment failed" }
  }
}

// The Whop promo id recorded on a claim. Claims fulfilled before codes were
// account-locked stored the bare id of a public code — delete those too.
const promoIdFrom = (ref: string | null) => {
  if (!ref) return null
  const tagged = ref.match(/promo:([^;]+)/)?.[1]
  if (tagged) return tagged === "?" ? null : tagged
  return ref.startsWith("sub:") ? null : ref
}

// Called by createCheckout() once the user's one-off Whop plan exists: if they
// hold an unused, unexpired Cases Drop discount, mint its promo code restricted
// to THIS plan only (single use), replacing any code bound to an earlier,
// abandoned checkout. Returns the code to show, or null. Never throws — a
// checkout must not fail because of a prize.
export async function bindPrizeToCheckout(userId: string, planId: string): Promise<{ code: string; percent: number } | null> {
  try {
    const now = new Date()
    const [best] = await db
      .select({
        id: dropClaims.id,
        prizeCode: dropClaims.prizeCode,
        expiresAt: dropClaims.expiresAt,
        fulfillmentRef: dropClaims.fulfillmentRef,
        percent: dropRewards.discountPercent,
      })
      .from(dropClaims)
      .innerJoin(dropRewards, eq(dropRewards.id, dropClaims.rewardId))
      .where(
        and(
          eq(dropClaims.userId, userId),
          eq(dropClaims.status, "active"),
          isNull(dropClaims.redeemedAt),
          gt(dropClaims.expiresAt, now),
          eq(dropRewards.type, "discount"),
        ),
      )
      .orderBy(desc(dropRewards.discountPercent), desc(dropClaims.claimedAt))
      .limit(1)
    if (!best || !best.percent) return null

    const previous = promoIdFrom(best.fulfillmentRef)
    if (previous) await deletePromoCode(previous).catch(() => undefined)

    const promo = await createPromoCode({
      code: best.prizeCode,
      promoType: "percentage",
      amountOff: best.percent,
      durationMonths: 1,
      newUsersOnly: false,
      onePerCustomer: true,
      stock: 1,
      expiresAt: best.expiresAt.toISOString(),
      planIds: [planId],
    })
    const promoId = promo && typeof promo === "object" && "id" in promo ? String((promo as { id: unknown }).id) : null
    await db
      .update(dropClaims)
      .set({ fulfillmentStatus: "fulfilled", fulfillmentRef: `promo:${promoId ?? "?"};plan:${planId}` })
      .where(eq(dropClaims.id, best.id))
    return { code: best.prizeCode, percent: best.percent }
  } catch (e) {
    console.error("[cases] couldn't bind a prize to checkout:", e instanceof Error ? e.message : e)
    return null
  }
}
