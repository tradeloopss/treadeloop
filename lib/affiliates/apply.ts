import { randomBytes } from "node:crypto"
import { and, eq, ne } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliateLinks, affiliates } from "@/lib/db/schema"
import { applicationApproved, applicationDenied, applicationReceived } from "@/lib/emails/affiliate-emails"
import { buildTrackingUrl, codeValid, suggestCode } from "./engine"
import { syncTierPerks } from "./perks"
import { SITE_URL, getProgram } from "./program"
import { notifyAffiliate, type Mail } from "./notify"
import { AUDIENCE_SIZES, NOTIFICATION_PREFS, SOCIAL_KEYS, TRAFFIC_SOURCES } from "./types"

// Applications and the affiliate's own profile.

export const linkToken = () => randomBytes(6).toString("hex")

// Codes that would read as part of the site rather than a person.
const RESERVED = new Set(["admin", "tradeloop", "support", "help", "affiliate", "affiliates", "pricing", "official", "staff", "team", "api", "app", "www"])

const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max)

function cleanUrl(v: unknown): string | null {
  const raw = text(v, 200)
  if (!raw) return null
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null
  } catch {
    return null
  }
}

export type ApplicationInput = {
  firstName: unknown
  lastName: unknown
  country: unknown
  website: unknown
  socials: unknown
  audienceSize: unknown
  trafficSource: unknown
  promotionMethod: unknown
  reason: unknown
  acceptTerms: unknown
}

function validateApplication(input: ApplicationInput) {
  const firstName = text(input.firstName, 60)
  const lastName = text(input.lastName, 60)
  if (firstName.length < 2 || lastName.length < 2) throw new Error("Enter your first and last name.")
  const country = text(input.country, 2).toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("Choose your country.")
  const trafficSource = text(input.trafficSource, 40)
  if (!(TRAFFIC_SOURCES as readonly string[]).includes(trafficSource)) throw new Error("Choose your main traffic source.")
  const audienceSize = text(input.audienceSize, 40)
  if (!(AUDIENCE_SIZES as readonly string[]).includes(audienceSize)) throw new Error("Choose your audience size.")
  const promotionMethod = text(input.promotionMethod, 1000)
  if (promotionMethod.length < 20) throw new Error("Tell us a little more about how you'll promote TradeLoop (at least 20 characters).")
  const reason = text(input.reason, 1000)
  if (input.acceptTerms !== true) throw new Error("Accept the affiliate terms to apply.")
  const website = cleanUrl(input.website)
  if (text(input.website, 200) && !website) throw new Error("That website address doesn't look right.")
  const socials: Record<string, string> = {}
  const rawSocials = (input.socials && typeof input.socials === "object" ? input.socials : {}) as Record<string, unknown>
  for (const key of SOCIAL_KEYS) {
    const v = text(rawSocials[key], 120)
    if (v) socials[key] = v
  }
  if (!website && Object.keys(socials).length === 0) throw new Error("Add a website or at least one social profile so we can review your audience.")
  return { firstName, lastName, country, website, socials, audienceSize, trafficSource, promotionMethod, reason: reason || null }
}

async function freeCode(firstName: string, lastName: string): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const code = suggestCode(firstName, lastName, randomBytes(2).readUInt16BE(0))
    const [taken] = await db.select({ id: affiliates.id }).from(affiliates).where(eq(affiliates.code, code))
    if (!taken && !RESERVED.has(code)) return code
  }
  return `partner${randomBytes(4).toString("hex")}`
}

// The application emails. A key carries the minute, so a double click sends
// one email while a later re-application (after a rejection) sends its own.
const minute = (d: Date) => Math.floor(d.getTime() / 60_000)
const approvedMail = (affiliateId: number, now: Date): Mail => ({
  key: `affiliate_application_approved:${affiliateId}:${minute(now)}`,
  build: (to) => applicationApproved({ firstName: to.firstName, affiliateId: to.id, onboarded: to.onboarded, link: to.onboarded ? buildTrackingUrl({ base: SITE_URL, code: to.code }) : null }),
})

// Everything an approved affiliate needs to exist: a default tracking link.
export async function ensureDefaultLink(affiliateId: number): Promise<void> {
  const [existing] = await db.select({ id: affiliateLinks.id }).from(affiliateLinks).where(and(eq(affiliateLinks.affiliateId, affiliateId), eq(affiliateLinks.isDefault, true)))
  if (!existing) await db.insert(affiliateLinks).values({ affiliateId, token: linkToken(), landingPage: "/", isDefault: true })
}

export async function submitApplication(user: { id: string; email: string }, input: ApplicationInput): Promise<{ status: string }> {
  const data = validateApplication(input)
  const [existing] = await db.select().from(affiliates).where(eq(affiliates.userId, user.id))
  if (existing && existing.status !== "rejected") throw new Error("You've already applied to the affiliate program.")
  const program = await getProgram()
  const status = program.autoApprove ? "approved" : "pending"
  const now = new Date()
  const values = { ...data, email: user.email.toLowerCase(), status, rejectionReason: null, approvedAt: status === "approved" ? now : null, updatedAt: now }

  let affiliateId: number
  if (existing) {
    // A rejected applicant may apply again; it reopens the same record.
    await db.update(affiliates).set(values).where(eq(affiliates.id, existing.id))
    affiliateId = existing.id
  } else {
    const [row] = await db
      .insert(affiliates)
      .values({ ...values, userId: user.id, code: await freeCode(data.firstName, data.lastName) })
      .onConflictDoNothing({ target: affiliates.userId })
      .returning({ id: affiliates.id })
    if (!row) throw new Error("You've already applied to the affiliate program.")
    affiliateId = row.id
  }

  if (status === "approved") {
    await ensureDefaultLink(affiliateId)
    await notifyAffiliate({ affiliateId, type: "application", title: "Welcome to the TradeLoop affiliate program", body: "Your application was approved. Finish setting up your account to get your referral link.", href: "/affiliate/onboarding", email: true, mail: approvedMail(affiliateId, now) })
  } else {
    const channel = (data.website ?? Object.values(data.socials)[0] ?? data.trafficSource).replace(/^https?:\/\//, "").replace(/\/$/, "")
    await notifyAffiliate({
      affiliateId,
      type: "application",
      title: "We received your application",
      body: "Thanks for applying to the TradeLoop affiliate program. We review every application by hand and will email you as soon as there's a decision.",
      href: "/affiliate/apply",
      email: true,
      mail: { key: `affiliate_application_received:${affiliateId}:${minute(now)}`, build: (to) => applicationReceived({ firstName: to.firstName, affiliateId: to.id, submittedAt: now, channel }) },
    })
  }
  return { status }
}

export type Decision = "approve" | "reject" | "review"

export async function decideApplication(affiliateId: number, decision: Decision, adminId: string, reason: string): Promise<{ userId: string; status: string }> {
  const [aff] = await db.select().from(affiliates).where(eq(affiliates.id, affiliateId))
  if (!aff) throw new Error("That application no longer exists.")
  if (!["pending", "review", "rejected"].includes(aff.status)) throw new Error("That application has already been decided.")
  const now = new Date()
  if (decision === "review") {
    await db.update(affiliates).set({ status: "review", reviewedBy: adminId, updatedAt: now }).where(eq(affiliates.id, affiliateId))
    return { userId: aff.userId, status: "review" }
  }
  if (decision === "reject") {
    const why = reason.trim().slice(0, 500)
    await db.update(affiliates).set({ status: "rejected", rejectionReason: why || null, reviewedBy: adminId, updatedAt: now }).where(eq(affiliates.id, affiliateId))
    await notifyAffiliate({
      affiliateId,
      type: "application",
      title: "Your affiliate application",
      body: `Thanks for applying. We aren't able to approve your application right now.${why ? `\n\n${why}` : ""}\n\nYou're welcome to apply again later.`,
      href: "/affiliate/apply",
      email: true,
      mail: { key: `affiliate_application_denied:${affiliateId}:${minute(now)}`, build: (to) => applicationDenied({ firstName: to.firstName, affiliateId: to.id, reviewedAt: now, reason: why || null }) },
    })
    return { userId: aff.userId, status: "rejected" }
  }
  await db.update(affiliates).set({ status: "approved", rejectionReason: null, reviewedBy: adminId, approvedAt: aff.approvedAt ?? now, updatedAt: now }).where(eq(affiliates.id, affiliateId))
  await ensureDefaultLink(affiliateId)
  // Someone approved again after a rejection already has their code chosen.
  await syncTierPerks(affiliateId).catch((e) => console.error("[affiliates] tier perks couldn't be applied:", e instanceof Error ? e.message : e))
  await notifyAffiliate({ affiliateId, type: "application", title: "You're approved — welcome to the TradeLoop affiliate program", body: "Your application was approved. Finish setting up your account to get your referral link.", href: "/affiliate/onboarding", email: true, mail: approvedMail(affiliateId, now) })
  return { userId: aff.userId, status: "approved" }
}

export async function validateCode(code: string, affiliateId: number): Promise<string> {
  const clean = code.trim().toLowerCase()
  if (!codeValid(clean)) throw new Error("Use 3–24 letters, numbers, dashes or underscores, starting with a letter or number.")
  if (RESERVED.has(clean)) throw new Error("That code is reserved. Choose another.")
  const [taken] = await db.select({ id: affiliates.id }).from(affiliates).where(and(eq(affiliates.code, clean), ne(affiliates.id, affiliateId)))
  if (taken) throw new Error("That code is already taken. Choose another.")
  return clean
}

// Onboarding is the one moment an affiliate picks their own code: nothing
// points at it yet. Afterwards a change would break links already shared, so
// it goes through an admin.
export async function completeOnboarding(affiliateId: number, input: { code: unknown; acceptTerms: unknown }): Promise<void> {
  if (input.acceptTerms !== true) throw new Error("Confirm the program rules to continue.")
  const code = await validateCode(String(input.code ?? ""), affiliateId)
  const [aff] = await db.select({ onboardedAt: affiliates.onboardedAt }).from(affiliates).where(eq(affiliates.id, affiliateId))
  if (aff?.onboardedAt) throw new Error("Your account is already set up.")
  await db.update(affiliates).set({ code, onboardedAt: new Date(), updatedAt: new Date() }).where(eq(affiliates.id, affiliateId))
  await ensureDefaultLink(affiliateId)
  // What their tier unlocks (someone moved into a higher tier by hand before
  // they finished setting up). The personal code is built from the referral
  // code they just chose; if the checkout provider can't be reached now, the
  // daily job creates it.
  await syncTierPerks(affiliateId).catch((e) => console.error("[affiliates] tier perks couldn't be applied:", e instanceof Error ? e.message : e))
}

export async function updateProfile(affiliateId: number, input: { firstName: unknown; lastName: unknown; country: unknown; website: unknown; socials: unknown }): Promise<void> {
  const firstName = text(input.firstName, 60)
  const lastName = text(input.lastName, 60)
  if (firstName.length < 2 || lastName.length < 2) throw new Error("Enter your first and last name.")
  const country = text(input.country, 2).toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("Choose your country.")
  const website = cleanUrl(input.website)
  if (text(input.website, 200) && !website) throw new Error("That website address doesn't look right.")
  const socials: Record<string, string> = {}
  const raw = (input.socials && typeof input.socials === "object" ? input.socials : {}) as Record<string, unknown>
  for (const key of SOCIAL_KEYS) {
    const v = text(raw[key], 120)
    if (v) socials[key] = v
  }
  await db.update(affiliates).set({ firstName, lastName, country, website, socials, updatedAt: new Date() }).where(eq(affiliates.id, affiliateId))
}

export async function updateNotificationPrefs(affiliateId: number, input: unknown): Promise<void> {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>
  const prefs: Record<string, boolean> = {}
  for (const p of NOTIFICATION_PREFS) prefs[p.key] = typeof raw[p.key] === "boolean" ? (raw[p.key] as boolean) : p.default
  await db.update(affiliates).set({ notifications: prefs, updatedAt: new Date() }).where(eq(affiliates.id, affiliateId))
}
