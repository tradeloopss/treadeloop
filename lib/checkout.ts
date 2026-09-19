import { db } from "@/lib/db"
import { subscriptions } from "@/lib/db/schema"
import { and, desc, eq, gt, isNotNull } from "drizzle-orm"
import { getWhopClient, renewalPriceFor, getProductIdForPlan, PLAN_PRICING, type PlanTier, type Billing } from "@/lib/whop"

// A checkout the user has started but Whop hasn't confirmed yet. Not in
// lib/subscription.ts's ACTIVE_STATUSES, so it never grants access by
// itself — it only remembers which Whop plan belongs to which user.
export const PENDING_STATUS = "pending"

// Membership statuses that mean the user should have access right now,
// mapped to what gets stored. "canceling" is an active membership that
// won't renew, so it still grants access until it lapses.
const GRANTING_STATUS: Record<string, string> = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  canceling: "active",
}

// Creates a real Whop checkout page on the fly — via an inline plan on the
// Checkout Configuration, not a link to the storefront product page — and
// returns its URL. Every checkout gets its own freshly created plan, so
// that plan id identifies this one purchase: it's stored on a pending
// subscriptions row, and both the webhook and confirmPendingCheckouts()
// use it to tie the resulting membership back to this user even if Whop
// drops the metadata. The tier and billing interval also travel in the
// configuration's metadata, which Whop copies onto the payment/membership.
export async function createCheckout(
  user: { id: string; email: string },
  plan: PlanTier,
  billing: Billing
): Promise<string> {
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
    metadata: { plan, billing, app_user_id: user.id },
    // Whop rejects anything but a real https:// URL — in local dev
    // BETTER_AUTH_URL is http://localhost:3000, so this only sends it once
    // deployed behind a real https domain, and just omits it otherwise
    // (Whop falls back to its own default post-checkout page).
    redirect_url: process.env.BETTER_AUTH_URL?.startsWith("https://")
      ? `${process.env.BETTER_AUTH_URL}/checkout/complete`
      : undefined,
  })

  if (!config.purchase_url) throw new Error("Whop did not return a checkout URL")
  if (config.plan?.id) {
    await db.insert(subscriptions).values({
      userId: user.id,
      email: user.email,
      plan,
      billing,
      status: PENDING_STATUS,
      whopPlanId: config.plan.id,
    })
  }
  return config.purchase_url
}

let warnedMissingScope = false

// Asks Whop directly whether any of the user's recent pending checkouts has
// turned into a membership, and activates the row if so — so access doesn't
// have to wait for the webhook to arrive. Needs the API key to hold Whop's
// member:basic:read permission; without it this logs once and returns,
// leaving activation to the webhook.
export async function confirmPendingCheckouts(userId: string): Promise<void> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const pending = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.status, PENDING_STATUS),
        isNotNull(subscriptions.whopPlanId),
        gt(subscriptions.createdAt, weekAgo)
      )
    )
    .orderBy(desc(subscriptions.createdAt))
    .limit(5)
  if (pending.length === 0) return

  const client = getWhopClient()
  for (const row of pending) {
    let memberships
    try {
      memberships = (await client.memberships.list({ plan_id: row.whopPlanId!, first: 5 })).data
    } catch (err) {
      if (!warnedMissingScope) {
        warnedMissingScope = true
        console.warn(
          "[checkout] could not look up memberships on Whop (the API key needs member:basic:read); waiting for the webhook instead:",
          err instanceof Error ? err.message : err
        )
      }
      return
    }

    const membership = memberships.find((m) => GRANTING_STATUS[m.status])
    if (!membership) continue

    try {
      await db
        .update(subscriptions)
        .set({
          status: GRANTING_STATUS[membership.status],
          whopMembershipId: membership.id,
          currentPeriodEnd: membership.current_period_end ? new Date(membership.current_period_end) : null,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, row.id))
    } catch (err) {
      // Unique violation on whopMembershipId: the webhook already recorded
      // this membership in its own row, so the pending placeholder is moot.
      const code = (err as { code?: string; cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code
      if (code !== "23505") throw err
      await db.delete(subscriptions).where(eq(subscriptions.id, row.id))
    }
  }
}

// The pending row created for a checkout, found by the one-off plan id that
// checkout generated. Lets the webhook attribute a membership to its user
// without relying on metadata or email.
export async function findPendingCheckoutByPlan(planId: string) {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.whopPlanId, planId), eq(subscriptions.status, PENDING_STATUS)))
  return row
}
