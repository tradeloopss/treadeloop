"use server"

import { cookies, headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliateAnnouncementReads, affiliateAnnouncements, affiliateNotifications, supportMessages, supportTickets } from "@/lib/db/schema"
import { assertAffiliate, getSessionUser } from "@/lib/affiliates/guard"
import { userHasPerk } from "@/lib/affiliates/perk-access"
import { completeOnboarding, submitApplication, updateNotificationPrefs, updateProfile, type ApplicationInput } from "@/lib/affiliates/apply"
import { claimAttribution } from "@/lib/affiliates/attribution"
import { createCampaign, createLink, setCampaignStatus, setLinkStatus, updateCampaign, type CampaignInput } from "@/lib/affiliates/campaigns"
import { addPayoutMethod, cancelOwnPayout, removePayoutMethod, renameMethod, requestAlreadyMade, requestPayout, setAutoPayout, setDefaultMethod, setMethodEnabled, startStripeOnboarding, type Actor } from "@/lib/affiliates/payouts"
import { payoutMethodsFor, payoutsFor, referralDetail, type ReferralDetail } from "@/lib/affiliates/queries"
import { CODE_TTL_MS, methodSubject, payoutSubject, type CodeChannel, type CodePurpose } from "@/lib/affiliates/action-code-rules"
import { claimCode, discardCode, issueCode, releaseCode } from "@/lib/affiliates/action-codes"
import { cryptoSpec } from "@/lib/affiliates/crypto"
import { maskEmail } from "@/lib/affiliates/engine"
import { getPayoutSettings } from "@/lib/affiliates/program"
import { appChecker, codeChannel } from "@/lib/affiliates/two-factor"
import { PAYOUT_METHOD_TYPES, methodLabel, money } from "@/lib/affiliates/types"
import { verificationCode } from "@/lib/emails/affiliate-emails"
import { deliverNow } from "@/lib/emails/outbox"
import { ATTRIBUTION_COOKIE, attributionCookieDomain } from "@/lib/affiliates/token"

// Everything an affiliate (or applicant) can do. The acting affiliate always
// comes from the session (assertAffiliate) — never from an argument — and the
// arguments are treated as untrusted input by the services they're passed to.

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string }

function describe(err: unknown): string {
  if (!(err instanceof Error)) return "Something went wrong. Try again."
  const cause = (err as { cause?: unknown }).cause
  return cause instanceof Error && err.message.startsWith("Failed query") ? "Something went wrong saving that. Try again." : err.message
}

async function run(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn()
    revalidatePath("/affiliate", "layout")
    return { ok: true, ...(message ? { message } : {}) }
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
}

// --- Application & onboarding -------------------------------------------------

export async function applyToProgram(input: ApplicationInput): Promise<ActionResult> {
  return run(async () => {
    const user = await getSessionUser()
    if (!user) throw new Error("Sign in to apply.")
    if (user.impersonating) throw new Error("You can't apply while logged in as another user.")
    const { status } = await submitApplication({ id: user.id, email: user.email }, input)
    return status === "approved" ? "You're in! Let's set up your account." : "Application received. We'll email you once it's reviewed."
  })
}

export async function finishOnboarding(input: { code: string; acceptTerms: boolean }): Promise<ActionResult> {
  return run(async () => {
    const { affiliate } = await assertAffiliate()
    await completeOnboarding(affiliate.id, input)
  })
}

// Called once by <AffiliateClaim/> right after sign-up: ties the new account
// to the affiliate in the signed cookie, then clears the cookie either way.
export async function claimReferral(): Promise<void> {
  try {
    const jar = await cookies()
    const token = jar.get(ATTRIBUTION_COOKIE)?.value
    if (!token) return
    const user = await getSessionUser()
    if (!user || user.impersonating) return
    const h = await headers()
    await claimAttribution(user.id, token, { country: h.get("x-vercel-ip-country"), userAgent: h.get("user-agent") })
    const domain = attributionCookieDomain(h.get("host"))
    jar.set(ATTRIBUTION_COOKIE, "", { path: "/", maxAge: 0, ...(domain ? { domain } : {}) })
  } catch (e) {
    console.error("[affiliates] claim failed:", e instanceof Error ? e.message : e)
  }
}

// --- Campaigns, links, coupons -------------------------------------------------

export async function saveCampaign(id: number | null, input: CampaignInput): Promise<ActionResult> {
  return run(async () => {
    const { affiliate } = await assertAffiliate()
    if (id == null) await createCampaign(affiliate.id, input)
    else await updateCampaign(affiliate.id, Number(id), input)
    return id == null ? "Campaign created." : "Campaign saved."
  })
}

export async function changeCampaignStatus(id: number, status: "active" | "archived"): Promise<ActionResult> {
  return run(async () => {
    const { affiliate } = await assertAffiliate()
    await setCampaignStatus(affiliate.id, Number(id), status === "archived" ? "archived" : "active")
    return status === "archived" ? "Campaign archived." : "Campaign restored."
  })
}

export async function addLink(input: { campaignId?: number | null; landingPage: string }): Promise<ActionResult> {
  return run(async () => {
    const { affiliate } = await assertAffiliate()
    await createLink(affiliate.id, input)
    return "Link created."
  })
}

export async function changeLinkStatus(id: number, status: "active" | "disabled"): Promise<ActionResult> {
  return run(async () => {
    const { affiliate } = await assertAffiliate()
    await setLinkStatus(affiliate.id, Number(id), status === "disabled" ? "disabled" : "active")
    return status === "disabled" ? "Link disabled." : "Link enabled."
  })
}

// --- Referral detail (drawer) --------------------------------------------------

export async function loadReferral(publicId: string): Promise<{ ok: true; referral: ReferralDetail } | { ok: false; error: string }> {
  try {
    const { affiliate } = await assertAffiliate()
    const referral = await referralDetail(affiliate.id, String(publicId).slice(0, 24))
    return referral ? { ok: true, referral } : { ok: false, error: "That referral wasn't found." }
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
}

// --- Payouts -------------------------------------------------------------------
// Anything that changes where money goes, or moves it, is refused inside an
// admin's "log in as user" session: support can look, not redirect a payout.

type PayoutActor = { affiliateId: number; actor: Actor; affiliate: Awaited<ReturnType<typeof assertAffiliate>>["affiliate"]; user: Awaited<ReturnType<typeof assertAffiliate>>["user"] }

async function payoutActor(): Promise<PayoutActor> {
  const { affiliate, user } = await assertAffiliate()
  if (user.impersonating) throw new Error("Payout settings can't be changed while logged in as another user.")
  return { affiliateId: affiliate.id, actor: { type: "affiliate", id: user.id }, affiliate, user }
}

// --- Verification codes ----------------------------------------------------------
// Confirming a payout and adding a payout method each need a 6-digit code: the
// authenticator app's when the account has two-factor sign-in on, otherwise one
// emailed to the affiliate. It is checked HERE, in the action that does the
// thing — a browser that skips the code screen is simply refused.

export type CodeRequest = { purpose: "payout"; amount: number; methodId: number; resend?: boolean } | { purpose: "method"; type: string; resend?: boolean }
export type SendCodeResult =
  | { ok: true; required: false }
  | { ok: true; required: true; channel: CodeChannel; sentTo: string | null; expiresInSeconds: number; resendInSeconds: number }
  | { ok: false; error: string }

// Starts the verification for one specific thing (this amount to this method;
// adding this kind of method). Emails the code when the account has no
// authenticator. Asking again for the same thing while its code is still good
// sends nothing new — `resend` asks for a fresh one.
export async function sendActionCode(input: CodeRequest): Promise<SendCodeResult> {
  try {
    const { affiliateId, affiliate, user } = await payoutActor()
    if (!(await getPayoutSettings()).confirmCode) return { ok: true, required: false }
    let subject: string
    let facts: { purpose: CodePurpose; amount?: string; method: string; destination?: string }
    if (input.purpose === "payout") {
      const amount = Number(input.amount)
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount first.")
      const method = (await payoutMethodsFor(affiliateId)).find((m) => m.id === Number(input.methodId))
      if (!method) throw new Error("That payout method no longer exists.")
      const coin = cryptoSpec(method.type)
      subject = payoutSubject(method.id, amount)
      facts = { purpose: "payout", amount: money(amount), method: coin ? `${coin.asset} · ${coin.networkLabel}` : methodLabel(method.type), destination: method.label }
    } else {
      const type = String(input.type)
      if (!(PAYOUT_METHOD_TYPES as readonly string[]).includes(type)) throw new Error("That payout method isn't available.")
      subject = methodSubject(type)
      facts = { purpose: "method", method: cryptoSpec(type)?.title ?? methodLabel(type) }
    }
    const channel = await codeChannel(user)
    const now = new Date()
    const issued = await issueCode({ affiliateId, purpose: input.purpose, subject, channel, force: input.resend === true, now })
    if (issued.code) {
      const sent = await deliverNow({ key: `action_code:${issued.id}`, to: affiliate.email, affiliateId, doc: verificationCode({ firstName: affiliate.firstName, code: issued.code, minutes: CODE_TTL_MS / 60_000, ...facts }) })
      if (sent !== "sent") {
        await discardCode(issued.id)
        return { ok: false, error: "We couldn't send your verification code right now. Please try again in a moment." }
      }
    }
    const left = (until: Date) => Math.max(0, Math.ceil((until.getTime() - now.getTime()) / 1000))
    return { ok: true, required: true, channel, sentTo: channel === "email" ? maskEmail(affiliate.email) : null, expiresInSeconds: left(issued.expiresAt), resendInSeconds: channel === "email" ? left(issued.resendAt) : 0 }
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
}

// Runs `act` only with a right code for exactly this thing. The code is spent
// before `act` starts (one code, one use) and handed back if `act` is refused —
// nothing happened, so the affiliate can put it right and confirm again.
async function withCode<T>(who: PayoutActor, purpose: CodePurpose, subject: string, code: unknown, act: () => Promise<T>): Promise<T> {
  if (!(await getPayoutSettings()).confirmCode) return act()
  const claimed = await claimCode({ affiliateId: who.affiliateId, purpose, subject, code, checkApp: appChecker(who.user.id) })
  try {
    return await act()
  } catch (err) {
    await releaseCode(claimed.id).catch(() => null)
    throw err
  }
}

export async function savePayoutMethod(type: string, details: Record<string, unknown>, code?: string): Promise<ActionResult> {
  return run(async () => {
    const who = await payoutActor()
    const { holdUntil } = await withCode(who, "method", methodSubject(String(type)), code, () => addPayoutMethod(who.affiliateId, String(type), details ?? {}, who.actor))
    return holdUntil ? "Payout method added. For your security it can be paid to after a short hold." : "Payout method added."
  })
}

export async function renamePayoutMethod(id: number, nickname: string): Promise<ActionResult> {
  return run(async () => {
    const { affiliateId, actor } = await payoutActor()
    await renameMethod(affiliateId, Number(id), String(nickname ?? ""), actor)
    return "Saved."
  })
}

export async function deletePayoutMethod(id: number): Promise<ActionResult> {
  return run(async () => {
    const { affiliateId, actor } = await payoutActor()
    await removePayoutMethod(affiliateId, Number(id), actor)
    return "Payout method removed."
  })
}

export async function makeDefaultPayoutMethod(id: number): Promise<ActionResult> {
  return run(async () => {
    const { affiliateId, actor } = await payoutActor()
    await setDefaultMethod(affiliateId, Number(id), actor)
    return "Default payout method updated."
  })
}

export async function togglePayoutMethod(id: number, enabled: boolean): Promise<ActionResult> {
  return run(async () => {
    const { affiliateId, actor } = await payoutActor()
    await setMethodEnabled(affiliateId, Number(id), enabled === true, actor)
    return enabled ? "Payout method enabled." : "Payout method disabled."
  })
}

// Stripe collects the bank details on its own pages; this returns the link there.
// Whoever holds that link can enter the bank account the payouts will go to, so
// it is behind the verification code like any other way of adding a method.
export async function connectStripe(code?: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const who = await payoutActor()
    const { affiliate, actor } = who
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")
    if (!base.startsWith("https://")) throw new Error("Stripe onboarding needs the app's public https address to be configured.")
    const url = await withCode(who, "method", methodSubject("stripe"), code, () => startStripeOnboarding({ id: affiliate.id, email: affiliate.email, country: affiliate.country }, `${base}/affiliate/payouts?stripe=return`, actor))
    revalidatePath("/affiliate", "layout")
    return { ok: true, url }
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
}

// The affiliate's own automatic-payout switch and threshold. The worker also
// requires the program-wide switch and the admin's per-affiliate one.
export async function saveAutoPayout(input: { enabled: boolean; threshold: number | null }): Promise<ActionResult> {
  return run(async () => {
    const { affiliateId, actor } = await payoutActor()
    await setAutoPayout(affiliateId, { enabled: input.enabled === true, threshold: input.threshold == null || (input.threshold as unknown) === "" ? null : Number(input.threshold) }, actor)
    return input.enabled ? "Automatic payouts are on." : "Automatic payouts are off."
  })
}

// What the request window shows once a payout exists — as the server stored
// it, not as the browser asked for it.
export type RequestedPayout = { id: number; amount: number; fee: number; net: number; status: string; sending: boolean; methodType: string; methodLabel: string; network: string | null; asset: string | null }

// `key` is generated when the request dialog opens: a double-click or a retry
// with the same key returns the payout that was already created. The amount,
// the fee, the eligibility and the destination are all decided on the server
// (payouts.createPayout); nothing the browser says about them is trusted.
// `code` is the verification code asked for exactly this amount to this method.
export async function requestPayoutNow(input: { amount: number; methodId: number; key: string; code?: string }): Promise<{ ok: true; payout: RequestedPayout } | { ok: false; error: string }> {
  try {
    const who = await payoutActor()
    const { affiliateId, actor } = who
    const amount = Number(input.amount)
    const methodId = Number(input.methodId)
    const key = String(input.key)
    const make = () => requestPayout({ affiliateId, amount, methodId, idempotencyKey: key, actor })
    // A retry of a request that already went through creates nothing — it is
    // answered with the payout that exists, and needs no code.
    const result = (await requestAlreadyMade(affiliateId, key)) ? await make() : await withCode(who, "payout", payoutSubject(methodId, Number.isFinite(amount) ? amount : 0), input.code, make)
    const [p] = (await payoutsFor(affiliateId)).filter((row) => row.id === result.id)
    revalidatePath("/affiliate", "layout")
    if (!p) return { ok: false, error: "Your payout was requested, but it couldn't be shown. Refresh the page to see it." }
    return { ok: true, payout: { id: p.id, amount: p.amount, fee: p.fee, net: p.net, status: p.status, sending: result.sending, methodType: p.methodType, methodLabel: p.methodLabel, network: p.network, asset: p.asset } }
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
}

export async function cancelPayoutRequest(id: number): Promise<ActionResult> {
  return run(async () => {
    const { affiliateId, actor } = await payoutActor()
    // Only while it is still waiting for approval, and only their own.
    await cancelOwnPayout(affiliateId, Number(id), actor.id)
    return "Payout cancelled. The amount is back in your available balance."
  })
}

// --- Settings ------------------------------------------------------------------

export async function saveProfile(input: { firstName: string; lastName: string; country: string; website: string; socials: Record<string, string> }): Promise<ActionResult> {
  return run(async () => {
    const { affiliate } = await assertAffiliate()
    await updateProfile(affiliate.id, input)
    return "Profile saved."
  })
}

export async function saveNotificationPrefs(prefs: Record<string, boolean>): Promise<ActionResult> {
  return run(async () => {
    const { affiliate } = await assertAffiliate()
    await updateNotificationPrefs(affiliate.id, prefs)
    return "Notification preferences saved."
  })
}

// --- Notifications & announcements ---------------------------------------------

export async function markNotificationsRead(): Promise<ActionResult> {
  return run(async () => {
    const { affiliate } = await assertAffiliate()
    await db.update(affiliateNotifications).set({ readAt: new Date() }).where(and(eq(affiliateNotifications.affiliateId, affiliate.id), isNull(affiliateNotifications.readAt)))
  })
}

export async function markAnnouncementRead(id: number): Promise<ActionResult> {
  return run(async () => {
    const { affiliate } = await assertAffiliate()
    const [a] = await db.select({ id: affiliateAnnouncements.id }).from(affiliateAnnouncements).where(and(eq(affiliateAnnouncements.id, Number(id)), eq(affiliateAnnouncements.published, true)))
    if (!a) return
    await db.insert(affiliateAnnouncementReads).values({ announcementId: a.id, affiliateId: affiliate.id }).onConflictDoNothing()
  })
}

// --- Support -------------------------------------------------------------------

// Affiliate questions go into the existing support queue (same tickets, same
// staff inbox at /admin/support), tagged so staff can tell them apart. An
// affiliate whose tier includes priority support is answered first, and can
// send a feature request the same way — both decided here, from their tier,
// never from what the form says.
export async function contactAffiliateSupport(input: { subject: string; message: string; kind?: string }): Promise<{ ok: true; ticketId: number } | { ok: false; error: string }> {
  try {
    const { user, affiliate } = await assertAffiliate()
    const subject = String(input.subject ?? "").trim()
    const message = String(input.message ?? "").trim()
    if (subject.length < 3) throw new Error("Add a subject.")
    if (message.length < 10) throw new Error("Describe your question in a little more detail.")
    if (message.length > 5000) throw new Error("Keep the message under 5000 characters.")
    const priority = await userHasPerk(user.id, "prioritySupport")
    const featureRequest = input.kind === "feature_request"
    if (featureRequest && !priority) throw new Error("Feature requests open up with the Gold tier.")
    const [ticket] = await db
      .insert(supportTickets)
      .values({ userId: user.id, subject: `${featureRequest ? "[Feature request]" : "[Affiliate]"} ${subject}`.slice(0, 140), priority, kind: featureRequest ? "feature_request" : "support" })
      .returning({ id: supportTickets.id })
    await db.insert(supportMessages).values({ ticketId: ticket.id, authorId: user.id, body: `${message}\n\n— Affiliate code: ${affiliate.code}` })
    revalidatePath("/support")
    return { ok: true, ticketId: ticket.id }
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
}
