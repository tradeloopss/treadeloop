"use server"

import { revalidatePath } from "next/cache"
import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliateAnnouncements, affiliateCampaigns, affiliateCoupons, affiliateFraudSignals, affiliatePayouts, affiliateResources, affiliateRules, affiliateTiers, affiliates } from "@/lib/db/schema"
import { assertAdmin } from "@/lib/admin/guard"
import { logAdminAction } from "@/lib/admin/audit"
import type { Permissions } from "@/lib/admin/access"
import { decideApplication, validateCode, type Decision } from "@/lib/affiliates/apply"
import { addLedgerEntry, approveCommission, releaseHolds, reverseCommission } from "@/lib/affiliates/commissions"
import { adminCreateCoupon, refreshPermanentCoupon, setCouponAccess, setCouponStatus, type CouponInput } from "@/lib/affiliates/coupons"
import { runAutoPayouts } from "@/lib/affiliates/auto-payouts"
import { adminPayoutAction, adminSetMethodStatus, revealPayoutDestination, setAffiliatePayoutControls, submitCryptoTransaction, trackPayout, type Actor, type AdminAction } from "@/lib/affiliates/payouts"
import { notifyAffiliate } from "@/lib/affiliates/notify"
import { getPayoutSettings, getProgram, saveProgram, savePayoutSettings } from "@/lib/affiliates/program"
import { exchangeReady, hotWalletReady, isAutoSender } from "@/lib/affiliates/providers"
import { ANNOUNCEMENT_CATEGORIES, RESOURCE_CATEGORIES } from "@/lib/affiliates/types"

// Admin side of the affiliate program. Every action re-checks the permission
// on the server and writes the existing admin audit log.

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string }

const MANAGE: Permissions = { affiliates: ["manage"] }

function describe(err: unknown): string {
  if (!(err instanceof Error)) return "Something went wrong"
  const cause = (err as { cause?: unknown }).cause
  return cause instanceof Error && err.message.startsWith("Failed query") ? `Database error: ${cause.message}` : err.message
}

async function run(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn()
    revalidatePath("/admin/affiliates", "layout")
    return { ok: true, ...(message ? { message } : {}) }
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
}

async function target(affiliateId: number) {
  const [aff] = await db.select().from(affiliates).where(eq(affiliates.id, Number(affiliateId)))
  if (!aff) throw new Error("That affiliate no longer exists.")
  return aff
}

const httpUrl = (v: unknown): string | null => {
  const raw = String(v ?? "").trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error()
    return u.toString()
  } catch {
    throw new Error("Links must be full http(s) addresses.")
  }
}

// --- Applications & standing ---------------------------------------------------

export async function reviewApplication(affiliateId: number, decision: Decision, reason = ""): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    if (!["approve", "reject", "review"].includes(decision)) throw new Error("Unknown decision.")
    const { userId, status } = await decideApplication(Number(affiliateId), decision, admin.id, String(reason ?? ""))
    await logAdminAction(admin, `affiliate.${decision}`, userId, { affiliateId, reason: reason || undefined })
    return status === "approved" ? "Application approved." : status === "rejected" ? "Application rejected." : "Marked as under review."
  })
}

// Suspending stops new clicks, attributions and commissions and blocks the
// portal; nothing already earned is touched — that takes a separate, explicit
// reversal or adjustment.
export async function setAffiliateStatus(affiliateId: number, status: "approved" | "suspended", reason = ""): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    const aff = await target(affiliateId)
    if (!["approved", "suspended"].includes(aff.status)) throw new Error("Decide the application first.")
    if (status !== "approved" && status !== "suspended") throw new Error("Unknown status.")
    await db.update(affiliates).set({ status, updatedAt: new Date() }).where(eq(affiliates.id, aff.id))
    await logAdminAction(admin, status === "suspended" ? "affiliate.suspend" : "affiliate.reinstate", aff.userId, { affiliateId: aff.id, reason: reason || undefined })
    if (status === "suspended") await notifyAffiliate({ affiliateId: aff.id, type: "account", title: "Your affiliate account was suspended", body: `Your affiliate account has been suspended.${reason ? `\n\n${String(reason).slice(0, 400)}` : ""}\n\nReply to this email or contact support if you think this is a mistake.`, email: true })
    else await releaseHolds({ affiliateId: aff.id })
    return status === "suspended" ? "Affiliate suspended." : "Affiliate reinstated."
  })
}

export async function setAffiliateFlags(affiliateId: number, flags: { payoutHold?: boolean; fraudLock?: boolean }): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    const aff = await target(affiliateId)
    const next = { payoutHold: typeof flags.payoutHold === "boolean" ? flags.payoutHold : aff.payoutHold, fraudLock: typeof flags.fraudLock === "boolean" ? flags.fraudLock : aff.fraudLock }
    await db.update(affiliates).set({ ...next, updatedAt: new Date() }).where(eq(affiliates.id, aff.id))
    await logAdminAction(admin, "affiliate.flags", aff.userId, { affiliateId: aff.id, ...next })
    if (aff.fraudLock && !next.fraudLock) await releaseHolds({ affiliateId: aff.id })
    return "Saved."
  })
}

export async function setAffiliateTier(affiliateId: number, tierId: number | null): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    const aff = await target(affiliateId)
    if (tierId != null) {
      const [tier] = await db.select({ id: affiliateTiers.id }).from(affiliateTiers).where(eq(affiliateTiers.id, Number(tierId)))
      if (!tier) throw new Error("That tier no longer exists.")
    }
    await db.update(affiliates).set({ tierId: tierId == null ? null : Number(tierId), updatedAt: new Date() }).where(eq(affiliates.id, aff.id))
    await logAdminAction(admin, "affiliate.tier", aff.userId, { affiliateId: aff.id, tierId })
    return tierId == null ? "Tier now follows paid customers." : "Tier set."
  })
}

export async function setAffiliateCode(affiliateId: number, code: string): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    const aff = await target(affiliateId)
    const clean = await validateCode(String(code), aff.id)
    await db.update(affiliates).set({ code: clean, updatedAt: new Date() }).where(eq(affiliates.id, aff.id))
    await logAdminAction(admin, "affiliate.code", aff.userId, { affiliateId: aff.id, from: aff.code, to: clean })
    return "Referral code changed. Links using the old code stop tracking."
  })
}

// --- Program rules, tiers, custom rules ----------------------------------------

export async function saveProgramSettings(input: Record<string, unknown>): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    const saved = await saveProgram(input)
    await logAdminAction(admin, "affiliate.program", null, saved)
    return "Program rules saved. They apply to payments from now on."
  })
}

export async function saveTier(input: { id?: number | null; name: string; minCustomers: number; ratePercent: number; enabled: boolean }): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    const name = String(input.name ?? "").trim().slice(0, 40)
    const minCustomers = Math.round(Number(input.minCustomers))
    const ratePercent = Number(input.ratePercent)
    if (name.length < 2) throw new Error("Give the tier a name.")
    if (!Number.isFinite(minCustomers) || minCustomers < 0) throw new Error("Paid customers must be 0 or more.")
    if (!Number.isFinite(ratePercent) || ratePercent <= 0 || ratePercent > 90) throw new Error("The rate must be between 0 and 90%.")
    const values = { name, minCustomers, ratePercent: String(ratePercent), sortOrder: minCustomers, enabled: input.enabled !== false }
    if (input.id) await db.update(affiliateTiers).set(values).where(eq(affiliateTiers.id, Number(input.id)))
    else await db.insert(affiliateTiers).values(values)
    await logAdminAction(admin, "affiliate.tier_save", null, { id: input.id ?? null, ...values })
    return "Tier saved."
  })
}

export async function deleteTier(id: number): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    await db.update(affiliates).set({ tierId: null }).where(eq(affiliates.tierId, Number(id)))
    await db.delete(affiliateTiers).where(eq(affiliateTiers.id, Number(id)))
    await logAdminAction(admin, "affiliate.tier_delete", null, { id })
    return "Tier deleted."
  })
}

export async function saveRule(input: { affiliateId: number; scope: string; campaignId?: number | null; couponId?: number | null; ratePercent: number; durationMonths?: number | null; startsAt?: string | null; endsAt?: string | null; note?: string }): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    const aff = await target(input.affiliateId)
    const scope = input.scope
    if (scope !== "affiliate" && scope !== "campaign" && scope !== "coupon") throw new Error("Choose what the rule applies to.")
    const ratePercent = Number(input.ratePercent)
    // A custom rule is a deliberate exception, so it may go all the way to 100%.
    if (!Number.isFinite(ratePercent) || ratePercent <= 0 || ratePercent > 100) throw new Error("The rate must be between 0 and 100%.")
    const durationMonths = input.durationMonths == null || (input.durationMonths as unknown) === "" ? null : Math.round(Number(input.durationMonths))
    if (durationMonths != null && (!Number.isFinite(durationMonths) || durationMonths < 1 || durationMonths > 240)) throw new Error("Duration must be 1–240 months, or empty to follow the program.")
    const date = (v: string | null | undefined) => {
      if (!v) return null
      const d = new Date(v)
      if (Number.isNaN(d.getTime())) throw new Error("That date isn't valid.")
      return d
    }
    const startsAt = date(input.startsAt)
    const endsAt = date(input.endsAt)
    if (startsAt && endsAt && endsAt <= startsAt) throw new Error("The end date must be after the start date.")

    // A rule may only point at this affiliate's own campaign / coupon.
    let campaignId: number | null = null
    let couponId: number | null = null
    if (scope === "campaign") {
      const [c] = await db.select({ id: affiliateCampaigns.id }).from(affiliateCampaigns).where(and(eq(affiliateCampaigns.id, Number(input.campaignId)), eq(affiliateCampaigns.affiliateId, aff.id)))
      if (!c) throw new Error("Choose one of this affiliate's campaigns.")
      campaignId = c.id
    }
    if (scope === "coupon") {
      const [c] = await db.select({ id: affiliateCoupons.id }).from(affiliateCoupons).where(and(eq(affiliateCoupons.id, Number(input.couponId)), eq(affiliateCoupons.affiliateId, aff.id)))
      if (!c) throw new Error("Choose one of this affiliate's coupons.")
      couponId = c.id
    }
    const [row] = await db
      .insert(affiliateRules)
      .values({ scope, affiliateId: aff.id, campaignId, couponId, ratePercent: String(ratePercent), durationMonths, startsAt, endsAt, note: String(input.note ?? "").trim().slice(0, 200) || null, createdBy: admin.id })
      .returning({ id: affiliateRules.id })
    await logAdminAction(admin, "affiliate.rule_save", aff.userId, { ruleId: row.id, affiliateId: aff.id, scope, ratePercent, durationMonths })
    return "Rule added. It applies to payments from now on."
  })
}

export async function setRuleEnabled(id: number, enabled: boolean): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    await db.update(affiliateRules).set({ enabled: !!enabled }).where(eq(affiliateRules.id, Number(id)))
    await logAdminAction(admin, "affiliate.rule_toggle", null, { ruleId: id, enabled: !!enabled })
    return enabled ? "Rule enabled." : "Rule disabled."
  })
}

export async function deleteRule(id: number): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    await db.delete(affiliateRules).where(eq(affiliateRules.id, Number(id)))
    await logAdminAction(admin, "affiliate.rule_delete", null, { ruleId: id })
    return "Rule deleted."
  })
}

// --- Ledger ----------------------------------------------------------------------

export async function adjustBalance(input: { affiliateId: number; type: "bonus" | "adjustment"; amount: number; note: string; key: string }): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    const aff = await target(input.affiliateId)
    const type = input.type === "bonus" ? "bonus" : "adjustment"
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(input.key))) throw new Error("Reload the page and try again.")
    await addLedgerEntry({ affiliateId: aff.id, type, amount: Number(input.amount), note: String(input.note ?? ""), adminId: admin.id, key: `${aff.id}:${input.key}` })
    await logAdminAction(admin, "affiliate.adjust", aff.userId, { affiliateId: aff.id, type, amount: Number(input.amount), note: input.note })
    return "Ledger entry added."
  })
}

export async function approveCommissionEarly(commissionId: number): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    const { affiliateId } = await approveCommission(Number(commissionId))
    await logAdminAction(admin, "affiliate.commission_approve", null, { commissionId, affiliateId })
    return "Commission approved."
  })
}

export async function reverseCommissionManually(commissionId: number, note: string): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    if (!String(note ?? "").trim()) throw new Error("Say why this commission is being reversed.")
    const { affiliateId, amount } = await reverseCommission(Number(commissionId), admin.id, String(note).trim().slice(0, 300))
    await logAdminAction(admin, "affiliate.commission_reverse", null, { commissionId, affiliateId, amount, note })
    await notifyAffiliate({ affiliateId, type: "reversal", title: "Commission reversed", body: `A commission was reversed: ${String(note).trim().slice(0, 200)}`, href: "/affiliate/earnings", pref: "commission", email: true })
    return "Commission reversed."
  })
}

// --- Payouts ---------------------------------------------------------------------

const ACTIONS: AdminAction[] = ["approve", "reject", "hold", "release", "cancel", "start", "mark_paid", "fail", "retry", "reverse", "send_auto"]
const DONE: Record<AdminAction, string> = {
  approve: "Payout approved.",
  reject: "Payout rejected. The amount is back in the affiliate's balance.",
  hold: "Payout placed on hold.",
  release: "Hold released.",
  cancel: "Payout cancelled. The amount is back in the affiliate's balance.",
  start: "Marked as processing.",
  mark_paid: "Payout marked as paid.",
  fail: "Payout marked as failed. The amount is back in the affiliate's balance.",
  retry: "Payout queued again.",
  reverse: "Payout reversed. The amount is back in the affiliate's balance.",
  send_auto: "Sent. It completes when the network confirms it.",
}

const adminActor = (admin: { id: string }): Actor => ({ type: "admin", id: admin.id })

// Every admin move on a payout. What is allowed in which state is decided by
// lib/affiliates/payouts.adminPayoutAction — this only checks the permission
// and writes the audit log.
export async function payoutAction(input: { payoutId: number; action: AdminAction; reason?: string; reference?: string }): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    if (!ACTIONS.includes(input.action)) throw new Error("Unknown action.")
    const payout = await adminPayoutAction(Number(input.payoutId), input.action, adminActor(admin), { reason: input.reason, reference: input.reference })
    const aff = await target(payout.affiliateId)
    await logAdminAction(admin, `affiliate.payout_${input.action}`, aff.userId, { payoutId: payout.id, amount: Number(payout.amount), status: payout.status, reason: input.reason || undefined, reference: input.reference || undefined })
    if (payout.status === "retry_required") return `It couldn't be sent: ${payout.failureReason ?? "unknown error"}`
    // Handed to the payout wallet but not sent yet (it is short of USDT or TRX, or the fee is over the limit).
    if (isAutoSender(payout.provider) && payout.status === "queued" && payout.failureReason) return `Queued — ${payout.failureReason} It is sent automatically once that is resolved.`
    if (isAutoSender(payout.provider) && ["processing", "submitted"].includes(payout.status) && ["retry", "approve", "release"].includes(input.action)) return DONE.send_auto
    return DONE[input.action]
  })
}

// The hash of the USDT transfer an admin sent. The chain decides what happens
// next — see submitCryptoTransaction.
export async function submitPayoutTransaction(payoutId: number, hash: string): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    const payout = await submitCryptoTransaction(Number(payoutId), String(hash ?? ""), adminActor(admin))
    const aff = await target(payout.affiliateId)
    await logAdminAction(admin, "affiliate.payout_transaction", aff.userId, { payoutId: payout.id, transactionHash: payout.transactionHash, status: payout.status })
    return payout.status === "paid" ? "Confirmed on-chain. Payout completed." : payout.status === "confirming" ? "Found on-chain — waiting for final confirmation." : "Transaction recorded. It isn't visible on the network yet; it will be checked again automatically."
  })
}

export async function checkPayout(payoutId: number): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    const payout = await trackPayout(Number(payoutId), adminActor(admin))
    if (!payout) throw new Error("That payout no longer exists.")
    return payout.status === "paid" ? "Confirmed on-chain. Payout completed." : payout.status === "retry_required" ? `Needs attention: ${payout.failureReason ?? ""}` : `Still ${payout.status}.`
  })
}

// The decrypted account a payout should be sent to. Shown on demand only, and
// every look is in the audit log.
export async function revealPayoutAccount(payoutId: number): Promise<{ ok: true; type: string; details: Record<string, string>; metadata: Record<string, string>; net: number; asset: string | null } | { ok: false; error: string }> {
  try {
    const admin = await assertAdmin(MANAGE)
    const [payout] = await db.select({ id: affiliatePayouts.id, affiliateId: affiliatePayouts.affiliateId }).from(affiliatePayouts).where(eq(affiliatePayouts.id, Number(payoutId)))
    if (!payout) throw new Error("That payout no longer exists.")
    const account = await revealPayoutDestination(payout.id)
    if (!account) throw new Error("The account details couldn't be read.")
    const aff = await target(payout.affiliateId)
    await logAdminAction(admin, "affiliate.payout_reveal", aff.userId, { payoutId: payout.id })
    return { ok: true, type: account.type, details: account.details, metadata: account.metadata, net: account.net, asset: account.asset }
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
}

// Program-wide payout settings (not the pause — that has its own action so it
// can't be flipped by accident while editing a limit).
export async function savePayoutConfig(input: Record<string, unknown>): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    const before = await getPayoutSettings()
    const minPayout = Number(input.minPayout)
    if (!Number.isFinite(minPayout) || minPayout < 1) throw new Error("The minimum payout must be at least $1.")
    if (input.maxPayout != null && input.maxPayout !== "" && Number(input.maxPayout) < minPayout) throw new Error("The maximum payout can't be below the minimum.")
    // Automatic sending can only be switched on while there is a wallet to send from.
    const sendOn = input.cryptoAutoSend === true
    if (sendOn && !before.cryptoAutoSend && !exchangeReady() && !hotWalletReady()) throw new Error("Automatic crypto sending needs the KuCoin account or the payout wallet to be connected first.")
    if (sendOn && Number(input.cryptoAutoDaily) < Number(input.cryptoAutoMax)) throw new Error("The daily limit for automatic sending can't be below the per-payout limit.")
    const saved = await savePayoutSettings({ ...input, paused: before.paused })
    const program = await getProgram()
    if (program.minPayout !== minPayout) await saveProgram({ ...program, minPayout })
    if (saved.cryptoAutoSend !== before.cryptoAutoSend) await logAdminAction(admin, saved.cryptoAutoSend ? "affiliate.crypto_auto_send_on" : "affiliate.crypto_auto_send_off", null, { perPayout: saved.cryptoAutoMax, perDay: saved.cryptoAutoDaily, feeLimitTrx: saved.cryptoFeeLimitTrx })
    await logAdminAction(admin, saved.autoPayouts !== before.autoPayouts ? (saved.autoPayouts ? "affiliate.auto_payouts_on" : "affiliate.auto_payouts_off") : "affiliate.payout_settings", null, { previous: { ...before, minPayout: program.minPayout }, next: { ...saved, minPayout } })
    if (saved.cryptoAutoSend !== before.cryptoAutoSend && saved.autoPayouts === before.autoPayouts) {
      return saved.cryptoAutoSend ? `Saved. Crypto payouts up to $${saved.cryptoAutoMax.toFixed(2)} are now sent automatically.` : "Saved. Automatic crypto sending is OFF — payouts already on their way keep being tracked; the rest wait for you."
    }
    return saved.autoPayouts !== before.autoPayouts ? (saved.autoPayouts ? "Saved. Automatic payouts are ON — each payout still passes every eligibility check." : "Saved. Automatic payouts are OFF. Balances and each affiliate's own setting are unchanged.") : "Payout settings saved."
  })
}

// PAUSE ALL PAYOUTS. Stops new payouts being created or sent; payouts already
// submitted keep being tracked, and nothing is cancelled.
export async function setPayoutPause(paused: boolean, reason = ""): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    const before = await getPayoutSettings()
    await savePayoutSettings({ ...before, paused: paused === true })
    await logAdminAction(admin, paused ? "affiliate.payout_pause" : "affiliate.payout_resume", null, { reason: reason || undefined })
    return paused ? "All payouts are paused. Nothing new will be sent until you resume." : "Payouts resumed. Nothing is sent in bulk — each payout goes through the normal checks."
  })
}

export async function runAutoPayoutsNow(): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    const result = await runAutoPayouts()
    await logAdminAction(admin, "affiliate.auto_payouts_run", null, result)
    if (result.halted) return result.halted === "paused" ? "Nothing ran: all payouts are paused." : "Nothing ran: automatic payouts are switched off."
    const skipped = Object.values(result.skipped).reduce((a, b) => a + (b ?? 0), 0)
    return `${result.created} payout${result.created === 1 ? "" : "s"} created, ${skipped} affiliate${skipped === 1 ? "" : "s"} not eligible${result.errors ? `, ${result.errors} error${result.errors === 1 ? "" : "s"}` : ""}.`
  })
}

// Per-affiliate payout controls. Disabling automatic payouts here is what the
// worker checks, under lock, immediately before it would create a payout.
export async function setPayoutControls(affiliateId: number, input: { autoPayoutAllowed?: boolean; manualPayoutAllowed?: boolean; minPayoutOverride?: number | null; maxPayoutOverride?: number | null }, reason = ""): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    const result = await setAffiliatePayoutControls(Number(affiliateId), input, adminActor(admin), String(reason ?? ""))
    const action = typeof input.autoPayoutAllowed === "boolean" ? (input.autoPayoutAllowed ? "affiliate.auto_payout_enable" : "affiliate.auto_payout_disable") : "affiliate.payout_controls"
    await logAdminAction(admin, action, result.userId, { affiliateId, previous: result.previous, next: result.next, reason: reason || undefined })
    return typeof input.autoPayoutAllowed === "boolean" ? (input.autoPayoutAllowed ? "Automatic payouts enabled for this affiliate." : "Automatic payouts disabled for this affiliate. Nothing else changed.") : "Payout controls saved."
  })
}

export async function setPayoutMethodStatus(methodId: number, status: "active" | "rejected" | "verification_required", reason = ""): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    if (!["active", "rejected", "verification_required"].includes(status)) throw new Error("Unknown status.")
    const { affiliateId } = await adminSetMethodStatus(Number(methodId), status, adminActor(admin), String(reason ?? ""))
    const aff = await target(affiliateId)
    await logAdminAction(admin, "affiliate.payout_method", aff.userId, { methodId, status, reason: reason || undefined })
    return status === "active" ? "Payout method restored." : status === "rejected" ? "Payout method rejected." : "Marked as needing verification."
  })
}

// --- Risk ------------------------------------------------------------------------

export async function resolveSignal(id: number, status: "reviewing" | "cleared" | "actioned"): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    if (!["reviewing", "cleared", "actioned"].includes(status)) throw new Error("Unknown status.")
    const done = status !== "reviewing"
    const [row] = await db
      .update(affiliateFraudSignals)
      .set({ status, resolvedBy: done ? admin.id : null, resolvedAt: done ? new Date() : null })
      .where(eq(affiliateFraudSignals.id, Number(id)))
      .returning({ affiliateId: affiliateFraudSignals.affiliateId, type: affiliateFraudSignals.type })
    if (!row) throw new Error("That signal no longer exists.")
    await logAdminAction(admin, "affiliate.signal", null, { signalId: id, status, ...row })
    return status === "cleared" ? "Signal cleared." : status === "actioned" ? "Signal marked as actioned." : "Signal marked as under review."
  })
}

export async function disableAffiliateCoupon(couponId: number): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    await setCouponStatus(null, Number(couponId), "disabled")
    await logAdminAction(admin, "affiliate.coupon_disable", null, { couponId })
    return "Coupon disabled."
  })
}

export async function enableAffiliateCoupon(couponId: number): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    await setCouponStatus(null, Number(couponId), "active")
    await logAdminAction(admin, "affiliate.coupon_enable", null, { couponId })
    return "Coupon enabled. It works at checkout again."
  })
}

// Opens or closes the Coupons section of one affiliate's portal, and sets the
// largest discount they may offer there.
export async function setAffiliateCouponAccess(affiliateId: number, input: { couponsEnabled?: boolean; maxCouponPercent?: number | null }): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    const result = await setCouponAccess(Number(affiliateId), { couponsEnabled: typeof input.couponsEnabled === "boolean" ? input.couponsEnabled : undefined, maxCouponPercent: input.maxCouponPercent === undefined ? undefined : input.maxCouponPercent })
    await logAdminAction(admin, "affiliate.coupon_access", result.userId, { affiliateId, previous: result.previous, next: result.next })
    if (typeof input.couponsEnabled === "boolean") return input.couponsEnabled ? "Coupons section opened for this affiliate." : "Coupons section closed for this affiliate. Their existing codes keep working."
    return "Discount limit saved."
  })
}

// Generates a coupon for one affiliate: any discount, the code typed in or made up.
export async function generateAffiliateCoupon(affiliateId: number, input: CouponInput): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    const aff = await target(affiliateId)
    const { code } = await adminCreateCoupon(aff.id, input, admin.id)
    await logAdminAction(admin, "affiliate.coupon_generate", aff.userId, { affiliateId: aff.id, code, percent: Number(input.percent), durationMonths: Number(input.durationMonths) })
    return `Coupon ${code} created. It works at checkout right away.`
  })
}

// Creates the affiliate's permanent code if they don't have one, or brings it
// in line with the program's current discount.
export async function refreshAffiliatePermanentCoupon(affiliateId: number): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    const aff = await target(affiliateId)
    const coupon = await refreshPermanentCoupon(aff.id)
    if (!coupon) throw new Error("The permanent code couldn't be created. The affiliate has to be approved and set up, and permanent codes switched on in the program rules.")
    await logAdminAction(admin, "affiliate.coupon_permanent", aff.userId, { affiliateId: aff.id, code: coupon.code, percent: Number(coupon.discountValue) })
    return `Permanent code ${coupon.code} is live at ${Number(coupon.discountValue)}% off.`
  })
}

// --- Resources & announcements -----------------------------------------------------

export async function saveResource(input: { id?: number | null; title: string; description?: string; category: string; url?: string; previewUrl?: string; content?: string; published: boolean; sortOrder?: number }): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    const title = String(input.title ?? "").trim().slice(0, 100)
    if (title.length < 2) throw new Error("Give the resource a title.")
    if (!(RESOURCE_CATEGORIES as readonly string[]).includes(input.category)) throw new Error("Choose a category.")
    const url = httpUrl(input.url)
    const content = String(input.content ?? "").trim().slice(0, 5000) || null
    if (!url && !content) throw new Error("Add a file link or some copy text.")
    const values = { title, description: String(input.description ?? "").trim().slice(0, 300) || null, category: input.category, url, previewUrl: httpUrl(input.previewUrl), content, published: input.published !== false, sortOrder: Math.round(Number(input.sortOrder ?? 0)) || 0, updatedAt: new Date() }
    if (input.id) await db.update(affiliateResources).set(values).where(eq(affiliateResources.id, Number(input.id)))
    else await db.insert(affiliateResources).values({ ...values, createdBy: admin.id })
    await logAdminAction(admin, "affiliate.resource_save", null, { id: input.id ?? null, title })
    return "Resource saved."
  })
}

export async function deleteResource(id: number): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    await db.delete(affiliateResources).where(eq(affiliateResources.id, Number(id)))
    await logAdminAction(admin, "affiliate.resource_delete", null, { id })
    return "Resource deleted."
  })
}

export async function saveAnnouncement(input: { id?: number | null; title: string; category: string; summary?: string; content: string; published: boolean }): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    const title = String(input.title ?? "").trim().slice(0, 120)
    const content = String(input.content ?? "").trim().slice(0, 8000)
    if (title.length < 3) throw new Error("Give the announcement a title.")
    if (content.length < 10) throw new Error("Write the announcement.")
    const category = (ANNOUNCEMENT_CATEGORIES as readonly string[]).includes(input.category) ? input.category : "update"
    const summary = String(input.summary ?? "").trim().slice(0, 240) || null
    const publish = input.published === true
    const now = new Date()

    let id = input.id ? Number(input.id) : null
    let firstPublish = publish
    if (id) {
      const [existing] = await db.select().from(affiliateAnnouncements).where(eq(affiliateAnnouncements.id, id))
      if (!existing) throw new Error("That announcement no longer exists.")
      firstPublish = publish && !existing.publishedAt
      await db.update(affiliateAnnouncements).set({ title, category, summary, content, published: publish, publishedAt: existing.publishedAt ?? (publish ? now : null), updatedAt: now }).where(eq(affiliateAnnouncements.id, id))
    } else {
      const [row] = await db.insert(affiliateAnnouncements).values({ title, category, summary, content, published: publish, publishedAt: publish ? now : null, createdBy: admin.id }).returning({ id: affiliateAnnouncements.id })
      id = row.id
    }
    await logAdminAction(admin, "affiliate.announcement_save", null, { id, title, published: publish })

    // The first time it goes live, every active affiliate hears about it
    // (in the portal, and by email if they kept announcements switched on).
    if (firstPublish) {
      const rows = await db.select({ id: affiliates.id }).from(affiliates).where(and(eq(affiliates.status, "approved"), sql`${affiliates.onboardedAt} is not null`))
      for (const a of rows) await notifyAffiliate({ affiliateId: a.id, type: "announcement", title, body: summary ?? content.slice(0, 240), href: "/affiliate/announcements", pref: "announcements", email: true })
      return `Announcement published to ${rows.length} affiliate${rows.length === 1 ? "" : "s"}.`
    }
    return publish ? "Announcement saved." : "Draft saved."
  })
}

export async function deleteAnnouncement(id: number): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    await db.delete(affiliateAnnouncements).where(eq(affiliateAnnouncements.id, Number(id)))
    await logAdminAction(admin, "affiliate.announcement_delete", null, { id })
    return "Announcement deleted."
  })
}

// Used by list pages that act on several rows at once.
export async function bulkReview(ids: number[], decision: "approve" | "reject"): Promise<ActionResult> {
  return run(async () => {
    const admin = await assertAdmin(MANAGE)
    const clean = [...new Set((ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 50)
    if (!clean.length) throw new Error("Select at least one application.")
    const rows = await db.select({ id: affiliates.id }).from(affiliates).where(and(inArray(affiliates.id, clean), inArray(affiliates.status, ["pending", "review"])))
    for (const r of rows) {
      const { userId } = await decideApplication(r.id, decision, admin.id, "")
      await logAdminAction(admin, `affiliate.${decision}`, userId, { affiliateId: r.id, bulk: true })
    }
    return `${rows.length} application${rows.length === 1 ? "" : "s"} ${decision === "approve" ? "approved" : "rejected"}.`
  })
}
