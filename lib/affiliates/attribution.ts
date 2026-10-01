import { randomInt } from "node:crypto"
import { and, desc, eq, gt, or, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliateClicks, affiliateConversions, affiliateCoupons, affiliateLinks, affiliateReferrals, affiliates, user } from "@/lib/db/schema"
import { canAttribute, chooseAttribution, cleanLandingPage, cleanUtm, deviceFrom, shouldCountClick } from "./engine"
import { getProgram } from "./program"
import { attributionSecret, signAttribution, verifyAttribution, type AttributionPayload } from "./token"
import { notifyAffiliate } from "./notify"
import { evaluateAffiliate, recordSignal } from "./fraud"

// Clicks and attribution. Nothing here trusts the browser for WHO referred a
// visitor: a click is resolved from the public ?ref= code on the server, and
// what travels back to the browser is a cookie the server signed.

const CLICK_DEDUPE_MINUTES = 30
// A single network hammering the tracker is a bot or a refresh loop, not
// traffic: past this many clicks in ten minutes nothing more is recorded.
const MAX_CLICKS_PER_IP_10MIN = 60

export type ClickInput = {
  code: string
  linkToken: string | null
  landingPage: string | null
  referrer: string | null
  utm: { source?: string | null; medium?: string | null; campaign?: string | null; content?: string | null }
  visitorId: string
  existingToken: string | null
  ipHash: string | null
  userAgent: string | null
  country: string | null
}

// Returns the cookie to set, or null when the visitor's attribution doesn't
// change (unknown/inactive affiliate, or first-touch keeps an earlier one).
export async function recordClick(input: ClickInput): Promise<{ token: string; cookieDays: number } | null> {
  const code = input.code.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{2,23}$/.test(code)) return null
  const [aff] = await db.select({ id: affiliates.id, status: affiliates.status }).from(affiliates).where(eq(affiliates.code, code))
  if (!aff || aff.status !== "approved") return null

  const now = new Date()
  const program = await getProgram()

  // The link decides the campaign — never a campaign id from the query string.
  let linkId: number | null = null
  let campaignId: number | null = null
  if (input.linkToken && /^[a-z0-9]{6,24}$/i.test(input.linkToken)) {
    const [link] = await db.select().from(affiliateLinks).where(and(eq(affiliateLinks.token, input.linkToken), eq(affiliateLinks.affiliateId, aff.id)))
    if (link && link.status === "active") {
      linkId = link.id
      campaignId = link.campaignId
    }
  }
  if (linkId == null) {
    const [def] = await db.select({ id: affiliateLinks.id }).from(affiliateLinks).where(and(eq(affiliateLinks.affiliateId, aff.id), eq(affiliateLinks.isDefault, true)))
    linkId = def?.id ?? null
  }

  const [last] = await db
    .select({ id: affiliateClicks.id, createdAt: affiliateClicks.createdAt })
    .from(affiliateClicks)
    .where(and(eq(affiliateClicks.visitorId, input.visitorId), eq(affiliateClicks.affiliateId, aff.id)))
    .orderBy(desc(affiliateClicks.createdAt))
    .limit(1)

  let clickId = last?.id ?? null
  let clickedAt = last?.createdAt ?? now
  if (shouldCountClick(last?.createdAt ?? null, now, CLICK_DEDUPE_MINUTES)) {
    let flooded = false
    if (input.ipHash) {
      const [burst] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(affiliateClicks)
        .where(and(eq(affiliateClicks.ipHash, input.ipHash), gt(affiliateClicks.createdAt, new Date(now.getTime() - 600_000))))
      flooded = (burst?.n ?? 0) >= MAX_CLICKS_PER_IP_10MIN
    }
    if (!flooded) {
      const [row] = await db
        .insert(affiliateClicks)
        .values({
          affiliateId: aff.id,
          campaignId,
          linkId,
          visitorId: input.visitorId,
          ipHash: input.ipHash,
          landingPage: cleanLandingPage(input.landingPage),
          referrer: cleanReferrer(input.referrer),
          utmSource: cleanUtm(input.utm.source),
          utmMedium: cleanUtm(input.utm.medium),
          utmCampaign: cleanUtm(input.utm.campaign),
          utmContent: cleanUtm(input.utm.content),
          device: deviceFrom(input.userAgent),
          country: cleanCountry(input.country),
        })
        .returning({ id: affiliateClicks.id })
      clickId = row.id
      clickedAt = now
    }
  }

  const secret = attributionSecret()
  const existing = verifyAttribution(input.existingToken, secret)
  const choice = chooseAttribution({ existing: existing ? { affiliateId: existing.a, ts: existing.t } : null, model: program.attribution, cookieDays: program.cookieDays, now })
  if (choice === "keep") return null

  const payload: AttributionPayload = { a: aff.id, l: linkId, c: campaignId, k: clickId, v: input.visitorId, t: clickedAt.getTime() }
  return { token: signAttribution(payload, secret), cookieDays: program.cookieDays }
}

// Only the host of the referring page is kept — never a full URL with its
// query string, which can carry someone's private data.
function cleanReferrer(value: string | null): string | null {
  if (!value) return null
  try {
    return new URL(value).hostname.toLowerCase().slice(0, 120) || null
  } catch {
    return null
  }
}

const cleanCountry = (value: string | null) => (value && /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : null)

// TL-48213: what an affiliate sees instead of the customer's identity.
async function newPublicId(): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const id = `TL-${randomInt(10_000, 1_000_000)}`
    const [taken] = await db.select({ id: affiliateReferrals.id }).from(affiliateReferrals).where(eq(affiliateReferrals.publicId, id))
    if (!taken) return id
  }
  return `TL-${Date.now().toString(36).toUpperCase()}`
}

export type ClaimResult = { attributed: boolean; reason?: string }

// Ties a newly signed-up user to the affiliate whose signed cookie they carry.
// Safe to call more than once: UNIQUE(userId) means a second call is a no-op.
export async function claimAttribution(userId: string, token: string | null | undefined, ctx: { country?: string | null; userAgent?: string | null } = {}): Promise<ClaimResult> {
  const payload = verifyAttribution(token, attributionSecret())
  if (!payload) return { attributed: false, reason: "none" }

  const [[aff], [u], [existing], program] = await Promise.all([
    db.select({ id: affiliates.id, userId: affiliates.userId, status: affiliates.status, email: affiliates.email }).from(affiliates).where(eq(affiliates.id, payload.a)),
    db.select({ id: user.id, createdAt: user.createdAt, email: user.email }).from(user).where(eq(user.id, userId)),
    db.select({ id: affiliateReferrals.id }).from(affiliateReferrals).where(eq(affiliateReferrals.userId, userId)),
    getProgram(),
  ])
  if (!aff || !u) return { attributed: false, reason: "none" }

  const verdict = canAttribute({
    affiliateUserId: aff.userId,
    affiliateStatus: aff.status,
    userId,
    userCreatedAtMs: new Date(u.createdAt).getTime(),
    clickedAtMs: payload.t,
    cookieDays: program.cookieDays,
    now: new Date(),
    hasReferral: !!existing,
    affiliateEmail: aff.email,
    userEmail: u.email,
  })
  if (!verdict.ok) {
    // A second account on the affiliate's own mailbox is worth a look. Their
    // own signed-in account merely opening their link is not.
    if (verdict.reason === "self" && aff.userId !== userId) await noteSelfReferral(aff.id, userId, "medium")
    return { attributed: false, reason: verdict.reason }
  }

  // The click this cookie points at, if it is really this affiliate's.
  let landingPage: string | null = null
  let clickId: number | null = null
  if (payload.k != null) {
    const [click] = await db.select({ id: affiliateClicks.id, landingPage: affiliateClicks.landingPage }).from(affiliateClicks).where(and(eq(affiliateClicks.id, payload.k), eq(affiliateClicks.affiliateId, aff.id)))
    clickId = click?.id ?? null
    landingPage = click?.landingPage ?? null
  }

  const [row] = await db
    .insert(affiliateReferrals)
    .values({
      publicId: await newPublicId(),
      affiliateId: aff.id,
      userId,
      campaignId: payload.c,
      linkId: payload.l,
      clickId,
      source: "link",
      status: "signup",
      country: cleanCountry(ctx.country ?? null),
      device: deviceFrom(ctx.userAgent),
      landingPage,
      clickedAt: new Date(payload.t),
    })
    .onConflictDoNothing({ target: affiliateReferrals.userId })
    .returning({ id: affiliateReferrals.id, publicId: affiliateReferrals.publicId })
  if (!row) return { attributed: false, reason: "existing" }

  await db.insert(affiliateConversions).values({ referralId: row.id, affiliateId: aff.id, type: "signup" })
  await notifyAffiliate({ affiliateId: aff.id, type: "referral", title: "New referral", body: `${row.publicId} signed up through your link.`, href: "/affiliate/referrals", pref: "referral", email: true })
  await evaluateAffiliate(aff.id)
  return { attributed: true }
}

// An affiliate referring themself: never attributed (canAttribute refuses it),
// and noted for a person to review — not punished.
export async function noteSelfReferral(affiliateId: number, userId: string, risk: "low" | "medium"): Promise<void> {
  await recordSignal(affiliateId, { type: "self_referral", risk, details: { userId } }, { key: userId })
}

export type CouponMatch = { affiliateId: number; couponId: number; campaignId: number | null }

// Coupon attribution, at payment time. Precedence (engine.canAttribute): a
// link referral already on record wins; the coupon only attributes a customer
// nobody has referred yet. The coupon's use is counted either way.
export async function attributeByCoupon(input: { userId: string; promoCode: string | null; promoCodeId?: string | null; firstUse: boolean }): Promise<CouponMatch | null> {
  // The webhook names the promo by its code, its Whop id, or both.
  const code = (input.promoCode ?? "").trim().toUpperCase()
  const promoId = (input.promoCodeId ?? "").trim()
  if (!code && !promoId) return null
  const [coupon] = await db
    .select()
    .from(affiliateCoupons)
    .where(or(code ? eq(affiliateCoupons.code, code) : undefined, promoId ? eq(affiliateCoupons.whopPromoId, promoId) : undefined))
  if (!coupon) return null
  if (input.firstUse) await db.update(affiliateCoupons).set({ uses: sql`${affiliateCoupons.uses} + 1` }).where(eq(affiliateCoupons.id, coupon.id))

  const [aff] = await db.select({ id: affiliates.id, userId: affiliates.userId, status: affiliates.status }).from(affiliates).where(eq(affiliates.id, coupon.affiliateId))
  if (!aff || aff.status !== "approved") return null
  // Their own coupon on their own subscription: a discount, not a referral.
  if (aff.userId === input.userId) {
    await noteSelfReferral(aff.id, input.userId, "low")
    return null
  }

  const [existing] = await db.select().from(affiliateReferrals).where(eq(affiliateReferrals.userId, input.userId))
  if (existing) {
    // Same affiliate's link AND coupon: remember the coupon on the referral
    // (coupon stats, coupon-scoped rules). Another affiliate's: the link wins.
    if (existing.affiliateId === aff.id && existing.couponId == null) {
      await db.update(affiliateReferrals).set({ couponId: coupon.id }).where(eq(affiliateReferrals.id, existing.id))
    }
    return existing.affiliateId === aff.id ? { affiliateId: aff.id, couponId: coupon.id, campaignId: existing.campaignId } : null
  }

  const [row] = await db
    .insert(affiliateReferrals)
    .values({ publicId: await newPublicId(), affiliateId: aff.id, userId: input.userId, campaignId: coupon.campaignId, couponId: coupon.id, source: "coupon", status: "signup" })
    .onConflictDoNothing({ target: affiliateReferrals.userId })
    .returning({ id: affiliateReferrals.id, publicId: affiliateReferrals.publicId })
  if (!row) return null
  await db.insert(affiliateConversions).values({ referralId: row.id, affiliateId: aff.id, type: "signup" })
  await notifyAffiliate({ affiliateId: aff.id, type: "referral", title: "New referral", body: `${row.publicId} used your coupon ${coupon.code}.`, href: "/affiliate/referrals", pref: "referral", email: true })
  return { affiliateId: aff.id, couponId: coupon.id, campaignId: coupon.campaignId }
}
