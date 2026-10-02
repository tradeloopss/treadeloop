import { randomUUID } from "node:crypto"
import { and, asc, eq, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliateCommissions, affiliateConversions, affiliateReferrals, affiliates } from "@/lib/db/schema"
import { decideCommission, ledgerBalances, planReversal, refundShare, resolveRule, round2, tierFor, type Balances, type ReversalKind } from "./engine"
import { getProgram, loadRules, loadTiers, paidCustomerCount } from "./program"
import { attributeByCoupon } from "./attribution"
import { notifyAffiliate } from "./notify"
import { evaluateAffiliate, recordSignal } from "./fraud"
import { money } from "./types"

// The commission engine. Every function here is driven by a verified Whop
// webhook or an authorised admin action — never by anything a browser sends —
// and every write to the ledger carries an idempotency key, so a webhook
// delivered twice (or two at once) changes nothing the second time.

export async function balancesFor(affiliateId: number): Promise<Balances> {
  const rows = await db
    .select({ type: affiliateCommissions.type, status: affiliateCommissions.status, amount: sql<string>`sum(${affiliateCommissions.amount})` })
    .from(affiliateCommissions)
    .where(eq(affiliateCommissions.affiliateId, affiliateId))
    .groupBy(affiliateCommissions.type, affiliateCommissions.status)
  return ledgerBalances(rows.map((r) => ({ type: r.type, status: r.status, amount: Number(r.amount) })))
}

export type PaymentEvent = {
  userId: string | null
  paymentId: string
  // What the customer actually paid, net of tax.
  amount: number
  currency: string
  promoCode: string | null
  promoCodeId?: string | null
  plan: string | null
  billing: string | null
  paidAt: Date
}

// A referred customer paid. Records the payment on the referral and, when the
// rules say so, one commission row for it.
export async function handleAffiliatePayment(ev: PaymentEvent): Promise<void> {
  if (!ev.userId || !ev.paymentId) return

  let [referral] = await db.select().from(affiliateReferrals).where(eq(affiliateReferrals.userId, ev.userId))
  if (ev.promoCode || ev.promoCodeId) {
    // Counted once per customer: on the payment where they have no earlier one.
    const match = await attributeByCoupon({ userId: ev.userId, promoCode: ev.promoCode, promoCodeId: ev.promoCodeId, firstUse: !referral?.firstPaymentAt })
    if (match) [referral] = await db.select().from(affiliateReferrals).where(eq(affiliateReferrals.userId, ev.userId))
  }
  if (!referral) return

  const [aff] = await db.select().from(affiliates).where(eq(affiliates.id, referral.affiliateId))
  if (!aff) return

  const [program, tiers, rules, customers] = await Promise.all([getProgram(), loadTiers(), loadRules(aff.id), paidCustomerCount(aff.id)])
  const firstPayment = !referral.firstPaymentAt
  // The customer count the tier is measured against includes this one.
  const customersNow = customers + (firstPayment ? 1 : 0)
  const rule = resolveRule({ program, tiers, rules, customers: customersNow, tierOverrideId: aff.tierId, campaignId: referral.campaignId, couponId: referral.couponId, now: ev.paidAt })
  const decision = decideCommission({ program, rule, affiliateStatus: aff.status, firstPaymentAt: referral.firstPaymentAt, paidAt: ev.paidAt, baseAmount: ev.amount })

  const created = await db.transaction(async (tx) => {
    // The conversion row is the "have we seen this payment" guard for the
    // referral's own counters; the ledger has its own key below.
    const [conv] = await tx
      .insert(affiliateConversions)
      .values({ referralId: referral.id, affiliateId: aff.id, type: "payment", amount: String(round2(ev.amount)), paymentId: ev.paymentId })
      .onConflictDoNothing({ target: [affiliateConversions.type, affiliateConversions.paymentId] })
      .returning({ id: affiliateConversions.id })
    if (conv) {
      await tx
        .update(affiliateReferrals)
        .set({
          status: "active",
          firstPaymentAt: referral.firstPaymentAt ?? ev.paidAt,
          lastPaymentAt: ev.paidAt,
          revenue: sql`${affiliateReferrals.revenue} + ${round2(ev.amount)}`,
          plan: ev.plan ?? referral.plan,
          billing: ev.billing ?? referral.billing,
        })
        .where(eq(affiliateReferrals.id, referral.id))
      if (firstPayment) await tx.insert(affiliateConversions).values({ referralId: referral.id, affiliateId: aff.id, type: "subscription", amount: String(round2(ev.amount)) })
    }
    if (!decision.ok) return null
    const [row] = await tx
      .insert(affiliateCommissions)
      .values({
        affiliateId: aff.id,
        referralId: referral.id,
        type: "subscription",
        amount: String(decision.amount),
        currency: ev.currency.toLowerCase(),
        status: "pending",
        baseAmount: String(round2(ev.amount)),
        ratePercent: String(decision.ratePercent),
        ruleSource: decision.source,
        paymentId: ev.paymentId,
        idempotencyKey: `pay:${ev.paymentId}`,
        holdUntil: decision.holdUntil,
      })
      .onConflictDoNothing({ target: affiliateCommissions.idempotencyKey })
      .returning({ id: affiliateCommissions.id })
    return row ?? null
  })

  if (!created || !decision.ok) return
  await notifyAffiliate({
    affiliateId: aff.id,
    type: "commission",
    title: "Commission generated",
    body: `You earned ${money(decision.amount)} from ${referral.publicId} (${decision.ratePercent}% of ${money(ev.amount)}). It clears on ${decision.holdUntil.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`,
    href: "/affiliate/earnings",
    pref: "commission",
    email: true,
  })
  if (firstPayment && aff.tierId == null) {
    const before = tierFor(tiers, customers)
    const after = tierFor(tiers, customersNow)
    if (after && after.id !== before?.id) {
      await notifyAffiliate({ affiliateId: aff.id, type: "tier", title: `You reached the ${after.name} tier`, body: `Your commission rate is now ${after.ratePercent}% on new payments.`, href: "/affiliate", email: true })
    }
  }
  await evaluateAffiliate(aff.id)
}

// The rows a completed reversal closes: the original, and — when earlier
// partial reversals had already reduced it — those rows too, so nothing of a
// fully reversed commission is left looking live.
const closes = (originalId: number, earlier: boolean) => (earlier ? or(eq(affiliateCommissions.id, originalId), eq(affiliateCommissions.reversesId, originalId)) : eq(affiliateCommissions.id, originalId))

export type RefundEvent = {
  // The refund's or dispute's own id — the idempotency key.
  eventId: string
  paymentId: string
  refundAmount: number
  paymentTotal: number
  kind: Exclude<ReversalKind, "manual">
}

// A referred payment was refunded or charged back. The commission for it is
// reversed by ADDING a row — the original is never deleted or rewritten in
// value. A chargeback always reverses; a refund does when the program says so.
export async function handleAffiliateRefund(ev: RefundEvent): Promise<void> {
  if (!ev.eventId || !ev.paymentId) return
  const [original] = await db
    .select()
    .from(affiliateCommissions)
    .where(and(eq(affiliateCommissions.paymentId, ev.paymentId), eq(affiliateCommissions.type, "subscription")))
  const [conversion] = await db
    .select({ referralId: affiliateConversions.referralId, affiliateId: affiliateConversions.affiliateId })
    .from(affiliateConversions)
    .where(and(eq(affiliateConversions.type, "payment"), eq(affiliateConversions.paymentId, ev.paymentId)))
  const referralId = original?.referralId ?? conversion?.referralId ?? null
  const affiliateId = original?.affiliateId ?? conversion?.affiliateId ?? null
  if (referralId == null || affiliateId == null) return

  const program = await getProgram()
  const type = ev.kind === "chargeback" ? "chargeback" : "refund"
  // When the event does not say what the payment was, the amount the
  // commission was calculated on stands in for it.
  const paymentTotal = ev.paymentTotal > 0 ? ev.paymentTotal : Number(original?.baseAmount ?? 0)
  // A chargeback takes the whole payment back, whatever amount it reports.
  const full = ev.kind === "chargeback" || !(paymentTotal > 0) || ev.refundAmount >= paymentTotal - 0.005
  const refundAmount = full ? Math.max(ev.refundAmount, paymentTotal) : ev.refundAmount

  const reversed = await db.transaction(async (tx) => {
    const [conv] = await tx
      .insert(affiliateConversions)
      .values({ referralId, affiliateId, type, amount: String(round2(refundAmount)), paymentId: ev.eventId })
      .onConflictDoNothing({ target: [affiliateConversions.type, affiliateConversions.paymentId] })
      .returning({ id: affiliateConversions.id })
    if (conv) {
      await tx
        .update(affiliateReferrals)
        .set({ revenue: sql`greatest(0, ${affiliateReferrals.revenue} - ${round2(refundAmount)})`, ...(full ? { status: "refunded" } : {}) })
        .where(eq(affiliateReferrals.id, referralId))
    }
    if (!original || (ev.kind === "refund" && !program.refundReversal)) return null

    const [done] = await tx
      .select({ total: sql<string>`coalesce(sum(${affiliateCommissions.amount}), 0)` })
      .from(affiliateCommissions)
      .where(eq(affiliateCommissions.reversesId, original.id))
    const plan = planReversal({ amount: Number(original.amount), status: original.status }, refundShare(refundAmount, paymentTotal), ev.kind, Number(done?.total ?? 0))
    if (!plan) return null

    const [row] = await tx
      .insert(affiliateCommissions)
      .values({
        affiliateId,
        referralId,
        type: plan.entry.type,
        amount: String(plan.entry.amount),
        currency: original.currency,
        status: plan.entry.status,
        paymentId: ev.paymentId,
        idempotencyKey: `${type}:${ev.eventId}`,
        // A partial reversal rides through the hold with the row it nets against.
        holdUntil: original.holdUntil,
        availableAt: plan.entry.status === "available" ? new Date() : null,
        reversesId: original.id,
        note: ev.kind === "chargeback" ? "Chargeback on the referred payment" : "Refund of the referred payment",
      })
      .onConflictDoNothing({ target: affiliateCommissions.idempotencyKey })
      .returning({ id: affiliateCommissions.id, amount: affiliateCommissions.amount })
    if (!row) return null
    if (plan.originalStatus) await tx.update(affiliateCommissions).set({ status: plan.originalStatus }).where(closes(original.id, plan.closeEarlier))
    return Number(row.amount)
  })

  if (ev.kind === "chargeback") await recordSignal(affiliateId, { type: "chargeback", risk: "medium", details: { paymentId: ev.paymentId } }, { referralId, key: ev.eventId })
  if (reversed != null) {
    await notifyAffiliate({
      affiliateId,
      type: "reversal",
      title: ev.kind === "chargeback" ? "Commission reversed (chargeback)" : "Commission reversed (refund)",
      body: `${money(Math.abs(reversed))} was reversed because the customer's payment was ${ev.kind === "chargeback" ? "disputed" : "refunded"}.`,
      href: "/affiliate/earnings",
      pref: "commission",
      email: true,
    })
  }
  await evaluateAffiliate(affiliateId)
}

// Trial started / subscription cancelled, from membership webhooks.
export async function handleAffiliateMembership(input: { userId: string | null | undefined; event: "trial" | "active" | "cancelled" }): Promise<void> {
  if (!input.userId) return
  const [referral] = await db.select().from(affiliateReferrals).where(eq(affiliateReferrals.userId, input.userId))
  if (!referral) return
  if (input.event === "trial" && referral.status === "signup") {
    await db.update(affiliateReferrals).set({ status: "trial" }).where(eq(affiliateReferrals.id, referral.id))
    await db.insert(affiliateConversions).values({ referralId: referral.id, affiliateId: referral.affiliateId, type: "trial" })
  } else if (input.event === "cancelled" && ["trial", "active"].includes(referral.status)) {
    await db.update(affiliateReferrals).set({ status: "cancelled" }).where(eq(affiliateReferrals.id, referral.id))
    await db.insert(affiliateConversions).values({ referralId: referral.id, affiliateId: referral.affiliateId, type: "cancelled" })
  } else if (input.event === "active" && referral.status === "cancelled" && referral.firstPaymentAt) {
    await db.update(affiliateReferrals).set({ status: "active" }).where(eq(affiliateReferrals.id, referral.id))
  }
}

// pending → approved once the hold period has passed, then approved →
// available for affiliates in good standing. An affiliate who is suspended or
// under a fraud lock keeps their commissions at "approved" until an admin
// resolves it. Run by the daily job and lazily when an affiliate opens the
// portal (scoped to them), so nothing depends on the cron having fired.
//
// Only what was EARNED moves here. A payout's own ledger row — the reservation —
// also starts as "pending" (awaiting approval), and it follows the payout's
// status and nothing else (payouts.transition).
export async function releaseHolds(opts: { affiliateId?: number; now?: Date } = {}): Promise<{ approved: number; released: number }> {
  const now = opts.now ?? new Date()
  const scope = opts.affiliateId != null ? eq(affiliateCommissions.affiliateId, opts.affiliateId) : undefined

  const approved = await db
    .update(affiliateCommissions)
    .set({ status: "approved", approvedAt: now })
    .where(and(eq(affiliateCommissions.status, "pending"), ne(affiliateCommissions.type, "payout"), or(isNull(affiliateCommissions.holdUntil), lte(affiliateCommissions.holdUntil, now)), scope))
    .returning({ id: affiliateCommissions.id })

  const clear = db.select({ id: affiliates.id }).from(affiliates).where(and(eq(affiliates.status, "approved"), eq(affiliates.fraudLock, false)))
  const released = await db
    .update(affiliateCommissions)
    .set({ status: "available", availableAt: now })
    .where(and(eq(affiliateCommissions.status, "approved"), ne(affiliateCommissions.type, "payout"), inArray(affiliateCommissions.affiliateId, clear), scope))
    .returning({ affiliateId: affiliateCommissions.affiliateId, amount: affiliateCommissions.amount })

  const byAffiliate = new Map<number, number>()
  for (const r of released) byAffiliate.set(r.affiliateId, (byAffiliate.get(r.affiliateId) ?? 0) + Number(r.amount))
  for (const [affiliateId, total] of byAffiliate) {
    if (total <= 0) continue
    await notifyAffiliate({
      affiliateId,
      type: "commission_available",
      title: "Commission available",
      body: `${money(round2(total))} cleared its holding period and is ready to withdraw.`,
      href: "/affiliate/payouts",
      pref: "commissionApproved",
      email: true,
    })
  }
  return { approved: approved.length, released: released.length }
}

// The holding period was shortened: commissions still waiting follow the new
// period (counted from when they were earned) instead of the date they were
// given at the time. Only ever brings a date forward — a longer period applies
// to new payments, never pushes back what an affiliate was already told.
// Returns how many were brought forward; releaseHolds() then clears those due.
export async function applyHoldPeriod(holdDays: number): Promise<number> {
  const days = Math.max(0, Math.min(180, Math.round(holdDays)))
  const due = sql`${affiliateCommissions.createdAt} + make_interval(days => ${days}::int)`
  const rows = await db
    .update(affiliateCommissions)
    .set({ holdUntil: due })
    .where(and(eq(affiliateCommissions.status, "pending"), ne(affiliateCommissions.type, "payout"), isNull(affiliateCommissions.reversesId), isNotNull(affiliateCommissions.holdUntil), sql`${affiliateCommissions.holdUntil} > ${due}`))
    .returning({ id: affiliateCommissions.id })
  // A partial refund rides through the hold with the commission it nets
  // against, so it keeps that commission's date — never its own.
  await db.execute(sql`
    update "affiliate_commissions" r set "holdUntil" = o."holdUntil"
    from "affiliate_commissions" o
    where r."reversesId" = o."id" and r."status" = 'pending' and r."type" <> 'payout' and o."holdUntil" is not null and r."holdUntil" is distinct from o."holdUntil"`)
  return rows.length
}

// --- Admin actions ----------------------------------------------------------

// Skips the rest of the hold for one commission. It becomes available at the
// next release, like any other approved row.
export async function approveCommission(commissionId: number): Promise<{ affiliateId: number }> {
  const [row] = await db
    .update(affiliateCommissions)
    .set({ status: "approved", approvedAt: new Date() })
    .where(and(eq(affiliateCommissions.id, commissionId), eq(affiliateCommissions.status, "pending")))
    .returning({ affiliateId: affiliateCommissions.affiliateId })
  if (!row) throw new Error("Only a pending commission can be approved.")
  await releaseHolds({ affiliateId: row.affiliateId })
  return row
}

export async function reverseCommission(commissionId: number, adminId: string, note: string): Promise<{ affiliateId: number; amount: number }> {
  return db.transaction(async (tx) => {
    const [original] = await tx.select().from(affiliateCommissions).where(eq(affiliateCommissions.id, commissionId)).for("update")
    if (!original) throw new Error("That commission no longer exists.")
    if (original.type === "payout" || Number(original.amount) <= 0) throw new Error("Only an earned commission can be reversed.")
    const [done] = await tx
      .select({ total: sql<string>`coalesce(sum(${affiliateCommissions.amount}), 0)` })
      .from(affiliateCommissions)
      .where(eq(affiliateCommissions.reversesId, original.id))
    const plan = planReversal({ amount: Number(original.amount), status: original.status }, 1, "manual", Number(done?.total ?? 0))
    if (!plan) throw new Error("That commission is already reversed.")
    await tx.insert(affiliateCommissions).values({
      affiliateId: original.affiliateId,
      referralId: original.referralId,
      type: plan.entry.type,
      amount: String(plan.entry.amount),
      currency: original.currency,
      status: plan.entry.status,
      paymentId: original.paymentId,
      idempotencyKey: `rev:${original.id}:${randomUUID()}`,
      holdUntil: original.holdUntil,
      availableAt: plan.entry.status === "available" ? new Date() : null,
      reversesId: original.id,
      note: note || "Reversed by an admin",
      createdBy: adminId,
    })
    if (plan.originalStatus) await tx.update(affiliateCommissions).set({ status: plan.originalStatus }).where(closes(original.id, plan.closeEarlier))
    return { affiliateId: original.affiliateId, amount: plan.entry.amount }
  })
}

// A manual bonus (positive) or adjustment (either sign). Lands as available:
// an admin put it there deliberately, so there is nothing to hold it for.
export async function addLedgerEntry(input: { affiliateId: number; type: "bonus" | "adjustment"; amount: number; note: string; adminId: string; key?: string }): Promise<void> {
  const amount = round2(input.amount)
  if (!Number.isFinite(amount) || amount === 0) throw new Error("Enter an amount.")
  if (input.type === "bonus" && amount < 0) throw new Error("A bonus must be positive. Use an adjustment to deduct.")
  if (Math.abs(amount) > 100_000) throw new Error("That amount is too large.")
  if (!input.note.trim()) throw new Error("Add a note explaining this entry.")
  const now = new Date()
  await db
    .insert(affiliateCommissions)
    .values({ affiliateId: input.affiliateId, type: input.type, amount: String(amount), status: "available", idempotencyKey: `adj:${input.key ?? randomUUID()}`, approvedAt: now, availableAt: now, note: input.note.trim().slice(0, 300), createdBy: input.adminId })
    .onConflictDoNothing({ target: affiliateCommissions.idempotencyKey })
  await notifyAffiliate({ affiliateId: input.affiliateId, type: "adjustment", title: input.type === "bonus" ? "Bonus added" : "Balance adjusted", body: `${money(amount)} — ${input.note.trim().slice(0, 200)}`, href: "/affiliate/earnings", pref: "commission", email: true })
}

// Cleared commissions a paid payout settles, oldest first — used by payouts.ts.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
export async function availableRows(affiliateId: number, tx: typeof db | Tx = db) {
  const rows = await tx
    .select({ id: affiliateCommissions.id, amount: affiliateCommissions.amount })
    .from(affiliateCommissions)
    .where(and(eq(affiliateCommissions.affiliateId, affiliateId), eq(affiliateCommissions.status, "available"), sql`${affiliateCommissions.type} <> 'payout'`, sql`${affiliateCommissions.amount} > 0`))
    .orderBy(asc(affiliateCommissions.createdAt), asc(affiliateCommissions.id))
  return rows.map((r) => ({ id: r.id, amount: Number(r.amount) }))
}
