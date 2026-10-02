import { createHmac } from "node:crypto"
import { and, desc, eq, gte, inArray, lt, ne, notInArray, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliateCommissions, affiliateFraudSignals, affiliatePayoutEvents, affiliatePayoutMethods, affiliatePayoutTransactions, affiliatePayouts, affiliates } from "@/lib/db/schema"
import { decrypt, encrypt } from "@/lib/crypto"
import { ledgerBalances, round2, settleFifo } from "./engine"
import { availableRows } from "./commissions"
import { recordSignal } from "./fraud"
import { validateMethod } from "./method-validation"
import { payoutApproved, payoutDenied, payoutFailed, payoutMethodChanged, payoutRequested, payoutSent, payoutUpdate, type PayoutFacts } from "@/lib/emails/affiliate-emails"
import { explorerTxUrl } from "./crypto"
import { notifyAffiliate, notifyOwners, type Mail } from "./notify"
import {
  EXCHANGE_REQUEST_WINDOW_MS,
  MAX_AUTO_ATTEMPTS,
  PAYOUT_IN_FLIGHT,
  affiliateCanCancel,
  assetAmount,
  autoSendProblem,
  decideAutoPayout,
  effectiveLimits,
  exchangeRequestProvablyDead,
  exchangeSendProblem,
  manualPayoutProblem,
  methodHoldUntil,
  payoutLedgerStatus,
  payoutTransitionAllowed,
  periodKey,
  quoteFee,
  transactionProvablyDead,
  type AffiliateState,
  type AutoSkip,
  type PayoutSettings,
  type PayoutStatus,
  type WindowTotals,
} from "./payout-engine"
import { getPayoutSettings, getProgram } from "./program"
import { cryptoSpec, cryptoSpecByNetwork, formatAsset, type CryptoSpec } from "./crypto"
import { EXCHANGE_NAME, ExchangeRefused, applyWithdrawal, assetPriceUsd, lookupWithdrawal, withdrawalQuota, withdrawalRemark, type Quota, type Withdrawal } from "./kucoin"
import { AUTO_SENDERS, EXCHANGE_PROVIDER, HOT_PROVIDER, autoSenderFor, cryptoProvider, exchangeOnly, isAutoSender, isCryptoMethod, methodAvailable, providerByName, providerFor } from "./providers"
import { judgeTransaction, lookupTransaction, solidHeadBlock } from "./tron-chain"
import { broadcast, quoteSend, signTransfer, type Broadcast } from "./tron-wallet"
import { isTxHash, maskAddress, maskTxHash } from "./tron"
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
  const problem = cryptoSpec(type)?.addressProblem(m.details.address)
  if (problem) throw new Error(problem)
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
  const coin = cryptoSpec(type)
  // Always emailed, whatever the notification preferences: it's a security notice.
  await notifyAffiliate({
    affiliateId,
    type: "payout_method",
    title: created.changed ? "Your TradeLoop payout method was changed" : "Payout method added",
    body: `${created.changed ? "A new payout method was added to your affiliate account" : "Your first payout method was added"}.\n\nMethod: ${what}${hold}\n\nIf you did not make this change, contact TradeLoop support immediately.`,
    href: "/affiliate/payouts",
    email: true,
    mail: {
      key: `${coin ? "wallet_changed" : "payout_method_changed"}:${created.id}:1`,
      build: (to) => payoutMethodChanged({ firstName: to.firstName, method: methodLabel(type), destination: m.label, changed: created.changed, changedAt: now, holdUntil: created.holdUntil, crypto: coin ? { asset: coin.asset, network: coin.networkLabel } : null }),
    },
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
    await notifyAffiliate({ affiliateId: m.affiliateId, type: "payout_method", title: status === "rejected" ? "A payout method was rejected" : "A payout method needs verifying", body: `${methodLabel(m.type)} (${m.label})${reason ? `\n\n${reason.trim().slice(0, 300)}` : ""}\n\nIt can't be used for payouts until this is resolved. Contact affiliate support if you have questions.`, href: "/affiliate/payouts", email: true, sender: "payments" })
  }
  return { affiliateId: m.affiliateId }
}

// Admin: lift the security hold on a payout method. It can be paid to
// straight away, and — an admin having vouched for it — it no longer has to
// wait out the "on file long enough" rule for automatic sending either.
// Recorded in the audit trail, and the affiliate is told.
export async function adminRemoveMethodHold(methodId: number, actor: Actor, reason = ""): Promise<{ affiliateId: number; label: string }> {
  const [m] = await db.select().from(affiliatePayoutMethods).where(eq(affiliatePayoutMethods.id, methodId))
  if (!m || m.status === "removed") throw new Error("That payout method no longer exists.")
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.update(affiliatePayoutMethods).set({ holdUntil: null, holdWaivedAt: now, updatedAt: now }).where(eq(affiliatePayoutMethods.id, m.id))
    await logEvent(tx, { affiliateId: m.affiliateId, methodId: m.id, actor, action: "method.hold_removed", previous: { holdUntil: m.holdUntil?.toISOString() ?? null }, next: { holdUntil: null }, reason })
  })
  await notifyAffiliate({
    affiliateId: m.affiliateId,
    type: "payout_method",
    title: "The security hold on your payout method was lifted",
    body: `${methodLabel(m.type)} (${m.label}) can be paid to now.\n\nIf you did not add this payout method, contact TradeLoop support immediately.`,
    href: "/affiliate/payouts",
    email: true,
    sender: "payments",
  })
  return { affiliateId: m.affiliateId, label: `${methodLabel(m.type)} (${m.label})` }
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
    const crypto = cryptoSpec(method.type)
    // Crypto inside the caps, to a wallet that has been on file long enough,
    // for an affiliate with nothing flagged, is approved by the rules instead
    // of a person and sent straight away (by the exchange account, or the
    // payout wallet). Decided here, under the lock, so today's cap can't be
    // overrun by requests arriving together.
    let hot = false
    const sender = crypto ? autoSenderFor(method.type) : null
    if (crypto && settings.cryptoAutoSend) {
      const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
      const [[sent], [signals]] = await Promise.all([
        tx
          .select({ v: sql<string>`coalesce(sum(coalesce(${affiliatePayouts.netAmount}, ${affiliatePayouts.amount})), 0)` })
          .from(affiliatePayouts)
          // what the rules approved today — a payout a person approved doesn't use up the unattended allowance
          .where(and(inArray(affiliatePayouts.provider, AUTO_SENDERS), eq(affiliatePayouts.approvedBy, "auto"), gte(affiliatePayouts.requestedAt, dayStart), notInArray(affiliatePayouts.status, DEAD))),
        tx
          .select({ n: sql<number>`count(*)::int` })
          .from(affiliateFraudSignals)
          .where(and(eq(affiliateFraudSignals.affiliateId, aff.id), inArray(affiliateFraudSignals.risk, ["medium", "high"]), inArray(affiliateFraudSignals.status, ["open", "reviewing"]))),
      ])
      hot = autoSendProblem({ settings, walletReady: sender != null, amount: quote.net, sentToday: Number(sent?.v ?? 0), methodAgeHours: method.holdWaivedAt ? Number.POSITIVE_INFINITY : (now.getTime() - method.createdAt.getTime()) / 3_600_000, openRiskSignals: signals?.n ?? 0, affiliate: stateOf(aff) }) === null
    }
    const provider = hot && sender ? providerByName(sender) : providerFor(method.type)
    // A payout only the exchange can send has no "queued for a person to send":
    // unless the rules approved it, approving it IS what sends it.
    const status: PayoutStatus = hot ? "queued" : crypto && exchangeOnly(method.type) ? "pending" : settings.approval === "automatic" ? "queued" : "pending"
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
        network: crypto?.network ?? null,
        asset: crypto?.asset ?? null,
        status,
        mode: input.mode,
        idempotencyKey: key,
        requestedAt: now,
        approvedAt: status === "queued" ? now : null,
        // "auto": approved by the rules, not by a person.
        approvedBy: hot ? "auto" : null,
      })
      .returning({ id: affiliatePayouts.id })
    // The reservation.
    await tx.insert(affiliateCommissions).values({ affiliateId: aff.id, type: "payout", amount: String(-amount), currency: aff.payoutCurrency, status: payoutLedgerStatus(status), idempotencyKey: `payout:${payout.id}`, payoutId: payout.id, note: `Payout to ${methodLabel(method.type)}` })
    await logEvent(tx, { affiliateId: aff.id, payoutId: payout.id, methodId: method.id, actor: input.mode === "manual" ? input.actor : SYSTEM, action: input.mode === "manual" ? "payout.requested" : "payout.auto_created", next: { amount, fee: quote.fee, net: quote.net, method: `${method.type}:${method.label}`, status, ...(hot ? { automaticSend: true } : {}) } })

    const feeLine = quote.fee > 0 ? ` A ${quote.estimated ? "estimated " : ""}fee of ${money(quote.fee)} applies, so you'll receive ${money(quote.net)}.` : ""
    return {
      created: true,
      id: payout.id,
      status,
      amount,
      notify: {
        title: input.mode === "manual" ? "Payout requested" : "Automatic payout created",
        body: `${input.mode === "manual" ? "Your payout" : "An automatic payout"} of ${money(amount)} to ${methodLabel(method.type)} (${method.label}) ${hot ? "is being sent to your wallet now" : status === "pending" ? "is waiting for approval" : "is queued to be sent"}.${feeLine}`,
      },
    }
  })

  if (result.created) {
    if (result.notify) {
      const [made] = await db.select().from(affiliatePayouts).where(eq(affiliatePayouts.id, result.id))
      await notifyAffiliate({
        affiliateId: input.affiliateId,
        type: "payout",
        title: result.notify.title,
        body: result.notify.body,
        href: "/affiliate/payouts",
        pref: "payout",
        email: true,
        mail: made ? { key: `payout_requested:${made.id}`, build: (to) => payoutRequested({ firstName: to.firstName, payout: payoutFacts(made), requestedAt: made.requestedAt, sending: isAutoSender(made.provider) && made.status === "queued" }) } : null,
      })
    }
    if (result.status === "queued") await executePayout(result.id).catch((e) => console.error("[affiliates] payout execution failed:", e instanceof Error ? e.message : e))
    return { created: true, id: result.id, status: result.status, amount: result.amount }
  }
  return result
}

export type PayoutRequest = { affiliateId: number; amount: number; methodId: number; idempotencyKey: string; actor?: Actor }

// A payout an affiliate asks for. The same idempotency key (one per opening of
// the request dialog) returns the payout it already made.
export async function requestPayout(req: PayoutRequest): Promise<{ id: number; created: boolean; sending: boolean }> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(req.idempotencyKey)) throw new Error("That request couldn't be verified. Reload the page and try again.")
  const result = await createPayout({ mode: "manual", affiliateId: req.affiliateId, amount: req.amount, methodId: req.methodId, idempotencyKey: req.idempotencyKey, actor: req.actor ?? { type: "affiliate", id: null } })
  if ("skipped" in result) throw new Error(result.message)
  // Read back rather than assumed: whether it is on its way from the payout wallet.
  const [now] = await db.select({ provider: affiliatePayouts.provider, status: affiliatePayouts.status }).from(affiliatePayouts).where(eq(affiliatePayouts.id, result.id)).limit(1)
  return { id: result.id, created: result.created, sending: isAutoSender(now?.provider) && ["queued", "processing", "submitted", "confirming", "paid"].includes(now!.status) }
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
  // No message to the affiliate (internal steps of an automatic send).
  silent?: boolean
  // Detach the payout from a transaction that provably never happened.
  clearHash?: boolean
}

const NOTICES: Partial<Record<PayoutStatus, (p: Payout, reason: string) => [string, string]>> = {
  queued: (p) => ["Payout approved", `Your payout of ${money(p.amount)} was approved and is queued to be sent.`],
  processing: (p) => ["Payout processing", `Your payout of ${money(p.amount)} is being sent.`],
  submitted: (p) => ["Payout submitted", `Your ${p.asset ?? ""} payout of ${money(p.netAmount ?? p.amount)} has been submitted${p.transactionHash ? ` (transaction ${maskTxHash(p.transactionHash)})` : ""} and is waiting for confirmation.`],
  confirming: (p) => ["Payout confirming", `Your ${p.asset ?? ""} payout of ${money(p.netAmount ?? p.amount)} is on the ${p.network ?? "network"} and waiting for final confirmation${p.transactionHash ? ` (transaction ${maskTxHash(p.transactionHash)})` : ""}.`],
  paid: (p) =>
    p.asset
      ? [`Your ${p.asset} payout has been sent`, `Your ${p.asset} payout has been sent.\n\nAmount: ${money(p.netAmount ?? p.amount)}\nNetwork: ${cryptoSpecByNetwork(p.network)?.networkLabel ?? p.network ?? "—"}${p.transactionHash ? `\nTransaction: ${maskTxHash(p.transactionHash)}` : ""}`]
      : ["Payout completed", `Your payout of ${money(p.netAmount ?? p.amount)} to ${methodLabel(p.methodType)} (${p.methodLabel}) has been sent.`],
  failed: (p, r) => ["Payout failed", `Your payout of ${money(p.amount)} couldn't be sent: ${r} The amount is back in your available balance.`],
  rejected: (p, r) => ["Payout rejected", `Your payout request of ${money(p.amount)} was not approved.${r ? ` ${r}` : ""} The amount is back in your available balance.`],
  cancelled: (p) => ["Payout cancelled", `Your payout of ${money(p.amount)} was cancelled. The amount is back in your available balance.`],
  reversed: (p, r) => ["Payout reversed", `Your payout of ${money(p.amount)} was returned and has been put back in your available balance.${r ? ` ${r}` : ""}`],
  on_hold: (p) => ["Payout on hold", `Your payout of ${money(p.amount)} is on hold while we review it. You don't need to do anything.`],
}

// What a payout's emails show: amounts, the method with its masked
// destination, and — for a crypto payout only — the asset, network, wallet and
// transaction. `sent` is the exact amount of the asset that went out, when
// that isn't simply the dollar figure.
function payoutFacts(p: Payout, sent: string | null = null): PayoutFacts {
  const coin = cryptoSpec(p.methodType)
  return {
    id: p.id,
    amount: Number(p.amount),
    fee: Number(p.fee),
    net: Number(p.netAmount ?? p.amount),
    method: `${methodLabel(p.methodType)} (${p.methodLabel})`,
    automatic: p.mode === "automatic",
    crypto: coin ? { asset: coin.asset, network: coin.networkLabel, wallet: p.methodLabel, hash: p.transactionHash, explorerUrl: explorerTxUrl(p.network, p.transactionHash), sent } : null,
  }
}

// The email for a payout arriving in a status, with the key that makes it a
// one-off. null = no email for that step.
function payoutMail(p: Payout, from: PayoutStatus, reason: string, sent: string | null = null): Mail | null {
  const facts = payoutFacts(p, sent)
  const now = new Date()
  switch (p.status as PayoutStatus) {
    case "queued":
      // "Approved" is a person's decision; a payout the rules approved goes
      // straight from "requested" to "sent".
      return from === "pending" || from === "on_hold" ? { key: `payout_approved:${p.id}`, build: (to) => payoutApproved({ firstName: to.firstName, payout: facts, approvedAt: p.approvedAt ?? now }) } : null
    case "paid":
      return { key: `${facts.automatic ? "automatic_payout_sent" : "payout_sent"}:${p.id}`, build: (to) => payoutSent({ firstName: to.firstName, payout: facts, completedAt: p.completedAt ?? now }) }
    case "rejected":
      return { key: `payout_denied:${p.id}`, build: (to) => payoutDenied({ firstName: to.firstName, payout: facts, reviewedAt: now, reason: reason || null }) }
    case "failed":
      return { key: `payout_failed:${p.id}`, build: (to) => payoutFailed({ firstName: to.firstName, payout: facts, reason: reason || p.failureReason }) }
    case "on_hold":
      // can happen more than once to the same payout
      return { key: `payout_on_hold:${p.id}:${Math.floor(now.getTime() / 60_000)}`, build: (to) => payoutUpdate({ firstName: to.firstName, payout: facts, status: "on_hold", reason: null }) }
    case "cancelled":
    case "reversed":
      return { key: `payout_${p.status}:${p.id}`, build: (to) => payoutUpdate({ firstName: to.firstName, payout: facts, status: p.status as "cancelled" | "reversed", reason: reason || null }) }
    default:
      return null
  }
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
      if (m.clearHash) patch.transactionHash = null
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

  const notice = !m.silent && before && before.status !== after.status ? NOTICES[m.to]?.(after, m.reason?.trim() ?? "") : null
  if (notice) {
    const mail = payoutMail(after, before!.status as PayoutStatus, m.reason?.trim() ?? "")
    // In the portal every step shows; by email only the ones that matter: a
    // failure, a rejection or a return always, the rest by preference. The
    // in-between steps (processing, submitted, confirming) aren't emailed.
    await notifyAffiliate({ affiliateId: after.affiliateId, type: "payout", title: notice[0], body: notice[1], href: "/affiliate/payouts", pref: ["failed", "rejected", "reversed"].includes(m.to) ? undefined : "payout", email: !!mail, mail })
  }
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
  if (p.provider === HOT_PROVIDER) return sendFromPayoutWallet(p, actor)
  if (p.provider === EXCHANGE_PROVIDER) return sendViaExchange(p, actor)
  const provider = providerByName(p.provider)
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

// --- Automatic USDT sending ----------------------------------------------------
// The rule that makes it safe to send money with nobody watching:
//
//   1. Everything is checked BEFORE anything is signed (wallet funded, the
//      contract would accept it, fee within the limit, affiliate still fine).
//   2. The signed transaction is WRITTEN DOWN (its id, its bytes, its expiry)
//      before it is broadcast. From that moment the payout has a transaction.
//   3. A payout that has a transaction is never signed again until the chain
//      itself proves that transaction dead: its expiry has passed on the
//      irreversible head and it isn't on-chain. Until then the only thing that
//      is ever re-sent is the SAME transaction, which can be included once.
//   4. "Completed" comes only from the chain showing the transfer.
//
// So a crash, a timeout, a lost response or two workers at once can delay a
// payout — they can't pay it twice.

const LIVE_TX = ["signed", "submitted", "confirming"]
const liveTransactions = (payoutId: number) => db.select().from(affiliatePayoutTransactions).where(and(eq(affiliatePayoutTransactions.payoutId, payoutId), inArray(affiliatePayoutTransactions.status, LIVE_TX)))

// The payout stays queued and is tried again on the next run; the owners hear
// about it once per reason, not once per run.
async function waitForWallet(p: Payout, reason: string): Promise<Payout> {
  if (p.failureReason === reason) return p
  const [row] = await db.update(affiliatePayouts).set({ failureReason: reason }).where(eq(affiliatePayouts.id, p.id)).returning()
  await logEvent(db, { affiliateId: p.affiliateId, payoutId: p.id, actor: SYSTEM, action: "payout.auto_waiting", reason })
  await notifyOwners(`A ${p.asset ?? "crypto"} payout is waiting to be sent`, `Payout PO-${p.id} (${money(p.netAmount ?? p.amount)} in ${p.asset ?? "crypto"}) can't be sent yet:\n\n${reason}\n\nIt stays queued and is sent automatically once this is resolved.`)
  return row ?? p
}

async function needsPerson(p: Payout, from: PayoutStatus[], reason: string): Promise<Payout> {
  const row = await transition({ payoutId: p.id, to: "retry_required", from, actor: SYSTEM, reason, silent: true })
  await notifyOwners(`An automatic ${p.asset ?? "crypto"} payout needs attention`, `Payout PO-${p.id} (${money(p.netAmount ?? p.amount)} in ${p.asset ?? "crypto"}) was not sent:\n\n${reason}\n\nThe amount is still reserved. Retry it, or cancel it.`)
  return row
}

async function sendFromPayoutWallet(p: Payout, actor: Actor): Promise<Payout | null> {
  const settings = await getPayoutSettings()
  // The pause is checked right before the money would move.
  if (settings.paused) return p
  // Switched off after this payout was auto-approved: it goes back to a person.
  if (!settings.cryptoAutoSend && p.approvedBy === "auto") {
    const [row] = await db.update(affiliatePayouts).set({ provider: "tron_manual", failureReason: null }).where(eq(affiliatePayouts.id, p.id)).returning()
    await logEvent(db, { affiliateId: p.affiliateId, payoutId: p.id, actor: SYSTEM, action: "payout.auto_send_off", reason: "Automatic USDT sending was switched off; the payout waits to be sent by hand." })
    return row
  }
  // The affiliate may have been flagged since the request.
  const [aff] = await db.select().from(affiliates).where(eq(affiliates.id, p.affiliateId))
  if (!aff || aff.status !== "approved" || aff.fraudLock || aff.payoutHold) return transition({ payoutId: p.id, to: "on_hold", from: ["queued"], actor: SYSTEM, reason: "The affiliate's account was flagged before the payout was sent." })
  // Rule 3.
  if ((await liveTransactions(p.id)).length) return p
  if (p.attempts >= MAX_AUTO_ATTEMPTS) {
    const [last] = await db.select({ why: affiliatePayoutTransactions.failureReason }).from(affiliatePayoutTransactions).where(eq(affiliatePayoutTransactions.payoutId, p.id)).orderBy(desc(affiliatePayoutTransactions.id)).limit(1)
    return needsPerson(p, ["queued"], `Automatic sending didn't go through after ${MAX_AUTO_ATTEMPTS} attempts.${last?.why ? ` Last answer from the network: ${last.why}` : ""}`)
  }

  let target: { address: string; amount: number }
  try {
    target = await cryptoTarget(p)
  } catch (e) {
    return needsPerson(p, ["queued"], e instanceof Error ? e.message : "The wallet address couldn't be read.")
  }
  const feeLimit = settings.cryptoFeeLimitTrx * 1_000_000

  // Rule 1. A node that can't be reached leaves the payout queued, untouched.
  let quote: Awaited<ReturnType<typeof quoteSend>>
  try {
    quote = await quoteSend(target.address, target.amount, feeLimit)
  } catch (e) {
    console.error("[affiliates] payout wallet check failed:", e instanceof Error ? e.message : e)
    return p
  }
  if (!quote.ok) return quote.kind === "funds" ? waitForWallet(p, quote.reason) : needsPerson(p, ["queued"], quote.reason)

  // Claim it: two workers can't both get past this line for one payout.
  const claimed = await transition({ payoutId: p.id, to: "processing", from: ["queued"], actor, silent: true }).catch(() => null)
  if (!claimed) return null

  let signed: Awaited<ReturnType<typeof signTransfer>>
  try {
    signed = await signTransfer(target.address, target.amount, feeLimit)
  } catch (e) {
    // Nothing was signed, so nothing can have been sent: back to the queue.
    return transition({ payoutId: p.id, to: "queued", from: ["processing"], actor: SYSTEM, action: "payout.requeued", reason: e instanceof Error ? e.message : "The transaction couldn't be built.", silent: true })
  }

  // Rule 2: written down first…
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.insert(affiliatePayoutTransactions).values({ payoutId: p.id, provider: HOT_PROVIDER, network: p.network, asset: p.asset, amount: String(target.amount), destination: maskAddress(target.address), transactionHash: signed.txId, signedTx: signed.signedHex, expiresAt: new Date(signed.expiration), status: "signed", submittedAt: now })
    await tx.update(affiliatePayouts).set({ transactionHash: signed.txId, failureReason: null }).where(eq(affiliatePayouts.id, p.id))
    await logEvent(tx, { affiliateId: p.affiliateId, payoutId: p.id, actor: SYSTEM, action: "payout.transaction_signed", next: { transactionHash: signed.txId, expiresAt: new Date(signed.expiration).toISOString() } })
  })

  // …then broadcast. The answer is only a hint (rule 4).
  let sent: Broadcast
  try {
    sent = await broadcast(signed.signedHex)
  } catch (e) {
    sent = { accepted: false, message: e instanceof Error ? e.message : "The network couldn't be reached." }
  }
  await db.update(affiliatePayoutTransactions).set({ status: "submitted", failureReason: sent.accepted ? null : sent.message }).where(eq(affiliatePayoutTransactions.transactionHash, signed.txId))
  return transition({ payoutId: p.id, to: "submitted", from: ["processing"], actor: SYSTEM, action: "payout.broadcast" })
}

// Follows a payout the wallet is sending: confirm it, or prove its transaction
// dead and put it back to be sent again.
async function trackAutomatic(p: Payout, actor: Actor): Promise<Payout | null> {
  const [txRow] = p.transactionHash ? await db.select().from(affiliatePayoutTransactions).where(eq(affiliatePayoutTransactions.transactionHash, p.transactionHash)) : []
  if (!p.transactionHash || !txRow) {
    // Claimed, but the process ended before anything was signed (nothing is
    // ever broadcast without being written down first). After ten quiet
    // minutes it goes back to the queue.
    const [lastEvent] = await db.select({ at: affiliatePayoutEvents.createdAt }).from(affiliatePayoutEvents).where(eq(affiliatePayoutEvents.payoutId, p.id)).orderBy(desc(affiliatePayoutEvents.id)).limit(1)
    if (p.status === "processing" && !p.transactionHash && lastEvent && Date.now() - lastEvent.at.getTime() > 10 * 60_000) {
      await transition({ payoutId: p.id, to: "queued", from: ["processing"], actor: SYSTEM, action: "payout.requeued", reason: "The send was interrupted before a transaction was signed.", silent: true })
      return executePayout(p.id)
    }
    return p
  }

  const target = await cryptoTarget(p)
  const hash = p.transactionHash
  const setTx = (status: string, failureReason: string | null = txRow.failureReason) => db.update(affiliatePayoutTransactions).set({ status, failureReason, confirmedAt: status === "confirmed" ? new Date() : null }).where(eq(affiliatePayoutTransactions.id, txRow.id))
  const judge = async () => {
    const found = await lookupTransaction(hash)
    return judgeTransaction(found.solid ?? found.latest, !!found.solid, target)
  }

  let verdict = await judge()
  await db.update(affiliatePayouts).set({ lastCheckedAt: new Date() }).where(eq(affiliatePayouts.id, p.id))

  if (verdict.state === "not_found") {
    const expiresAt = txRow.expiresAt?.getTime()
    if (!expiresAt) return p
    // Still valid, and the node never acknowledged it: the broadcast may simply
    // not have got through. Send the SAME transaction again. (One the node did
    // accept is just waiting for a block — nothing to do but look again later.)
    if (Date.now() < expiresAt - 20_000 && txRow.signedTx && txRow.failureReason) {
      const again = await broadcast(txRow.signedTx).catch((e): Broadcast => ({ accepted: false, message: e instanceof Error ? e.message : "unreachable" }))
      await setTx("submitted", again.accepted ? null : again.message)
      return p.status === "processing" ? transition({ payoutId: p.id, to: "submitted", from: ["processing"], actor: SYSTEM, action: "payout.broadcast" }) : p
    }
    // Rule 3: dead only when the irreversible head has passed the expiry AND a
    // lookup made after that still finds nothing.
    const solidHead = await solidHeadBlock()
    if (!transactionProvablyDead({ expiresAt, solidHeadTime: solidHead.timestamp, foundOnChain: false })) return p.status === "processing" ? transition({ payoutId: p.id, to: "submitted", from: ["processing"], actor: SYSTEM, action: "payout.broadcast" }) : p
    verdict = await judge()
    if (verdict.state === "not_found") {
      await setTx("expired", txRow.failureReason ?? "The transaction expired without being included in a block.")
      await transition({ payoutId: p.id, to: "queued", from: ["processing", "submitted"], actor: SYSTEM, action: "payout.requeued", reason: "The transaction expired without being included. It is being sent again.", silent: true, clearHash: true })
      return executePayout(p.id)
    }
  }

  if (verdict.state === "confirmed") {
    await setTx("confirmed", null)
    return transition({ payoutId: p.id, to: "paid", from: ["processing", "submitted", "confirming"], actor, action: "payout.confirmed" })
  }
  if (verdict.state === "confirming") {
    await setTx("confirming", null)
    return p.status === "confirming" ? p : transition({ payoutId: p.id, to: "confirming", from: ["processing", "submitted"], actor: SYSTEM })
  }
  // Included but failed (e.g. out of energy), or — which should be impossible
  // for a transaction built here — not matching the payout. The transaction
  // is spent either way; a person decides what happens next.
  const reason = verdict.state === "failed" || verdict.state === "mismatch" ? verdict.reason : "The transaction could not be verified."
  await setTx("failed", reason)
  return needsPerson(p, ["processing", "submitted", "confirming"], reason)
}

// Sends what is waiting in the queue for an automatic sender: payouts that
// were short of funds last time, and ones put back after an attempt that
// provably never happened.
export async function sendQueuedAutomatic(limit = 20): Promise<{ tried: number; submitted: number }> {
  const rows = await db.select({ id: affiliatePayouts.id }).from(affiliatePayouts).where(and(inArray(affiliatePayouts.provider, AUTO_SENDERS), eq(affiliatePayouts.status, "queued"))).orderBy(affiliatePayouts.id).limit(limit)
  let submitted = 0
  for (const r of rows) {
    try {
      if ((await executePayout(r.id))?.status === "submitted") submitted++
    } catch (e) {
      console.error("[affiliates] automatic send failed:", r.id, e instanceof Error ? e.message : e)
    }
  }
  return { tried: rows.length, submitted }
}

// --- Sending from the exchange account ------------------------------------------
// The same four rules as the payout wallet, for a withdrawal the exchange
// makes on our behalf:
//
//   1. Everything is checked BEFORE anything is requested (the account holds
//      the funds, the network is open, the amount clears the minimum, the fee
//      is within the limit, the affiliate is still fine).
//   2. The attempt is WRITTEN DOWN, with the tag the withdrawal will carry and
//      the moment after which the request can no longer be accepted, before
//      the exchange is asked.
//   3. An attempt whose answer was lost is never repeated until it is proven
//      that it created nothing: its window has passed and the account's
//      history, looked up after that, has no such withdrawal. If the history
//      does have it, it is adopted — not sent again.
//   4. "Completed" comes only from the exchange reporting the withdrawal as
//      done — and for USDT on TRON, from the chain confirming the transfer too.

type ExchangeQuote = { quota: Quota; price: number; units: number }

async function exchangeQuote(spec: CryptoSpec, usd: number): Promise<ExchangeQuote> {
  const [quota, price] = await Promise.all([withdrawalQuota(spec.asset, spec.exchangeChain), spec.usdPegged ? Promise.resolve(1) : assetPriceUsd(spec.asset)])
  return { quota, price, units: assetAmount(usd, price, Math.min(quota.precision, spec.decimals)) }
}

async function sendViaExchange(p: Payout, actor: Actor): Promise<Payout | null> {
  const settings = await getPayoutSettings()
  // The pause is checked right before the money would move.
  if (settings.paused) return p
  const spec = cryptoSpec(p.methodType)
  if (!spec) return needsPerson(p, ["queued"], "This payout isn't a crypto payout.")
  // Switched off after this payout was auto-approved: it goes back to a person.
  if (!settings.cryptoAutoSend && p.approvedBy === "auto") {
    if (!exchangeOnly(p.methodType)) {
      const [row] = await db.update(affiliatePayouts).set({ provider: "tron_manual", failureReason: null }).where(eq(affiliatePayouts.id, p.id)).returning()
      await logEvent(db, { affiliateId: p.affiliateId, payoutId: p.id, actor: SYSTEM, action: "payout.auto_send_off", reason: "Automatic crypto sending was switched off; the payout waits to be sent by hand." })
      return row
    }
    return transition({ payoutId: p.id, to: "on_hold", from: ["queued"], actor: SYSTEM, action: "payout.auto_send_off", reason: "Automatic crypto sending was switched off before this payout was sent. Release it to send it." })
  }
  // The affiliate may have been flagged since the request.
  const [aff] = await db.select().from(affiliates).where(eq(affiliates.id, p.affiliateId))
  if (!aff || aff.status !== "approved" || aff.fraudLock || aff.payoutHold) return transition({ payoutId: p.id, to: "on_hold", from: ["queued"], actor: SYSTEM, reason: "The affiliate's account was flagged before the payout was sent." })
  // Rule 3.
  if ((await liveTransactions(p.id)).length) return p
  if (p.attempts >= MAX_AUTO_ATTEMPTS) {
    const [last] = await db.select({ why: affiliatePayoutTransactions.failureReason }).from(affiliatePayoutTransactions).where(eq(affiliatePayoutTransactions.payoutId, p.id)).orderBy(desc(affiliatePayoutTransactions.id)).limit(1)
    return needsPerson(p, ["queued"], `Automatic sending didn't go through after ${MAX_AUTO_ATTEMPTS} attempts.${last?.why ? ` Last answer from ${EXCHANGE_NAME}: ${last.why}` : ""}`)
  }

  let target: { address: string; amount: number }
  try {
    target = await cryptoTarget(p)
    const bad = spec.addressProblem(target.address)
    if (bad) throw new Error(bad)
  } catch (e) {
    return needsPerson(p, ["queued"], e instanceof Error ? e.message : "The wallet address couldn't be read.")
  }

  // Rule 1. An exchange that can't be reached leaves the payout queued, untouched.
  let quote: ExchangeQuote
  try {
    quote = await exchangeQuote(spec, target.amount)
  } catch (e) {
    if (e instanceof ExchangeRefused) return waitForWallet(p, `${EXCHANGE_NAME} refused the request: ${e.message}`)
    console.error("[affiliates] exchange check failed:", e instanceof Error ? e.message : e)
    return p
  }
  const problem = exchangeSendProblem({ asset: spec.asset, network: spec.networkLabel, amount: quote.units, available: quote.quota.available, fee: quote.quota.fee, min: quote.quota.min, enabled: quote.quota.enabled, priceUsd: quote.price, maxFeeUsd: settings.cryptoMaxFeeUsd })
  if (problem) return problem.kind === "funds" ? waitForWallet(p, problem.reason) : needsPerson(p, ["queued"], problem.reason)

  // Claim it: two workers can't both get past this line for one payout.
  const claimed = await transition({ payoutId: p.id, to: "processing", from: ["queued"], actor, silent: true }).catch(() => null)
  if (!claimed) return null

  // Rule 2: written down first…
  const now = new Date()
  const amount = quote.units.toFixed(Math.min(quote.quota.precision, spec.decimals)).replace(/\.?0+$/, "")
  const attempt = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(affiliatePayoutTransactions)
      .values({ payoutId: p.id, provider: EXCHANGE_PROVIDER, network: spec.network, asset: spec.asset, amount, destination: maskAddress(target.address), expiresAt: new Date(now.getTime() + EXCHANGE_REQUEST_WINDOW_MS), status: "signed", submittedAt: now })
      .returning({ id: affiliatePayoutTransactions.id })
    await tx.update(affiliatePayouts).set({ failureReason: null }).where(eq(affiliatePayouts.id, p.id))
    await logEvent(tx, { affiliateId: p.affiliateId, payoutId: p.id, actor: SYSTEM, action: "payout.withdrawal_prepared", next: { tag: withdrawalRemark(p.id, row.id), amount: `${amount} ${spec.asset}`, network: spec.network, ...(spec.usdPegged ? {} : { priceUsd: quote.price }), fee: `${quote.quota.fee} ${spec.asset}` } })
    return row
  })
  const setAttempt = (patch: Partial<typeof affiliatePayoutTransactions.$inferInsert>) => db.update(affiliatePayoutTransactions).set(patch).where(eq(affiliatePayoutTransactions.id, attempt.id))

  // …then asked.
  try {
    const { withdrawalId } = await applyWithdrawal({ currency: spec.asset, chain: spec.exchangeChain, address: target.address, amount, remark: withdrawalRemark(p.id, attempt.id) })
    await setAttempt({ providerTransactionId: withdrawalId, status: "submitted", failureReason: null })
    return transition({ payoutId: p.id, to: "submitted", from: ["processing"], actor: SYSTEM, action: "payout.withdrawal_requested", reference: withdrawalId })
  } catch (e) {
    const why = e instanceof Error ? e.message : "The exchange couldn't be reached."
    if (e instanceof ExchangeRefused) {
      // A plain "no": nothing was created, so it can be tried again later.
      await setAttempt({ status: "failed", failureReason: why.slice(0, 300) })
      return transition({ payoutId: p.id, to: "queued", from: ["processing"], actor: SYSTEM, action: "payout.requeued", reason: `${EXCHANGE_NAME} refused the withdrawal: ${why}`, silent: true })
    }
    // No answer: the withdrawal may exist. The attempt stays open and
    // trackExchange finds out which (rule 3).
    await setAttempt({ failureReason: why.slice(0, 300) })
    return claimed
  }
}

// Follows a payout the exchange is sending: adopt a withdrawal whose answer was
// lost, complete it when the exchange (and the chain, where it can be checked)
// says it is done, or prove the attempt created nothing and send it again.
async function trackExchange(p: Payout, actor: Actor): Promise<Payout | null> {
  const spec = cryptoSpec(p.methodType)
  const [attempt] = await db.select().from(affiliatePayoutTransactions).where(and(eq(affiliatePayoutTransactions.payoutId, p.id), eq(affiliatePayoutTransactions.provider, EXCHANGE_PROVIDER), inArray(affiliatePayoutTransactions.status, LIVE_TX))).orderBy(desc(affiliatePayoutTransactions.id)).limit(1)
  if (!spec || !attempt) {
    // Claimed, but the process ended before the attempt was written down —
    // and nothing is ever requested without that. After ten quiet minutes it
    // goes back to the queue.
    const [lastEvent] = await db.select({ at: affiliatePayoutEvents.createdAt }).from(affiliatePayoutEvents).where(eq(affiliatePayoutEvents.payoutId, p.id)).orderBy(desc(affiliatePayoutEvents.id)).limit(1)
    if (spec && p.status === "processing" && lastEvent && Date.now() - lastEvent.at.getTime() > 10 * 60_000) {
      await transition({ payoutId: p.id, to: "queued", from: ["processing"], actor: SYSTEM, action: "payout.requeued", reason: "The send was interrupted before a withdrawal was requested.", silent: true })
      return executePayout(p.id)
    }
    return p
  }
  const target = await cryptoTarget(p)
  const units = Number(attempt.amount)
  const setAttempt = (patch: Partial<typeof affiliatePayoutTransactions.$inferInsert>) => db.update(affiliatePayoutTransactions).set(patch).where(eq(affiliatePayoutTransactions.id, attempt.id))
  await db.update(affiliatePayouts).set({ lastCheckedAt: new Date() }).where(eq(affiliatePayouts.id, p.id))

  let found: Withdrawal | null
  try {
    found = await lookupWithdrawal({ id: attempt.providerTransactionId, currency: spec.asset, remark: withdrawalRemark(p.id, attempt.id), address: target.address, amount: units, since: (attempt.submittedAt ?? attempt.createdAt).getTime(), caseInsensitive: spec.caseInsensitive })
  } catch (e) {
    // Not being able to ask proves nothing: wait.
    console.error("[affiliates] exchange lookup failed:", p.id, e instanceof Error ? e.message : e)
    return p
  }
  const lookedUpAt = Date.now()

  if (!found) {
    // The exchange gave us an id for it: it exists, whatever this lookup says.
    if (attempt.providerTransactionId || !attempt.expiresAt) return p
    // Rule 3.
    if (!exchangeRequestProvablyDead({ expiresAt: attempt.expiresAt.getTime(), lookedUpAt, found: false })) return p
    await setAttempt({ status: "expired", failureReason: attempt.failureReason ?? "The request never reached the exchange." })
    await transition({ payoutId: p.id, to: "queued", from: ["processing", "submitted"], actor: SYSTEM, action: "payout.requeued", reason: "The withdrawal request never reached the exchange. It is being sent again.", silent: true })
    return executePayout(p.id)
  }

  // The answer was lost but the withdrawal was made: this is the one.
  if (!attempt.providerTransactionId) {
    await setAttempt({ providerTransactionId: found.id, status: "submitted", failureReason: null })
    await logEvent(db, { affiliateId: p.affiliateId, payoutId: p.id, actor: SYSTEM, action: "payout.withdrawal_found", next: { reference: found.id } })
  }
  const hash = found.inner ? null : spec.hashFrom(found.txId)
  const inFlight: PayoutStatus[] = ["processing", "submitted", "confirming"]

  if (found.status === "FAILURE") {
    const reason = `${EXCHANGE_NAME} reported the withdrawal as failed. Nothing was sent, and the funds are back in the exchange account.`
    await setAttempt({ status: "failed", failureReason: reason })
    return needsPerson(p, inFlight, reason)
  }
  if (found.status !== "SUCCESS") {
    // Under review or being sent by the exchange.
    if (p.status === "processing") return transition({ payoutId: p.id, to: "submitted", from: ["processing"], actor: SYSTEM, action: "payout.withdrawal_requested", reference: found.id })
    return p
  }

  // The exchange says it is done. For USDT on TRON the chain is asked as well,
  // exactly as for a transfer sent any other way.
  if (hash && spec.verifiable) {
    const verdict = await cryptoProvider().getTransaction(hash, { address: target.address, amount: units })
    if (verdict.state === "failed" || verdict.state === "mismatch") {
      await setAttempt({ status: "failed", failureReason: verdict.reason, transactionHash: hash })
      return needsPerson(p, inFlight, `${EXCHANGE_NAME} reported the withdrawal as sent, but the transaction doesn't check out on-chain: ${verdict.reason}`)
    }
    if (verdict.state === "not_found" && Date.now() - (attempt.submittedAt ?? attempt.createdAt).getTime() > NOT_FOUND_AFTER_MS) {
      const reason = `${EXCHANGE_NAME} reported the withdrawal as sent, but the transaction wasn't found on the TRON network after 24 hours. Check it in the exchange account.`
      await setAttempt({ status: "not_found", failureReason: reason, transactionHash: hash })
      return needsPerson(p, inFlight, reason)
    }
    if (verdict.state !== "confirmed") {
      await setAttempt({ status: "confirming", transactionHash: hash })
      return p.status === "confirming" ? p : transition({ payoutId: p.id, to: "confirming", from: ["processing", "submitted"], actor: SYSTEM, hash, reference: found.id })
    }
  }
  await setAttempt({ status: "confirmed", failureReason: null, confirmedAt: new Date(), ...(hash ? { transactionHash: hash } : {}) })
  const paid = await transition({ payoutId: p.id, to: "paid", from: inFlight, actor, action: "payout.confirmed", reference: found.id, ...(hash ? { hash } : {}), silent: true }).catch(async (e) => {
    // Another worker completed it a moment ago (and told the affiliate): nothing left to do.
    const [now] = await db.select().from(affiliatePayouts).where(eq(affiliatePayouts.id, p.id))
    if (now?.status === "paid") return null
    throw e
  })
  if (!paid) return (await db.select().from(affiliatePayouts).where(eq(affiliatePayouts.id, p.id)))[0] ?? null
  // Said here rather than by transition(): this notice carries the exact amount of the asset that was sent.
  await notifyAffiliate({
    affiliateId: p.affiliateId,
    type: "payout",
    title: `Your ${spec.assetName} payout has been sent`,
    body: `Your ${spec.assetName} payout has been sent.\n\nAmount: ${formatAsset(units, spec.asset, spec.decimals)}${spec.usdPegged ? "" : ` (${money(p.netAmount ?? p.amount)})`}\nNetwork: ${spec.networkLabel}${hash ? `\nTransaction: ${maskTxHash(hash)}` : ""}`,
    href: "/affiliate/payouts",
    pref: "payout",
    email: true,
    mail: payoutMail(paid, "confirming", "", formatAsset(units, spec.asset, spec.decimals)),
  })
  return paid
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
    .values({ payoutId: p.id, provider: p.provider, network: p.network, asset: p.asset, amount: String(amount), destination: maskAddress(address), transactionHash: hash, status, failureReason, submittedAt: now, confirmedAt: status === "confirmed" ? now : null })
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
  // Only a USDT (TRC-20) transfer can be checked on-chain here.
  if (!cryptoSpec(p.methodType)?.verifiable) throw new Error(`A ${methodLabel(p.methodType)} payout is sent by the exchange account; it can't be paid by hand here.`)
  if (isAutoSender(p.provider)) {
    // Paying by hand a payout the wallet may already be paying would pay it twice.
    if (!["queued", "retry_required"].includes(p.status) || (await liveTransactions(p.id)).length) throw new Error("This payout is being sent automatically. Wait for the network to confirm it, or for it to come back for a retry.")
    await db.update(affiliatePayouts).set({ provider: "tron_manual" }).where(eq(affiliatePayouts.id, p.id))
  }
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
  if (p && p.provider === HOT_PROVIDER && ["processing", "submitted", "confirming"].includes(p.status)) return trackAutomatic(p, actor)
  if (p && p.provider === EXCHANGE_PROVIDER && ["processing", "submitted", "confirming"].includes(p.status)) return trackExchange(p, actor)
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
    .where(and(sql`((${affiliatePayouts.status} in ('submitted','confirming') and ${affiliatePayouts.transactionHash} is not null) or (${affiliatePayouts.provider} = ${HOT_PROVIDER} and ${affiliatePayouts.status} = 'processing') or (${affiliatePayouts.provider} = ${EXCHANGE_PROVIDER} and ${affiliatePayouts.status} in ('processing','submitted','confirming')))`, opts.affiliateId != null ? eq(affiliatePayouts.affiliateId, opts.affiliateId) : undefined, sql`(${affiliatePayouts.lastCheckedAt} is null or ${affiliatePayouts.lastCheckedAt} < ${stale})`))
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

export type AdminAction = "approve" | "reject" | "hold" | "release" | "cancel" | "start" | "mark_paid" | "fail" | "retry" | "reverse" | "send_auto"

// One entry point for what an admin can do to a payout, so the rules about
// what is allowed when (and while paused) live in one place.
export async function adminPayoutAction(payoutId: number, action: AdminAction, actor: Actor, input: { reason?: string; reference?: string } = {}): Promise<Payout> {
  const [p] = await db.select().from(affiliatePayouts).where(eq(affiliatePayouts.id, payoutId))
  if (!p) throw new Error("That payout no longer exists.")
  const reason = input.reason?.trim() ?? ""
  // While paused, nothing new is sent. Recording what already happened
  // (mark paid, fail, reverse) and stopping things (reject, cancel, hold) stay possible.
  if (["approve", "start", "retry", "release", "send_auto"].includes(action) && (await getPayoutSettings()).paused) throw new Error("All payouts are paused. Lift the pause in Payout settings before sending anything.")

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
      // A person is now the one approving it, whatever approved it before.
      if (p.approvedBy === "auto") await db.update(affiliatePayouts).set({ approvedBy: actor.id }).where(eq(affiliatePayouts.id, p.id))
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
    case "send_auto": {
      // An admin hands a crypto payout to the automatic sender instead of sending it by hand.
      if (!isCryptoMethod(p.methodType)) throw new Error("Only a crypto payout can be sent automatically.")
      if (!["queued", "retry_required"].includes(p.status)) throw new Error("Approve the payout first.")
      const sender = autoSenderFor(p.methodType)
      if (!sender) throw new Error("Nothing is configured to send this payout automatically.")
      if (p.transactionHash || (await liveTransactions(p.id)).length) throw new Error("This payout already has a transaction.")
      await db.update(affiliatePayouts).set({ provider: sender, attempts: 0, approvedBy: p.approvedBy === "auto" || !p.approvedBy ? actor.id : p.approvedBy }).where(eq(affiliatePayouts.id, p.id))
      const next = p.status === "retry_required" ? await transition({ payoutId, to: "queued", from: ["retry_required"], actor, action: "payout.send_auto", silent: true }) : p
      if (p.status === "queued") await logEvent(db, { affiliateId: p.affiliateId, payoutId: p.id, actor, action: "payout.send_auto" })
      return (await executePayout(payoutId, actor)) ?? next
    }
    case "fail":
      if (!reason) throw new Error("Say why the payout failed — the affiliate will see it.")
      // A signed transaction of ours may still land: releasing the money now could pay it twice.
      if (isAutoSender(p.provider) && ["processing", "submitted", "confirming"].includes(p.status)) throw new Error("A transaction for this payout may still confirm. Wait for the network — it comes back for a retry if it didn't go through.")
      return transition({ payoutId, to: "failed", from: ["queued", "processing", "submitted", "confirming", "retry_required"], actor, reason })
    case "retry": {
      if (p.status !== "retry_required" && p.status !== "queued") throw new Error(`A payout that is ${p.status.replace("_", " ")} can't be retried.`)
      // An admin's retry starts the automatic attempts afresh.
      if (isAutoSender(p.provider)) await db.update(affiliatePayouts).set({ attempts: 0 }).where(eq(affiliatePayouts.id, p.id))
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
      sender: "payments",
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
