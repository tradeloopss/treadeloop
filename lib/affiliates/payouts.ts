import { createHmac } from "node:crypto"
import { and, desc, eq, gte, inArray, lt, ne, notInArray, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliateCommissions, affiliateFraudSignals, affiliatePayoutEvents, affiliatePayoutMethods, affiliatePayoutTransactions, affiliatePayouts, affiliates } from "@/lib/db/schema"
import { decrypt, encrypt } from "@/lib/crypto"
import { ledgerBalances, round2, settleFifo } from "./engine"
import { availableRows } from "./commissions"
import { recordSignal } from "./fraud"
import { validateMethod } from "./method-validation"
import { notifyAffiliate } from "./notify"
import {
  PAYOUT_IN_FLIGHT,
  affiliateCanCancel,
  decideAutoPayout,
  effectiveLimits,
  manualPayoutProblem,
  methodHoldUntil,
  payoutLedgerStatus,
  payoutTransitionAllowed,
  periodKey,
  quoteFee,
  type AffiliateState,
  type AutoSkip,
  type PayoutSettings,
  type PayoutStatus,
  type WindowTotals,
} from "./payout-engine"
import { getPayoutSettings, getProgram } from "./program"
import { cryptoProvider, isCryptoMethod, methodAvailable, providerFor } from "./providers"
import { TRON_NETWORK, USDT_ASSET, isTxHash, maskAddress, maskTxHash } from "./tron"
import { money, methodLabel, type PayoutMethodType } from "./types"

// Payouts. Money leaves the ledger as a negative "payout" row written in the
// same transaction as the payout itself — that row IS the reservation: it
// counts against the available balance while the payout is in flight, and
// stops counting if the payout fails, is cancelled or rejected. No balance
// number is ever edited. Every state change goes through transition(), which
// holds a row lock, checks the status machine, keeps the ledger row in step
// and writes the audit trail.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Exec = typeof db | Tx
type Payout = typeof affiliatePayouts.$inferSelect
type Method = typeof affiliatePayoutMethods.$inferSelect

export type Actor = { type: "affiliate" | "admin" | "system"; id: string | null }
export const SYSTEM: Actor = { type: "system", id: null }

const MAX_ACTIVE_METHODS = 5
const MAX_METHODS_ADDED_PER_DAY = 5
// A submitted transaction the network still doesn't know after this long is
// handed back to a person.
const NOT_FOUND_AFTER_MS = 24 * 3_600_000

// --- Audit trail ---------------------------------------------------------------

async function logEvent(exec: Exec, e: { affiliateId: number; payoutId?: number | null; methodId?: number | null; actor: Actor; action: string; previous?: Record<string, unknown> | null; next?: Record<string, unknown> | null; reason?: string | null }) {
  await exec.insert(affiliatePayoutEvents).values({
    affiliateId: e.affiliateId,
    payoutId: e.payoutId ?? null,
    methodId: e.methodId ?? null,
    actorType: e.actor.type,
    actorId: e.actor.id,
    action: e.action,
    previous: e.previous ?? null,
    next: e.next ?? null,
    reason: e.reason?.trim().slice(0, 400) || null,
  })
}

// --- Payout methods --------------------------------------------------------------
// Account details are encrypted at rest (AES-256-GCM, lib/crypto) and only
// decrypted for an admin who is about to send a payout, or for the chain
// check. Everything else works from the masked label.

// Recognises the same destination being added again without storing it in the
// clear: an HMAC keyed by a server secret.
function fingerprint(identity: string): string {
  const secret = process.env.BETTER_AUTH_SECRET || process.env.BROKER_CREDENTIALS_KEY
  if (!secret) throw new Error("A server secret (BETTER_AUTH_SECRET) is required to add payout methods.")
  return createHmac("sha256", secret).update(`payout-method:${identity}`).digest("hex")
}

const LIVE_METHOD = ["active", "pending_verification", "verification_required", "disabled"]

async function pickNewDefault(exec: Exec, affiliateId: number) {
  const [next] = await exec
    .select({ id: affiliatePayoutMethods.id })
    .from(affiliatePayoutMethods)
    .where(and(eq(affiliatePayoutMethods.affiliateId, affiliateId), eq(affiliatePayoutMethods.status, "active")))
    .orderBy(affiliatePayoutMethods.id)
    .limit(1)
  if (next) await exec.update(affiliatePayoutMethods).set({ isDefault: true, updatedAt: new Date() }).where(eq(affiliatePayoutMethods.id, next.id))
}

export async function addPayoutMethod(affiliateId: number, type: string, raw: unknown, actor: Actor): Promise<{ id: number; holdUntil: Date | null }> {
  const settings = await getPayoutSettings()
  if (!settings.methods.includes(type as PayoutMethodType) || !methodAvailable(type)) throw new Error("That payout method isn't available.")
  if (type === "stripe") throw new Error("Stripe accounts are connected through Stripe's own onboarding.")
  const check = validateMethod(type, raw)
  if (!check.ok) throw new Error(check.error)
  const m = check.method
  if (isCryptoMethod(type)) {
    const problem = cryptoProvider().validateAddress(m.details.address)
    if (problem) throw new Error(problem)
  }
  const print = fingerprint(m.identity)
  const now = new Date()

  const created = await db.transaction(async (tx) => {
    const [aff] = await tx.select({ id: affiliates.id }).from(affiliates).where(eq(affiliates.id, affiliateId)).for("update")
    if (!aff) throw new Error("Affiliate account not found.")
    const existing = await tx.select().from(affiliatePayoutMethods).where(eq(affiliatePayoutMethods.affiliateId, affiliateId))
    if (existing.some((e) => e.fingerprint === print && LIVE_METHOD.includes(e.status))) throw new Error("You've already added this payout method.")
    if (existing.filter((e) => LIVE_METHOD.includes(e.status)).length >= MAX_ACTIVE_METHODS) throw new Error(`You can keep up to ${MAX_ACTIVE_METHODS} payout methods. Remove one first.`)
    if (existing.filter((e) => e.createdAt.getTime() > now.getTime() - 86_400_000).length >= MAX_METHODS_ADDED_PER_DAY) throw new Error("You've added several payout methods today. For your security, try again tomorrow.")

    // The wallet-change hold: the first method ever is usable at once; one
    // added to an account that already had a method waits.
    const holdUntil = methodHoldUntil({ hadMethodBefore: existing.length > 0, holdHours: settings.methodHoldHours, now })
    const [row] = await tx
      .insert(affiliatePayoutMethods)
      .values({ affiliateId, type, label: m.label, nickname: m.nickname, details: encrypt(JSON.stringify(m.details)), metadata: m.metadata, fingerprint: print, isDefault: !existing.some((e) => e.isDefault && e.status === "active"), status: "active", holdUntil, verifiedAt: now })
      .returning({ id: affiliatePayoutMethods.id })
    await logEvent(tx, { affiliateId, methodId: row.id, actor, action: existing.length > 0 ? "method.changed" : "method.added", previous: existing.length ? { methods: existing.filter((e) => LIVE_METHOD.includes(e.status)).map((e) => `${e.type}:${e.label}`) } : null, next: { type, label: m.label, holdUntil: holdUntil?.toISOString() ?? null } })
    return { id: row.id, holdUntil, changed: existing.length > 0 }
  })

  // The same destination on another affiliate's account is worth a look — one
  // person running several accounts. Recorded for review; nothing is blocked.
  const [shared] = await db
    .select({ affiliateId: affiliatePayoutMethods.affiliateId })
    .from(affiliatePayoutMethods)
    .where(and(eq(affiliatePayoutMethods.fingerprint, print), ne(affiliatePayoutMethods.affiliateId, affiliateId)))
    .limit(1)
  if (shared) await recordSignal(affiliateId, { type: "shared_payout_method", risk: "medium", details: { method: methodLabel(type), otherAffiliateId: shared.affiliateId } }, { key: `m${created.id}` })

  const what = `${methodLabel(type)} (${m.label})`
  const hold = created.holdUntil ? `\n\nFor your security, payouts to it start after ${created.holdUntil.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC.` : ""
  // Always emailed, whatever the notification preferences: it's a security notice.
  await notifyAffiliate({
    affiliateId,
    type: "payout_method",
    title: created.changed ? "Your TradeLoop payout method was changed" : "Payout method added",
    body: `${created.changed ? "A new payout method was added to your affiliate account" : "Your first payout method was added"}.\n\nMethod: ${what}${hold}\n\nIf you did not make this change, contact TradeLoop support immediately.`,
    href: "/affiliate/payouts",
    email: true,
  })
  return { id: created.id, holdUntil: created.holdUntil }
}

async function ownMethod(exec: Exec, affiliateId: number, methodId: number): Promise<Method> {
  const [m] = await exec.select().from(affiliatePayoutMethods).where(and(eq(affiliatePayoutMethods.id, methodId), eq(affiliatePayoutMethods.affiliateId, affiliateId), ne(affiliatePayoutMethods.status, "removed")))
  if (!m) throw new Error("That payout method no longer exists.")
  return m
}

// The affiliate's own name for a method. The destination itself is never
// edited in place — a different account is a new method, with the hold.
export async function renameMethod(affiliateId: number, methodId: number, nickname: string, actor: Actor): Promise<void> {
  const m = await ownMethod(db, affiliateId, methodId)
  const next = nickname.trim().slice(0, 40) || null
  await db.update(affiliatePayoutMethods).set({ nickname: next, updatedAt: new Date() }).where(eq(affiliatePayoutMethods.id, m.id))
  await logEvent(db, { affiliateId, methodId: m.id, actor, action: "method.renamed", previous: { nickname: m.nickname }, next: { nickname: next } })
}

export async function setDefaultMethod(affiliateId: number, methodId: number, actor: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const m = await ownMethod(tx, affiliateId, methodId)
    if (m.status !== "active") throw new Error("Only an active payout method can be the default.")
    await tx.update(affiliatePayoutMethods).set({ isDefault: false }).where(eq(affiliatePayoutMethods.affiliateId, affiliateId))
    await tx.update(affiliatePayoutMethods).set({ isDefault: true, updatedAt: new Date() }).where(eq(affiliatePayoutMethods.id, m.id))
    await logEvent(tx, { affiliateId, methodId: m.id, actor, action: "method.default", next: { type: m.type, label: m.label } })
  })
}

// Disabled: kept on file, not paid to. Re-enabling doesn't restart the hold —
// the destination hasn't changed.
export async function setMethodEnabled(affiliateId: number, methodId: number, enabled: boolean, actor: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const m = await ownMethod(tx, affiliateId, methodId)
    if (enabled ? m.status !== "disabled" : m.status !== "active") throw new Error(enabled ? "That payout method can't be enabled." : "That payout method can't be disabled.")
    await tx.update(affiliatePayoutMethods).set({ status: enabled ? "active" : "disabled", isDefault: enabled ? m.isDefault : false, updatedAt: new Date() }).where(eq(affiliatePayoutMethods.id, m.id))
    await logEvent(tx, { affiliateId, methodId: m.id, actor, action: enabled ? "method.enabled" : "method.disabled", previous: { status: m.status }, next: { status: enabled ? "active" : "disabled" } })
    const [hasDefault] = await tx.select({ id: affiliatePayoutMethods.id }).from(affiliatePayoutMethods).where(and(eq(affiliatePayoutMethods.affiliateId, affiliateId), eq(affiliatePayoutMethods.isDefault, true), eq(affiliatePayoutMethods.status, "active")))
    if (!hasDefault) await pickNewDefault(tx, affiliateId)
  })
}

// Soft-removed: payouts already made keep pointing at what they were sent to.
export async function removePayoutMethod(affiliateId: number, methodId: number, actor: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const m = await ownMethod(tx, affiliateId, methodId)
    const [busy] = await tx.select({ id: affiliatePayouts.id }).from(affiliatePayouts).where(and(eq(affiliatePayouts.methodId, m.id), inArray(affiliatePayouts.status, PAYOUT_IN_FLIGHT)))
    if (busy) throw new Error("A payout to this method is in progress. You can remove it once that payout is complete.")
    await tx.update(affiliatePayoutMethods).set({ status: "removed", isDefault: false, updatedAt: new Date() }).where(eq(affiliatePayoutMethods.id, m.id))
    await logEvent(tx, { affiliateId, methodId: m.id, actor, action: "method.removed", previous: { type: m.type, label: m.label, status: m.status } })
    if (m.isDefault) await pickNewDefault(tx, affiliateId)
  })
}

// Admin: reject a method, ask for it to be verified again, or restore it.
export async function adminSetMethodStatus(methodId: number, status: "active" | "rejected" | "verification_required", actor: Actor, reason: string): Promise<{ affiliateId: number }> {
  const [m] = await db.select().from(affiliatePayoutMethods).where(eq(affiliatePayoutMethods.id, methodId))
  if (!m || m.status === "removed") throw new Error("That payout method no longer exists.")
  await db.transaction(async (tx) => {
    await tx.update(affiliatePayoutMethods).set({ status, isDefault: status === "active" ? m.isDefault : false, updatedAt: new Date() }).where(eq(affiliatePayoutMethods.id, m.id))
    await logEvent(tx, { affiliateId: m.affiliateId, methodId: m.id, actor, action: `method.${status}`, previous: { status: m.status }, next: { status }, reason })
    if (status !== "active" && m.isDefault) await pickNewDefault(tx, m.affiliateId)
  })
  if (status !== "active") {
    await notifyAffiliate({ affiliateId: m.affiliateId, type: "payout_method", title: status === "rejected" ? "A payout method was rejected" : "A payout method needs verifying", body: `${methodLabel(m.type)} (${m.label})${reason ? `\n\n${reason.trim().slice(0, 300)}` : ""}\n\nIt can't be used for payouts until this is resolved. Contact affiliate support if you have questions.`, href: "/affiliate/payouts", email: true })
  }
  return { affiliateId: m.affiliateId }
}

function readDetails(m: Pick<Method, "details">): Record<string, string> | null {
  try {
    return JSON.parse(decrypt(m.details)) as Record<string, string>
  } catch {
    return null
  }
}

// Where a payout goes, decrypted. Admin only: the caller checks the permission
// and records the look in the audit log.
export async function revealPayoutDestination(payoutId: number): Promise<{ type: string; details: Record<string, string>; metadata: Record<string, string>; amount: number; net: number; asset: string | null } | null> {
  const [p] = await db.select().from(affiliatePayouts).where(eq(affiliatePayouts.id, payoutId))
  if (!p?.methodId) return null
  const [m] = await db.select().from(affiliatePayoutMethods).where(eq(affiliatePayoutMethods.id, p.methodId))
  const details = m ? readDetails(m) : null
  if (!m || !details) return null
  return { type: m.type, details, metadata: m.metadata ?? {}, amount: Number(p.amount), net: Number(p.netAmount ?? p.amount), asset: p.asset }
}

// --- Creating a payout ---------------------------------------------------------

const DEAD: PayoutStatus[] = ["failed", "cancelled", "rejected", "reversed"]

// What the program has paid out (or reserved) so far today / this week / this
// month, UTC — for the program-wide limits.
async function windowTotals(exec: Exec, now: Date): Promise<WindowTotals> {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const week = new Date(day.getTime() - ((now.getUTCDay() || 7) - 1) * 86_400_000)
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const start = week < month ? week : month
  const sum = (from: Date) => sql<string>`coalesce(sum(${affiliatePayouts.amount}) filter (where ${affiliatePayouts.requestedAt} >= ${from}), 0)`
  const [row] = await exec
    .select({ day: sum(day), week: sum(week), month: sum(month) })
    .from(affiliatePayouts)
    .where(and(gte(affiliatePayouts.requestedAt, start), notInArray(affiliatePayouts.status, DEAD)))
  return { day: Number(row?.day ?? 0), week: Number(row?.week ?? 0), month: Number(row?.month ?? 0) }
}

const stateOf = (a: typeof affiliates.$inferSelect): AffiliateState => ({ status: a.status, payoutHold: a.payoutHold, fraudLock: a.fraudLock, manualPayoutAllowed: a.manualPayoutAllowed, autoPayout: a.autoPayout, autoPayoutAllowed: a.autoPayoutAllowed })
const num = (v: string | null) => (v == null ? null : Number(v))

// Everything the payout rules need to know about one affiliate, read through
// `exec` — the locked transaction when a payout is being created, the plain
// connection when a page only wants to show what WOULD happen.
async function payoutContext(exec: Exec, aff: typeof affiliates.$inferSelect, methodId: number | null, settings: PayoutSettings, programMin: number, now: Date) {
  const [method] = await exec
    .select()
    .from(affiliatePayoutMethods)
    .where(and(eq(affiliatePayoutMethods.affiliateId, aff.id), ne(affiliatePayoutMethods.status, "removed"), methodId != null ? eq(affiliatePayoutMethods.id, methodId) : eq(affiliatePayoutMethods.isDefault, true)))
  const entries = await exec.select({ type: affiliateCommissions.type, status: affiliateCommissions.status, amount: affiliateCommissions.amount }).from(affiliateCommissions).where(eq(affiliateCommissions.affiliateId, aff.id))
  const [inFlight] = await exec.select({ id: affiliatePayouts.id }).from(affiliatePayouts).where(and(eq(affiliatePayouts.affiliateId, aff.id), inArray(affiliatePayouts.status, PAYOUT_IN_FLIGHT)))
  const [risk] = await exec
    .select({ n: sql<number>`count(*)::int` })
    .from(affiliateFraudSignals)
    .where(and(eq(affiliateFraudSignals.affiliateId, aff.id), eq(affiliateFraudSignals.risk, "high"), inArray(affiliateFraudSignals.status, ["open", "reviewing"])))
  const [thisPeriod] = await exec.select({ id: affiliatePayouts.id }).from(affiliatePayouts).where(eq(affiliatePayouts.idempotencyKey, `auto:${aff.id}:${periodKey(settings.frequency, now)}`))
  return {
    method: (method as Method | undefined) ?? null,
    methodState: method ? { status: method.status, holdUntil: method.holdUntil } : null,
    available: ledgerBalances(entries.map((e) => ({ type: e.type, status: e.status, amount: Number(e.amount) }))).available,
    hasPayoutInFlight: !!inFlight,
    openHighRiskSignals: risk?.n ?? 0,
    paidThisPeriod: !!thisPeriod,
    totals: await windowTotals(exec, now),
    limits: effectiveLimits({ programMin, settings, minOverride: num(aff.minPayoutOverride), maxOverride: num(aff.maxPayoutOverride) }),
  }
}

// What the automatic payout worker would do for this affiliate right now, and
// why — for the affiliate's own page and the admin's. Reads only.
export async function autoPayoutPreview(affiliateId: number, now = new Date()) {
  const [[aff], settings, program] = await Promise.all([db.select().from(affiliates).where(eq(affiliates.id, affiliateId)), getPayoutSettings(), getProgram()])
  if (!aff) return null
  const ctx = await payoutContext(db, aff, null, settings, program.minPayout, now)
  const decision = decideAutoPayout({ settings, affiliate: stateOf(aff), available: ctx.available, limits: ctx.limits, threshold: num(aff.autoPayoutThreshold), method: ctx.methodState, hasPayoutInFlight: ctx.hasPayoutInFlight, paidThisPeriod: ctx.paidThisPeriod, openHighRiskSignals: ctx.openHighRiskSignals, totals: ctx.totals, now })
  return { decision, settings, limits: ctx.limits, available: ctx.available, threshold: Math.max(ctx.limits.min, num(aff.autoPayoutThreshold) ?? ctx.limits.min), method: ctx.method ? { id: ctx.method.id, type: ctx.method.type, label: ctx.method.label, holdUntil: ctx.method.holdUntil } : null, paidThisPeriod: ctx.paidThisPeriod }
}

export type CreateResult = { created: true; id: number; status: PayoutStatus; amount: number } | { created: false; id: number } | { created: false; skipped: AutoSkip; message: string }

type CreateInput =
  | { mode: "manual"; affiliateId: number; amount: number; methodId: number; idempotencyKey: string; actor: Actor; now?: Date }
  | { mode: "automatic"; affiliateId: number; settings?: PayoutSettings; now?: Date }

// The one place a payout is created — a request from an affiliate and the
// automatic worker both come through here. Everything is decided INSIDE the
// transaction, under a program-wide advisory lock plus a lock on the
// affiliate: the settings (pause, automatic on/off), the affiliate's own
// switches, the balance from the ledger, the method and its hold, the limits.
// So a worker that runs twice, or two requests at once, cannot pay the same
// balance twice — and a switch flipped a moment ago is honoured.
export async function createPayout(input: CreateInput): Promise<CreateResult> {
  const now = input.now ?? new Date()
  const program = await getProgram()

  const result = await db.transaction(async (tx): Promise<CreateResult & { notify?: { title: string; body: string } }> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('affiliate_payouts'))`)
    const [aff] = await tx.select().from(affiliates).where(eq(affiliates.id, input.affiliateId)).for("update")
    if (!aff) throw new Error("Affiliate account not found.")
    // Read after the locks are held, so this is the setting as it is NOW.
    const settings = await getPayoutSettings()
    const key = input.mode === "manual" ? `req:${aff.id}:${input.idempotencyKey}` : `auto:${aff.id}:${periodKey(settings.frequency, now)}`

    const [dupe] = await tx.select({ id: affiliatePayouts.id }).from(affiliatePayouts).where(eq(affiliatePayouts.idempotencyKey, key))
    if (dupe) return input.mode === "manual" ? { created: false, id: dupe.id } : { created: false, skipped: "already_paid_this_period", message: "This period's automatic payout was already created." }

    const ctx = await payoutContext(tx, aff, input.mode === "manual" ? input.methodId : null, settings, program.minPayout, now)
    let amount: number
    if (input.mode === "manual") {
      // Not rounded: an amount with a fraction of a cent is refused, never adjusted.
      amount = Number(input.amount)
      const problem = manualPayoutProblem({ amount, available: ctx.available, limits: ctx.limits, settings, affiliate: stateOf(aff), method: ctx.methodState, hasPayoutInFlight: ctx.hasPayoutInFlight, totals: ctx.totals, now })
      if (problem) throw new Error(problem)
    } else {
      const decision = decideAutoPayout({ settings, affiliate: stateOf(aff), available: ctx.available, limits: ctx.limits, threshold: num(aff.autoPayoutThreshold), method: ctx.methodState, hasPayoutInFlight: ctx.hasPayoutInFlight, paidThisPeriod: ctx.paidThisPeriod, openHighRiskSignals: ctx.openHighRiskSignals, totals: ctx.totals, now })
      if (!decision.ok) return { created: false, skipped: decision.code, message: decision.message }
      amount = decision.amount
    }
    const method = ctx.method
    if (!method) throw new Error("Add a payout method first.")

    const quote = quoteFee(amount, method.type, settings)
    const provider = providerFor(method.type)
    const crypto = isCryptoMethod(method.type)
    const status: PayoutStatus = settings.approval === "automatic" ? "queued" : "pending"
    const [payout] = await tx
      .insert(affiliatePayouts)
      .values({
        affiliateId: aff.id,
        amount: String(amount),
        fee: String(quote.fee),
        netAmount: String(quote.net),
        currency: aff.payoutCurrency,
        methodId: method.id,
        methodType: method.type,
        methodLabel: method.label,
        provider: provider.name,
        network: crypto ? TRON_NETWORK : null,
        asset: crypto ? USDT_ASSET : null,
        status,
        mode: input.mode,
        idempotencyKey: key,
        requestedAt: now,
        approvedAt: status === "queued" ? now : null,
      })
      .returning({ id: affiliatePayouts.id })
    // The reservation.
    await tx.insert(affiliateCommissions).values({ affiliateId: aff.id, type: "payout", amount: String(-amount), currency: aff.payoutCurrency, status: payoutLedgerStatus(status), idempotencyKey: `payout:${payout.id}`, payoutId: payout.id, note: `Payout to ${methodLabel(method.type)}` })
    await logEvent(tx, { affiliateId: aff.id, payoutId: payout.id, methodId: method.id, actor: input.mode === "manual" ? input.actor : SYSTEM, action: input.mode === "manual" ? "payout.requested" : "payout.auto_created", next: { amount, fee: quote.fee, net: quote.net, method: `${method.type}:${method.label}`, status } })

    const feeLine = quote.fee > 0 ? ` A ${quote.estimated ? "estimated " : ""}fee of ${money(quote.fee)} applies, so you'll receive ${money(quote.net)}.` : ""
    return {
      created: true,
      id: payout.id,
      status,
      amount,
      notify: {
        title: input.mode === "manual" ? "Payout requested" : "Automatic payout created",
        body: `${input.mode === "manual" ? "Your payout" : "An automatic payout"} of ${money(amount)} to ${methodLabel(method.type)} (${method.label}) ${status === "pending" ? "is waiting for approval" : "is queued to be sent"}.${feeLine}`,
      },
    }
  })

  if (result.created) {
    if (result.notify) await notifyAffiliate({ affiliateId: input.affiliateId, type: "payout", title: result.notify.title, body: result.notify.body, href: "/affiliate/payouts", pref: "payout", email: true })
    if (result.status === "queued") await executePayout(result.id).catch((e) => console.error("[affiliates] payout execution failed:", e instanceof Error ? e.message : e))
    return { created: true, id: result.id, status: result.status, amount: result.amount }
  }
  return result
}

export type PayoutRequest = { affiliateId: number; amount: number; methodId: number; idempotencyKey: string; actor?: Actor }

// A payout an affiliate asks for. The same idempotency key (one per opening of
// the request dialog) returns the payout it already made.
export async function requestPayout(req: PayoutRequest): Promise<{ id: number; created: boolean }> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(req.idempotencyKey)) throw new Error("That request couldn't be verified. Reload the page and try again.")
  const result = await createPayout({ mode: "manual", affiliateId: req.affiliateId, amount: req.amount, methodId: req.methodId, idempotencyKey: req.idempotencyKey, actor: req.actor ?? { type: "affiliate", id: null } })
  if ("skipped" in result) throw new Error(result.message)
  return { id: result.id, created: result.created }
}

// --- State changes -------------------------------------------------------------

type Move = {
  payoutId: number
  to: PayoutStatus
  actor: Actor
  // Restrict to payouts of this affiliate (their own actions).
  affiliateId?: number
  // Only from these states (on top of the status machine).
  from?: PayoutStatus[]
  reason?: string
  reference?: string
  hash?: string
  note?: string
  action?: string
}

const NOTICES: Partial<Record<PayoutStatus, (p: Payout, reason: string) => [string, string]>> = {
  queued: (p) => ["Payout approved", `Your payout of ${money(p.amount)} was approved and is queued to be sent.`],
  processing: (p) => ["Payout processing", `Your payout of ${money(p.amount)} is being sent.`],
  submitted: (p) => ["Payout submitted", `Your ${p.asset ?? ""} payout of ${money(p.netAmount ?? p.amount)} has been submitted${p.transactionHash ? ` (transaction ${maskTxHash(p.transactionHash)})` : ""} and is waiting for confirmation.`],
  confirming: (p) => ["Payout confirming", `Your ${p.asset ?? ""} payout of ${money(p.netAmount ?? p.amount)} is on the ${p.network ?? "network"} and waiting for final confirmation${p.transactionHash ? ` (transaction ${maskTxHash(p.transactionHash)})` : ""}.`],
  paid: (p) =>
    p.asset
      ? [`Your ${p.asset} payout has been sent`, `Your ${p.asset} payout has been sent.\n\nAmount: ${money(p.netAmount ?? p.amount)}\nNetwork: TRC-20\nTransaction: ${maskTxHash(p.transactionHash)}`]
      : ["Payout completed", `Your payout of ${money(p.netAmount ?? p.amount)} to ${methodLabel(p.methodType)} (${p.methodLabel}) has been sent.`],
  failed: (p, r) => ["Payout failed", `Your payout of ${money(p.amount)} couldn't be sent: ${r} The amount is back in your available balance.`],
  rejected: (p, r) => ["Payout rejected", `Your payout request of ${money(p.amount)} was not approved.${r ? ` ${r}` : ""} The amount is back in your available balance.`],
  cancelled: (p) => ["Payout cancelled", `Your payout of ${money(p.amount)} was cancelled. The amount is back in your available balance.`],
  reversed: (p, r) => ["Payout reversed", `Your payout of ${money(p.amount)} was returned and has been put back in your available balance.${r ? ` ${r}` : ""}`],
  on_hold: (p) => ["Payout on hold", `Your payout of ${money(p.amount)} is on hold while we review it. You don't need to do anything.`],
}

// Every status change. Locks the payout, checks the machine, stamps the times,
// keeps the ledger row (the reservation) in step, and records who did it.
export async function transition(m: Move): Promise<Payout> {
  let before: Payout | undefined
  const after = await db
    .transaction(async (tx) => {
      const [p] = await tx.select().from(affiliatePayouts).where(eq(affiliatePayouts.id, m.payoutId)).for("update")
      if (!p || (m.affiliateId != null && p.affiliateId !== m.affiliateId)) throw new Error("That payout no longer exists.")
      if ((m.from && !m.from.includes(p.status as PayoutStatus)) || !payoutTransitionAllowed(p.status, m.to)) throw new Error(`A payout that is ${p.status.replace("_", " ")} can't be moved to ${m.to.replace("_", " ")}.`)
      before = p
      const now = new Date()
      const reason = m.reason?.trim().slice(0, 300) || null
      const adminId = m.actor.type === "admin" ? m.actor.id : null
      const patch: Partial<typeof affiliatePayouts.$inferInsert> = { status: m.to }
      if (m.reference) patch.providerRef = m.reference.trim().slice(0, 120)
      if (m.hash) patch.transactionHash = m.hash
      if (m.note) patch.note = m.note.trim().slice(0, 300)
      if (m.to === "queued" && !p.approvedAt) Object.assign(patch, { approvedAt: now, approvedBy: adminId })
      if (m.to === "queued") patch.failureReason = null
      if (m.to === "on_hold") Object.assign(patch, { heldFrom: p.status, note: reason ?? p.note })
      if (m.to === "processing") Object.assign(patch, { attempts: p.attempts + 1, processedBy: adminId ?? p.processedBy })
      if ((m.to === "submitted" || m.to === "confirming") && !p.submittedAt) patch.submittedAt = now
      if (m.to === "paid") Object.assign(patch, { completedAt: now, processedAt: now, processedBy: adminId ?? p.processedBy, failureReason: null, submittedAt: p.submittedAt ?? now })
      if (m.to === "retry_required") patch.failureReason = reason
      if (m.to === "failed") Object.assign(patch, { failedAt: now, processedAt: now, failureReason: reason })
      if (m.to === "rejected" || m.to === "cancelled" || m.to === "reversed") Object.assign(patch, { processedAt: now, failureReason: reason ?? p.failureReason })

      const [row] = await tx.update(affiliatePayouts).set(patch).where(eq(affiliatePayouts.id, p.id)).returning()
      await tx
        .update(affiliateCommissions)
        .set({ status: payoutLedgerStatus(m.to), paidAt: m.to === "paid" ? now : null })
        .where(and(eq(affiliateCommissions.payoutId, p.id), eq(affiliateCommissions.type, "payout")))
      if (m.to === "paid") {
        const settle = settleFifo(await availableRows(p.affiliateId, tx), Number(p.amount))
        if (settle.length) await tx.update(affiliateCommissions).set({ status: "paid", paidAt: now, payoutId: p.id }).where(inArray(affiliateCommissions.id, settle))
      }
      // Returned money: the commissions it had settled are available again.
      if (m.to === "reversed") await tx.update(affiliateCommissions).set({ status: "available", paidAt: null, payoutId: null }).where(and(eq(affiliateCommissions.payoutId, p.id), ne(affiliateCommissions.type, "payout"), eq(affiliateCommissions.status, "paid")))
      await logEvent(tx, { affiliateId: p.affiliateId, payoutId: p.id, methodId: p.methodId, actor: m.actor, action: m.action ?? `payout.${m.to}`, previous: { status: p.status }, next: { status: m.to, ...(m.hash ? { transactionHash: m.hash } : {}), ...(m.reference ? { reference: m.reference } : {}) }, reason })
      return row
    })
    .catch((err) => {
      const code = (err as { code?: string; cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code
      if (code === "23505" && m.hash) throw new Error("That transaction is already recorded for another payout.")
      throw err
    })

  const notice = before && before.status !== after.status ? NOTICES[m.to]?.(after, m.reason?.trim() ?? "") : null
  // A failure or a hold is always emailed; the rest follow the preference.
  if (notice) await notifyAffiliate({ affiliateId: after.affiliateId, type: "payout", title: notice[0], body: notice[1], href: "/affiliate/payouts", pref: ["failed", "rejected", "reversed"].includes(m.to) ? undefined : "payout", email: true })
  return after
}

export async function cancelOwnPayout(affiliateId: number, payoutId: number, actorId: string | null): Promise<void> {
  const [p] = await db.select({ status: affiliatePayouts.status }).from(affiliatePayouts).where(and(eq(affiliatePayouts.id, payoutId), eq(affiliatePayouts.affiliateId, affiliateId)))
  if (!p) throw new Error("That payout no longer exists.")
  if (!affiliateCanCancel(p.status)) throw new Error("This payout is already being processed and can't be cancelled.")
  await transition({ payoutId, to: "cancelled", from: ["pending"], affiliateId, actor: { type: "affiliate", id: actorId } })
}

// --- Sending -------------------------------------------------------------------

// Hands a queued payout to its provider. Manual providers do nothing here (a
// person sends it); an automated one moves the money now. The payout is
// claimed (queued → processing, under the row lock) before the provider is
// called, so two workers can't both send it.
export async function executePayout(payoutId: number, actor: Actor = SYSTEM): Promise<Payout | null> {
  const [p] = await db.select().from(affiliatePayouts).where(eq(affiliatePayouts.id, payoutId))
  if (!p || p.status !== "queued") return null
  const provider = providerFor(p.methodType)
  if (!provider.automated) return p
  // The pause is checked right before the money would move.
  if ((await getPayoutSettings()).paused) return p
  const [m] = p.methodId ? await db.select().from(affiliatePayoutMethods).where(eq(affiliatePayoutMethods.id, p.methodId)) : []
  const details = m ? readDetails(m) : null
  if (!m || !details) return transition({ payoutId, to: "failed", from: ["queued"], actor, reason: "The payout method's details couldn't be read." })

  const claimed = await transition({ payoutId, to: "processing", from: ["queued"], actor }).catch(() => null)
  if (!claimed) return null
  // The provider key never changes for a payout: a retry of a request whose
  // answer was lost gets the original result back, not a second transfer.
  const outcome = await provider
    .createPayout({ id: p.id, amount: Number(p.netAmount ?? p.amount), currency: p.currency, methodType: p.methodType, details, idempotencyKey: `tl-payout-${p.id}` })
    .catch((e): { state: "retry"; reason: string } => ({ state: "retry", reason: e instanceof Error ? e.message : "The provider couldn't be reached." }))

  await db.insert(affiliatePayoutTransactions).values({
    payoutId: p.id,
    provider: provider.name,
    providerTransactionId: "reference" in outcome ? outcome.reference : null,
    amount: String(p.netAmount ?? p.amount),
    destination: p.methodLabel,
    status: outcome.state === "paid" ? "confirmed" : outcome.state === "submitted" ? "submitted" : "failed",
    failureReason: "reason" in outcome ? outcome.reason.slice(0, 300) : null,
    submittedAt: new Date(),
    confirmedAt: outcome.state === "paid" ? new Date() : null,
  })
  if (outcome.state === "paid") return transition({ payoutId, to: "paid", from: ["processing"], actor, reference: outcome.reference })
  if (outcome.state === "submitted") return transition({ payoutId, to: "submitted", from: ["processing"], actor, reference: outcome.reference, hash: outcome.hash })
  if (outcome.state === "failed") return transition({ payoutId, to: "failed", from: ["processing"], actor, reason: outcome.reason })
  if (outcome.state === "retry") return transition({ payoutId, to: "retry_required", from: ["processing"], actor, reason: outcome.reason })
  return claimed
}

// --- Crypto: transaction tracking ----------------------------------------------

async function cryptoTarget(p: Payout): Promise<{ address: string; amount: number }> {
  if (!isCryptoMethod(p.methodType) || !p.methodId) throw new Error("That payout isn't a crypto payout.")
  const [m] = await db.select().from(affiliatePayoutMethods).where(eq(affiliatePayoutMethods.id, p.methodId))
  const address = m ? readDetails(m)?.address : null
  if (!address) throw new Error("The wallet address for this payout couldn't be read.")
  return { address, amount: Number(p.netAmount ?? p.amount) }
}

async function recordTx(p: Payout, hash: string, address: string, amount: number, status: string, failureReason: string | null) {
  const now = new Date()
  await db
    .insert(affiliatePayoutTransactions)
    .values({ payoutId: p.id, provider: p.provider, network: TRON_NETWORK, asset: USDT_ASSET, amount: String(amount), destination: maskAddress(address), transactionHash: hash, status, failureReason, submittedAt: now, confirmedAt: status === "confirmed" ? now : null })
    .onConflictDoUpdate({ target: affiliatePayoutTransactions.transactionHash, set: { status, failureReason, confirmedAt: status === "confirmed" ? now : null } })
}

// An admin sent the USDT and gives us the transaction hash. Nothing is taken
// on trust: the chain is asked whether that transaction really is a USDT
// (TRC-20) transfer of at least the payout amount to the payout's wallet.
//   irreversible and matching  → completed
//   on-chain, not yet final    → confirming
//   not known to the network   → submitted (tracked until it appears)
//   failed, or not this payout → refused, nothing recorded
export async function submitCryptoTransaction(payoutId: number, rawHash: string, actor: Actor): Promise<Payout> {
  if (!isTxHash(rawHash)) throw new Error("That isn't a TRON transaction hash (64 hexadecimal characters).")
  const hash = rawHash.trim().toLowerCase()
  const [p] = await db.select().from(affiliatePayouts).where(eq(affiliatePayouts.id, payoutId))
  if (!p) throw new Error("That payout no longer exists.")
  if (!["queued", "processing", "retry_required", "submitted"].includes(p.status)) throw new Error(`A payout that is ${p.status.replace("_", " ")} can't take a transaction.`)
  const target = await cryptoTarget(p)
  const [used] = await db.select({ id: affiliatePayouts.id }).from(affiliatePayouts).where(and(eq(affiliatePayouts.transactionHash, hash), ne(affiliatePayouts.id, p.id)))
  if (used) throw new Error("That transaction is already recorded for another payout.")

  const verdict = await cryptoProvider().getTransaction(hash, target)
  if (verdict.state === "failed" || verdict.state === "mismatch") throw new Error(verdict.reason)

  const to: PayoutStatus = verdict.state === "confirmed" ? "paid" : verdict.state === "confirming" ? "confirming" : "submitted"
  // Re-submitting a corrected hash while still "submitted" is not a status change.
  const after = p.status === "submitted" && to === "submitted" ? await replaceHash(p, hash, actor) : await transition({ payoutId, to, actor, hash, action: "payout.transaction_submitted" })
  // An earlier hash that never reached a verdict was a mistake being corrected;
  // one that failed or was never found keeps that record.
  if (p.transactionHash && p.transactionHash !== hash) await db.update(affiliatePayoutTransactions).set({ status: "replaced" }).where(and(eq(affiliatePayoutTransactions.transactionHash, p.transactionHash), inArray(affiliatePayoutTransactions.status, ["submitted", "confirming"])))
  await recordTx(p, hash, target.address, target.amount, verdict.state === "confirmed" ? "confirmed" : verdict.state === "confirming" ? "confirming" : "submitted", null)
  return after
}

async function replaceHash(p: Payout, hash: string, actor: Actor): Promise<Payout> {
  const [row] = await db.update(affiliatePayouts).set({ transactionHash: hash, submittedAt: new Date(), lastCheckedAt: null }).where(and(eq(affiliatePayouts.id, p.id), eq(affiliatePayouts.status, "submitted"))).returning()
  if (!row) throw new Error("That payout changed while you were working on it. Reload and try again.")
  await logEvent(db, { affiliateId: p.affiliateId, payoutId: p.id, actor, action: "payout.transaction_replaced", previous: { transactionHash: p.transactionHash }, next: { transactionHash: hash } })
  return row
}

// Asks the chain again about a payout that has a transaction but isn't final.
// Returns the payout as it stands afterwards. A network error changes nothing.
export async function trackPayout(payoutId: number, actor: Actor = SYSTEM): Promise<Payout | null> {
  const [p] = await db.select().from(affiliatePayouts).where(eq(affiliatePayouts.id, payoutId))
  if (!p || !p.transactionHash || !["submitted", "confirming"].includes(p.status) || !isCryptoMethod(p.methodType)) return p ?? null
  const target = await cryptoTarget(p)
  const verdict = await cryptoProvider().getTransaction(p.transactionHash, target)
  await db.update(affiliatePayouts).set({ lastCheckedAt: new Date() }).where(eq(affiliatePayouts.id, p.id))

  if (verdict.state === "confirmed") {
    await recordTx(p, p.transactionHash, target.address, target.amount, "confirmed", null)
    return transition({ payoutId, to: "paid", from: ["submitted", "confirming"], actor, action: "payout.confirmed" })
  }
  if (verdict.state === "confirming") {
    await recordTx(p, p.transactionHash, target.address, target.amount, "confirming", null)
    return p.status === "submitted" ? transition({ payoutId, to: "confirming", from: ["submitted"], actor }) : p
  }
  if (verdict.state === "failed" || verdict.state === "mismatch") {
    await recordTx(p, p.transactionHash, target.address, target.amount, "failed", verdict.reason)
    return transition({ payoutId, to: "retry_required", from: ["submitted", "confirming"], actor, reason: verdict.reason })
  }
  // Not found: give the network time, then hand it back to a person. The
  // funds stay reserved either way — nothing is released on a guess.
  if (p.submittedAt && Date.now() - p.submittedAt.getTime() > NOT_FOUND_AFTER_MS) {
    const reason = "The transaction wasn't found on the TRON network after 24 hours. Check the hash, or send the payout again."
    await recordTx(p, p.transactionHash, target.address, target.amount, "not_found", reason)
    return transition({ payoutId, to: "retry_required", from: ["submitted"], actor, reason })
  }
  return p
}

// Follows up every payout with a transaction that isn't final yet. Runs from
// the cron and when an admin or the affiliate opens the payouts page — and
// keeps running while payouts are paused: a pause stops new money, not the
// tracking of money already sent.
// `limit` keeps a page load from waiting on a long queue of lookups; the cron
// takes the default.
export async function trackPayouts(opts: { affiliateId?: number; olderThanSeconds?: number; limit?: number } = {}): Promise<{ checked: number; completed: number }> {
  const stale = new Date(Date.now() - (opts.olderThanSeconds ?? 20) * 1000)
  const rows = await db
    .select({ id: affiliatePayouts.id })
    .from(affiliatePayouts)
    .where(and(inArray(affiliatePayouts.status, ["submitted", "confirming"]), sql`${affiliatePayouts.transactionHash} is not null`, opts.affiliateId != null ? eq(affiliatePayouts.affiliateId, opts.affiliateId) : undefined, sql`(${affiliatePayouts.lastCheckedAt} is null or ${affiliatePayouts.lastCheckedAt} < ${stale})`))
    .orderBy(sql`${affiliatePayouts.lastCheckedAt} asc nulls first`, affiliatePayouts.id)
    .limit(opts.limit ?? 50)
  let completed = 0
  for (const [i, r] of rows.entries()) {
    // Without an API key the public TRON endpoint throttles bursts: pace the lookups.
    if (i > 0 && !process.env.TRONGRID_API_KEY) await new Promise((resolve) => setTimeout(resolve, 600))
    try {
      if ((await trackPayout(r.id))?.status === "paid") completed++
    } catch (e) {
      console.error("[affiliates] payout tracking failed:", r.id, e instanceof Error ? e.message : e)
    }
  }
  return { checked: rows.length, completed }
}

// --- Admin actions -------------------------------------------------------------

export type AdminAction = "approve" | "reject" | "hold" | "release" | "cancel" | "start" | "mark_paid" | "fail" | "retry" | "reverse"

// One entry point for what an admin can do to a payout, so the rules about
// what is allowed when (and while paused) live in one place.
export async function adminPayoutAction(payoutId: number, action: AdminAction, actor: Actor, input: { reason?: string; reference?: string } = {}): Promise<Payout> {
  const [p] = await db.select().from(affiliatePayouts).where(eq(affiliatePayouts.id, payoutId))
  if (!p) throw new Error("That payout no longer exists.")
  const reason = input.reason?.trim() ?? ""
  // While paused, nothing new is sent. Recording what already happened
  // (mark paid, fail, reverse) and stopping things (reject, cancel, hold) stay possible.
  if (["approve", "start", "retry", "release"].includes(action) && (await getPayoutSettings()).paused) throw new Error("All payouts are paused. Lift the pause in Payout settings before sending anything.")

  switch (action) {
    case "approve": {
      const next = await transition({ payoutId, to: "queued", from: ["pending"], actor, action: "payout.approved" })
      return (await executePayout(payoutId, actor)) ?? next
    }
    case "reject":
      if (!reason) throw new Error("Say why the payout is rejected — the affiliate will see it.")
      return transition({ payoutId, to: "rejected", from: ["pending", "on_hold"], actor, reason })
    case "hold":
      return transition({ payoutId, to: "on_hold", from: ["pending", "queued", "retry_required"], actor, reason })
    case "release": {
      const next = await transition({ payoutId, to: p.heldFrom === "pending" || !p.approvedAt ? "pending" : "queued", from: ["on_hold"], actor, action: "payout.released" })
      return next.status === "queued" ? ((await executePayout(payoutId, actor)) ?? next) : next
    }
    case "cancel":
      return transition({ payoutId, to: "cancelled", from: ["pending", "queued", "retry_required", "on_hold"], actor, reason })
    case "start":
      if (providerFor(p.methodType).automated) throw new Error("This payout is sent automatically. Use Retry instead.")
      return transition({ payoutId, to: "processing", from: ["queued"], actor })
    case "mark_paid":
      // A crypto payout completes only through a verified on-chain transaction.
      if (isCryptoMethod(p.methodType)) throw new Error("A crypto payout is completed by submitting its transaction hash.")
      if (providerFor(p.methodType).automated) throw new Error("This payout is confirmed by the provider, not by hand.")
      return transition({ payoutId, to: "paid", from: ["queued", "processing", "retry_required"], actor, reference: input.reference, action: "payout.marked_paid" })
    case "fail":
      if (!reason) throw new Error("Say why the payout failed — the affiliate will see it.")
      return transition({ payoutId, to: "failed", from: ["queued", "processing", "submitted", "confirming", "retry_required"], actor, reason })
    case "retry": {
      if (p.status !== "retry_required" && p.status !== "queued") throw new Error(`A payout that is ${p.status.replace("_", " ")} can't be retried.`)
      const next = p.status === "retry_required" ? await transition({ payoutId, to: "queued", from: ["retry_required"], actor, action: "payout.retried" }) : p
      return (await executePayout(payoutId, actor)) ?? next
    }
    case "reverse":
      if (isCryptoMethod(p.methodType)) throw new Error("An on-chain payout can't be reversed.")
      if (!reason) throw new Error("Say why the payout came back.")
      return transition({ payoutId, to: "reversed", from: ["paid"], actor, reason })
  }
}

// --- Automatic payout switches ---------------------------------------------------

// The affiliate's own switch and threshold.
export async function setAutoPayout(affiliateId: number, input: { enabled: boolean; threshold: number | null }, actor: Actor): Promise<void> {
  const [program, settings] = await Promise.all([getProgram(), getPayoutSettings()])
  await db.transaction(async (tx) => {
    const [aff] = await tx.select().from(affiliates).where(eq(affiliates.id, affiliateId)).for("update")
    if (!aff) throw new Error("Affiliate account not found.")
    if (input.enabled && !aff.autoPayoutAllowed) throw new Error("Automatic payouts are disabled for your account. Contact affiliate support.")
    const limits = effectiveLimits({ programMin: program.minPayout, settings, minOverride: num(aff.minPayoutOverride), maxOverride: num(aff.maxPayoutOverride) })
    let threshold: number | null = null
    if (input.threshold != null) {
      threshold = round2(Number(input.threshold))
      if (!Number.isFinite(threshold) || threshold < limits.min) throw new Error(`The threshold can't be below the minimum payout of $${limits.min.toFixed(2)}.`)
      if (limits.max != null && threshold > limits.max) throw new Error(`The threshold can't be above the maximum payout of $${limits.max.toFixed(2)}.`)
    }
    if (input.enabled) {
      const [method] = await tx.select({ id: affiliatePayoutMethods.id }).from(affiliatePayoutMethods).where(and(eq(affiliatePayoutMethods.affiliateId, affiliateId), eq(affiliatePayoutMethods.isDefault, true), eq(affiliatePayoutMethods.status, "active")))
      if (!method) throw new Error("Add a payout method and make it the default before switching automatic payouts on.")
    }
    await tx.update(affiliates).set({ autoPayout: input.enabled, autoPayoutThreshold: threshold == null ? null : String(threshold), updatedAt: new Date() }).where(eq(affiliates.id, affiliateId))
    await logEvent(tx, { affiliateId, actor, action: input.enabled ? "auto_payout.enabled" : "auto_payout.disabled", previous: { enabled: aff.autoPayout, threshold: num(aff.autoPayoutThreshold) }, next: { enabled: input.enabled, threshold } })
  })
}

// Admin: per-affiliate payout controls. Switching automatic payouts off here
// takes effect on the very next worker run — it re-reads this row under lock.
// It touches nothing else: balance, methods, commissions and the account stay
// exactly as they are.
export async function setAffiliatePayoutControls(affiliateId: number, input: { autoPayoutAllowed?: boolean; manualPayoutAllowed?: boolean; minPayoutOverride?: number | null; maxPayoutOverride?: number | null }, actor: Actor, reason = ""): Promise<{ userId: string; previous: Record<string, unknown>; next: Record<string, unknown> }> {
  const override = (v: number | null | undefined, current: string | null): string | null => {
    if (v === undefined) return current
    if (v === null) return null
    const n = round2(Number(v))
    if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) throw new Error("Enter an amount above 0, or leave it empty to inherit the program's.")
    return String(n)
  }
  const result = await db.transaction(async (tx) => {
    const [aff] = await tx.select().from(affiliates).where(eq(affiliates.id, affiliateId)).for("update")
    if (!aff) throw new Error("That affiliate no longer exists.")
    const next = {
      autoPayoutAllowed: typeof input.autoPayoutAllowed === "boolean" ? input.autoPayoutAllowed : aff.autoPayoutAllowed,
      manualPayoutAllowed: typeof input.manualPayoutAllowed === "boolean" ? input.manualPayoutAllowed : aff.manualPayoutAllowed,
      minPayoutOverride: override(input.minPayoutOverride, aff.minPayoutOverride),
      maxPayoutOverride: override(input.maxPayoutOverride, aff.maxPayoutOverride),
    }
    if (next.minPayoutOverride != null && next.maxPayoutOverride != null && Number(next.maxPayoutOverride) < Number(next.minPayoutOverride)) throw new Error("The maximum can't be below the minimum.")
    const previous = { autoPayoutAllowed: aff.autoPayoutAllowed, manualPayoutAllowed: aff.manualPayoutAllowed, minPayoutOverride: aff.minPayoutOverride, maxPayoutOverride: aff.maxPayoutOverride }
    await tx.update(affiliates).set({ ...next, updatedAt: new Date() }).where(eq(affiliates.id, affiliateId))
    const action = previous.autoPayoutAllowed !== next.autoPayoutAllowed ? (next.autoPayoutAllowed ? "auto_payout.admin_enabled" : "auto_payout.admin_disabled") : "payout_controls.changed"
    await logEvent(tx, { affiliateId, actor, action, previous, next, reason })
    return { userId: aff.userId, previous, next, autoChanged: previous.autoPayoutAllowed !== next.autoPayoutAllowed, autoOn: next.autoPayoutAllowed }
  })
  if (result.autoChanged) {
    await notifyAffiliate({
      affiliateId,
      type: "payout",
      title: result.autoOn ? "Automatic payouts enabled" : "Automatic payouts disabled",
      body: result.autoOn ? "Automatic payouts are available for your affiliate account again." : `Automatic payouts have been switched off for your affiliate account.${reason ? ` ${reason.trim().slice(0, 300)}` : ""} Your balance, payout methods and commissions are unchanged.`,
      href: "/affiliate/payouts",
      email: true,
    })
  }
  return { userId: result.userId, previous: result.previous, next: result.next }
}

// --- Reads used by pages ---------------------------------------------------------

export async function payoutEvents(payoutId: number) {
  return db.select().from(affiliatePayoutEvents).where(eq(affiliatePayoutEvents.payoutId, payoutId)).orderBy(desc(affiliatePayoutEvents.createdAt), desc(affiliatePayoutEvents.id)).limit(100)
}

export async function payoutTransactions(payoutId: number) {
  return db.select().from(affiliatePayoutTransactions).where(eq(affiliatePayoutTransactions.payoutId, payoutId)).orderBy(desc(affiliatePayoutTransactions.id))
}

// Stale "pending verification" Stripe methods and similar are tidied by the
// daily job: a method nobody finished onboarding within a week is removed.
export async function pruneUnfinishedMethods(): Promise<number> {
  const rows = await db
    .update(affiliatePayoutMethods)
    .set({ status: "removed", isDefault: false, updatedAt: new Date() })
    .where(and(eq(affiliatePayoutMethods.status, "pending_verification"), lt(affiliatePayoutMethods.createdAt, new Date(Date.now() - 7 * 86_400_000))))
    .returning({ id: affiliatePayoutMethods.id })
  return rows.length
}

// --- Stripe Connect --------------------------------------------------------------
// Bank details for a Stripe method are collected by Stripe's hosted onboarding
// and never pass through TradeLoop: what is stored here is the account id.

const STRIPE_STATUS = { onboarding: "pending_verification", connected: "active", restricted: "verification_required" } as const

// Creates (or reuses) the affiliate's connected account and returns Stripe's
// onboarding link for it.
export async function startStripeOnboarding(aff: { id: number; email: string; country: string | null }, returnUrl: string, actor: Actor): Promise<string> {
  const settings = await getPayoutSettings()
  if (!settings.methods.includes("stripe") || !methodAvailable("stripe")) throw new Error("Stripe Connect isn't available.")
  const { createConnectedAccount, onboardingLink } = await import("./stripe-connect")
  const existing = await db.select().from(affiliatePayoutMethods).where(and(eq(affiliatePayoutMethods.affiliateId, aff.id), eq(affiliatePayoutMethods.type, "stripe"), ne(affiliatePayoutMethods.status, "removed")))
  let accountId = existing[0] ? readDetails(existing[0])?.accountId : null
  if (!accountId) {
    const account = await createConnectedAccount({ email: aff.email, country: /^[A-Z]{2}$/.test(aff.country ?? "") ? aff.country! : "US", affiliateId: aff.id })
    accountId = account.id
    const all = await db.select({ id: affiliatePayoutMethods.id }).from(affiliatePayoutMethods).where(eq(affiliatePayoutMethods.affiliateId, aff.id))
    const now = new Date()
    const [row] = await db
      .insert(affiliatePayoutMethods)
      .values({ affiliateId: aff.id, type: "stripe", label: `Stripe ···· ${accountId.slice(-4)}`, details: encrypt(JSON.stringify({ accountId })), metadata: { state: "onboarding", currency: "USD" }, fingerprint: fingerprint(`stripe:${accountId}`), status: "pending_verification", holdUntil: methodHoldUntil({ hadMethodBefore: all.length > 0, holdHours: settings.methodHoldHours, now }) })
      .returning({ id: affiliatePayoutMethods.id })
    await logEvent(db, { affiliateId: aff.id, methodId: row.id, actor, action: all.length > 0 ? "method.changed" : "method.added", next: { type: "stripe", state: "onboarding" } })
  }
  return onboardingLink(accountId, returnUrl)
}

// Asks Stripe where each of the affiliate's connected accounts stands and
// mirrors it: Onboarding → pending, Connected → active, Restricted → needs
// verification. Only a connected account can be paid.
export async function syncStripeMethods(affiliateId: number): Promise<void> {
  if (!methodAvailable("stripe")) return
  const { retrieveAccount, stripeAccountState } = await import("./stripe-connect")
  const rows = await db.select().from(affiliatePayoutMethods).where(and(eq(affiliatePayoutMethods.affiliateId, affiliateId), eq(affiliatePayoutMethods.type, "stripe"), inArray(affiliatePayoutMethods.status, ["pending_verification", "verification_required", "active"])))
  for (const m of rows) {
    const accountId = readDetails(m)?.accountId
    if (!accountId) continue
    try {
      const state = stripeAccountState(await retrieveAccount(accountId))
      const status = STRIPE_STATUS[state]
      if (status === m.status && m.metadata?.state === state) continue
      await db.update(affiliatePayoutMethods).set({ status, metadata: { ...(m.metadata ?? {}), state }, verifiedAt: status === "active" ? (m.verifiedAt ?? new Date()) : m.verifiedAt, isDefault: status === "active" ? m.isDefault : false, updatedAt: new Date() }).where(eq(affiliatePayoutMethods.id, m.id))
      await logEvent(db, { affiliateId, methodId: m.id, actor: SYSTEM, action: `method.stripe_${state}`, previous: { status: m.status }, next: { status } })
      const [hasDefault] = await db.select({ id: affiliatePayoutMethods.id }).from(affiliatePayoutMethods).where(and(eq(affiliatePayoutMethods.affiliateId, affiliateId), eq(affiliatePayoutMethods.isDefault, true), eq(affiliatePayoutMethods.status, "active")))
      if (!hasDefault) await pickNewDefault(db, affiliateId)
    } catch (e) {
      console.error("[affiliates] Stripe account sync failed:", e instanceof Error ? e.message : e)
    }
  }
}
