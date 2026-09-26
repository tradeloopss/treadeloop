import { db } from "@/lib/db"
import { subscriptions } from "@/lib/db/schema"
import { and, desc, eq, gt, isNotNull } from "drizzle-orm"
import { getWhopClient, renewalPriceFor, getProductIdForPlan, PLAN_PRICING, type PlanTier, type Billing } from "@/lib/whop"
import { hasUsedTrial, PENDING_STATUS } from "@/lib/subscription"

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
//
// The free trial is decided here, not by the button that was clicked: one
// per person, so someone who has had theirs gets a plan that bills today.
//
// `replaces` is the membership a plan switch takes over from: it travels in
// the metadata, and once the new membership is live the old one is set not
// to renew (retireReplacedMembership), so nobody pays for both.
export async function createCheckout(
  user: { id: string; email: string },
  plan: PlanTier,
  billing: Billing,
  replaces: string | null = null,
  // Hashed IP of the request (lib/trial-ip.ts): a trial is offered only if this
  // IP hasn't already claimed one, and the hash is stored on the row below.
  ipHash: string | null = null
): Promise<string> {
  const withTrial = !(await hasUsedTrial(user.id, user.email, ipHash))
  const { amount, billingPeriodDays, trialPeriodDays } = renewalPriceFor(plan, billing, withTrial)
  const title = `${PLAN_PRICING[plan].title} (${billing === "annual" ? "Annual" : "Monthly"})`
  const productId = await getProductIdForPlan(plan)

  const client = getWhopClient()
  const config = await client.checkoutConfigurations.create({
    plan: {
      title,
      product_id: productId,
      renewal_price: amount,
      billing_period: billingPeriodDays,
      ...(trialPeriodDays > 0 ? { trial_period_days: trialPeriodDays } : {}),
      currency: "usd",
      plan_type: "renewal",
    },
    metadata: { plan, billing, app_user_id: user.id, ...(replaces ? { replaces_membership: replaces } : {}) },
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
      // Only record the IP when a trial is actually being granted, so the
      // check counts trials, not every checkout, from an address.
      trialIpHash: withTrial ? ipHash : null,
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
    await retireReplacedMembership(userId, membership.metadata)

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

// A plan switch is live: stop the membership it replaced from renewing (it
// keeps access to what was already paid for). Only a membership our records
// say belongs to this same user is touched; setting it twice is harmless.
export async function retireReplacedMembership(userId: string | null | undefined, metadata: Record<string, unknown> | null | undefined): Promise<void> {
  const replaces = typeof metadata?.replaces_membership === "string" ? metadata.replaces_membership : null
  if (!userId || !replaces) return
  const [row] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.whopMembershipId, replaces)))
  if (!row) return
  try {
    await getWhopClient().memberships.update({ id: replaces, cancel_at_period_end: true })
  } catch (err) {
    console.error("[checkout] couldn't stop the replaced membership from renewing:", replaces, err instanceof Error ? err.message : err)
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
