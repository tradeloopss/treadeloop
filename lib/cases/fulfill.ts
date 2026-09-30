import { and, desc, eq, gt, inArray, isNull, like } from "drizzle-orm"
import { db } from "@/lib/db"
import { dropClaims, dropRewards, subscriptions } from "@/lib/db/schema"
import { createPromoCode, deletePromoCode, extendMembership } from "@/lib/admin/whop"
import { rowGrantsAccess } from "@/lib/subscription"

export type FulfillOutcome = { status: "fulfilled" | "pending" | "failed" | "none"; ref: string | null; error?: string }

const DAY_MS = 86_400_000
const FREE_TIME_TYPES = ["free_subscription", "free_month"]

function addMonths(from: Date, months: number): Date {
  const d = new Date(from)
  d.setMonth(d.getMonth() + months)
  return d
}

// Free time (a won "1 month free") STACKS onto whatever access the user
// already has, instead of running alongside it and being wasted:
//  1. a live Whop membership (paying or trialing) → extended on Whop, which
//     pushes the next charge out by the same amount (so the month is free);
//  2. else an existing granted plan (admin / earlier prize) → its end date
//     moves out by N months;
//  3. else → a new source="cases" grant starting now.
// If Whop can't be reached, the months are granted as a row that starts after
// the current paid period ends, so they're never lost.
// ref = "whop:<id>;days=<n>;until=<iso>" | "ext:<subId>;until=<iso>" | "sub:<subId>;until=<iso>"
export async function stackFreeTime(input: { userId: string; email: string; plan: "essential" | "pro"; months: number; excludeSubId?: number }): Promise<FulfillOutcome> {
  const now = new Date()
  const months = Math.max(1, input.months)
  const rows = (await db.select().from(subscriptions).where(eq(subscriptions.userId, input.userId)).orderBy(desc(subscriptions.updatedAt))).filter(
    (r) => r.id !== input.excludeSubId && rowGrantsAccess(r),
  )

  const whopRow = [...rows].sort((a, b) => Number(b.status !== "past_due") - Number(a.status !== "past_due")).find((r) => r.source === "whop" && r.whopMembershipId)
  if (whopRow) {
    const base = whopRow.currentPeriodEnd && whopRow.currentPeriodEnd > now ? whopRow.currentPeriodEnd : now
    const days = Math.round((addMonths(base, months).getTime() - base.getTime()) / DAY_MS)
    const until = new Date(base.getTime() + days * DAY_MS)
    try {
      await extendMembership(whopRow.whopMembershipId!, days)
      await db.update(subscriptions).set({ currentPeriodEnd: until, updatedAt: now }).where(eq(subscriptions.id, whopRow.id))
      return { status: "fulfilled", ref: `whop:${whopRow.whopMembershipId};days=${days};until=${until.toISOString()}` }
    } catch (e) {
      console.error("[cases] couldn't extend the Whop membership, granting the time after it instead:", e instanceof Error ? e.message : e)
      const [row] = await db
        .insert(subscriptions)
        .values({ userId: input.userId, email: input.email, plan: whopRow.plan === "pro" ? "pro" : input.plan, status: "active", source: "cases", currentPeriodEnd: until })
        .returning({ id: subscriptions.id })
      return { status: "fulfilled", ref: `sub:${row.id};until=${until.toISOString()}` }
    }
  }

  const grantRow = rows.find((r) => (r.source === "admin" || r.source === "cases") && r.currentPeriodEnd && r.currentPeriodEnd > now)
  if (grantRow) {
    const until = addMonths(grantRow.currentPeriodEnd!, months)
    await db.update(subscriptions).set({ currentPeriodEnd: until, updatedAt: now }).where(eq(subscriptions.id, grantRow.id))
    return { status: "fulfilled", ref: `ext:${grantRow.id};until=${until.toISOString()}` }
  }

  const until = addMonths(now, months)
  const [row] = await db
    .insert(subscriptions)
    .values({ userId: input.userId, email: input.email, plan: input.plan, status: "active", source: "cases", currentPeriodEnd: until })
    .returning({ id: subscriptions.id })
  return { status: "fulfilled", ref: `sub:${row.id};until=${until.toISOString()}` }
}

// Whole days of Cases Drop free time the user still has (the latest active
// source="cases" grant). createCheckout adds these to the new plan's free
// period so subscribing mid-prize doesn't waste the rest of it — the first
// charge lands when the free time runs out.
export async function remainingPrizeDays(userId: string): Promise<number> {
  try {
    const now = new Date()
    const [row] = await db
      .select({ end: subscriptions.currentPeriodEnd })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.source, "cases"), eq(subscriptions.status, "active"), gt(subscriptions.currentPeriodEnd, now)))
      .orderBy(desc(subscriptions.currentPeriodEnd))
      .limit(1)
    return row?.end ? Math.ceil((row.end.getTime() - now.getTime()) / DAY_MS) : 0
  } catch {
    return 0
  }
}

// Repair free months claimed before stacking existed: they were granted as a
// separate row running alongside an existing subscription (so they added
// nothing). Move each onto the user's existing access and retire the separate
// row. Idempotent and race-safe: a claim is locked by swapping its ref first.
export async function reconcileFreeTimeClaims(userId: string): Promise<void> {
  try {
    const legacy = await db
      .select({ id: dropClaims.id, ref: dropClaims.fulfillmentRef, months: dropRewards.subscriptionMonths, plan: dropRewards.subscriptionPlan })
      .from(dropClaims)
      .innerJoin(dropRewards, eq(dropRewards.id, dropClaims.rewardId))
      .where(and(eq(dropClaims.userId, userId), inArray(dropRewards.type, FREE_TIME_TYPES), like(dropClaims.fulfillmentRef, "sub:%")))
    for (const c of legacy) {
      if (!c.ref || c.ref.includes("until=")) continue // already in the new format
      const subId = Number(c.ref.slice(4))
      if (!Number.isInteger(subId) || subId <= 0) continue
      const [grant] = await db.select().from(subscriptions).where(eq(subscriptions.id, subId))
      if (!grant) continue
      const others = (await db.select().from(subscriptions).where(eq(subscriptions.userId, userId))).filter((r) => r.id !== subId && rowGrantsAccess(r))
      if (others.length === 0) {
        // Nothing to stack onto — the separate grant IS their access. Just record it.
        await db
          .update(dropClaims)
          .set({ fulfillmentRef: `sub:${subId};until=${(grant.currentPeriodEnd ?? new Date()).toISOString()}` })
          .where(and(eq(dropClaims.id, c.id), eq(dropClaims.fulfillmentRef, c.ref)))
        continue
      }
      // Lock this claim so a concurrent request can't stack it twice.
      const locked = await db
        .update(dropClaims)
        .set({ fulfillmentRef: `reconciling:${subId}` })
        .where(and(eq(dropClaims.id, c.id), eq(dropClaims.fulfillmentRef, c.ref)))
        .returning({ id: dropClaims.id })
      if (locked.length === 0) continue
      try {
        const out = await stackFreeTime({ userId, email: grant.email, plan: c.plan === "pro" ? "pro" : "essential", months: c.months ?? 1, excludeSubId: subId })
        await db.update(subscriptions).set({ status: "canceled", updatedAt: new Date() }).where(eq(subscriptions.id, subId))
        await db.update(dropClaims).set({ fulfillmentRef: `${out.ref};from=sub:${subId}` }).where(eq(dropClaims.id, c.id))
      } catch (e) {
        await db.update(dropClaims).set({ fulfillmentRef: c.ref }).where(eq(dropClaims.id, c.id))
        throw e
      }
    }
  } catch (e) {
    console.error("[cases] couldn't reconcile free-time claims:", e instanceof Error ? e.message : e)
  }
}

// Provision a freshly claimed prize:
//  - free_subscription / free_month → activated immediately and STACKED onto
//    any existing subscription (stackFreeTime). No code.
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
    if (FREE_TIME_TYPES.includes(reward.type)) {
      return await stackFreeTime({ userId: input.userId, email: input.userEmail, plan: reward.subscriptionPlan === "pro" ? "pro" : "essential", months: reward.subscriptionMonths ?? 1 })
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
  return /^(sub|ext|whop|reconciling):/.test(ref) ? null : ref
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
