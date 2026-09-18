"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { subscriptions } from "@/lib/db/schema"
import { desc, eq } from "drizzle-orm"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getWhopClient, renewalPriceFor, getProductIdForPlan, PLAN_PRICING, type PlanTier, type Billing } from "@/lib/whop"

async function getSession() {
  return auth.api.getSession({ headers: await headers() })
}

export async function getMySubscription() {
  const session = await getSession()
  if (!session?.user) return null
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, session.user.id))
    .orderBy(desc(subscriptions.updatedAt))
  return row ?? null
}

// Creates a real Whop checkout page on the fly — via an inline plan on the
// Checkout Configuration, not a link to the storefront product page — and
// redirects straight to it. The tier and billing interval travel in the
// configuration's own metadata, which Whop copies onto the resulting
// payment/membership, so the webhook always knows the tier even though the
// plan itself is generated per-click rather than a fixed plan_id.
export async function startCheckout(plan: PlanTier, billing: Billing) {
  const session = await getSession()
  const { amount, billingPeriodDays, trialPeriodDays } = renewalPriceFor(plan, billing)
  const title = `${PLAN_PRICING[plan].title} (${billing === "annual" ? "Annual" : "Monthly"})`
  const productId = await getProductIdForPlan(plan)

  const client = getWhopClient()
  const config = await client.checkoutConfigurations.create({
    plan: {
      title,
      product_id: productId,
      renewal_price: amount,
      billing_period: billingPeriodDays,
      trial_period_days: trialPeriodDays,
      currency: "usd",
      plan_type: "renewal",
    },
    metadata: {
      plan,
      billing,
      ...(session?.user ? { app_user_id: session.user.id } : {}),
    },
    // Whop rejects anything but a real https:// URL — in local dev
    // BETTER_AUTH_URL is http://localhost:3000, so this only sends it once
    // deployed behind a real https domain, and just omits it otherwise
    // (Whop falls back to its own default post-checkout page).
    redirect_url: process.env.BETTER_AUTH_URL?.startsWith("https://") ? process.env.BETTER_AUTH_URL : undefined,
  })

  if (!config.purchase_url) throw new Error("Whop did not return a checkout URL")
  redirect(config.purchase_url)
}
