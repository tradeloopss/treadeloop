import { db } from "@/lib/db"
import { subscriptions } from "@/lib/db/schema"
import { createPromoCode } from "@/lib/admin/whop"

export type FulfillOutcome = { status: "fulfilled" | "failed" | "none"; ref: string | null; error?: string }

// Provision a claimed prize in the real systems:
//  - discount  → create a billing promo code whose code IS the prize code, so
//                the user types TL-45-XXXX at checkout and gets the discount.
//  - free_subscription / free_month → grant the plan immediately (a
//                source="cases" subscription row that lapses after N months).
// Best-effort and isolated: a failure is recorded on the claim (so an admin can
// see and re-provision) but never rolls back the claim itself — the user keeps
// their prize.
export async function fulfillPrize(input: {
  userId: string
  userEmail: string
  prizeCode: string
  expiresAt: Date
  reward: { type: string; discountPercent: number | null; subscriptionPlan: string | null; subscriptionMonths: number | null }
}): Promise<FulfillOutcome> {
  const { reward } = input
  try {
    if (reward.type === "discount" && reward.discountPercent) {
      const res = await createPromoCode({
        code: input.prizeCode,
        promoType: "percentage",
        amountOff: reward.discountPercent,
        durationMonths: 1,
        newUsersOnly: false,
        onePerCustomer: true,
        stock: 1,
        expiresAt: input.expiresAt.toISOString(),
      })
      const ref = res && typeof res === "object" && "id" in res ? String((res as { id: unknown }).id) : null
      return { status: "fulfilled", ref }
    }

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

    return { status: "none", ref: null }
  } catch (e) {
    return { status: "failed", ref: null, error: e instanceof Error ? e.message : "Fulfillment failed" }
  }
}
