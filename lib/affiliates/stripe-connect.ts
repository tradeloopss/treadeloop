// Stripe Connect, for affiliates paid through a connected Stripe account.
// Only active when STRIPE_CONNECT_SECRET_KEY is set — TradeLoop's own billing
// runs on Whop, so without that key this method is simply not offered.
// Talks to Stripe's REST API directly (no SDK); the secret never leaves the
// server, and bank details are collected by Stripe's hosted onboarding, never
// by TradeLoop.

const API = "https://api.stripe.com/v1"

export const stripeConfigured = () => Boolean(process.env.STRIPE_CONNECT_SECRET_KEY)

export class StripeError extends Error {
  readonly code: string | null
  readonly status: number
  constructor(message: string, code: string | null, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

// Stripe takes application/x-www-form-urlencoded with bracketed nesting.
function encode(params: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue
    const name = prefix ? `${prefix}[${key}]` : key
    if (typeof value === "object") out.push(...encode(value as Record<string, unknown>, name))
    else out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`)
  }
  return out
}

async function stripe<T>(method: "GET" | "POST", path: string, params?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const key = process.env.STRIPE_CONNECT_SECRET_KEY
  if (!key) throw new StripeError("Stripe Connect isn't configured on this deployment.", "not_configured", 0)
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    body: method === "POST" ? encode(params ?? {}).join("&") : undefined,
    signal: AbortSignal.timeout(20_000),
  })
  const body = (await res.json().catch(() => null)) as (T & { error?: { message?: string; code?: string } }) | null
  if (!res.ok || !body) throw new StripeError(body?.error?.message ?? `Stripe request failed (HTTP ${res.status})`, body?.error?.code ?? null, res.status)
  return body
}

export type StripeAccount = {
  id: string
  details_submitted?: boolean
  payouts_enabled?: boolean
  capabilities?: { transfers?: string }
  requirements?: { disabled_reason?: string | null; currently_due?: string[] }
}

export type StripeState = "onboarding" | "connected" | "restricted"

// Not Connected (no account) → Onboarding → Connected, or Restricted when
// Stripe needs something more before it will accept transfers. Only a
// "connected" account can be paid.
export function stripeAccountState(account: StripeAccount): StripeState {
  if (!account.details_submitted) return "onboarding"
  if (account.capabilities?.transfers === "active" && !account.requirements?.disabled_reason) return "connected"
  return "restricted"
}

export async function createConnectedAccount(input: { email: string; country: string; affiliateId: number }): Promise<StripeAccount> {
  return stripe<StripeAccount>(
    "POST",
    "/accounts",
    { type: "express", email: input.email, country: input.country, capabilities: { transfers: { requested: true } }, metadata: { affiliate_id: input.affiliateId } },
    `tl-affiliate-account-${input.affiliateId}`
  )
}

// Stripe's hosted onboarding page for the account. Single-use, short-lived.
export async function onboardingLink(accountId: string, returnUrl: string): Promise<string> {
  const link = await stripe<{ url: string }>("POST", "/account_links", { account: accountId, refresh_url: returnUrl, return_url: returnUrl, type: "account_onboarding" })
  return link.url
}

export const retrieveAccount = (accountId: string) => stripe<StripeAccount>("GET", `/accounts/${encodeURIComponent(accountId)}`)

// Moves `amount` USD from the platform balance to the connected account. The
// idempotency key is the payout's own, so a retry of a request whose answer
// was lost returns the ORIGINAL transfer instead of sending a second one.
export async function createTransfer(input: { amount: number; accountId: string; payoutId: number; idempotencyKey: string }): Promise<{ id: string }> {
  return stripe<{ id: string }>(
    "POST",
    "/transfers",
    { amount: Math.round(input.amount * 100), currency: "usd", destination: input.accountId, transfer_group: `affiliate-payout-${input.payoutId}`, metadata: { payout_id: input.payoutId } },
    input.idempotencyKey
  )
}

export const retrieveTransfer = (id: string) => stripe<{ id: string; reversed?: boolean; amount: number; amount_reversed?: number }>("GET", `/transfers/${encodeURIComponent(id)}`)

// Errors that will fail the same way however often they are retried.
const PERMANENT = new Set(["account_invalid", "account_closed", "transfers_not_allowed", "invalid_request_error", "resource_missing"])
export const stripeFailurePermanent = (err: unknown) => err instanceof StripeError && (PERMANENT.has(err.code ?? "") || (err.status >= 400 && err.status < 500 && err.status !== 409 && err.status !== 429 && err.code !== "balance_insufficient"))
