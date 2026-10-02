import { and, desc, eq, gte, ilike, inArray, lt, lte, or, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  affiliateAnnouncements,
  affiliateCampaigns,
  affiliateClicks,
  affiliateCommissions,
  affiliateCoupons,
  affiliateFraudSignals,
  affiliatePayoutMethods,
  affiliatePayouts,
  affiliateReferrals,
  affiliateResources,
  affiliateRules,
  affiliateTiers,
  affiliates,
  user,
} from "@/lib/db/schema"
import { ledgerBalances, round2, tierFor, type Balances } from "./engine"
import { getProgram, loadTiers } from "./program"
import { PAYOUT_GROUPS, PAYOUT_IN_FLIGHT, type PayoutGroup } from "./payout-engine"
import { EARNED, PAGE_SIZE, ledgerWhere, performance, type LedgerFilters } from "./queries"
import { rangeStart, type Range } from "./types"
import { EXPORT_LIMIT } from "./csv"
import { CRYPTO } from "./crypto"
import { assetPriceUsd, exchangeConfig, withdrawalQuota, type Quota } from "./kucoin"
import { AUTO_SENDERS, EXCHANGE_PROVIDER, HOT_PROVIDER } from "./providers"
import { payoutWallet, walletBalances, type WalletBalances } from "./tron-wallet"

// What the admin side reads. Callers are admin pages/actions that have already
// passed requireAdmin({ affiliates: [...] }).

const n = (v: unknown) => Number(v ?? 0)

async function balancesByAffiliate(ids: number[] | null): Promise<Map<number, Balances>> {
  if (ids && ids.length === 0) return new Map()
  const rows = await db
    .select({ affiliateId: affiliateCommissions.affiliateId, type: affiliateCommissions.type, status: affiliateCommissions.status, amount: sql<string>`sum(${affiliateCommissions.amount})` })
    .from(affiliateCommissions)
    .where(ids ? inArray(affiliateCommissions.affiliateId, ids) : undefined)
    .groupBy(affiliateCommissions.affiliateId, affiliateCommissions.type, affiliateCommissions.status)
  const grouped = new Map<number, { type: string; status: string; amount: number }[]>()
  for (const r of rows) (grouped.get(r.affiliateId) ?? grouped.set(r.affiliateId, []).get(r.affiliateId)!).push({ type: r.type, status: r.status, amount: n(r.amount) })
  return new Map([...grouped].map(([id, entries]) => [id, ledgerBalances(entries)]))
}

const ZERO: Balances = { pending: 0, available: 0, processing: 0, lifetimeEarned: 0, lifetimePaid: 0 }

export async function programOverview(range: Range) {
  const [[first]] = await Promise.all([db.select({ at: sql<Date>`min(${affiliates.createdAt})` }).from(affiliates)])
  const since = first?.at ? new Date(first.at) : new Date()
  const start = rangeStart(range) ?? since
  const [perf, statuses, balances, [payoutQueue], [signals], top] = await Promise.all([
    performance(null, range, since),
    db.select({ status: affiliates.status, v: sql<number>`count(*)::int` }).from(affiliates).groupBy(affiliates.status),
    balancesByAffiliate(null),
    db.select({ count: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${affiliatePayouts.amount}), 0)` }).from(affiliatePayouts).where(inArray(affiliatePayouts.status, PAYOUT_IN_FLIGHT)),
    db.select({ v: sql<number>`count(*)::int` }).from(affiliateFraudSignals).where(inArray(affiliateFraudSignals.status, ["open", "reviewing"])),
    db
      .select({ id: affiliates.id, firstName: affiliates.firstName, lastName: affiliates.lastName, code: affiliates.code, commission: sql<string>`coalesce(sum(${affiliateCommissions.amount}), 0)` })
      .from(affiliateCommissions)
      .innerJoin(affiliates, eq(affiliates.id, affiliateCommissions.affiliateId))
      .where(and(EARNED, gte(affiliateCommissions.createdAt, start)))
      .groupBy(affiliates.id)
      .orderBy(sql`5 desc`)
      .limit(6),
  ])
  const totals = [...balances.values()].reduce((a, b) => ({ pending: a.pending + b.pending, available: a.available + b.available, processing: a.processing + b.processing, lifetimeEarned: a.lifetimeEarned + b.lifetimeEarned, lifetimePaid: a.lifetimePaid + b.lifetimePaid }), { ...ZERO })
  const count = (s: string) => statuses.find((x) => x.status === s)?.v ?? 0
  return {
    ...perf,
    affiliates: { approved: count("approved"), pending: count("pending") + count("review"), suspended: count("suspended"), rejected: count("rejected") },
    ledger: { pending: round2(totals.pending), available: round2(totals.available), paid: round2(totals.lifetimePaid), earned: round2(totals.lifetimeEarned) },
    payoutQueue: { count: payoutQueue?.count ?? 0, total: round2(n(payoutQueue?.total)) },
    openSignals: signals?.v ?? 0,
    top: top.map((t) => ({ id: t.id, name: `${t.firstName} ${t.lastName}`.trim(), code: t.code, commission: round2(n(t.commission)) })),
  }
}

export type AffiliateFilters = { q?: string; status?: string; page?: number }

function affiliateWhere(f: AffiliateFilters) {
  const q = f.q?.trim().replace(/[%_\\]/g, "")
  return and(
    f.status === "applications" ? inArray(affiliates.status, ["pending", "review"]) : f.status ? eq(affiliates.status, f.status) : undefined,
    q ? or(ilike(affiliates.email, `%${q}%`), ilike(affiliates.code, `%${q}%`), ilike(affiliates.firstName, `%${q}%`), ilike(affiliates.lastName, `%${q}%`)) : undefined
  )
}

async function statsFor(ids: number[]) {
  if (!ids.length) return new Map<number, { clicks: number; referrals: number; customers: number; revenue: number }>()
  const [clicks, refs] = await Promise.all([
    db.select({ id: affiliateClicks.affiliateId, v: sql<number>`count(*)::int` }).from(affiliateClicks).where(inArray(affiliateClicks.affiliateId, ids)).groupBy(affiliateClicks.affiliateId),
    db
      .select({ id: affiliateReferrals.affiliateId, referrals: sql<number>`count(*)::int`, customers: sql<number>`count(${affiliateReferrals.firstPaymentAt})::int`, revenue: sql<string>`coalesce(sum(${affiliateReferrals.revenue}), 0)` })
      .from(affiliateReferrals)
      .where(inArray(affiliateReferrals.affiliateId, ids))
      .groupBy(affiliateReferrals.affiliateId),
  ])
  return new Map(
    ids.map((id) => {
      const r = refs.find((x) => x.id === id)
      return [id, { clicks: clicks.find((c) => c.id === id)?.v ?? 0, referrals: r?.referrals ?? 0, customers: r?.customers ?? 0, revenue: round2(n(r?.revenue)) }]
    })
  )
}

export async function affiliatesPage(f: AffiliateFilters, pageSize = PAGE_SIZE) {
  const where = affiliateWhere(f)
  const page = Math.max(1, f.page ?? 1)
  const [rows, [total], tiers] = await Promise.all([
    db.select().from(affiliates).where(where).orderBy(desc(affiliates.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ v: sql<number>`count(*)::int` }).from(affiliates).where(where),
    loadTiers(),
  ])
  const ids = rows.map((r) => r.id)
  const [stats, balances] = await Promise.all([statsFor(ids), balancesByAffiliate(ids)])
  return {
    rows: rows.map((a) => {
      const s = stats.get(a.id)!
      return { ...a, stats: s, balances: balances.get(a.id) ?? ZERO, tier: tierFor(tiers, s.customers, a.tierId) }
    }),
    total: total?.v ?? 0,
    page,
  }
}

export async function affiliateDetail(id: number) {
  const [aff] = await db.select().from(affiliates).where(eq(affiliates.id, id))
  if (!aff) return null
  const [[account], stats, balances, tiers, rules, campaigns, coupons, referrals, ledger, payouts, methods, signals, program] = await Promise.all([
    db.select({ id: user.id, email: user.email, name: user.name, banned: user.banned, createdAt: user.createdAt }).from(user).where(eq(user.id, aff.userId)),
    statsFor([id]),
    balancesByAffiliate([id]),
    loadTiers(),
    db.select().from(affiliateRules).where(eq(affiliateRules.affiliateId, id)).orderBy(desc(affiliateRules.id)),
    db.select().from(affiliateCampaigns).where(eq(affiliateCampaigns.affiliateId, id)).orderBy(desc(affiliateCampaigns.createdAt)),
    db.select().from(affiliateCoupons).where(eq(affiliateCoupons.affiliateId, id)).orderBy(desc(affiliateCoupons.createdAt)),
    db
      .select({ id: affiliateReferrals.id, publicId: affiliateReferrals.publicId, status: affiliateReferrals.status, source: affiliateReferrals.source, plan: affiliateReferrals.plan, revenue: affiliateReferrals.revenue, createdAt: affiliateReferrals.createdAt, userId: affiliateReferrals.userId, email: user.email })
      .from(affiliateReferrals)
      .leftJoin(user, eq(user.id, affiliateReferrals.userId))
      .where(eq(affiliateReferrals.affiliateId, id))
      .orderBy(desc(affiliateReferrals.createdAt))
      .limit(25),
    db
      .select({ id: affiliateCommissions.id, type: affiliateCommissions.type, status: affiliateCommissions.status, amount: affiliateCommissions.amount, ratePercent: affiliateCommissions.ratePercent, ruleSource: affiliateCommissions.ruleSource, holdUntil: affiliateCommissions.holdUntil, note: affiliateCommissions.note, createdAt: affiliateCommissions.createdAt, referral: affiliateReferrals.publicId })
      .from(affiliateCommissions)
      .leftJoin(affiliateReferrals, eq(affiliateReferrals.id, affiliateCommissions.referralId))
      .where(eq(affiliateCommissions.affiliateId, id))
      .orderBy(desc(affiliateCommissions.createdAt), desc(affiliateCommissions.id))
      .limit(40),
    db.select().from(affiliatePayouts).where(eq(affiliatePayouts.affiliateId, id)).orderBy(desc(affiliatePayouts.requestedAt)).limit(20),
    db
      .select({ id: affiliatePayoutMethods.id, type: affiliatePayoutMethods.type, label: affiliatePayoutMethods.label, nickname: affiliatePayoutMethods.nickname, metadata: affiliatePayoutMethods.metadata, isDefault: affiliatePayoutMethods.isDefault, status: affiliatePayoutMethods.status, holdUntil: affiliatePayoutMethods.holdUntil, holdWaivedAt: affiliatePayoutMethods.holdWaivedAt, createdAt: affiliatePayoutMethods.createdAt })
      .from(affiliatePayoutMethods)
      .where(eq(affiliatePayoutMethods.affiliateId, id))
      .orderBy(desc(affiliatePayoutMethods.isDefault), affiliatePayoutMethods.id),
    db.select().from(affiliateFraudSignals).where(eq(affiliateFraudSignals.affiliateId, id)).orderBy(desc(affiliateFraudSignals.createdAt)).limit(20),
    getProgram(),
  ])
  const s = stats.get(id)!
  return {
    affiliate: aff,
    account: account ?? null,
    stats: s,
    balances: balances.get(id) ?? ZERO,
    tiers,
    tier: tierFor(tiers, s.customers, aff.tierId),
    rules: rules.map((r) => ({ ...r, ratePercent: n(r.ratePercent) })),
    campaigns,
    coupons: coupons.map((c) => ({ ...c, discountValue: n(c.discountValue) })),
    referrals: referrals.map((r) => ({ ...r, revenue: n(r.revenue) })),
    ledger: ledger.map((l) => ({ ...l, amount: n(l.amount), ratePercent: l.ratePercent == null ? null : n(l.ratePercent) })),
    payouts: payouts.map((p) => ({ ...p, amount: n(p.amount) })),
    methods,
    signals,
    program,
  }
}
export type AffiliateDetail = NonNullable<Awaited<ReturnType<typeof affiliateDetail>>>

export type PayoutFilters = { group?: PayoutGroup; q?: string; method?: string; mode?: string; from?: Date | null; to?: Date | null; min?: number | null; max?: number | null; page?: number }

function payoutWhere(f: PayoutFilters) {
  const q = f.q?.trim().replace(/[%_\\]/g, "")
  return and(
    f.group ? inArray(affiliatePayouts.status, PAYOUT_GROUPS[f.group]) : undefined,
    f.method ? eq(affiliatePayouts.methodType, f.method) : undefined,
    f.mode === "manual" || f.mode === "automatic" ? eq(affiliatePayouts.mode, f.mode) : undefined,
    f.from ? gte(affiliatePayouts.requestedAt, f.from) : undefined,
    f.to ? lt(affiliatePayouts.requestedAt, f.to) : undefined,
    f.min != null ? gte(affiliatePayouts.amount, String(f.min)) : undefined,
    f.max != null ? lte(affiliatePayouts.amount, String(f.max)) : undefined,
    q ? or(ilike(affiliates.email, `%${q}%`), ilike(affiliates.firstName, `%${q}%`), ilike(affiliates.lastName, `%${q}%`), ilike(affiliates.code, `%${q}%`)) : undefined
  )
}

const payoutColumns = {
  id: affiliatePayouts.id,
  affiliateId: affiliatePayouts.affiliateId,
  amount: affiliatePayouts.amount,
  fee: affiliatePayouts.fee,
  netAmount: affiliatePayouts.netAmount,
  currency: affiliatePayouts.currency,
  methodId: affiliatePayouts.methodId,
  methodType: affiliatePayouts.methodType,
  methodLabel: affiliatePayouts.methodLabel,
  provider: affiliatePayouts.provider,
  status: affiliatePayouts.status,
  mode: affiliatePayouts.mode,
  network: affiliatePayouts.network,
  asset: affiliatePayouts.asset,
  transactionHash: affiliatePayouts.transactionHash,
  providerRef: affiliatePayouts.providerRef,
  failureReason: affiliatePayouts.failureReason,
  note: affiliatePayouts.note,
  attempts: affiliatePayouts.attempts,
  requestedAt: affiliatePayouts.requestedAt,
  approvedAt: affiliatePayouts.approvedAt,
  submittedAt: affiliatePayouts.submittedAt,
  completedAt: affiliatePayouts.completedAt,
  failedAt: affiliatePayouts.failedAt,
  processedAt: affiliatePayouts.processedAt,
  firstName: affiliates.firstName,
  lastName: affiliates.lastName,
  email: affiliates.email,
  affiliateStatus: affiliates.status,
  payoutHold: affiliates.payoutHold,
  fraudLock: affiliates.fraudLock,
}

const payoutRow = <T extends { amount: string; fee: string; netAmount: string | null }>(r: T) => ({ ...r, amount: n(r.amount), fee: n(r.fee), net: n(r.netAmount ?? r.amount) })

export async function payoutsPage(f: PayoutFilters, pageSize = PAGE_SIZE) {
  const where = payoutWhere(f)
  const page = Math.max(1, f.page ?? 1)
  const [rows, [total], counts] = await Promise.all([
    db
      .select(payoutColumns)
      .from(affiliatePayouts)
      .innerJoin(affiliates, eq(affiliates.id, affiliatePayouts.affiliateId))
      .where(where)
      .orderBy(desc(affiliatePayouts.requestedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ v: sql<number>`count(*)::int`, sum: sql<string>`coalesce(sum(${affiliatePayouts.amount}), 0)` }).from(affiliatePayouts).innerJoin(affiliates, eq(affiliates.id, affiliatePayouts.affiliateId)).where(where),
    db.select({ status: affiliatePayouts.status, v: sql<number>`count(*)::int` }).from(affiliatePayouts).groupBy(affiliatePayouts.status),
  ])
  // How many payouts sit in each tab, whatever the filters.
  const groups = Object.fromEntries((Object.keys(PAYOUT_GROUPS) as PayoutGroup[]).map((g) => [g, counts.filter((c) => (PAYOUT_GROUPS[g] as string[]).includes(c.status)).reduce((sum, c) => sum + c.v, 0)])) as Record<PayoutGroup, number>
  return { rows: rows.map(payoutRow), total: total?.v ?? 0, sum: round2(n(total?.sum)), page, groups }
}

export async function payoutDetail(id: number) {
  const [row] = await db.select(payoutColumns).from(affiliatePayouts).innerJoin(affiliates, eq(affiliates.id, affiliatePayouts.affiliateId)).where(eq(affiliatePayouts.id, id))
  return row ? payoutRow(row) : null
}
export type PayoutDetail = NonNullable<Awaited<ReturnType<typeof payoutDetail>>>

export async function signalsPage(f: { status?: string; page?: number }, pageSize = PAGE_SIZE) {
  const where = f.status === "open" || !f.status ? inArray(affiliateFraudSignals.status, ["open", "reviewing"]) : f.status === "all" ? undefined : eq(affiliateFraudSignals.status, f.status)
  const page = Math.max(1, f.page ?? 1)
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: affiliateFraudSignals.id,
        affiliateId: affiliateFraudSignals.affiliateId,
        type: affiliateFraudSignals.type,
        risk: affiliateFraudSignals.risk,
        details: affiliateFraudSignals.details,
        status: affiliateFraudSignals.status,
        createdAt: affiliateFraudSignals.createdAt,
        firstName: affiliates.firstName,
        lastName: affiliates.lastName,
        email: affiliates.email,
        affiliateStatus: affiliates.status,
        fraudLock: affiliates.fraudLock,
        payoutHold: affiliates.payoutHold,
      })
      .from(affiliateFraudSignals)
      .innerJoin(affiliates, eq(affiliates.id, affiliateFraudSignals.affiliateId))
      .where(where)
      .orderBy(sql`case ${affiliateFraudSignals.risk} when 'high' then 0 when 'medium' then 1 else 2 end`, desc(affiliateFraudSignals.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ v: sql<number>`count(*)::int` }).from(affiliateFraudSignals).where(where),
  ])
  return { rows, total: total?.v ?? 0, page }
}

export async function rulesList() {
  const rows = await db
    .select({
      id: affiliateRules.id,
      scope: affiliateRules.scope,
      affiliateId: affiliateRules.affiliateId,
      ratePercent: affiliateRules.ratePercent,
      durationMonths: affiliateRules.durationMonths,
      startsAt: affiliateRules.startsAt,
      endsAt: affiliateRules.endsAt,
      enabled: affiliateRules.enabled,
      note: affiliateRules.note,
      createdAt: affiliateRules.createdAt,
      firstName: affiliates.firstName,
      lastName: affiliates.lastName,
      campaign: affiliateCampaigns.name,
      coupon: affiliateCoupons.code,
    })
    .from(affiliateRules)
    .innerJoin(affiliates, eq(affiliates.id, affiliateRules.affiliateId))
    .leftJoin(affiliateCampaigns, eq(affiliateCampaigns.id, affiliateRules.campaignId))
    .leftJoin(affiliateCoupons, eq(affiliateCoupons.id, affiliateRules.couponId))
    .orderBy(desc(affiliateRules.id))
    .limit(200)
  return rows.map((r) => ({ ...r, ratePercent: n(r.ratePercent) }))
}

// Tiers with how many approved affiliates currently sit in each.
export async function tiersWithCounts() {
  const [tiers, rows, customers] = await Promise.all([
    db.select().from(affiliateTiers).orderBy(affiliateTiers.sortOrder, affiliateTiers.minCustomers),
    db.select({ id: affiliates.id, tierId: affiliates.tierId }).from(affiliates).where(eq(affiliates.status, "approved")),
    db.select({ id: affiliateReferrals.affiliateId, v: sql<number>`count(${affiliateReferrals.firstPaymentAt})::int` }).from(affiliateReferrals).groupBy(affiliateReferrals.affiliateId),
  ])
  const list = tiers.map((t) => ({ id: t.id, name: t.name, minCustomers: t.minCustomers, ratePercent: n(t.ratePercent), sortOrder: t.sortOrder, enabled: t.enabled }))
  const counts = new Map<number, number>()
  for (const a of rows) {
    const tier = tierFor(list, customers.find((c) => c.id === a.id)?.v ?? 0, a.tierId)
    if (tier) counts.set(tier.id, (counts.get(tier.id) ?? 0) + 1)
  }
  return list.map((t) => ({ ...t, affiliates: counts.get(t.id) ?? 0 }))
}

export const resourcesAll = () => db.select().from(affiliateResources).orderBy(affiliateResources.sortOrder, desc(affiliateResources.createdAt))
export const announcementsAll = () => db.select().from(affiliateAnnouncements).orderBy(desc(affiliateAnnouncements.createdAt)).limit(100)

// --- Exports ----------------------------------------------------------------

export type ExportKind = "affiliates" | "commissions" | "payouts" | "referrals"

// affiliateId null = the whole program (admin). With an id, the same shapes
// serve the affiliate's own downloads — minus the customer identity columns.
export async function exportTable(kind: ExportKind, affiliateId: number | null, f: LedgerFilters & AffiliateFilters = {}): Promise<{ header: string[]; rows: unknown[][] }> {
  const admin = affiliateId == null
  if (kind === "affiliates") {
    const rows = await db.select().from(affiliates).where(affiliateWhere(f)).orderBy(desc(affiliates.createdAt)).limit(EXPORT_LIMIT)
    const ids = rows.map((r) => r.id)
    const [stats, balances] = await Promise.all([statsFor(ids), balancesByAffiliate(ids)])
    return {
      header: ["id", "name", "email", "code", "status", "country", "clicks", "referrals", "customers", "revenue", "earned", "pending", "available", "paid", "joined"],
      rows: rows.map((a) => {
        const s = stats.get(a.id)!
        const b = balances.get(a.id) ?? ZERO
        return [a.id, `${a.firstName} ${a.lastName}`.trim(), a.email, a.code, a.status, a.country, s.clicks, s.referrals, s.customers, s.revenue, b.lifetimeEarned, b.pending, b.available, b.lifetimePaid, a.createdAt]
      }),
    }
  }
  if (kind === "commissions") {
    const rows = await db
      .select({
        id: affiliateCommissions.id,
        createdAt: affiliateCommissions.createdAt,
        type: affiliateCommissions.type,
        status: affiliateCommissions.status,
        amount: affiliateCommissions.amount,
        currency: affiliateCommissions.currency,
        baseAmount: affiliateCommissions.baseAmount,
        ratePercent: affiliateCommissions.ratePercent,
        ruleSource: affiliateCommissions.ruleSource,
        holdUntil: affiliateCommissions.holdUntil,
        note: affiliateCommissions.note,
        referral: affiliateReferrals.publicId,
        affiliate: affiliates.email,
      })
      .from(affiliateCommissions)
      .leftJoin(affiliateReferrals, eq(affiliateReferrals.id, affiliateCommissions.referralId))
      .innerJoin(affiliates, eq(affiliates.id, affiliateCommissions.affiliateId))
      .where(ledgerWhere(affiliateId, f))
      .orderBy(desc(affiliateCommissions.createdAt))
      .limit(EXPORT_LIMIT)
    return {
      header: ["id", "date", ...(admin ? ["affiliate"] : []), "type", "status", "amount", "currency", "payment_amount", "rate_percent", "rule", "referral", "clears_on", "note"],
      rows: rows.map((r) => [r.id, r.createdAt, ...(admin ? [r.affiliate] : []), r.type, r.status, n(r.amount), r.currency, r.baseAmount == null ? "" : n(r.baseAmount), r.ratePercent == null ? "" : n(r.ratePercent), r.ruleSource, r.referral, r.holdUntil, r.note]),
    }
  }
  if (kind === "payouts") {
    const rows = await db
      .select(payoutColumns)
      .from(affiliatePayouts)
      .innerJoin(affiliates, eq(affiliates.id, affiliatePayouts.affiliateId))
      .where(and(admin ? undefined : eq(affiliatePayouts.affiliateId, affiliateId), f.status ? eq(affiliatePayouts.status, f.status) : undefined))
      .orderBy(desc(affiliatePayouts.requestedAt))
      .limit(EXPORT_LIMIT)
    return {
      header: ["id", "requested", "completed", ...(admin ? ["affiliate"] : []), "amount", "fee", "net", "currency", "method", "account", "status", "mode", "network", "transaction", ...(admin ? ["reference"] : []), "failure_reason"],
      rows: rows.map((r) => [r.id, r.requestedAt, r.completedAt, ...(admin ? [r.email] : []), n(r.amount), n(r.fee), n(r.netAmount ?? r.amount), r.currency, r.methodType, r.methodLabel, r.status, r.mode, r.network, r.transactionHash, ...(admin ? [r.providerRef] : []), r.failureReason]),
    }
  }
  const rows = await db
    .select({
      publicId: affiliateReferrals.publicId,
      createdAt: affiliateReferrals.createdAt,
      status: affiliateReferrals.status,
      source: affiliateReferrals.source,
      plan: affiliateReferrals.plan,
      billing: affiliateReferrals.billing,
      country: affiliateReferrals.country,
      revenue: affiliateReferrals.revenue,
      firstPaymentAt: affiliateReferrals.firstPaymentAt,
      campaign: affiliateCampaigns.name,
      affiliate: affiliates.email,
      customer: user.email,
    })
    .from(affiliateReferrals)
    .innerJoin(affiliates, eq(affiliates.id, affiliateReferrals.affiliateId))
    .leftJoin(affiliateCampaigns, eq(affiliateCampaigns.id, affiliateReferrals.campaignId))
    .leftJoin(user, eq(user.id, affiliateReferrals.userId))
    .where(and(admin ? undefined : eq(affiliateReferrals.affiliateId, affiliateId), f.status ? eq(affiliateReferrals.status, f.status) : undefined))
    .orderBy(desc(affiliateReferrals.createdAt))
    .limit(EXPORT_LIMIT)
  return {
    // The customer's email is admin-only: an affiliate never gets it.
    header: ["referral", "signed_up", ...(admin ? ["affiliate", "customer"] : []), "status", "source", "campaign", "plan", "billing", "country", "revenue", "first_payment"],
    rows: rows.map((r) => [r.publicId, r.createdAt, ...(admin ? [r.affiliate, r.customer] : []), r.status, r.source, r.campaign, r.plan, r.billing, r.country, n(r.revenue), r.firstPaymentAt]),
  }
}

// The payout wallet as the settings page shows it: whether it can send, what it
// holds right now, and what has gone out automatically today. The balances come
// from the network and are best-effort — a slow node must not stall the page.
export async function payoutWalletStatus() {
  const wallet = payoutWallet()
  const now = new Date()
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const live = wallet.address
    ? Promise.race([walletBalances(wallet.address).catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000))])
    : Promise.resolve(null)
  const [[sent], [waiting], balances] = await Promise.all([
    db
      .select({ v: sql<string>`coalesce(sum(coalesce(${affiliatePayouts.netAmount}, ${affiliatePayouts.amount})), 0)`, n: sql<number>`count(*)::int` })
      .from(affiliatePayouts)
      // what the rules approved today, through any automatic sender: this is what the daily limit measures
      .where(and(inArray(affiliatePayouts.provider, AUTO_SENDERS), eq(affiliatePayouts.approvedBy, "auto"), gte(affiliatePayouts.requestedAt, dayStart), sql`${affiliatePayouts.status} not in ('failed','cancelled','rejected','reversed')`)),
    db
      .select({ v: sql<string>`coalesce(sum(coalesce(${affiliatePayouts.netAmount}, ${affiliatePayouts.amount})), 0)`, n: sql<number>`count(*)::int` })
      .from(affiliatePayouts)
      .where(and(eq(affiliatePayouts.provider, HOT_PROVIDER), inArray(affiliatePayouts.status, ["queued", "retry_required"]))),
    live as Promise<WalletBalances | null>,
  ])
  return {
    ready: wallet.ready,
    address: wallet.address,
    problem: wallet.ready ? null : wallet.problem,
    balances,
    sentToday: Number(sent?.v ?? 0),
    sentTodayCount: sent?.n ?? 0,
    waiting: Number(waiting?.v ?? 0),
    waitingCount: waiting?.n ?? 0,
  }
}

// The exchange account as the settings page shows it: whether it is connected,
// and for each network what can be withdrawn, what a withdrawal costs and
// whether withdrawals are open. Best-effort and time-boxed, like the wallet's.
type Boxed<T> = { value: T | null; error: string | null }
const boxed = <T>(work: Promise<T>): Promise<Boxed<T>> =>
  Promise.race([
    work.then((value): Boxed<T> => ({ value, error: null })).catch((e): Boxed<T> => ({ value: null, error: e instanceof Error ? e.message : "KuCoin couldn't be reached." })),
    new Promise<Boxed<T>>((resolve) => setTimeout(() => resolve({ value: null, error: "KuCoin didn't answer in time." }), 7000)),
  ])

export async function exchangeStatus() {
  const config = exchangeConfig()
  const specs = Object.values(CRYPTO)
  const none = <T>(): Promise<Boxed<T>> => Promise.resolve({ value: null, error: null })
  const [quotas, prices, [waiting]] = await Promise.all([
    Promise.all(specs.map((s) => (config.ready ? boxed<Quota>(withdrawalQuota(s.asset, s.exchangeChain)) : none<Quota>()))),
    Promise.all(specs.map((s) => (s.usdPegged ? Promise.resolve<Boxed<number>>({ value: 1, error: null }) : config.ready ? boxed<number>(assetPriceUsd(s.asset)) : none<number>()))),
    db
      .select({ v: sql<string>`coalesce(sum(coalesce(${affiliatePayouts.netAmount}, ${affiliatePayouts.amount})), 0)`, n: sql<number>`count(*)::int` })
      .from(affiliatePayouts)
      .where(and(eq(affiliatePayouts.provider, EXCHANGE_PROVIDER), inArray(affiliatePayouts.status, ["queued", "retry_required"]))),
  ])
  return {
    ready: config.ready,
    problem: config.ready ? (quotas.find((q) => q.error)?.error ?? null) : config.problem,
    relay: process.env.KUCOIN_RELAY?.trim() || null,
    networks: specs.map((spec, i) => ({ type: spec.type, asset: spec.asset, network: spec.networkLabel, quota: quotas[i].value, priceUsd: prices[i].value })),
    waiting: Number(waiting?.v ?? 0),
    waitingCount: waiting?.n ?? 0,
  }
}
