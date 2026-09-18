import { WhopClient } from "@whop/sdk"

export type PlanTier = "essential" | "pro"
export type Billing = "monthly" | "annual"

export function getWhopClient() {
  return new WhopClient({ token: process.env.WHOP_API_KEY })
}

// The per-month price shown on /pricing. Annual bills the full-year total
// up front (12x this), monthly bills this amount every 30 days.
export const PLAN_PRICING: Record<PlanTier, { title: string; monthlyPrice: number; annualPrice: number }> = {
  essential: { title: "Essential", monthlyPrice: 25, annualPrice: 18.75 },
  pro: { title: "Pro", monthlyPrice: 55, annualPrice: 41.25 },
}

// Free trial before the first charge — longer on annual since that's a
// bigger up-front commitment to ask someone to try blind. Exported so the
// pricing UI can show the same numbers without duplicating them.
export const TRIAL_DAYS: Record<Billing, number> = { monthly: 7, annual: 14 }

// Limited-time launch promo. The deadline is a fixed date on purpose: a
// rolling "ends in 30 days" window recomputed on each page load would never
// actually expire, which is just a fake countdown. Applied in
// renewalPriceFor below as well as on the pricing UI, so the price someone
// is shown is the price Whop actually charges.
export const PROMO = {
  percentOff: 20,
  endsAt: new Date("2026-10-18T23:59:59Z"),
}

export function isPromoActive(now: Date = new Date()): boolean {
  return now.getTime() <= PROMO.endsAt.getTime()
}

// Rounded to whole cents so the displayed price and the charged amount
// can't drift apart.
export function promoPrice(price: number, now: Date = new Date()): number {
  if (!isPromoActive(now)) return price
  return Math.round(price * (1 - PROMO.percentOff / 100) * 100) / 100
}

export function renewalPriceFor(plan: PlanTier, billing: Billing): { amount: number; billingPeriodDays: number; trialPeriodDays: number } {
  const pricing = PLAN_PRICING[plan]
  const trialPeriodDays = TRIAL_DAYS[billing]
  if (billing === "annual") {
    return { amount: Math.round(promoPrice(pricing.annualPrice) * 12 * 100) / 100, billingPeriodDays: 365, trialPeriodDays }
  }
  return { amount: promoPrice(pricing.monthlyPrice), billingPeriodDays: 30, trialPeriodDays }
}

// Whop requires an existing product for a dynamically-created renewal plan
// ("you must pass in product details") — it won't create one inline from
// just a title. These are the two products already set up in the Whop
// dashboard (from the checkout links originally shared: .../essentials-8c
// and .../pro-fa-b247), resolved to their prod_ id by route slug and cached
// per server process since they never change.
const PRODUCT_ROUTE_BY_TIER: Record<PlanTier, string> = {
  essential: "essentials-8c",
  pro: "pro-fa-b247",
}

const cachedProductIds: Partial<Record<PlanTier, string>> = {}

// products.retrieve accepts the route slug directly as `id` and only needs
// access_pass:basic:read — unlike accounts.retrieve("me"), which pulls in
// balance data behind a scope this API key doesn't have.
export async function getProductIdForPlan(plan: PlanTier): Promise<string> {
  const cached = cachedProductIds[plan]
  if (cached) return cached

  const client = getWhopClient()
  const route = PRODUCT_ROUTE_BY_TIER[plan]
  const product = await client.products.retrieve({ id: route })
  cachedProductIds[plan] = product.id
  return product.id
}

// Legacy fallback only — checkouts created through startCheckout() carry
// their tier directly in metadata.plan, which the webhook reads first, so
// this is only relevant for a payment that didn't go through that flow.
const PLAN_TIER_BY_ID: Record<string, PlanTier> = {
  ...(process.env.WHOP_ESSENTIAL_PLAN_ID ? { [process.env.WHOP_ESSENTIAL_PLAN_ID]: "essential" as const } : {}),
  ...(process.env.WHOP_PRO_PLAN_ID ? { [process.env.WHOP_PRO_PLAN_ID]: "pro" as const } : {}),
}

export function tierFromPlanId(planId: string | null | undefined): PlanTier | "unknown" {
  if (!planId) return "unknown"
  return PLAN_TIER_BY_ID[planId] ?? "unknown"
}
