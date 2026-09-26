import { and, count, desc, eq, gte, isNotNull, ne } from "drizzle-orm"
import { db } from "@/lib/db"
import { metatraderConnections, subscriptions, trades, tradingAccounts } from "@/lib/db/schema"
import { getWhopClient, type PlanTier } from "@/lib/whop"
import { hasUsedTrial, isOwner, PENDING_STATUS, rowGrantsAccess } from "@/lib/subscription"
import { ESSENTIAL_ACCOUNT_LIMIT, ESSENTIAL_METATRADER_LIMIT } from "@/lib/plan-allowance"

// Everything the Billing page shows, read live from Whop (the membership,
// its plan's price, payments and saved cards) plus TradeLoop's own usage.
// Our subscriptions table only says which Whop memberships are this user's —
// its status can lag Whop's (a trial set to cancel still reads "active"
// there), so the page never takes status or price from it when Whop answers.

export type BillingStatus = "trialing" | "active" | "past_due" | "canceling" | "canceled" | "expired"
export type PaymentStatus = "paid" | "pending" | "failed" | "refunded" | "canceled" | "review"

export interface BillingPayment {
  id: string
  date: string
  description: string
  reason: string | null // "Renewal", "Free trial started"…
  amount: number
  currency: string
  status: PaymentStatus
  card: string | null // "Visa •••• 4242"
}

export interface BillingCard {
  id: string
  brand: string
  last4: string
  expMonth: number | null
  expYear: number | null
  expired: boolean
  inUse: boolean // the card the subscription was last charged with
  icon: string | null // Whop's brand artwork
}

export interface BillingAddress {
  name: string | null
  line1: string | null
  line2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
}

export interface BillingSubscription {
  plan: PlanTier
  title: string // the Whop plan's own title, e.g. "Pro (Annual)"
  status: BillingStatus
  periodStart: string | null
  periodEnd: string | null
  price: { amount: number; currency: string; periodDays: number } | null
  trialDays: number
  manageUrl: string | null // Whop's page for this membership's card & billing details
  recoveryUrl: string | null // Whop's page to retry a failed payment
}

export interface BillingUsage {
  accounts: number
  accountLimit: number | null // null = unlimited
  metatrader: number
  metatraderLimit: number | null
  tradesThisMonth: number
}

// A plan the "Manage plan" window offers, priced as checkout would charge it.
export interface PlanOption {
  plan: PlanTier
  billing: "monthly" | "annual"
  title: string
  amount: number // per period
  list: number // before the promo, per period
  periodDays: number
}

export interface BillingOverview {
  access: "owner" | "admin" | "whop" | "none"
  plan: PlanTier | null
  subscription: BillingSubscription | null
  adminGrant: { plan: PlanTier; until: string | null } | null
  payments: BillingPayment[]
  cards: BillingCard[]
  address: BillingAddress | null
  account: { name: string; email: string; billingEmail: string | null }
  usage: BillingUsage
  trialEligible: boolean
  whopError: boolean // Whop couldn't be reached; what's shown comes from our records
}

const WHOP_REQUEST = { timeoutInSeconds: 8, maxRetries: 1 }

// Membership as the API returns it: the SDK's type (1.1.4) leaves out these
// two fields, which retrieve does send.
type LiveMembership = Awaited<ReturnType<ReturnType<typeof getWhopClient>["memberships"]["retrieve"]>> & {
  manage_url?: string | null
  current_period_start?: string | null
}

const PAYMENT_STATUS: Record<string, PaymentStatus> = {
  succeeded: "paid",
  pending: "pending",
  requires_capture: "pending",
  failed: "failed",
  past_due: "failed",
  uncollectible: "failed",
  price_too_low: "failed",
  refunded: "refunded",
  auto_refunded: "refunded",
  partially_refunded: "refunded",
  canceled: "canceled",
}

function paymentStatus(p: { status?: string | null; substatus?: string | null }): PaymentStatus {
  if (p.substatus && PAYMENT_STATUS[p.substatus]) return PAYMENT_STATUS[p.substatus]
  if (p.substatus?.startsWith("dispute") || p.substatus?.startsWith("resolution")) return "review"
  if (p.status === "paid") return "paid"
  if (p.status === "void") return "canceled"
  if (p.status === "uncollectible") return "failed"
  return "pending"
}

function paymentReason(reason: string | null | undefined, amount: number): string | null {
  if (reason === "subscription_create") return amount === 0 ? "Free trial started" : "Subscription started"
  if (reason === "subscription_cycle" || reason === "subscription_update" || reason === "subscription") return "Renewal"
  return null
}

function membershipStatus(status: string, cancelAtPeriodEnd: boolean): BillingStatus {
  if ((status === "active" || status === "trialing" || status === "canceling") && (cancelAtPeriodEnd || status === "canceling")) return "canceling"
  if (status === "trialing" || status === "active" || status === "past_due" || status === "canceled" || status === "expired") return status
  if (status === "completed") return "expired"
  return "active"
}

const GRANTING = new Set<BillingStatus>(["trialing", "active", "past_due", "canceling"])

async function usageFor(userId: string, pro: boolean): Promise<BillingUsage> {
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
  const [[accounts], [metatrader], [monthTrades]] = await Promise.all([
    db.select({ n: count() }).from(tradingAccounts).where(eq(tradingAccounts.userId, userId)),
    db.select({ n: count() }).from(metatraderConnections).where(eq(metatraderConnections.userId, userId)),
    db.select({ n: count() }).from(trades).where(and(eq(trades.userId, userId), gte(trades.entryTime, monthStart))),
  ])
  return {
    accounts: accounts.n,
    accountLimit: pro ? null : ESSENTIAL_ACCOUNT_LIMIT,
    metatrader: metatrader.n,
    metatraderLimit: pro ? null : ESSENTIAL_METATRADER_LIMIT,
    tradesThisMonth: monthTrades.n,
  }
}

// The user's Whop memberships (newest first) — the ones our records say are
// theirs. Pending checkout placeholders have no membership yet.
async function whopRows(userId: string) {
  return db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.source, "whop"), ne(subscriptions.status, PENDING_STATUS), isNotNull(subscriptions.whopMembershipId)))
    .orderBy(desc(subscriptions.updatedAt))
}

// The membership the Billing page's actions act on: the newest one that
// still grants access (by Whop's word), else the newest at all.
export async function currentWhopMembershipId(userId: string): Promise<string | null> {
  const rows = await whopRows(userId)
  if (rows.length === 0) return null
  const client = getWhopClient()
  for (const row of rows) {
    try {
      const m = await client.memberships.retrieve({ id: row.whopMembershipId! }, WHOP_REQUEST)
      if (GRANTING.has(membershipStatus(m.status, m.cancel_at_period_end))) return m.id
    } catch {
      // try the next one
    }
  }
  return rows[0].whopMembershipId
}

// The Whop member behind a membership (whose saved cards these are) and the
// card its latest successful charge used, read off its payments.
export async function memberAndCardInUse(membershipId: string): Promise<{ memberId: string | null; cardInUse: string | null }> {
  const payments = (await getWhopClient().payments.list({ membership_id: membershipId, first: 25 }, WHOP_REQUEST)).data
  const memberId = payments.find((p) => p.member_id)?.member_id ?? null
  const cardInUse = payments.find((p) => paymentStatus(p) === "paid" && p.payment_method_id)?.payment_method_id ?? null
  return { memberId, cardInUse }
}

export async function getBillingOverview(user: { id: string; email: string; name: string }, ipHash: string | null = null): Promise<BillingOverview> {
  const [owner, rows, adminRows, trialUsed] = await Promise.all([
    isOwner(user.id),
    whopRows(user.id),
    db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, user.id), eq(subscriptions.source, "admin")))
      .orderBy(desc(subscriptions.updatedAt)),
    hasUsedTrial(user.id, user.email, ipHash),
  ])
  const adminRow = adminRows.find(rowGrantsAccess) ?? null

  const base = {
    payments: [] as BillingPayment[],
    cards: [] as BillingCard[],
    address: null as BillingAddress | null,
    account: { name: user.name, email: user.email, billingEmail: null as string | null },
    trialEligible: !trialUsed,
    whopError: false,
  }

  // Every Whop membership of this user, live: status, plan price, payments.
  const client = getWhopClient()
  const memberships = await Promise.all(
    rows.map(async (row) => {
      try {
        const [m, payments] = await Promise.all([
          client.memberships.retrieve({ id: row.whopMembershipId! }, WHOP_REQUEST).then((m) => m as LiveMembership),
          client.payments.list({ membership_id: row.whopMembershipId!, first: 50 }, WHOP_REQUEST).then((page) => page.data),
        ])
        const plan = await client.plans.retrieve({ id: m.plan_id }, WHOP_REQUEST).catch(() => null)
        return { row, m, payments, plan }
      } catch (err) {
        console.warn("[billing] Whop lookup failed for a membership:", err instanceof Error ? err.message : err)
        return { row, m: null, payments: [], plan: null }
      }
    }),
  )
  base.whopError = memberships.some((x) => x.m == null)

  // Payment history across all of them, newest first.
  const payments: (BillingPayment & { memberId: string | null; methodId: string | null; address: BillingAddress | null; email: string | null; ts: number })[] = []
  for (const { row, payments: list, plan } of memberships) {
    const title = plan?.title ?? `${row.plan === "pro" ? "Pro" : "Essential"}${row.billing ? ` (${row.billing === "annual" ? "Annual" : "Monthly"})` : ""}`
    for (const p of list) {
      const amount = Number(p.total?.amount ?? 0)
      const card = p.payment_instrument?.card
      const date = p.paid_at ?? p.created_at
      const a = p.billing_address
      payments.push({
        id: p.id,
        date,
        ts: new Date(date).getTime(),
        description: title,
        reason: paymentReason(p.billing_reason, amount),
        amount,
        currency: (p.total?.currency ?? p.currency ?? "usd").toUpperCase(),
        status: paymentStatus(p),
        card: p.payment_instrument?.display_name ?? (card?.last4 ? `${card.brand ?? "Card"} •••• ${card.last4}` : null),
        memberId: p.member_id ?? null,
        methodId: paymentStatus(p) === "paid" ? (p.payment_method_id ?? null) : null,
        address: a
          ? { name: a.name ?? null, line1: a.line1 ?? null, line2: a.line2 ?? null, city: a.city ?? null, state: a.state ?? null, postalCode: a.postal_code ?? null, country: a.country ?? null }
          : null,
        email: p.customer_email ?? null,
      })
    }
  }
  payments.sort((x, y) => y.ts - x.ts)
  base.payments = payments.map(({ memberId: _m, methodId: _p, address: _a, email: _e, ts: _t, ...rest }) => rest)
  base.address = payments.find((p) => p.address?.line1 || p.address?.name)?.address ?? null
  base.account.billingEmail = payments.find((p) => p.email)?.email ?? null

  // The current membership: the newest one Whop says still grants access,
  // else the newest one (so a canceled plan still shows what it was).
  const live = memberships.filter((x) => x.m != null)
  const current =
    live.find((x) => GRANTING.has(membershipStatus(x.m!.status, x.m!.cancel_at_period_end))) ??
    live[0] ??
    null
  let subscription: BillingSubscription | null = null
  if (current?.m) {
    const m = current.m
    const failed = current.payments.find((p) => paymentStatus(p) === "failed" && p.recovery_url)
    subscription = {
      plan: current.row.plan === "pro" ? "pro" : "essential",
      title: current.plan?.title ?? (current.row.plan === "pro" ? "Pro" : "Essential"),
      status: membershipStatus(m.status, m.cancel_at_period_end),
      periodStart: m.current_period_start ?? null,
      periodEnd: m.current_period_end ?? null,
      price:
        current.plan?.renewal_price != null
          ? { amount: Number(current.plan.renewal_price), currency: (current.plan.currency ?? "usd").toUpperCase(), periodDays: current.plan.billing_period ?? 30 }
          : null,
      trialDays: current.plan?.trial_period_days ?? 0,
      manageUrl: m.manage_url ?? null,
      recoveryUrl: m.status === "past_due" ? (failed?.recovery_url ?? null) : null,
    }
  } else if (rows[0]) {
    // Whop didn't answer: what our records say, marked as such (whopError).
    const row = rows[0]
    subscription = {
      plan: row.plan === "pro" ? "pro" : "essential",
      title: row.plan === "pro" ? "Pro" : "Essential",
      status: row.status === "trialing" || row.status === "past_due" || row.status === "canceled" || row.status === "expired" ? row.status : "active",
      periodStart: null,
      periodEnd: row.currentPeriodEnd?.toISOString() ?? null,
      price: null,
      trialDays: 0,
      manageUrl: null,
      recoveryUrl: null,
    }
  }

  // Saved cards on the Whop member behind the current membership.
  const memberId = payments.find((p) => p.memberId)?.memberId ?? null
  const cardInUse = payments.find((p) => p.methodId)?.methodId ?? null
  if (memberId) {
    try {
      const methods = (await client.paymentMethods.list({ member_id: memberId }, WHOP_REQUEST)).data
      base.cards = methods
        .filter((pm) => pm.payment_method_type === "card" && "card" in pm && pm.card)
        .map((pm) => {
          const card = (pm as { card: { brand?: string | null; last4?: string | null; exp_month?: number | null; exp_year?: number | null; expired?: boolean | null } }).card
          const icons = (pm as { icons?: { card?: { light?: { svg?: string } } } }).icons
          return {
            id: pm.id,
            brand: card.brand ?? "card",
            last4: card.last4 ?? "",
            expMonth: card.exp_month ?? null,
            expYear: card.exp_year ?? null,
            expired: !!card.expired,
            inUse: pm.id === cardInUse,
            icon: icons?.card?.light?.svg ?? null,
          }
        })
        .sort((a, b) => Number(b.inUse) - Number(a.inUse))
    } catch (err) {
      console.warn("[billing] couldn't list saved cards:", err instanceof Error ? err.message : err)
      base.whopError = true
    }
  }

  const subscriptionGrants = subscription != null && GRANTING.has(subscription.status)
  const access: BillingOverview["access"] = owner ? "owner" : subscriptionGrants ? "whop" : adminRow ? "admin" : "none"
  const plan: PlanTier | null = owner ? "pro" : subscriptionGrants ? subscription!.plan : adminRow ? (adminRow.plan === "pro" ? "pro" : "essential") : null

  return {
    ...base,
    access,
    plan,
    subscription,
    adminGrant: adminRow ? { plan: adminRow.plan === "pro" ? "pro" : "essential", until: adminRow.currentPeriodEnd?.toISOString() ?? null } : null,
    usage: await usageFor(user.id, plan === "pro"),
  }
}
