import { NextResponse } from "next/server"
import { unwrapWebhook, WebhookVerificationError } from "@whop/sdk/helpers"
import { db } from "@/lib/db"
import { subscriptions, user } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { tierFromPlanId, type PlanTier } from "@/lib/whop"
import { findPendingCheckoutByPlan, retireReplacedMembership } from "@/lib/checkout"
import { money } from "@/lib/admin/whop"
import { handleAffiliateMembership, handleAffiliatePayment, handleAffiliateRefund } from "@/lib/affiliates/commissions"

function tierFromMetadata(metadata: Record<string, unknown> | null | undefined): PlanTier | "unknown" {
  const value = metadata?.plan
  return value === "essential" || value === "pro" ? value : "unknown"
}

function billingFromMetadata(metadata: Record<string, unknown> | null | undefined): "monthly" | "annual" | null {
  const value = metadata?.billing
  return value === "monthly" || value === "annual" ? value : null
}

// Whop's own SDK ships no typed model for a delivered webhook's wrapper
// shape (verified directly in its source — Fern generates event *names*,
// not payload models). This reads defensively across the plausible wrapper
// keys; the [whop webhook] log line below is there so a real delivery can
// confirm which one Whop actually uses.
function parseEvent(body: Record<string, unknown>): { name: string | undefined; payload: Record<string, any> } {
  const name = (body.event ?? body.type ?? body.action) as string | undefined
  const payload = (body.data ?? body.object ?? body) as Record<string, any>
  return { name, payload }
}

async function resolveUserIdByEmail(email: string): Promise<string | null> {
  const [match] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()))
  return match?.id ?? null
}

// The row this membership already has, or else the pending row its checkout
// created (lib/checkout.ts) — found by the one-off plan id each checkout
// generates, which ties the purchase to its user even when metadata or an
// email isn't there to go on.
async function findSubscriptionRow(membershipId: string, planId: string | null) {
  const [byMembership] = await db.select().from(subscriptions).where(eq(subscriptions.whopMembershipId, membershipId))
  if (byMembership) return byMembership
  return planId ? await findPendingCheckoutByPlan(planId) : undefined
}

// payment.succeeded carries the buyer's email directly (Membership does
// not), so this is what actually creates/refreshes a subscriptions row.
async function handlePaymentSucceeded(payment: Record<string, any>) {
  const membershipId: string | undefined = payment.membership_id ?? payment.membership?.id ?? undefined
  if (!membershipId) return

  const email: string | null = payment.customer_email ?? null
  const planId: string | null = payment.plan_id ?? payment.plan?.id ?? null
  const metadataUserId: string | undefined = payment.metadata?.app_user_id
  const userId = metadataUserId ?? (email ? await resolveUserIdByEmail(email) : null)
  // Checkouts created by createCheckout() (lib/checkout.ts) carry the tier
  // directly in metadata (it's copied from the checkout configuration onto
  // the payment) — tierFromPlanId is only a fallback for a payment that
  // didn't go through that flow.
  const metaTier = tierFromMetadata(payment.metadata)
  const tier = metaTier !== "unknown" ? metaTier : tierFromPlanId(planId)
  const billing = billingFromMetadata(payment.metadata)

  const existing = await findSubscriptionRow(membershipId, planId)
  if (existing) {
    await db
      .update(subscriptions)
      .set({
        userId: userId ?? existing.userId,
        email: email ?? existing.email,
        whopMembershipId: membershipId,
        plan: tier === "unknown" ? existing.plan : tier,
        billing: billing ?? existing.billing,
        whopPlanId: planId ?? existing.whopPlanId,
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, existing.id))
  } else {
    await db.insert(subscriptions).values({
      userId,
      email: email ?? "",
      plan: tier === "unknown" ? "essential" : tier,
      billing,
      whopPlanId: planId,
      whopMembershipId: membershipId,
      status: "active",
    })
  }
  await retireReplacedMembership(userId ?? existing?.userId, payment.metadata)
  await affiliate(() => creditAffiliate(payment, userId ?? existing?.userId ?? null, tier === "unknown" ? (existing?.plan ?? null) : tier, billing ?? existing?.billing ?? null))
}

// The affiliate program hangs off the same billing events, but it must never
// be able to break them: whatever it throws is logged and swallowed.
async function affiliate(fn: () => Promise<void>) {
  try {
    await fn()
  } catch (err) {
    console.error("[whop webhook] affiliate handler error", err)
  }
}

// A payment by a referred customer earns their affiliate a commission
// (lib/affiliates/commissions.ts). The amount is what was actually charged,
// net of tax — read from the verified payload, never from the client.
async function creditAffiliate(payment: Record<string, any>, userId: string | null, plan: string | null, billing: string | null) {
  if (!payment.id) return
  const total = money(payment.usd_total) ?? money(payment.total) ?? money(payment.subtotal) ?? 0
  const amount = Math.max(0, total - (money(payment.tax_amount) ?? 0))
  if (!(amount > 0)) return
  await handleAffiliatePayment({
    userId,
    paymentId: String(payment.id),
    amount,
    currency: payment.usd_total != null ? "usd" : String(payment.currency ?? "usd"),
    promoCode: payment.promo_code?.code ?? null,
    promoCodeId: payment.promo_code_id ?? payment.promo_code?.id ?? null,
    plan,
    billing,
    paidAt: payment.paid_at ? new Date(payment.paid_at) : new Date(),
  })
}

// refund.created / refund.updated: the commission on the refunded payment is
// reversed (in full, or by the refunded share).
async function handleRefund(refund: Record<string, any>) {
  const paymentId: string | undefined = refund.payment?.id ?? refund.payment_id
  if (!refund.id || !paymentId || refund.status === "failed" || refund.status === "canceled") return
  await handleAffiliateRefund({
    eventId: String(refund.id),
    paymentId: String(paymentId),
    refundAmount: money(refund.amount) ?? money(refund.original_amount) ?? 0,
    paymentTotal: money(refund.payment?.usd_total) ?? money(refund.payment?.total) ?? 0,
    kind: "refund",
  })
}

// dispute.created: a real chargeback (not a pre-dispute inquiry) reverses the
// whole commission and is flagged for review.
async function handleDispute(dispute: Record<string, any>) {
  const paymentId: string | undefined = dispute.payment?.id ?? dispute.payment_id
  if (!dispute.id || !paymentId || dispute.inquiry === true) return
  await handleAffiliateRefund({ eventId: String(dispute.id), paymentId: String(paymentId), refundAmount: money(dispute.amount) ?? 0, paymentTotal: money(dispute.payment?.usd_total) ?? money(dispute.payment?.total) ?? 0, kind: "chargeback" })
}

// membership.activated fires the moment someone starts a free trial, before
// any money moves — payment.succeeded only fires later, once the trial ends
// and the first real charge goes through (or never, if they cancel first).
// So this can't just update a row payment.succeeded already created; for a
// new trial it has to create one itself, or a trialing user would see no
// Pro access for the entire trial. Membership carries the same metadata we
// set in createCheckout() (copied through same as it is onto Payment), so
// metadata.app_user_id resolves the user directly — no email on Membership
// to fall back on the way payment.succeeded's handler does.
async function handleMembershipChanged(eventName: string, membership: Record<string, any>) {
  const membershipId: string | undefined = membership.id
  if (!membershipId) return

  const status = eventName === "membership.activated" ? (membership.status ?? "active") : "canceled"
  const currentPeriodEnd = membership.current_period_end ? new Date(membership.current_period_end) : null
  const planId: string | null = membership.plan_id ?? membership.plan?.id ?? null
  const metaTier = tierFromMetadata(membership.metadata)
  const tier = metaTier !== "unknown" ? metaTier : tierFromPlanId(planId)
  const billing = billingFromMetadata(membership.metadata)
  const userId: string | undefined = membership.metadata?.app_user_id

  const existing = await findSubscriptionRow(membershipId, planId)
  if (existing) {
    await db
      .update(subscriptions)
      .set({
        userId: userId ?? existing.userId,
        whopMembershipId: membershipId,
        plan: tier === "unknown" ? existing.plan : tier,
        billing: billing ?? existing.billing,
        status,
        currentPeriodEnd,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, existing.id))
  } else if (eventName === "membership.activated") {
    await db.insert(subscriptions).values({
      userId: userId ?? null,
      email: "", // Membership carries no email — payment.succeeded backfills it once/if a real charge lands
      plan: tier === "unknown" ? "essential" : tier,
      billing,
      whopPlanId: planId,
      whopMembershipId: membershipId,
      status,
      currentPeriodEnd,
    })
  }
  if (eventName === "membership.activated") await retireReplacedMembership(userId ?? existing?.userId, membership.metadata)
  await affiliate(() =>
    handleAffiliateMembership({
      userId: userId ?? existing?.userId,
      event: eventName !== "membership.activated" ? "cancelled" : status === "trialing" ? "trial" : "active",
    })
  )
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const headers = Object.fromEntries(request.headers.entries())

  let body: Record<string, unknown>
  try {
    body = unwrapWebhook(rawBody, { headers, key: process.env.WHOP_WEBHOOK_SECRET })
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
    }
    console.error("[whop webhook] verification error", err)
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { name, payload } = parseEvent(body)
  console.log("[whop webhook]", name, JSON.stringify(payload).slice(0, 500))

  try {
    if (name === "payment.succeeded") {
      await handlePaymentSucceeded(payload)
    } else if (name === "membership.activated" || name === "membership.deactivated") {
      await handleMembershipChanged(name, payload)
    } else if (name === "refund.created" || name === "refund.updated") {
      await affiliate(() => handleRefund(payload))
    } else if (name === "dispute.created") {
      await affiliate(() => handleDispute(payload))
    }
  } catch (err) {
    // Still ack with 200 — a bug on our side re-processing the same payload
    // forever isn't fixed by Whop's retries, and failing the delivery just
    // makes the dashboard show it as broken.
    console.error("[whop webhook] handler error", err)
  }

  return NextResponse.json({ received: true })
}
