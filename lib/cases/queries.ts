import { and, count, desc, eq, gt, gte, isNull, or, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { dropClaims, dropRewards, drops, user } from "@/lib/db/schema"
import { effectiveClaimStatus, grantInfo, type ClaimStatus, type DropStatus } from "@/lib/cases/types"

export type RewardView = {
  id: number
  name: string
  type: string
  discountPercent: number | null
  subscriptionPlan: string | null
  subscriptionMonths: number | null
  quantity: number
  probability: number
  claimed: number
  remaining: number
}

export type MyClaimView = {
  prizeCode: string
  reward: RewardView | null
  claimedAt: Date
  expiresAt: Date
  redeemedAt: Date | null
  status: ClaimStatus
  // Free-month prizes: access now runs until this date; `grantExtended` = it
  // was stacked onto an existing subscription rather than started fresh.
  grantedUntil: string | null
  grantExtended: boolean
}

export type DropView = {
  id: number
  name: string
  description: string | null
  status: DropStatus
  totalCases: number
  claimedCases: number
  remaining: number
  startAt: Date | null
  endAt: Date | null
  prizeExpirationDays: number
  rewards: RewardView[]
  myClaim: MyClaimView | null
}

// Claimed count per reward for a drop (a claim consumes one slot of its reward).
async function claimedByReward(dropId: number): Promise<Map<number, number>> {
  const rows = await db
    .select({ rewardId: dropClaims.rewardId, n: count() })
    .from(dropClaims)
    .where(eq(dropClaims.dropId, dropId))
    .groupBy(dropClaims.rewardId)
  return new Map(rows.map((r) => [r.rewardId, Number(r.n)]))
}

async function rewardViews(dropId: number): Promise<RewardView[]> {
  const [rewards, claimed] = await Promise.all([
    db.select().from(dropRewards).where(eq(dropRewards.dropId, dropId)).orderBy(dropRewards.sortOrder, dropRewards.id),
    claimedByReward(dropId),
  ])
  return rewards.map((r) => {
    const c = claimed.get(r.id) ?? 0
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      discountPercent: r.discountPercent,
      subscriptionPlan: r.subscriptionPlan,
      subscriptionMonths: r.subscriptionMonths,
      quantity: r.quantity,
      probability: r.probability,
      claimed: c,
      remaining: Math.max(0, r.quantity - c),
    }
  })
}

// The active drop a signed-in user should see on /cases, with the user's own
// claim if they have one. Picks the most recently started active drop that is
// within its start/end window. Returns null when there's no active drop.
export async function getActiveDropForUser(userId: string): Promise<DropView | null> {
  const now = new Date()
  const [drop] = await db
    .select()
    .from(drops)
    .where(
      and(
        eq(drops.status, "active"),
        or(isNull(drops.startAt), sql`${drops.startAt} <= ${now}`),
        or(isNull(drops.endAt), gt(drops.endAt, now)),
      ),
    )
    .orderBy(desc(drops.startAt), desc(drops.id))
    .limit(1)
  if (!drop) return null

  const rewards = await rewardViews(drop.id)
  const [mine] = await db.select().from(dropClaims).where(and(eq(dropClaims.dropId, drop.id), eq(dropClaims.userId, userId))).limit(1)
  const myClaim: MyClaimView | null = mine
    ? {
        prizeCode: mine.prizeCode,
        reward: rewards.find((r) => r.id === mine.rewardId) ?? null,
        claimedAt: mine.claimedAt,
        expiresAt: mine.expiresAt,
        redeemedAt: mine.redeemedAt,
        status: effectiveClaimStatus(mine.status, mine.expiresAt, now),
        grantedUntil: grantInfo(mine.fulfillmentRef).until,
        grantExtended: grantInfo(mine.fulfillmentRef).extended,
      }
    : null

  return {
    id: drop.id,
    name: drop.name,
    description: drop.description,
    status: drop.status as DropStatus,
    totalCases: drop.totalCases,
    claimedCases: drop.claimedCases,
    remaining: Math.max(0, drop.totalCases - drop.claimedCases),
    startAt: drop.startAt,
    endAt: drop.endAt,
    prizeExpirationDays: drop.prizeExpirationDays,
    rewards,
    myClaim,
  }
}

// A lightweight look at the active drop for the dashboard promo popup — just
// enough to decide whether to nudge the user, without loading rewards/claims.
export type DropTeaser = { dropId: number; name: string; endAt: Date | null; remaining: number; totalCases: number; claimed: boolean }

export async function getDropTeaser(userId: string): Promise<DropTeaser | null> {
  const now = new Date()
  const [drop] = await db
    .select()
    .from(drops)
    .where(
      and(
        eq(drops.status, "active"),
        or(isNull(drops.startAt), sql`${drops.startAt} <= ${now}`),
        or(isNull(drops.endAt), gt(drops.endAt, now)),
      ),
    )
    .orderBy(desc(drops.startAt), desc(drops.id))
    .limit(1)
  if (!drop) return null
  const [mine] = await db
    .select({ id: dropClaims.id })
    .from(dropClaims)
    .where(and(eq(dropClaims.dropId, drop.id), eq(dropClaims.userId, userId)))
    .limit(1)
  return {
    dropId: drop.id,
    name: drop.name,
    endAt: drop.endAt,
    remaining: Math.max(0, drop.totalCases - drop.claimedCases),
    totalCases: drop.totalCases,
    claimed: !!mine,
  }
}

// -------------------------------------------------------------- admin reads

export type AdminDropRow = {
  id: number
  name: string
  status: DropStatus
  totalCases: number
  claimedCases: number
  remaining: number
  startAt: Date | null
  endAt: Date | null
  createdAt: Date
}

export async function listDrops(): Promise<AdminDropRow[]> {
  const rows = await db.select().from(drops).orderBy(desc(drops.createdAt))
  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    status: d.status as DropStatus,
    totalCases: d.totalCases,
    claimedCases: d.claimedCases,
    remaining: Math.max(0, d.totalCases - d.claimedCases),
    startAt: d.startAt,
    endAt: d.endAt,
    createdAt: d.createdAt,
  }))
}

export type ClaimRowView = {
  id: number
  userId: string
  userName: string | null
  userEmail: string | null
  rewardId: number
  rewardName: string
  prizeCode: string
  claimedAt: Date
  expiresAt: Date
  redeemedAt: Date | null
  status: ClaimStatus
  fulfillmentStatus: string
}

export async function listClaims(dropId: number, limit = 500): Promise<ClaimRowView[]> {
  const now = new Date()
  const rows = await db
    .select({
      id: dropClaims.id,
      userId: dropClaims.userId,
      userName: user.name,
      userEmail: user.email,
      rewardId: dropClaims.rewardId,
      rewardName: dropRewards.name,
      prizeCode: dropClaims.prizeCode,
      claimedAt: dropClaims.claimedAt,
      expiresAt: dropClaims.expiresAt,
      redeemedAt: dropClaims.redeemedAt,
      status: dropClaims.status,
      fulfillmentStatus: dropClaims.fulfillmentStatus,
    })
    .from(dropClaims)
    .leftJoin(user, eq(user.id, dropClaims.userId))
    .leftJoin(dropRewards, eq(dropRewards.id, dropClaims.rewardId))
    .where(eq(dropClaims.dropId, dropId))
    .orderBy(desc(dropClaims.claimedAt))
    .limit(limit)
  return rows.map((r) => ({
    ...r,
    rewardName: r.rewardName ?? "Reward",
    status: effectiveClaimStatus(r.status, r.expiresAt, now),
  }))
}

export type DropDetail = {
  drop: typeof drops.$inferSelect
  rewards: RewardView[]
  stats: {
    total: number
    claimed: number
    remaining: number
    claimRate: number
    activePrizes: number
    usedPrizes: number
    expiredPrizes: number
    revokedPrizes: number
    claims24h: number
    claimsToday: number
  }
  claims: ClaimRowView[]
}

export async function getDropDetail(dropId: number): Promise<DropDetail | null> {
  const [drop] = await db.select().from(drops).where(eq(drops.id, dropId)).limit(1)
  if (!drop) return null
  const now = new Date()
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const [rewards, claims, [c24], [ctoday]] = await Promise.all([
    rewardViews(dropId),
    listClaims(dropId, 1000),
    db.select({ n: count() }).from(dropClaims).where(and(eq(dropClaims.dropId, dropId), gte(dropClaims.claimedAt, dayAgo))),
    db.select({ n: count() }).from(dropClaims).where(and(eq(dropClaims.dropId, dropId), gte(dropClaims.claimedAt, startOfToday))),
  ])

  const tally = { active: 0, used: 0, expired: 0, revoked: 0 }
  for (const c of claims) tally[c.status]++

  return {
    drop,
    rewards,
    stats: {
      total: drop.totalCases,
      claimed: drop.claimedCases,
      remaining: Math.max(0, drop.totalCases - drop.claimedCases),
      claimRate: drop.totalCases > 0 ? Math.round((drop.claimedCases / drop.totalCases) * 100) : 0,
      activePrizes: tally.active,
      usedPrizes: tally.used,
      expiredPrizes: tally.expired,
      revokedPrizes: tally.revoked,
      claims24h: Number(c24?.n ?? 0),
      claimsToday: Number(ctoday?.n ?? 0),
    },
    claims,
  }
}
