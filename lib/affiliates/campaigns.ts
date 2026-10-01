import { and, eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliateCampaigns, affiliateLinks } from "@/lib/db/schema"
import { cleanUtm } from "./engine"
import { linkToken } from "./apply"
import { LANDING_PAGES } from "./types"

// Campaigns and tracking links. Every write is scoped by the affiliate id the
// server resolved from the session.

const MAX_CAMPAIGNS = 50
const MAX_LINKS = 100

export function landingPage(value: unknown): string {
  const v = String(value ?? "/")
  if (!LANDING_PAGES.some((p) => p.path === v)) throw new Error("Choose one of the available landing pages.")
  return v
}

export type CampaignInput = { name: unknown; description?: unknown; landingPage?: unknown; utmSource?: unknown; utmMedium?: unknown; utmCampaign?: unknown; utmContent?: unknown }

function campaignValues(input: CampaignInput) {
  const name = String(input.name ?? "").trim().slice(0, 60)
  if (name.length < 2) throw new Error("Give the campaign a name.")
  return {
    name,
    description: String(input.description ?? "").trim().slice(0, 300) || null,
    landingPage: landingPage(input.landingPage),
    utmSource: cleanUtm(String(input.utmSource ?? "")),
    utmMedium: cleanUtm(String(input.utmMedium ?? "")),
    utmCampaign: cleanUtm(String(input.utmCampaign ?? "")) ?? cleanUtm(name),
    utmContent: cleanUtm(String(input.utmContent ?? "")),
  }
}

async function countOf(table: typeof affiliateCampaigns | typeof affiliateLinks, affiliateId: number) {
  const [row] = await db.select({ v: sql<number>`count(*)::int` }).from(table).where(eq(table.affiliateId, affiliateId))
  return row?.v ?? 0
}

// A campaign always comes with its own tracking link.
export async function createCampaign(affiliateId: number, input: CampaignInput): Promise<number> {
  const values = campaignValues(input)
  if ((await countOf(affiliateCampaigns, affiliateId)) >= MAX_CAMPAIGNS) throw new Error(`You can have up to ${MAX_CAMPAIGNS} campaigns. Archive one you no longer use.`)
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(affiliateCampaigns).values({ affiliateId, ...values }).returning({ id: affiliateCampaigns.id })
    await tx.insert(affiliateLinks).values({ affiliateId, campaignId: row.id, token: linkToken(), landingPage: values.landingPage })
    return row.id
  })
}

export async function updateCampaign(affiliateId: number, campaignId: number, input: CampaignInput): Promise<void> {
  const values = campaignValues(input)
  const [row] = await db
    .update(affiliateCampaigns)
    .set(values)
    .where(and(eq(affiliateCampaigns.id, campaignId), eq(affiliateCampaigns.affiliateId, affiliateId)))
    .returning({ id: affiliateCampaigns.id })
  if (!row) throw new Error("That campaign no longer exists.")
  await db.update(affiliateLinks).set({ landingPage: values.landingPage }).where(and(eq(affiliateLinks.campaignId, campaignId), eq(affiliateLinks.affiliateId, affiliateId)))
}

// Archiving keeps the history and keeps the link working: traffic already
// out there still counts for the affiliate.
export async function setCampaignStatus(affiliateId: number, campaignId: number, status: "active" | "archived"): Promise<void> {
  const [row] = await db
    .update(affiliateCampaigns)
    .set({ status })
    .where(and(eq(affiliateCampaigns.id, campaignId), eq(affiliateCampaigns.affiliateId, affiliateId)))
    .returning({ id: affiliateCampaigns.id })
  if (!row) throw new Error("That campaign no longer exists.")
}

export async function createLink(affiliateId: number, input: { campaignId?: unknown; landingPage?: unknown }): Promise<void> {
  if ((await countOf(affiliateLinks, affiliateId)) >= MAX_LINKS) throw new Error(`You can have up to ${MAX_LINKS} links.`)
  let campaignId: number | null = null
  if (input.campaignId != null && input.campaignId !== "") {
    const id = Number(input.campaignId)
    const [c] = await db.select({ id: affiliateCampaigns.id }).from(affiliateCampaigns).where(and(eq(affiliateCampaigns.id, id), eq(affiliateCampaigns.affiliateId, affiliateId)))
    if (!c) throw new Error("That campaign no longer exists.")
    campaignId = c.id
  }
  await db.insert(affiliateLinks).values({ affiliateId, campaignId, token: linkToken(), landingPage: landingPage(input.landingPage) })
}

export async function setLinkStatus(affiliateId: number, linkId: number, status: "active" | "disabled"): Promise<void> {
  const [link] = await db.select().from(affiliateLinks).where(and(eq(affiliateLinks.id, linkId), eq(affiliateLinks.affiliateId, affiliateId)))
  if (!link) throw new Error("That link no longer exists.")
  if (link.isDefault && status === "disabled") throw new Error("Your main referral link can't be disabled.")
  await db.update(affiliateLinks).set({ status }).where(eq(affiliateLinks.id, link.id))
}
