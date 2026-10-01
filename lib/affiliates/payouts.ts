import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliateCommissions, affiliatePayoutMethods, affiliatePayouts, affiliates } from "@/lib/db/schema"
import { decrypt, encrypt } from "@/lib/crypto"
import { ledgerBalances, maskEmail, payoutLedgerStatus, payoutTransitionAllowed, round2, settleFifo, validatePayoutRequest } from "./engine"
import { availableRows } from "./commissions"
import { getProgram } from "./program"
import { notifyAffiliate } from "./notify"
import { money, PAYOUT_METHOD_LABELS, type PayoutMethodType, type PayoutStatus } from "./types"

// Payouts. Money leaves the ledger as a negative "payout" row written in the
// same transaction as the payout itself, under a lock on the affiliate, so two
// requests at once can't both spend the same balance.

// --- Provider abstraction ---------------------------------------------------
// Anything that actually moves money implements this. Today there is one
// provider, "manual": a person sends the transfer and records the result in
// the admin panel. An automated provider (PayPal Payouts, Wise) plugs in here
// without touching the ledger code.

export type ProviderPayout = { id: number; amount: number; currency: string; methodType: string; details: Record<string, string> }
export type ProviderResult = { status: PayoutStatus; providerRef?: string | null; failureReason?: string | null }

export interface PayoutProvider {
  readonly name: string
  validateAccount(type: PayoutMethodType, details: Record<string, string>): string | null
  createPayout(payout: ProviderPayout): Promise<ProviderResult>
  getPayoutStatus(providerRef: string): Promise<ProviderResult | null>
  cancelPayout(providerRef: string): Promise<boolean>
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const manualProvider: PayoutProvider = {
  name: "manual",
  validateAccount(type, d) {
    if (type === "paypal") return EMAIL.test(d.email ?? "") ? null : "Enter the email address of your PayPal account."
    if (type === "wise") {
      if (!EMAIL.test(d.email ?? "")) return "Enter the email address of your Wise account."
      return (d.holder ?? "").trim().length >= 2 ? null : "Enter the account holder name."
    }
    if ((d.holder ?? "").trim().length < 2) return "Enter the account holder name."
    if ((d.bankName ?? "").trim().length < 2) return "Enter the bank name."
    if (!/^[A-Z0-9]{6,34}$/.test((d.account ?? "").replace(/\s+/g, "").toUpperCase())) return "Enter a valid IBAN or account number."
    if (d.swift && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(d.swift.replace(/\s+/g, "").toUpperCase())) return "That SWIFT/BIC code doesn't look right."
    if (!/^[A-Za-z]{2}$/.test(d.country ?? "")) return "Choose the bank's country."
    return null
  },
  // Nothing is sent automatically: the request waits for an admin.
  async createPayout() {
    return { status: "pending" }
  },
  async getPayoutStatus() {
    return null
  },
  async cancelPayout() {
    return true
  },
}

const PROVIDERS: Record<string, PayoutProvider> = { manual: manualProvider }
export const payoutProvider = (name = "manual"): PayoutProvider => PROVIDERS[name] ?? manualProvider

// --- Payout methods ---------------------------------------------------------
// The account details are encrypted at rest (AES-256-GCM, lib/crypto) and only
// ever decrypted for an admin who is about to send the payout. What the
// affiliate sees again is the masked label.

const FIELDS: Record<PayoutMethodType, string[]> = { paypal: ["email"], wise: ["email", "holder"], bank: ["holder", "bankName", "account", "swift", "country"] }

function cleanDetails(type: PayoutMethodType, raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of FIELDS[type]) {
    let v = String(raw[key] ?? "").trim().slice(0, 120)
    if (key === "email") v = v.toLowerCase()
    if (key === "account" || key === "swift") v = v.replace(/\s+/g, "").toUpperCase()
    if (key === "country") v = v.toUpperCase()
    if (v) out[key] = v
  }
  return out
}

function maskedLabel(type: PayoutMethodType, d: Record<string, string>): string {
  if (type === "bank") return `${d.bankName} ···· ${d.account.slice(-4)}`
  return maskEmail(d.email)
}

export async function addPayoutMethod(affiliateId: number, type: PayoutMethodType, raw: Record<string, unknown>): Promise<void> {
  if (!(type in FIELDS)) throw new Error("Choose a payout method.")
  const details = cleanDetails(type, raw)
  const problem = payoutProvider().validateAccount(type, details)
  if (problem) throw new Error(problem)
  const existing = await db.select({ id: affiliatePayoutMethods.id }).from(affiliatePayoutMethods).where(and(eq(affiliatePayoutMethods.affiliateId, affiliateId), eq(affiliatePayoutMethods.status, "active")))
  if (existing.length >= 5) throw new Error("You can keep up to 5 payout methods. Remove one first.")
  await db.insert(affiliatePayoutMethods).values({ affiliateId, type, label: maskedLabel(type, details), details: encrypt(JSON.stringify(details)), isDefault: existing.length === 0 })
}

export async function setDefaultMethod(affiliateId: number, methodId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [m] = await tx.select({ id: affiliatePayoutMethods.id }).from(affiliatePayoutMethods).where(and(eq(affiliatePayoutMethods.id, methodId), eq(affiliatePayoutMethods.affiliateId, affiliateId), eq(affiliatePayoutMethods.status, "active")))
    if (!m) throw new Error("That payout method no longer exists.")
    await tx.update(affiliatePayoutMethods).set({ isDefault: false }).where(eq(affiliatePayoutMethods.affiliateId, affiliateId))
    await tx.update(affiliatePayoutMethods).set({ isDefault: true }).where(eq(affiliatePayoutMethods.id, methodId))
  })
}

// Soft-removed: payouts already made keep pointing at what they were sent to.
export async function removePayoutMethod(affiliateId: number, methodId: number): Promise<void> {
  const [m] = await db
    .update(affiliatePayoutMethods)
    .set({ status: "removed", isDefault: false })
    .where(and(eq(affiliatePayoutMethods.id, methodId), eq(affiliatePayoutMethods.affiliateId, affiliateId), eq(affiliatePayoutMethods.status, "active")))
    .returning({ wasDefault: affiliatePayoutMethods.isDefault })
  if (!m) throw new Error("That payout method no longer exists.")
  const [next] = await db
    .select({ id: affiliatePayoutMethods.id })
    .from(affiliatePayoutMethods)
    .where(and(eq(affiliatePayoutMethods.affiliateId, affiliateId), eq(affiliatePayoutMethods.status, "active")))
    .orderBy(desc(affiliatePayoutMethods.isDefault), affiliatePayoutMethods.id)
    .limit(1)
  if (next) await db.update(affiliatePayoutMethods).set({ isDefault: true }).where(eq(affiliatePayoutMethods.id, next.id))
}

// Admin only (the caller checks the permission and writes the audit entry).
export async function revealMethodDetails(methodId: number): Promise<{ type: string; details: Record<string, string> } | null> {
  const [m] = await db.select().from(affiliatePayoutMethods).where(eq(affiliatePayoutMethods.id, methodId))
  if (!m) return null
  try {
    return { type: m.type, details: JSON.parse(decrypt(m.details)) as Record<string, string> }
  } catch {
    return null
  }
}

// --- Requests ---------------------------------------------------------------

export type PayoutRequest = { affiliateId: number; amount: number; methodId: number; idempotencyKey: string }

// The amount comes from the affiliate, so everything about it is checked
// against the ledger here, inside the lock. The same idempotency key (one per
// opening of the request dialog) returns the payout it already made.
export async function requestPayout(req: PayoutRequest): Promise<{ id: number; created: boolean }> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(req.idempotencyKey)) throw new Error("That request couldn't be verified. Reload the page and try again.")
  const key = `req:${req.affiliateId}:${req.idempotencyKey}`
  const amount = round2(Number(req.amount))
  const program = await getProgram()

  const result = await db.transaction(async (tx) => {
    const [aff] = await tx.select().from(affiliates).where(eq(affiliates.id, req.affiliateId)).for("update")
    if (!aff) throw new Error("Affiliate account not found.")

    const [dupe] = await tx.select({ id: affiliatePayouts.id }).from(affiliatePayouts).where(eq(affiliatePayouts.idempotencyKey, key))
    if (dupe) return { id: dupe.id, created: false }

    const [method] = await tx
      .select()
      .from(affiliatePayoutMethods)
      .where(and(eq(affiliatePayoutMethods.id, req.methodId), eq(affiliatePayoutMethods.affiliateId, aff.id), eq(affiliatePayoutMethods.status, "active")))
    const entries = await tx.select({ type: affiliateCommissions.type, status: affiliateCommissions.status, amount: affiliateCommissions.amount }).from(affiliateCommissions).where(eq(affiliateCommissions.affiliateId, aff.id))
    const balances = ledgerBalances(entries.map((e) => ({ type: e.type, status: e.status, amount: Number(e.amount) })))

    const problem = validatePayoutRequest({ amount, available: balances.available, minPayout: program.minPayout, hasMethod: !!method, affiliateStatus: aff.status, payoutHold: aff.payoutHold, fraudLock: aff.fraudLock })
    if (problem) throw new Error(problem)

    const [open] = await tx.select({ id: affiliatePayouts.id }).from(affiliatePayouts).where(and(eq(affiliatePayouts.affiliateId, aff.id), inArray(affiliatePayouts.status, ["pending", "processing"])))
    if (open) throw new Error("You already have a payout in progress. You can request another once it's paid.")

    const provider = payoutProvider()
    const [payout] = await tx
      .insert(affiliatePayouts)
      .values({ affiliateId: aff.id, amount: String(amount), currency: aff.payoutCurrency, methodId: method.id, methodType: method.type, methodLabel: method.label, provider: provider.name, status: "pending", idempotencyKey: key })
      .returning({ id: affiliatePayouts.id })
    await tx.insert(affiliateCommissions).values({ affiliateId: aff.id, type: "payout", amount: String(-amount), currency: aff.payoutCurrency, status: "pending", idempotencyKey: `payout:${payout.id}`, payoutId: payout.id, note: `Payout to ${PAYOUT_METHOD_LABELS[method.type as PayoutMethodType] ?? method.type}` })
    return { id: payout.id, created: true }
  })

  if (result.created) {
    await notifyAffiliate({ affiliateId: req.affiliateId, type: "payout", title: "Payout requested", body: `Your payout of ${money(amount)} was requested. Expected arrival: ${program.payoutEta} after it's processed.`, href: "/affiliate/payouts", pref: "payout", email: true })
  }
  return result
}

// Moves a payout through its lifecycle and keeps its ledger row in step.
// `by` is the admin's user id, or null when the affiliate cancels their own.
export async function setPayoutStatus(input: { payoutId: number; to: PayoutStatus; by: string | null; affiliateId?: number; reason?: string; providerRef?: string; note?: string }): Promise<{ affiliateId: number; amount: number }> {
  const done = await db.transaction(async (tx) => {
    const [payout] = await tx.select().from(affiliatePayouts).where(eq(affiliatePayouts.id, input.payoutId)).for("update")
    if (!payout || (input.affiliateId != null && payout.affiliateId !== input.affiliateId)) throw new Error("That payout no longer exists.")
    if (!payoutTransitionAllowed(payout.status, input.to)) throw new Error(`A ${payout.status} payout can't be marked ${input.to}.`)
    if (input.to === "failed" && !input.reason?.trim()) throw new Error("Say why the payout failed — the affiliate will see it.")

    const now = new Date()
    const amount = Number(payout.amount)
    await tx
      .update(affiliatePayouts)
      .set({
        status: input.to,
        processedBy: input.by ?? payout.processedBy,
        processedAt: input.to === "paid" || input.to === "failed" || input.to === "cancelled" ? now : payout.processedAt,
        failureReason: input.to === "failed" ? input.reason!.trim().slice(0, 300) : payout.failureReason,
        providerRef: input.providerRef?.trim().slice(0, 120) || payout.providerRef,
        note: input.note?.trim().slice(0, 300) || payout.note,
      })
      .where(eq(affiliatePayouts.id, payout.id))
    await tx
      .update(affiliateCommissions)
      .set({ status: payoutLedgerStatus(input.to), ...(input.to === "paid" ? { paidAt: now } : {}) })
      .where(and(eq(affiliateCommissions.payoutId, payout.id), eq(affiliateCommissions.type, "payout")))

    if (input.to === "paid") {
      const settle = settleFifo(await availableRows(payout.affiliateId, tx), amount)
      if (settle.length) await tx.update(affiliateCommissions).set({ status: "paid", paidAt: now, payoutId: payout.id }).where(inArray(affiliateCommissions.id, settle))
    }
    return { affiliateId: payout.affiliateId, amount, providerRef: payout.providerRef, provider: payout.provider }
  })

  if (input.to === "cancelled" && done.providerRef) await payoutProvider(done.provider).cancelPayout(done.providerRef).catch(() => false)
  const messages: Partial<Record<PayoutStatus, [string, string]>> = {
    processing: ["Payout processing", `Your payout of ${money(done.amount)} is being processed.`],
    paid: ["Payout paid", `Your payout of ${money(done.amount)} has been sent.`],
    failed: ["Payout failed", `Your payout of ${money(done.amount)} couldn't be sent: ${input.reason ?? ""} The amount is back in your available balance.`],
    cancelled: ["Payout cancelled", `Your payout of ${money(done.amount)} was cancelled. The amount is back in your available balance.`],
  }
  const msg = messages[input.to]
  // A failure always emails, whatever the preference: it needs action.
  if (msg) await notifyAffiliate({ affiliateId: done.affiliateId, type: "payout", title: msg[0], body: msg[1], href: "/affiliate/payouts", pref: input.to === "failed" ? undefined : "payout", email: true })
  return { affiliateId: done.affiliateId, amount: done.amount }
}
