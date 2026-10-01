import { and, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliateClicks, affiliateConversions, affiliateFraudSignals, affiliateReferrals } from "@/lib/db/schema"
import { fraudFindings, type FraudFinding } from "./engine"

// Risk signals. Everything here only RECORDS something for a person to look at
// on /admin/affiliates/fraud — nothing in this file suspends an affiliate,
// reverses a commission or blocks a payout. Those are admin decisions.

export const FRAUD_LABELS: Record<string, string> = {
  self_referral: "Self-referral attempt",
  same_device: "Several sign-ups from one network",
  abnormal_conversion: "Abnormally high conversion rate",
  unusual_traffic: "More sign-ups than clicks",
  repeated_signups: "Burst of sign-ups",
  repeated_refunds: "High refund rate",
  chargeback: "Chargeback on a referred payment",
  suspicious_coupon: "Coupon-only conversions",
}

// One open signal per affiliate + type + month (dedupeKey), so a recurring
// pattern shows once instead of flooding the queue.
export async function recordSignal(affiliateId: number, finding: FraudFinding, opts: { referralId?: number | null; key?: string } = {}): Promise<void> {
  const month = new Date().toISOString().slice(0, 7)
  const dedupeKey = `${affiliateId}:${finding.type}:${opts.key ?? month}`
  try {
    await db
      .insert(affiliateFraudSignals)
      .values({ affiliateId, referralId: opts.referralId ?? null, type: finding.type, risk: finding.risk, details: finding.details, dedupeKey })
      .onConflictDoNothing({ target: affiliateFraudSignals.dedupeKey })
  } catch (e) {
    console.error("[affiliates] couldn't record a risk signal:", e instanceof Error ? e.message : e)
  }
}

// Re-reads an affiliate's numbers and files any signals they trip. Called
// after sign-ups, payments, refunds and by the daily job. Best-effort.
export async function evaluateAffiliate(affiliateId: number): Promise<void> {
  try {
    const hourAgo = new Date(Date.now() - 3_600_000)
    const [[clicks], [refs], sameNetwork, events] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(affiliateClicks).where(eq(affiliateClicks.affiliateId, affiliateId)),
      db
        .select({
          signups: sql<number>`count(*)::int`,
          paid: sql<number>`count(*) filter (where ${affiliateReferrals.firstPaymentAt} is not null)::int`,
          couponPaid: sql<number>`count(*) filter (where ${affiliateReferrals.firstPaymentAt} is not null and ${affiliateReferrals.source} = 'coupon')::int`,
          lastHour: sql<number>`count(*) filter (where ${affiliateReferrals.createdAt} > ${hourAgo})::int`,
        })
        .from(affiliateReferrals)
        .where(eq(affiliateReferrals.affiliateId, affiliateId)),
      // Sign-ups that came from a network another sign-up of this affiliate
      // also came from (by hashed IP of the attributed click).
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(affiliateReferrals)
        .innerJoin(affiliateClicks, eq(affiliateClicks.id, affiliateReferrals.clickId))
        .where(and(eq(affiliateReferrals.affiliateId, affiliateId), isNotNull(affiliateClicks.ipHash)))
        .groupBy(affiliateClicks.ipHash)
        .having(sql`count(*) >= 2`),
      db
        .select({ type: affiliateConversions.type, n: sql<number>`count(*)::int` })
        .from(affiliateConversions)
        .where(and(eq(affiliateConversions.affiliateId, affiliateId), inArray(affiliateConversions.type, ["refund", "chargeback"])))
        .groupBy(affiliateConversions.type),
    ])
    const count = (type: string) => events.find((e) => e.type === type)?.n ?? 0
    const findings = fraudFindings({
      clicks: clicks?.n ?? 0,
      signups: refs?.signups ?? 0,
      paidCustomers: refs?.paid ?? 0,
      refunds: count("refund"),
      chargebacks: count("chargeback"),
      sameIpSignups: sameNetwork.reduce((max, r) => Math.max(max, r.n), 0),
      signupsLastHour: refs?.lastHour ?? 0,
      couponOnlyShare: refs?.paid ? (refs.couponPaid ?? 0) / refs.paid : 0,
    })
    for (const f of findings) await recordSignal(affiliateId, f)
  } catch (e) {
    console.error("[affiliates] risk evaluation failed:", e instanceof Error ? e.message : e)
  }
}
