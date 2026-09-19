import { getWhopClient } from "@/lib/whop"

// Whop-side billing for the admin panel. Every call goes through `guarded`,
// which turns Whop's 403 for a missing API-key scope into a message naming
// the scope, so the page says what to enable instead of failing opaquely.

export class WhopScopeError extends Error {
  constructor(public readonly scope: string) {
    super(`The Whop API key doesn't have the "${scope}" permission. Add it to the key in Whop's developer settings, update WHOP_API_KEY in Vercel and redeploy.`)
  }
}

function scopeFrom(err: unknown): string | null {
  const message = (err as { body?: { error?: { message?: string } }; message?: string })?.body?.error?.message ?? (err as Error)?.message ?? ""
  return message.match(/authorized for the ([\w:]+) scope/)?.[1] ?? null
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const scope = scopeFrom(err)
    if (scope) throw new WhopScopeError(scope)
    const body = (err as { body?: { error?: { message?: string } } })?.body?.error?.message
    throw new Error(body ? `Whop: ${body}` : err instanceof Error ? err.message : "Whop request failed")
  }
}

// The company (biz_) id, from the product the checkout uses. Cached per
// server process; it never changes.
let accountIdCache: string | null = null
export async function whopAccountId(): Promise<string> {
  if (accountIdCache) return accountIdCache
  const product = await guarded(() => getWhopClient().products.retrieve({ id: "pro-fa-b247" }))
  const id = (product as { account?: { id?: string } }).account?.id
  if (!id) throw new Error("Couldn't determine the Whop company id from the Pro product.")
  accountIdCache = id
  return id
}

// A result that is either data or the reason it couldn't be loaded, so a page
// can render the rest and show the reason in the one panel it affects.
export type Loaded<T> = { ok: true; data: T } | { ok: false; error: string; missingScope: string | null }

export async function load<T>(fn: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), missingScope: err instanceof WhopScopeError ? err.scope : null }
  }
}

// --- Reads --------------------------------------------------------------------

export type WhopPayment = {
  id: string
  createdAt: string
  paidAt: string | null
  status: string | null
  substatus: string
  amount: number | null
  amountAfterFees: number
  currency: string
  refundedAmount: number | null
  refundable: boolean
  retryable: boolean
  failureMessage: string | null
  declineCode: string | null
  nextAttempt: string | null
  attemptsFailed: number | null
  email: string | null
  membershipId: string | null
  planTitle: string | null
  billingReason: string | null
  promoCode: string | null
}

export const PAYMENT_STATUSES = ["paid", "open", "pending", "uncollectible", "unresolved", "void"] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export async function listPayments(opts: { status?: PaymentStatus; limit?: number; membershipId?: string } = {}): Promise<WhopPayment[]> {
  const accountId = await whopAccountId()
  const page = await guarded(() =>
    getWhopClient().payments.list({
      account_id: accountId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.membershipId ? { membership_id: opts.membershipId } : {}),
      first: opts.limit ?? 50,
      order: "created_at",
      direction: "desc",
    })
  )
  return (page as { data: Record<string, any>[] }).data.map((p) => ({
    id: p.id,
    createdAt: p.created_at,
    paidAt: p.paid_at ?? null,
    status: p.status ?? null,
    substatus: p.substatus,
    amount: p.subtotal ?? p.total ?? null,
    amountAfterFees: p.amount_after_fees,
    currency: p.currency,
    refundedAmount: p.refunded_amount ?? null,
    refundable: !!p.refundable,
    retryable: !!p.retryable,
    failureMessage: p.failure_message ?? null,
    declineCode: p.decline_code ?? null,
    nextAttempt: p.next_payment_attempt ?? null,
    attemptsFailed: p.payments_failed ?? null,
    email: p.member?.email ?? p.member?.user?.email ?? p.user?.email ?? null,
    membershipId: p.membership?.id ?? null,
    planTitle: p.plan?.title ?? p.product?.title ?? null,
    billingReason: p.billing_reason ?? null,
    promoCode: p.promo_code?.code ?? null,
  }))
}

export type WhopPromoCode = {
  id: string
  code: string | null
  promoType: string
  amountOff: number
  currency: string
  durationMonths: number | null
  status: string
  uses: number
  stock: number
  unlimitedStock: boolean
  newUsersOnly: boolean
  expiresAt: string | null
  createdAt: string
}

export async function listPromoCodes(): Promise<WhopPromoCode[]> {
  const accountId = await whopAccountId()
  const page = await guarded(() => getWhopClient().promoCodes.list({ account_id: accountId, first: 100 }))
  return (page as { data: Record<string, any>[] }).data.map((c) => ({
    id: c.id,
    code: c.code ?? null,
    promoType: c.promo_type,
    amountOff: c.amount_off,
    currency: c.currency,
    durationMonths: c.promo_duration_months ?? null,
    status: c.status,
    uses: c.uses,
    stock: c.stock,
    unlimitedStock: !!c.unlimited_stock,
    newUsersOnly: !!c.new_users_only,
    expiresAt: c.expires_at ?? null,
    createdAt: c.created_at,
  }))
}

export type WhopAffiliate = {
  id: string
  name: string | null
  email: string | null
  status: string | null
  referrals: number
  activeMembers: number
  revenueUsd: number
  earningsUsd: number
  mrrUsd: number
  createdAt: string
}

export async function listAffiliates(): Promise<WhopAffiliate[]> {
  const accountId = await whopAccountId()
  const page = await guarded(() => getWhopClient().affiliates.list({ account_id: accountId, first: 100 }))
  return (page as { data: Record<string, any>[] }).data.map((a) => ({
    id: a.id,
    name: a.user?.name ?? a.user?.username ?? null,
    email: a.user?.email ?? null,
    status: a.status ?? null,
    referrals: a.total_referrals_count ?? 0,
    activeMembers: a.active_members_count ?? 0,
    revenueUsd: Number(a.total_revenue_usd ?? 0),
    earningsUsd: Number(a.total_referral_earnings_usd ?? 0),
    mrrUsd: Number(a.monthly_recurring_revenue_usd ?? 0),
    createdAt: a.created_at,
  }))
}

export type WhopMembership = {
  id: string
  status: string
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string | null
  planId: string
}

export async function getMembership(id: string): Promise<WhopMembership> {
  const m = await guarded(() => getWhopClient().memberships.retrieve({ id }))
  return {
    id: m.id,
    status: m.status,
    cancelAtPeriodEnd: !!m.cancel_at_period_end,
    currentPeriodEnd: m.current_period_end ?? null,
    planId: m.plan_id,
  }
}

// --- Writes --------------------------------------------------------------------

export async function refundPayment(paymentId: string, partialAmount: number | null) {
  return guarded(() => getWhopClient().payments.refund({ id: paymentId, ...(partialAmount != null ? { partial_amount: partialAmount } : {}) }))
}

export async function retryPayment(paymentId: string) {
  return guarded(() => getWhopClient().payments.retry({ id: paymentId }))
}

export async function pauseMembership(membershipId: string, untilIso: string | null) {
  return guarded(() => getWhopClient().memberships.pause({ id: membershipId, ...(untilIso ? { until: untilIso } : {}) }))
}

export async function resumeMembership(membershipId: string) {
  return guarded(() => getWhopClient().memberships.resume({ id: membershipId }))
}

export async function cancelMembership(membershipId: string, atPeriodEnd: boolean, reason: string) {
  return guarded(() => getWhopClient().memberships.cancel({ id: membershipId, cancel_at_period_end: atPeriodEnd, ...(reason ? { reason } : {}) }))
}

export async function extendMembership(membershipId: string, days: number) {
  return guarded(() => getWhopClient().memberships.extend({ id: membershipId, days }))
}

export async function createPromoCode(input: {
  code: string
  promoType: "percentage" | "flat_amount"
  amountOff: number
  durationMonths: number
  newUsersOnly: boolean
  onePerCustomer: boolean
  stock: number | null
  expiresAt: string | null
}) {
  const accountId = await whopAccountId()
  return guarded(() =>
    getWhopClient().promoCodes.create({
      account_id: accountId,
      code: input.code,
      promo_type: input.promoType,
      amount_off: input.amountOff,
      base_currency: "usd",
      promo_duration_months: input.durationMonths,
      new_users_only: input.newUsersOnly,
      one_per_customer: input.onePerCustomer,
      stock: input.stock,
      expires_at: input.expiresAt,
    } as never)
  )
}

export async function deletePromoCode(id: string) {
  return guarded(() => getWhopClient().promoCodes.delete({ id }))
}
