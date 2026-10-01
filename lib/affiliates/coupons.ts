import { and, eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliateCampaigns, affiliateCoupons } from "@/lib/db/schema"
import { createPromoCode, deletePromoCode } from "@/lib/admin/whop"
import { getProductIdForPlan } from "@/lib/whop"
import { couponCodeValid } from "./engine"
import { getProgram } from "./program"

// Affiliate coupons. Each is a REAL Whop promo code — the customer types it at
// checkout and Whop applies the discount — and the payment that follows carries
// the code, which is how a coupon attributes a sale (attribution.ts).

const MAX_COUPONS = 10

export type CouponInput = { code: unknown; percent: unknown; durationMonths: unknown; plan?: unknown; campaignId?: unknown; usageLimit?: unknown; expiresAt?: unknown }

async function mintOnWhop(c: { code: string; percent: number; durationMonths: number; plan: string | null; usageLimit: number | null; expiresAt: Date | null }): Promise<string | null> {
  const promo = (await createPromoCode({
    code: c.code,
    promoType: "percentage",
    amountOff: c.percent,
    durationMonths: c.durationMonths,
    // Affiliate coupons bring in NEW customers; they aren't a discount for
    // people who already subscribe.
    newUsersOnly: true,
    onePerCustomer: true,
    stock: c.usageLimit,
    unlimitedStock: c.usageLimit == null,
    expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
    productId: c.plan === "essential" || c.plan === "pro" ? await getProductIdForPlan(c.plan) : null,
  })) as { id?: string } | null
  return promo?.id ?? null
}

export async function createCoupon(affiliateId: number, input: CouponInput): Promise<void> {
  const program = await getProgram()
  if (!program.couponsEnabled) throw new Error("Coupons aren't available in the program right now.")
  const code = String(input.code ?? "").trim().toUpperCase()
  if (!couponCodeValid(code)) throw new Error("Use 3–20 capital letters, numbers, dashes or underscores for the code.")
  const percent = Math.round(Number(input.percent))
  if (!Number.isFinite(percent) || percent < 1) throw new Error("Enter a discount percentage.")
  if (percent > program.maxCouponPercent) throw new Error(`The largest discount you can offer is ${program.maxCouponPercent}%.`)
  const durationMonths = Math.round(Number(input.durationMonths))
  if (!Number.isFinite(durationMonths) || durationMonths < 1 || durationMonths > 12) throw new Error("The discount can last 1 to 12 months.")
  const plan = input.plan === "essential" || input.plan === "pro" ? input.plan : null
  const usageLimit = input.usageLimit == null || input.usageLimit === "" ? null : Math.round(Number(input.usageLimit))
  if (usageLimit != null && (!Number.isFinite(usageLimit) || usageLimit < 1 || usageLimit > 100_000)) throw new Error("Enter a usage limit of at least 1, or leave it empty for no limit.")
  const expiresAt = input.expiresAt ? new Date(String(input.expiresAt)) : null
  if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now())) throw new Error("Choose an expiry date in the future.")

  let campaignId: number | null = null
  if (input.campaignId != null && input.campaignId !== "") {
    const [c] = await db.select({ id: affiliateCampaigns.id }).from(affiliateCampaigns).where(and(eq(affiliateCampaigns.id, Number(input.campaignId)), eq(affiliateCampaigns.affiliateId, affiliateId)))
    if (!c) throw new Error("That campaign no longer exists.")
    campaignId = c.id
  }

  const [[count], [taken]] = await Promise.all([
    db.select({ v: sql<number>`count(*)::int` }).from(affiliateCoupons).where(and(eq(affiliateCoupons.affiliateId, affiliateId), eq(affiliateCoupons.status, "active"))),
    db.select({ id: affiliateCoupons.id }).from(affiliateCoupons).where(eq(affiliateCoupons.code, code)),
  ])
  if (taken) throw new Error("That code is already taken. Choose another.")
  if ((count?.v ?? 0) >= MAX_COUPONS) throw new Error(`You can have up to ${MAX_COUPONS} active coupons. Disable one first.`)

  // Reserve the code in our table first (the unique index settles a race),
  // then mint it on Whop; if Whop refuses, the reservation is rolled back so
  // a coupon that can't actually be redeemed never appears.
  const [row] = await db
    .insert(affiliateCoupons)
    .values({ affiliateId, campaignId, code, discountType: "percent", discountValue: String(percent), durationMonths, plan, usageLimit, expiresAt })
    .onConflictDoNothing({ target: affiliateCoupons.code })
    .returning({ id: affiliateCoupons.id })
  if (!row) throw new Error("That code is already taken. Choose another.")
  try {
    const whopPromoId = await mintOnWhop({ code, percent, durationMonths, plan, usageLimit, expiresAt })
    await db.update(affiliateCoupons).set({ whopPromoId }).where(eq(affiliateCoupons.id, row.id))
  } catch (e) {
    await db.delete(affiliateCoupons).where(eq(affiliateCoupons.id, row.id))
    throw new Error(`The coupon couldn't be created at checkout: ${e instanceof Error ? e.message : "unknown error"}`)
  }
}

// Disabling removes the promo code from Whop so it stops working at checkout;
// the row (and its history) stays. Enabling mints it again.
export async function setCouponStatus(affiliateId: number | null, couponId: number, status: "active" | "disabled"): Promise<void> {
  const [c] = await db
    .select()
    .from(affiliateCoupons)
    .where(and(eq(affiliateCoupons.id, couponId), affiliateId == null ? undefined : eq(affiliateCoupons.affiliateId, affiliateId)))
  if (!c) throw new Error("That coupon no longer exists.")
  if (c.status === status) return
  if (status === "disabled") {
    if (c.whopPromoId) await deletePromoCode(c.whopPromoId).catch((e) => console.error("[affiliates] couldn't remove the promo code on Whop:", e instanceof Error ? e.message : e))
    await db.update(affiliateCoupons).set({ status: "disabled", whopPromoId: null }).where(eq(affiliateCoupons.id, c.id))
    return
  }
  const program = await getProgram()
  if (!program.couponsEnabled) throw new Error("Coupons aren't available in the program right now.")
  if (c.expiresAt && c.expiresAt.getTime() < Date.now()) throw new Error("That coupon has expired. Create a new one.")
  const left = c.usageLimit == null ? null : Math.max(0, c.usageLimit - c.uses)
  if (left === 0) throw new Error("That coupon has reached its usage limit.")
  const whopPromoId = await mintOnWhop({ code: c.code, percent: Number(c.discountValue), durationMonths: c.durationMonths, plan: c.plan, usageLimit: left, expiresAt: c.expiresAt })
  await db.update(affiliateCoupons).set({ status: "active", whopPromoId }).where(eq(affiliateCoupons.id, c.id))
}
