import { cache } from "react"
import { and, desc, eq, gt, gte, ilike, inArray, isNotNull, or, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { db } from "@/lib/db"
import { affiliateCampaigns, affiliateClicks, affiliateCommissions, affiliateConversions, affiliateFeedback, affiliatePayouts, affiliateReferrals, affiliates } from "@/lib/db/schema"
import { getAppSetting, setAppSetting } from "@/lib/app-settings"
import { round2 } from "../engine"
import { EARNED, bucketFor, type Bucket, type SeriesPoint, type Totals } from "../queries"
import { DEFAULT_V2_CONFIG, effectiveVersion, normalizeV2Config, v2Open, type DashboardVersion, type V2Config } from "./config"
import { balanceTrend, countsTowardBalance, type BalanceTrend } from "./wallet"
import type { PortalContext } from "../guard"

// The V2 dashboard's server side. Like everything the portal reads, every
// query is scoped by the affiliate the session resolved (lib/affiliates/guard),
// never by an id from the browser. The leaderboard is the one cross-affiliate
// read, and it only ever includes affiliates who opted in to it.

const n = (v: unknown) => Number(v ?? 0)
const KEY = "affiliate_dashboard_v2"

export const getV2Config = cache(async (): Promise<V2Config> => {
  try {
    return normalizeV2Config(await getAppSetting(KEY))
  } catch {
    // The portal must open even if this can't be read — as Classic, for everyone.
    return { ...DEFAULT_V2_CONFIG, enabled: false }
  }
})

export async function saveV2Config(next: unknown): Promise<V2Config> {
  const clean = normalizeV2Config(next)
  await setAppSetting(KEY, clean)
  return clean
}

// Which dashboard this affiliate gets, and whether V2 is open to them at all.
export async function portalVersion(affiliate: PortalContext["affiliate"]): Promise<{ config: V2Config; open: boolean; version: DashboardVersion }> {
  const config = await getV2Config()
  return { config, open: v2Open(config, affiliate.id), version: effectiveVersion(config, affiliate) }
}

export async function setDashboardVersion(affiliateId: number, version: DashboardVersion): Promise<void> {
  await db.update(affiliates).set({ dashboardVersion: version, updatedAt: new Date() }).where(eq(affiliates.id, affiliateId))
}

// --- Today's focus -----------------------------------------------------------------

// The next commission(s) to clear their hold: when, and how much clears that day.
export async function nextRelease(affiliateId: number, now = new Date()): Promise<{ amount: number; at: Date } | null> {
  const rows = await db
    .select({ amount: affiliateCommissions.amount, holdUntil: affiliateCommissions.holdUntil })
    .from(affiliateCommissions)
    .where(and(eq(affiliateCommissions.affiliateId, affiliateId), sql`${affiliateCommissions.type} <> 'payout'`, inArray(affiliateCommissions.status, ["pending", "approved"]), isNotNull(affiliateCommissions.holdUntil), gt(affiliateCommissions.holdUntil, now)))
    .orderBy(affiliateCommissions.holdUntil)
    .limit(200)
  if (!rows.length) return null
  const first = rows[0].holdUntil!
  const day = first.toISOString().slice(0, 10)
  const amount = round2(rows.filter((r) => r.holdUntil!.toISOString().slice(0, 10) === day).reduce((s, r) => s + n(r.amount), 0))
  return amount > 0 ? { amount, at: first } : null
}

// --- Goals and achievements --------------------------------------------------------------

export async function monthProgress(affiliateId: number, now = new Date()): Promise<{ customers: number; clicks: number; commission: number }> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const [[clicks], [customers], [commission]] = await Promise.all([
    db.select({ v: sql<number>`count(*)::int` }).from(affiliateClicks).where(and(eq(affiliateClicks.affiliateId, affiliateId), gte(affiliateClicks.createdAt, start))),
    db.select({ v: sql<number>`count(*)::int` }).from(affiliateReferrals).where(and(eq(affiliateReferrals.affiliateId, affiliateId), gte(affiliateReferrals.firstPaymentAt, start))),
    db.select({ v: sql<string>`coalesce(sum(${affiliateCommissions.amount}), 0)` }).from(affiliateCommissions).where(and(eq(affiliateCommissions.affiliateId, affiliateId), EARNED, gte(affiliateCommissions.createdAt, start))),
  ])
  return { clicks: n(clicks?.v), customers: n(customers?.v), commission: round2(n(commission?.v)) }
}

export async function achievementStats(affiliateId: number): Promise<{ referrals: number; customers: number; clicks: number; payoutsPaid: number }> {
  const [[refs], [clicks], [paid]] = await Promise.all([
    db.select({ referrals: sql<number>`count(*)::int`, customers: sql<number>`count(${affiliateReferrals.firstPaymentAt})::int` }).from(affiliateReferrals).where(eq(affiliateReferrals.affiliateId, affiliateId)),
    db.select({ v: sql<number>`count(*)::int` }).from(affiliateClicks).where(eq(affiliateClicks.affiliateId, affiliateId)),
    db.select({ v: sql<number>`count(*)::int` }).from(affiliatePayouts).where(and(eq(affiliatePayouts.affiliateId, affiliateId), eq(affiliatePayouts.status, "paid"))),
  ])
  return { referrals: n(refs?.referrals), customers: n(refs?.customers), clicks: n(clicks?.v), payoutsPaid: n(paid?.v) }
}

// --- Leaderboard ---------------------------------------------------------------------------

export type LeaderPeriod = "month" | "quarter" | "all"
export type LeaderMetric = "earnings" | "customers" | "conversion"
export type LeaderRow = { rank: number; name: string; customers: number; earnings: number; clicks: number; conversion: number | null; you: boolean }

export function periodStart(period: LeaderPeriod, now = new Date()): Date | null {
  if (period === "all") return null
  if (period === "month") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  return new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1))
}

// A public name: first name and the initial of the last. Nothing else about
// the affiliate (or any customer) is shown.
export const publicName = (first: string, last: string) => `${first.trim()} ${last.trim() ? `${last.trim()[0].toUpperCase()}.` : ""}`.trim()

// Ranks only the approved affiliates who chose to appear. Conversion needs at
// least 50 clicks in the period to be ranked, so one lucky click can't top it.
export async function leaderboard(viewerId: number, period: LeaderPeriod, metric: LeaderMetric, limit = 25): Promise<{ rows: LeaderRow[]; you: LeaderRow | null; total: number }> {
  const start = periodStart(period)
  const people = await db
    .select({ id: affiliates.id, firstName: affiliates.firstName, lastName: affiliates.lastName })
    .from(affiliates)
    .where(and(eq(affiliates.status, "approved"), eq(affiliates.leaderboardPublic, true)))
  if (!people.length) return { rows: [], you: null, total: 0 }
  const ids = people.map((p) => p.id)
  const [earn, cust, clk] = await Promise.all([
    db.select({ id: affiliateCommissions.affiliateId, v: sql<string>`coalesce(sum(${affiliateCommissions.amount}), 0)` }).from(affiliateCommissions).where(and(inArray(affiliateCommissions.affiliateId, ids), EARNED, start ? gte(affiliateCommissions.createdAt, start) : undefined)).groupBy(affiliateCommissions.affiliateId),
    db.select({ id: affiliateReferrals.affiliateId, v: sql<number>`count(*)::int` }).from(affiliateReferrals).where(and(inArray(affiliateReferrals.affiliateId, ids), isNotNull(affiliateReferrals.firstPaymentAt), start ? gte(affiliateReferrals.firstPaymentAt, start) : undefined)).groupBy(affiliateReferrals.affiliateId),
    db.select({ id: affiliateClicks.affiliateId, v: sql<number>`count(*)::int` }).from(affiliateClicks).where(and(inArray(affiliateClicks.affiliateId, ids), start ? gte(affiliateClicks.createdAt, start) : undefined)).groupBy(affiliateClicks.affiliateId),
  ])
  const get = <T extends { id: number; v: unknown }>(rows: T[], id: number) => n(rows.find((r) => r.id === id)?.v)
  const all = people.map((p) => {
    const clicks = get(clk, p.id)
    const customers = get(cust, p.id)
    return { id: p.id, name: publicName(p.firstName, p.lastName), customers, earnings: round2(get(earn, p.id)), clicks, conversion: clicks >= 50 ? customers / clicks : null }
  })
  const score = (r: (typeof all)[number]) => (metric === "earnings" ? r.earnings : metric === "customers" ? r.customers : (r.conversion ?? -1))
  const ranked = all
    .filter((r) => (metric === "conversion" ? r.conversion != null : score(r) > 0))
    .sort((a, b) => score(b) - score(a) || b.customers - a.customers || a.id - b.id)
    .map((r, i) => ({ rank: i + 1, name: r.name, customers: r.customers, earnings: r.earnings, clicks: r.clicks, conversion: r.conversion, you: r.id === viewerId }))
  return { rows: ranked.slice(0, limit), you: ranked.find((r) => r.you) ?? null, total: ranked.length }
}

export async function setLeaderboardPublic(affiliateId: number, on: boolean): Promise<void> {
  await db.update(affiliates).set({ leaderboardPublic: on, updatedAt: new Date() }).where(eq(affiliates.id, affiliateId))
}

// --- One campaign -------------------------------------------------------------------------

function keys(start: Date, end: Date, unit: Bucket): string[] {
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
  if (unit === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
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
const trunc = (unit: Bucket, col: AnyPgColumn) => sql<string>`to_char(date_trunc(${sql.raw(`'${unit}'`)}, ${col}), 'YYYY-MM-DD')`

// A campaign of this affiliate's, with its totals and chart for the period. Null when it isn't theirs.
export async function campaignDetail(affiliateId: number, campaignId: number, start: Date | null, now = new Date()) {
  const [campaign] = await db.select().from(affiliateCampaigns).where(and(eq(affiliateCampaigns.id, campaignId), eq(affiliateCampaigns.affiliateId, affiliateId)))
  if (!campaign) return null
  const from = start ?? campaign.createdAt
  const unit = bucketFor(from, now)
  const mine = (col: AnyPgColumn) => eq(col, affiliateId)
  const [clicks, signups, customers, trials, revenue, commission] = await Promise.all([
    db.select({ d: trunc(unit, affiliateClicks.createdAt), v: sql<number>`count(*)::int` }).from(affiliateClicks).where(and(mine(affiliateClicks.affiliateId), eq(affiliateClicks.campaignId, campaignId), gte(affiliateClicks.createdAt, from))).groupBy(sql`1`),
    db.select({ d: trunc(unit, affiliateReferrals.createdAt), v: sql<number>`count(*)::int` }).from(affiliateReferrals).where(and(mine(affiliateReferrals.affiliateId), eq(affiliateReferrals.campaignId, campaignId), gte(affiliateReferrals.createdAt, from))).groupBy(sql`1`),
    db.select({ d: trunc(unit, affiliateReferrals.firstPaymentAt), v: sql<number>`count(*)::int` }).from(affiliateReferrals).where(and(mine(affiliateReferrals.affiliateId), eq(affiliateReferrals.campaignId, campaignId), gte(affiliateReferrals.firstPaymentAt, from))).groupBy(sql`1`),
    db.select({ v: sql<number>`count(*)::int` }).from(affiliateConversions).innerJoin(affiliateReferrals, eq(affiliateReferrals.id, affiliateConversions.referralId)).where(and(mine(affiliateConversions.affiliateId), eq(affiliateReferrals.campaignId, campaignId), eq(affiliateConversions.type, "trial"), gte(affiliateConversions.createdAt, from))),
    db
      .select({ d: trunc(unit, affiliateConversions.createdAt), v: sql<string>`sum(${affiliateConversions.amount})` })
      .from(affiliateConversions)
      .innerJoin(affiliateReferrals, eq(affiliateReferrals.id, affiliateConversions.referralId))
      .where(and(mine(affiliateConversions.affiliateId), eq(affiliateReferrals.campaignId, campaignId), eq(affiliateConversions.type, "payment"), gte(affiliateConversions.createdAt, from)))
      .groupBy(sql`1`),
    db
      .select({ d: trunc(unit, affiliateCommissions.createdAt), v: sql<string>`sum(${affiliateCommissions.amount})` })
      .from(affiliateCommissions)
      .innerJoin(affiliateReferrals, eq(affiliateReferrals.id, affiliateCommissions.referralId))
      .where(and(mine(affiliateCommissions.affiliateId), eq(affiliateReferrals.campaignId, campaignId), EARNED, gte(affiliateCommissions.createdAt, from)))
      .groupBy(sql`1`),
  ])
  const map = (rows: { d: string; v: unknown }[]) => new Map(rows.map((r) => [r.d, n(r.v)]))
  const [c, s, cu, r, co] = [map(clicks), map(signups), map(customers), map(revenue), map(commission)]
  const points: SeriesPoint[] = keys(from, now, unit).map((date) => ({ date, clicks: c.get(date) ?? 0, signups: s.get(date) ?? 0, customers: cu.get(date) ?? 0, revenue: round2(r.get(date) ?? 0), commission: round2(co.get(date) ?? 0) }))
  const sum = (k: keyof Omit<SeriesPoint, "date">) => round2(points.reduce((t, p) => t + p[k], 0))
  const totals: Totals = { clicks: sum("clicks"), signups: sum("signups"), trials: n(trials[0]?.v), customers: sum("customers"), revenue: sum("revenue"), commission: sum("commission") }
  return { campaign, totals, series: { unit, points } }
}

// --- Search (the header search box) -----------------------------------------------------

export type PortalHit = { key: string; group: string; title: string; detail: string; href: string }

export async function searchPortal(affiliateId: number, raw: string): Promise<PortalHit[]> {
  const term = raw.trim().slice(0, 60)
  if (term.length < 2) return []
  const like = `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
  const num = /^#?\s*(\d{1,9})$/.exec(term)?.[1]
  const [refs, campaigns, payouts] = await Promise.all([
    db.select({ publicId: affiliateReferrals.publicId, status: affiliateReferrals.status, plan: affiliateReferrals.plan }).from(affiliateReferrals).where(and(eq(affiliateReferrals.affiliateId, affiliateId), ilike(affiliateReferrals.publicId, like))).orderBy(desc(affiliateReferrals.createdAt)).limit(5),
    db.select({ id: affiliateCampaigns.id, name: affiliateCampaigns.name, status: affiliateCampaigns.status }).from(affiliateCampaigns).where(and(eq(affiliateCampaigns.affiliateId, affiliateId), or(ilike(affiliateCampaigns.name, like), ilike(affiliateCampaigns.utmSource, like)))).limit(5),
    num ? db.select({ id: affiliatePayouts.id, amount: affiliatePayouts.amount, status: affiliatePayouts.status }).from(affiliatePayouts).where(and(eq(affiliatePayouts.affiliateId, affiliateId), eq(affiliatePayouts.id, Number(num)))) : Promise.resolve([]),
  ])
  return [
    ...refs.map((r) => ({ key: `r:${r.publicId}`, group: "Referrals", title: r.publicId, detail: [r.plan, r.status].filter(Boolean).join(" · "), href: `/affiliate/v2/referrals?open=${encodeURIComponent(r.publicId)}` })),
    ...campaigns.map((c) => ({ key: `c:${c.id}`, group: "Campaigns", title: c.name, detail: c.status, href: `/affiliate/v2/campaigns/${c.id}` })),
    ...payouts.map((p) => ({ key: `p:${p.id}`, group: "Payouts", title: `Payout #${p.id}`, detail: `$${n(p.amount).toFixed(2)} · ${p.status}`, href: `/affiliate/v2/payouts?payout=${p.id}` })),
  ]
}

// --- Wallet -----------------------------------------------------------------------------------

// One read of the affiliate's ledger, grouped by day / type / status, giving
// the Wallet both of the things it derives: the balance history behind the
// Total Balance card, and how many rows each Transaction History filter holds.
export async function walletLedgerSummary(affiliateId: number, now = new Date(), days = 30): Promise<{ trend: BalanceTrend; byType: Record<string, number> }> {
  const day = sql<string>`to_char(${affiliateCommissions.createdAt}, 'YYYY-MM-DD')`
  const rows = await db
    .select({ day, type: affiliateCommissions.type, status: affiliateCommissions.status, amount: sql<string>`sum(${affiliateCommissions.amount})`, rows: sql<number>`count(*)::int` })
    .from(affiliateCommissions)
    .where(eq(affiliateCommissions.affiliateId, affiliateId))
    .groupBy(day, affiliateCommissions.type, affiliateCommissions.status)
  const byType: Record<string, number> = {}
  for (const r of rows) byType[r.type] = (byType[r.type] ?? 0) + n(r.rows)
  return { trend: balanceTrend(rows.filter((r) => countsTowardBalance(r.type, r.status)).map((r) => ({ day: r.day, amount: n(r.amount) })), now, days), byType }
}

// --- Feedback -------------------------------------------------------------------------------

export async function saveFeedback(affiliateId: number, input: { rating: string; message: string | null; page: string | null }): Promise<void> {
  await db.insert(affiliateFeedback).values({ affiliateId, rating: input.rating, message: input.message, page: input.page, version: "v2" })
}

// A soft brake on a stuck button: a handful of messages an hour is plenty.
export async function recentFeedbackCount(affiliateId: number, since: Date): Promise<number> {
  const [row] = await db.select({ v: sql<number>`count(*)::int` }).from(affiliateFeedback).where(and(eq(affiliateFeedback.affiliateId, affiliateId), gte(affiliateFeedback.createdAt, since)))
  return n(row?.v)
}

// For the admin: what affiliates said, newest first, with a tally.
export async function feedbackForAdmin(limit = 100) {
  const [rows, tally, [v2users]] = await Promise.all([
    db
      .select({ id: affiliateFeedback.id, rating: affiliateFeedback.rating, message: affiliateFeedback.message, page: affiliateFeedback.page, createdAt: affiliateFeedback.createdAt, affiliateId: affiliateFeedback.affiliateId, firstName: affiliates.firstName, lastName: affiliates.lastName, email: affiliates.email })
      .from(affiliateFeedback)
      .innerJoin(affiliates, eq(affiliates.id, affiliateFeedback.affiliateId))
      .orderBy(desc(affiliateFeedback.createdAt))
      .limit(limit),
    db.select({ rating: affiliateFeedback.rating, v: sql<number>`count(*)::int` }).from(affiliateFeedback).groupBy(affiliateFeedback.rating),
    db.select({ v: sql<number>`count(*)::int` }).from(affiliates).where(and(eq(affiliates.status, "approved"), eq(affiliates.dashboardVersion, "v2"))),
  ])
  return { rows, tally: Object.fromEntries(tally.map((t) => [t.rating, t.v])) as Record<string, number>, v2Users: n(v2users?.v) }
}

