import { cache } from "react"
import { and, desc, eq, gte, ilike, inArray, isNull, lt, ne, sql, type SQL } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { db } from "@/lib/db"
import {
  affiliateAnnouncementReads,
  affiliateAnnouncements,
  affiliateCampaigns,
  affiliateClicks,
  affiliateCommissions,
  affiliateConversions,
  affiliateCoupons,
  affiliateLinks,
  affiliateNotifications,
  affiliatePayoutMethods,
  affiliatePayouts,
  affiliateReferrals,
  affiliateResources,
  affiliates,
} from "@/lib/db/schema"
import { round2 } from "./engine"
import { rangeStart, type Range } from "./types"

// Everything the affiliate portal reads. EVERY query is scoped by the
// affiliate id the server resolved from the session (lib/affiliates/guard) —
// no function here takes an id from the browser and trusts it.

const n = (v: unknown) => Number(v ?? 0)

// Ledger rows that count as earnings: not payouts, not voided.
export const EARNED = sql`${affiliateCommissions.type} <> 'payout' and ${affiliateCommissions.status} not in ('reversed','refunded','cancelled')`

export const getAffiliateByUser = cache(async (userId: string) => {
  const [row] = await db.select().from(affiliates).where(eq(affiliates.userId, userId))
  return row ?? null
})

// --- Time series ------------------------------------------------------------

export type Bucket = "day" | "week" | "month"
export type SeriesPoint = { date: string; clicks: number; signups: number; customers: number; revenue: number; commission: number }

export function bucketFor(start: Date, end: Date): Bucket {
  const days = (end.getTime() - start.getTime()) / 86_400_000
  return days <= 92 ? "day" : days <= 400 ? "week" : "month"
}

function bucketKeys(start: Date, end: Date, unit: Bucket): string[] {
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
  if (unit === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)) // ISO week starts Monday, like date_trunc
  if (unit === "month") d.setUTCDate(1)
  const out: string[] = []
  while (d <= end && out.length < 800) {
    out.push(d.toISOString().slice(0, 10))
    if (unit === "day") d.setUTCDate(d.getUTCDate() + 1)
    else if (unit === "week") d.setUTCDate(d.getUTCDate() + 7)
    else d.setUTCMonth(d.getUTCMonth() + 1)
  }
  return out
}

const trunc = (unit: Bucket, col: unknown) => sql<string>`to_char(date_trunc(${sql.raw(`'${unit}'`)}, ${col}), 'YYYY-MM-DD')`

// `affiliateId` null = the whole program (admin).
export async function seriesFor(affiliateId: number | null, start: Date, end: Date): Promise<{ unit: Bucket; points: SeriesPoint[] }> {
  const unit = bucketFor(start, end)
  const scope = (col: AnyPgColumn) => (affiliateId == null ? undefined : eq(col, affiliateId))
  const [clicks, signups, customers, revenue, commission] = await Promise.all([
    db.select({ d: trunc(unit, affiliateClicks.createdAt), v: sql<number>`count(*)::int` }).from(affiliateClicks).where(and(scope(affiliateClicks.affiliateId), gte(affiliateClicks.createdAt, start))).groupBy(sql`1`),
    db.select({ d: trunc(unit, affiliateReferrals.createdAt), v: sql<number>`count(*)::int` }).from(affiliateReferrals).where(and(scope(affiliateReferrals.affiliateId), gte(affiliateReferrals.createdAt, start))).groupBy(sql`1`),
    db.select({ d: trunc(unit, affiliateReferrals.firstPaymentAt), v: sql<number>`count(*)::int` }).from(affiliateReferrals).where(and(scope(affiliateReferrals.affiliateId), gte(affiliateReferrals.firstPaymentAt, start))).groupBy(sql`1`),
    db
      .select({ d: trunc(unit, affiliateConversions.createdAt), v: sql<string>`sum(${affiliateConversions.amount})` })
      .from(affiliateConversions)
      .where(and(scope(affiliateConversions.affiliateId), eq(affiliateConversions.type, "payment"), gte(affiliateConversions.createdAt, start)))
      .groupBy(sql`1`),
    db.select({ d: trunc(unit, affiliateCommissions.createdAt), v: sql<string>`sum(${affiliateCommissions.amount})` }).from(affiliateCommissions).where(and(scope(affiliateCommissions.affiliateId), EARNED, gte(affiliateCommissions.createdAt, start))).groupBy(sql`1`),
  ])
  const map = (rows: { d: string; v: unknown }[]) => new Map(rows.map((r) => [r.d, n(r.v)]))
  const [c, s, cu, r, co] = [map(clicks), map(signups), map(customers), map(revenue), map(commission)]
  const points = bucketKeys(start, end, unit).map((date) => ({ date, clicks: c.get(date) ?? 0, signups: s.get(date) ?? 0, customers: cu.get(date) ?? 0, revenue: round2(r.get(date) ?? 0), commission: round2(co.get(date) ?? 0) }))
  return { unit, points }
}

// --- Totals -----------------------------------------------------------------

export type Totals = { clicks: number; signups: number; trials: number; customers: number; revenue: number; commission: number }

export async function totalsFor(affiliateId: number | null, start: Date | null, end: Date | null = null): Promise<Totals> {
  const within = (col: AnyPgColumn) => and(start ? gte(col, start) : undefined, end ? lt(col, end) : undefined)
  const scope = (t: { affiliateId: AnyPgColumn }) => (affiliateId == null ? undefined : eq(t.affiliateId, affiliateId))
  const [[clicks], [refs], [paid], [trials], [revenue], [commission]] = await Promise.all([
    db.select({ v: sql<number>`count(*)::int` }).from(affiliateClicks).where(and(scope(affiliateClicks), within(affiliateClicks.createdAt))),
    db.select({ v: sql<number>`count(*)::int` }).from(affiliateReferrals).where(and(scope(affiliateReferrals), within(affiliateReferrals.createdAt))),
    db.select({ v: sql<number>`count(*)::int` }).from(affiliateReferrals).where(and(scope(affiliateReferrals), sql`${affiliateReferrals.firstPaymentAt} is not null`, within(affiliateReferrals.firstPaymentAt))),
    db.select({ v: sql<number>`count(*)::int` }).from(affiliateConversions).where(and(scope(affiliateConversions), eq(affiliateConversions.type, "trial"), within(affiliateConversions.createdAt))),
    db.select({ v: sql<string>`coalesce(sum(${affiliateConversions.amount}), 0)` }).from(affiliateConversions).where(and(scope(affiliateConversions), eq(affiliateConversions.type, "payment"), within(affiliateConversions.createdAt))),
    db.select({ v: sql<string>`coalesce(sum(${affiliateCommissions.amount}), 0)` }).from(affiliateCommissions).where(and(scope(affiliateCommissions), EARNED, within(affiliateCommissions.createdAt))),
  ])
  return { clicks: n(clicks?.v), signups: n(refs?.v), trials: n(trials?.v), customers: n(paid?.v), revenue: round2(n(revenue?.v)), commission: round2(n(commission?.v)) }
}

// The range, the period just before it (for "vs previous"), and the chart.
export async function performance(affiliateId: number | null, range: Range, since: Date) {
  const now = new Date()
  const start = rangeStart(range, now) ?? since
  const prevStart = range === "all" ? null : new Date(start.getTime() - (now.getTime() - start.getTime()))
  const [current, previous, series] = await Promise.all([totalsFor(affiliateId, start), prevStart ? totalsFor(affiliateId, prevStart, start) : Promise.resolve(null), seriesFor(affiliateId, start, now)])
  return { start, current, previous, series }
}

// --- Breakdowns -------------------------------------------------------------

export type BreakdownRow = { label: string; clicks: number; signups: number; customers: number; revenue: number }

const DIMENSIONS = {
  source: sql`coalesce(${affiliateClicks.utmSource}, nullif(${affiliateClicks.referrer}, ''), 'direct')`,
  device: sql`coalesce(${affiliateClicks.device}, 'unknown')`,
  country: sql`coalesce(${affiliateClicks.country}, 'unknown')`,
  landing: sql`coalesce(${affiliateClicks.landingPage}, '/')`,
} as const
export type Dimension = keyof typeof DIMENSIONS

export async function breakdown(affiliateId: number, start: Date, dimension: Dimension, limit = 8): Promise<BreakdownRow[]> {
  const dim = DIMENSIONS[dimension]
  const [clicks, refs] = await Promise.all([
    db
      .select({ label: sql<string>`${dim}`, clicks: sql<number>`count(*)::int` })
      .from(affiliateClicks)
      .where(and(eq(affiliateClicks.affiliateId, affiliateId), gte(affiliateClicks.createdAt, start)))
      .groupBy(sql`1`),
    db
      .select({
        // A customer who came by coupon alone has no click to describe.
        label: sql<string>`case when ${affiliateReferrals.clickId} is null then 'coupon' else ${dim} end`,
        signups: sql<number>`count(*)::int`,
        customers: sql<number>`count(${affiliateReferrals.firstPaymentAt})::int`,
        revenue: sql<string>`coalesce(sum(${affiliateReferrals.revenue}), 0)`,
      })
      .from(affiliateReferrals)
      .leftJoin(affiliateClicks, eq(affiliateClicks.id, affiliateReferrals.clickId))
      .where(and(eq(affiliateReferrals.affiliateId, affiliateId), gte(affiliateReferrals.createdAt, start)))
      .groupBy(sql`1`),
  ])
  const rows = new Map<string, BreakdownRow>()
  const at = (label: string) => rows.get(label) ?? rows.set(label, { label, clicks: 0, signups: 0, customers: 0, revenue: 0 }).get(label)!
  for (const c of clicks) at(c.label).clicks = c.clicks
  for (const r of refs) Object.assign(at(r.label), { signups: r.signups, customers: r.customers, revenue: round2(n(r.revenue)) })
  return [...rows.values()].sort((a, b) => b.clicks + b.signups * 5 - (a.clicks + a.signups * 5)).slice(0, limit)
}

// --- Campaigns, links, coupons ----------------------------------------------

export type Stat = { clicks: number; signups: number; customers: number; revenue: number; commission: number }
const emptyStat = (): Stat => ({ clicks: 0, signups: 0, customers: 0, revenue: 0, commission: 0 })

// Stats grouped by one of the referral's foreign keys (campaign, link, coupon).
async function statsBy(affiliateId: number, key: "campaignId" | "linkId" | "couponId", start: Date | null): Promise<Map<number, Stat>> {
  const refCol = affiliateReferrals[key]
  const out = new Map<number, Stat>()
  const at = (id: number) => out.get(id) ?? out.set(id, emptyStat()).get(id)!
  const [clicks, refs, comm] = await Promise.all([
    key === "couponId"
      ? Promise.resolve([] as { id: number | null; v: number }[])
      : db
          .select({ id: affiliateClicks[key], v: sql<number>`count(*)::int` })
          .from(affiliateClicks)
          .where(and(eq(affiliateClicks.affiliateId, affiliateId), start ? gte(affiliateClicks.createdAt, start) : undefined))
          .groupBy(affiliateClicks[key]),
    db
      .select({ id: refCol, signups: sql<number>`count(*)::int`, customers: sql<number>`count(${affiliateReferrals.firstPaymentAt})::int`, revenue: sql<string>`coalesce(sum(${affiliateReferrals.revenue}), 0)` })
      .from(affiliateReferrals)
      .where(and(eq(affiliateReferrals.affiliateId, affiliateId), start ? gte(affiliateReferrals.createdAt, start) : undefined))
      .groupBy(refCol),
    db
      .select({ id: refCol, v: sql<string>`coalesce(sum(${affiliateCommissions.amount}), 0)` })
      .from(affiliateCommissions)
      .innerJoin(affiliateReferrals, eq(affiliateReferrals.id, affiliateCommissions.referralId))
      .where(and(eq(affiliateCommissions.affiliateId, affiliateId), EARNED, start ? gte(affiliateCommissions.createdAt, start) : undefined))
      .groupBy(refCol),
  ])
  for (const c of clicks) if (c.id != null) at(c.id).clicks = c.v
  for (const r of refs) if (r.id != null) Object.assign(at(r.id), { signups: r.signups, customers: r.customers, revenue: round2(n(r.revenue)) })
  for (const c of comm) if (c.id != null) at(c.id).commission = round2(n(c.v))
  return out
}

export async function campaignsWithStats(affiliateId: number, start: Date | null = null) {
  const [rows, stats, links] = await Promise.all([
    db.select().from(affiliateCampaigns).where(eq(affiliateCampaigns.affiliateId, affiliateId)).orderBy(desc(affiliateCampaigns.createdAt)),
    statsBy(affiliateId, "campaignId", start),
    db.select().from(affiliateLinks).where(eq(affiliateLinks.affiliateId, affiliateId)),
  ])
  return rows.map((c) => ({ ...c, stats: stats.get(c.id) ?? emptyStat(), link: links.find((l) => l.campaignId === c.id && l.status === "active") ?? links.find((l) => l.campaignId === c.id) ?? null }))
}

export async function linksWithStats(affiliateId: number) {
  const [rows, stats, campaigns] = await Promise.all([
    db.select().from(affiliateLinks).where(eq(affiliateLinks.affiliateId, affiliateId)).orderBy(desc(affiliateLinks.isDefault), desc(affiliateLinks.createdAt)),
    statsBy(affiliateId, "linkId", null),
    db.select().from(affiliateCampaigns).where(eq(affiliateCampaigns.affiliateId, affiliateId)),
  ])
  return rows.map((l) => ({ ...l, stats: stats.get(l.id) ?? emptyStat(), campaign: campaigns.find((c) => c.id === l.campaignId) ?? null }))
}

export async function couponsWithStats(affiliateId: number) {
  const [rows, stats, campaigns] = await Promise.all([
    db.select().from(affiliateCoupons).where(eq(affiliateCoupons.affiliateId, affiliateId)).orderBy(desc(affiliateCoupons.createdAt)),
    statsBy(affiliateId, "couponId", null),
    db.select({ id: affiliateCampaigns.id, name: affiliateCampaigns.name }).from(affiliateCampaigns).where(eq(affiliateCampaigns.affiliateId, affiliateId)),
  ])
  return rows.map((c) => ({ ...c, stats: stats.get(c.id) ?? emptyStat(), campaign: campaigns.find((x) => x.id === c.campaignId) ?? null }))
}

export async function defaultLink(affiliateId: number) {
  const [row] = await db.select().from(affiliateLinks).where(and(eq(affiliateLinks.affiliateId, affiliateId), eq(affiliateLinks.isDefault, true)))
  return row ?? null
}

// --- Referrals --------------------------------------------------------------

export const PAGE_SIZE = 20

export type ReferralFilters = { q?: string; status?: string; campaign?: number; source?: string; page?: number }

export async function referralsPage(affiliateId: number, f: ReferralFilters) {
  const where = and(
    eq(affiliateReferrals.affiliateId, affiliateId),
    f.q ? ilike(affiliateReferrals.publicId, `%${f.q.replace(/[%_\\]/g, "")}%`) : undefined,
    f.status ? eq(affiliateReferrals.status, f.status) : undefined,
    f.campaign ? eq(affiliateReferrals.campaignId, f.campaign) : undefined,
    f.source ? eq(affiliateReferrals.source, f.source) : undefined
  )
  const page = Math.max(1, f.page ?? 1)
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: affiliateReferrals.id,
        publicId: affiliateReferrals.publicId,
        status: affiliateReferrals.status,
        source: affiliateReferrals.source,
        plan: affiliateReferrals.plan,
        billing: affiliateReferrals.billing,
        country: affiliateReferrals.country,
        revenue: affiliateReferrals.revenue,
        createdAt: affiliateReferrals.createdAt,
        firstPaymentAt: affiliateReferrals.firstPaymentAt,
        campaign: affiliateCampaigns.name,
      })
      .from(affiliateReferrals)
      .leftJoin(affiliateCampaigns, eq(affiliateCampaigns.id, affiliateReferrals.campaignId))
      .where(where)
      .orderBy(desc(affiliateReferrals.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ v: sql<number>`count(*)::int` }).from(affiliateReferrals).where(where),
  ])
  const ids = rows.map((r) => r.id)
  const earned = ids.length
    ? await db
        .select({ id: affiliateCommissions.referralId, v: sql<string>`coalesce(sum(${affiliateCommissions.amount}), 0)` })
        .from(affiliateCommissions)
        .where(and(eq(affiliateCommissions.affiliateId, affiliateId), inArray(affiliateCommissions.referralId, ids), EARNED))
        .groupBy(affiliateCommissions.referralId)
    : []
  const byId = new Map(earned.map((e) => [e.id, round2(n(e.v))]))
  return { rows: rows.map((r) => ({ ...r, revenue: n(r.revenue), commission: byId.get(r.id) ?? 0 })), total: total?.v ?? 0, page }
}

// One referral, by the public id, with its timeline. Never the customer's
// name or email — an affiliate is not shown who their referrals are.
export async function referralDetail(affiliateId: number, publicId: string) {
  const [ref] = await db
    .select()
    .from(affiliateReferrals)
    .where(and(eq(affiliateReferrals.affiliateId, affiliateId), eq(affiliateReferrals.publicId, publicId)))
  if (!ref) return null
  const [events, ledger, [campaign], [coupon]] = await Promise.all([
    db.select().from(affiliateConversions).where(and(eq(affiliateConversions.referralId, ref.id), eq(affiliateConversions.affiliateId, affiliateId))).orderBy(desc(affiliateConversions.createdAt)).limit(60),
    db.select().from(affiliateCommissions).where(and(eq(affiliateCommissions.referralId, ref.id), eq(affiliateCommissions.affiliateId, affiliateId))).orderBy(desc(affiliateCommissions.createdAt)).limit(60),
    ref.campaignId ? db.select({ name: affiliateCampaigns.name }).from(affiliateCampaigns).where(eq(affiliateCampaigns.id, ref.campaignId)) : Promise.resolve([]),
    ref.couponId ? db.select({ code: affiliateCoupons.code }).from(affiliateCoupons).where(eq(affiliateCoupons.id, ref.couponId)) : Promise.resolve([]),
  ])
  return {
    publicId: ref.publicId,
    status: ref.status,
    source: ref.source,
    plan: ref.plan,
    billing: ref.billing,
    country: ref.country,
    device: ref.device,
    landingPage: ref.landingPage,
    revenue: n(ref.revenue),
    createdAt: ref.createdAt,
    clickedAt: ref.clickedAt,
    firstPaymentAt: ref.firstPaymentAt,
    lastPaymentAt: ref.lastPaymentAt,
    campaign: (campaign as { name: string } | undefined)?.name ?? null,
    coupon: (coupon as { code: string } | undefined)?.code ?? null,
    events: events.map((e) => ({ id: e.id, type: e.type, amount: e.amount == null ? null : n(e.amount), createdAt: e.createdAt })),
    ledger: ledger.map((l) => ({ id: l.id, type: l.type, status: l.status, amount: n(l.amount), ratePercent: l.ratePercent == null ? null : n(l.ratePercent), createdAt: l.createdAt, holdUntil: l.holdUntil })),
  }
}
export type ReferralDetail = NonNullable<Awaited<ReturnType<typeof referralDetail>>>

// --- Ledger -----------------------------------------------------------------

export type LedgerFilters = { type?: string; status?: string; page?: number; from?: Date | null; to?: Date | null }

export function ledgerWhere(affiliateId: number | null, f: LedgerFilters): SQL | undefined {
  return and(
    affiliateId == null ? undefined : eq(affiliateCommissions.affiliateId, affiliateId),
    f.type ? eq(affiliateCommissions.type, f.type) : undefined,
    f.status ? eq(affiliateCommissions.status, f.status) : undefined,
    f.from ? gte(affiliateCommissions.createdAt, f.from) : undefined,
    f.to ? lt(affiliateCommissions.createdAt, f.to) : undefined
  )
}

const ledgerColumns = {
  id: affiliateCommissions.id,
  affiliateId: affiliateCommissions.affiliateId,
  type: affiliateCommissions.type,
  status: affiliateCommissions.status,
  amount: affiliateCommissions.amount,
  currency: affiliateCommissions.currency,
  baseAmount: affiliateCommissions.baseAmount,
  ratePercent: affiliateCommissions.ratePercent,
  ruleSource: affiliateCommissions.ruleSource,
  holdUntil: affiliateCommissions.holdUntil,
  note: affiliateCommissions.note,
  createdAt: affiliateCommissions.createdAt,
  referral: affiliateReferrals.publicId,
  plan: affiliateReferrals.plan,
}

export async function ledgerPage(affiliateId: number, f: LedgerFilters, pageSize = PAGE_SIZE) {
  const where = ledgerWhere(affiliateId, f)
  const page = Math.max(1, f.page ?? 1)
  const [rows, [total]] = await Promise.all([
    db
      .select(ledgerColumns)
      .from(affiliateCommissions)
      .leftJoin(affiliateReferrals, eq(affiliateReferrals.id, affiliateCommissions.referralId))
      .where(where)
      .orderBy(desc(affiliateCommissions.createdAt), desc(affiliateCommissions.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ v: sql<number>`count(*)::int` }).from(affiliateCommissions).where(where),
  ])
  return { rows: rows.map((r) => ({ ...r, amount: n(r.amount), baseAmount: r.baseAmount == null ? null : n(r.baseAmount), ratePercent: r.ratePercent == null ? null : n(r.ratePercent) })), total: total?.v ?? 0, page }
}
export type LedgerRow = Awaited<ReturnType<typeof ledgerPage>>["rows"][number]

// Per-month statement: what was earned, what was taken back, what was paid.
export async function monthlyStatements(affiliateId: number, months = 12) {
  const start = new Date()
  start.setUTCDate(1)
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCMonth(start.getUTCMonth() - (months - 1))
  const rows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${affiliateCommissions.createdAt}), 'YYYY-MM')`,
      // Gross earned and everything taken back, so that earned + reversed is
      // the month's net whatever state the rows are in now.
      earned: sql<string>`coalesce(sum(${affiliateCommissions.amount}) filter (where ${affiliateCommissions.amount} > 0 and ${affiliateCommissions.type} <> 'payout'), 0)`,
      reversed: sql<string>`coalesce(sum(${affiliateCommissions.amount}) filter (where ${affiliateCommissions.amount} < 0 and ${affiliateCommissions.type} <> 'payout'), 0)`,
      paid: sql<string>`coalesce(sum(-${affiliateCommissions.amount}) filter (where ${affiliateCommissions.type} = 'payout' and ${affiliateCommissions.status} = 'paid'), 0)`,
    })
    .from(affiliateCommissions)
    .where(and(eq(affiliateCommissions.affiliateId, affiliateId), gte(affiliateCommissions.createdAt, start)))
    .groupBy(sql`1`)
    .orderBy(sql`1 desc`)
  return rows.map((r) => ({ month: r.month, earned: round2(n(r.earned)), reversed: round2(n(r.reversed)), paid: round2(n(r.paid)) }))
}

// The data behind the monthly report email (and anything else that wants a
// month in review): one calendar month, UTC.
export async function monthlyReport(affiliateId: number, monthStart: Date) {
  const start = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 1))
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
  const [totals, campaigns] = await Promise.all([totalsFor(affiliateId, start, end), campaignsWithStats(affiliateId, start)])
  return {
    month: start.toISOString().slice(0, 7),
    label: start.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    ...totals,
    topCampaigns: campaigns.filter((c) => c.stats.clicks + c.stats.signups > 0).sort((a, b) => b.stats.commission - a.stats.commission || b.stats.clicks - a.stats.clicks).slice(0, 3).map((c) => ({ name: c.name, ...c.stats })),
  }
}
export type MonthlyReport = Awaited<ReturnType<typeof monthlyReport>>

// --- Payouts ----------------------------------------------------------------

export async function payoutsFor(affiliateId: number) {
  const rows = await db.select().from(affiliatePayouts).where(eq(affiliatePayouts.affiliateId, affiliateId)).orderBy(desc(affiliatePayouts.requestedAt)).limit(100)
  return rows.map((p) => ({
    id: p.id,
    amount: n(p.amount),
    fee: n(p.fee),
    net: n(p.netAmount ?? p.amount),
    currency: p.currency,
    methodType: p.methodType,
    methodLabel: p.methodLabel,
    status: p.status,
    mode: p.mode,
    network: p.network,
    asset: p.asset,
    transactionHash: p.transactionHash,
    failureReason: p.failureReason,
    requestedAt: p.requestedAt,
    completedAt: p.completedAt ?? (p.status === "paid" ? p.processedAt : null),
  }))
}

// Masked labels and display-safe facts only — the encrypted details never
// leave the server.
export async function payoutMethodsFor(affiliateId: number) {
  return db
    .select({
      id: affiliatePayoutMethods.id,
      type: affiliatePayoutMethods.type,
      label: affiliatePayoutMethods.label,
      nickname: affiliatePayoutMethods.nickname,
      metadata: affiliatePayoutMethods.metadata,
      status: affiliatePayoutMethods.status,
      isDefault: affiliatePayoutMethods.isDefault,
      holdUntil: affiliatePayoutMethods.holdUntil,
      createdAt: affiliatePayoutMethods.createdAt,
    })
    .from(affiliatePayoutMethods)
    .where(and(eq(affiliatePayoutMethods.affiliateId, affiliateId), ne(affiliatePayoutMethods.status, "removed")))
    .orderBy(desc(affiliatePayoutMethods.isDefault), affiliatePayoutMethods.id)
}

// --- Resources, announcements, notifications --------------------------------

export async function publishedResources() {
  return db.select().from(affiliateResources).where(eq(affiliateResources.published, true)).orderBy(affiliateResources.sortOrder, desc(affiliateResources.createdAt))
}

export async function announcementsFor(affiliateId: number) {
  const rows = await db
    .select({
      id: affiliateAnnouncements.id,
      title: affiliateAnnouncements.title,
      category: affiliateAnnouncements.category,
      summary: affiliateAnnouncements.summary,
      content: affiliateAnnouncements.content,
      publishedAt: affiliateAnnouncements.publishedAt,
      readAt: affiliateAnnouncementReads.readAt,
    })
    .from(affiliateAnnouncements)
    .leftJoin(affiliateAnnouncementReads, and(eq(affiliateAnnouncementReads.announcementId, affiliateAnnouncements.id), eq(affiliateAnnouncementReads.affiliateId, affiliateId)))
    .where(eq(affiliateAnnouncements.published, true))
    .orderBy(desc(affiliateAnnouncements.publishedAt))
    .limit(60)
  return rows
}

export async function notificationsFor(affiliateId: number, limit = 30) {
  return db.select().from(affiliateNotifications).where(eq(affiliateNotifications.affiliateId, affiliateId)).orderBy(desc(affiliateNotifications.createdAt)).limit(limit)
}

export async function unreadCounts(affiliateId: number): Promise<{ notifications: number; announcements: number }> {
  const [[notes], [news]] = await Promise.all([
    db.select({ v: sql<number>`count(*)::int` }).from(affiliateNotifications).where(and(eq(affiliateNotifications.affiliateId, affiliateId), isNull(affiliateNotifications.readAt))),
    db
      .select({ v: sql<number>`count(*)::int` })
      .from(affiliateAnnouncements)
      .leftJoin(affiliateAnnouncementReads, and(eq(affiliateAnnouncementReads.announcementId, affiliateAnnouncements.id), eq(affiliateAnnouncementReads.affiliateId, affiliateId)))
      .where(and(eq(affiliateAnnouncements.published, true), isNull(affiliateAnnouncementReads.id))),
  ])
  return { notifications: notes?.v ?? 0, announcements: news?.v ?? 0 }
}

export async function recentReferrals(affiliateId: number, limit = 6) {
  const page = await referralsPage(affiliateId, { page: 1 })
  return page.rows.slice(0, limit)
}
