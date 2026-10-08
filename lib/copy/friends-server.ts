import { and, eq, gte, inArray, isNotNull, ne } from "drizzle-orm"
import { db } from "@/lib/db"
import { copyGroupFollowers, copyGroups, copyOrders, copyPositions, copyShareMembers, copyShares, metatraderConnections, trades, tradingAccounts, user } from "@/lib/db/schema"
import { localDay } from "@/lib/timezone"
import { activityOf, friendState, friendsTotals, moneyOf, tallyCopies, type CopyResults, type FollowedStrategy, type FriendsOverview, type SharedStrategy, type TradeRow } from "./friends"

// The Friends page, read for one trader (lib/copy/friends.ts says who sees what).
//
// Everything is reached from the trader the session resolved: the strategies
// they own, the friends who follow those, and the strategies they follow
// themselves. No id comes from the page. Of a friend, a figure in money leaves
// here only when that friend shares their results; whether they are copying,
// and how many copies went through, always does.

const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "A trader"
const MEMBER = ["active", "paused"]
// more than anyone has, and a ceiling all the same on what one page reads
const MAX_ROWS = 20_000

export async function friendsOverview(userId: string, timeZone: string): Promise<FriendsOverview> {
  const [shares, memberships] = await Promise.all([
    db.select().from(copyShares).where(and(eq(copyShares.ownerId, userId), ne(copyShares.status, "revoked"))).orderBy(copyShares.createdAt),
    db
      .select({ shareId: copyShares.id, accountId: copyShares.accountId, name: copyShares.name, owner: user.name, status: copyShareMembers.status, joinedAt: copyShareMembers.joinedAt, shareResults: copyShareMembers.shareResults })
      .from(copyShareMembers)
      .innerJoin(copyShares, eq(copyShares.id, copyShareMembers.shareId))
      .leftJoin(user, eq(user.id, copyShares.ownerId))
      .where(and(eq(copyShareMembers.userId, userId), inArray(copyShareMembers.status, MEMBER), ne(copyShares.status, "revoked")))
      .orderBy(copyShareMembers.joinedAt),
  ])
  const members = shares.length
    ? await db
        .select({ shareId: copyShareMembers.shareId, userId: copyShareMembers.userId, status: copyShareMembers.status, joinedAt: copyShareMembers.joinedAt, shareResults: copyShareMembers.shareResults, name: user.name })
        .from(copyShareMembers)
        .leftJoin(user, eq(user.id, copyShareMembers.userId))
        .where(and(inArray(copyShareMembers.shareId, shares.map((s) => s.id)), inArray(copyShareMembers.status, MEMBER)))
        .orderBy(copyShareMembers.joinedAt)
    : []

  // Each pair of "who copies" and "which shared account": the friends of this trader's strategies, and this trader on the ones they follow.
  const pairs = [...members.map((m) => ({ userId: m.userId, accountId: shares.find((s) => s.id === m.shareId)!.accountId })), ...memberships.map((m) => ({ userId, accountId: m.accountId }))]
  const results = await copyResults(pairs, timeZone)
  const of = (who: string, accountId: number) => results.get(`${who}|${accountId}`) ?? { groups: [], followers: 0, results: tallyCopies([], [], { today: "", dayOf: () => "", keyOf: () => null, trades: [], openPnl: () => null }) }

  const accountNames = shares.length ? new Map((await db.select({ id: tradingAccounts.id, name: tradingAccounts.name }).from(tradingAccounts).where(inArray(tradingAccounts.id, shares.map((s) => s.accountId)))).map((a) => [a.id, a.name])) : new Map<number, string>()
  const sharing: SharedStrategy[] = shares.map((s) => ({
    shareId: s.id,
    accountId: s.accountId,
    accountName: accountNames.get(s.accountId) ?? "Account",
    name: s.name,
    status: s.status === "paused" ? "paused" : "active",
    token: s.token,
    maxFriends: s.maxFriends,
    createdAt: s.createdAt.toISOString(),
    friends: members
      .filter((m) => m.shareId === s.id)
      .map((m) => {
        const r = of(m.userId, s.accountId)
        return { userId: m.userId, name: firstName(m.name), joinedAt: m.joinedAt.toISOString(), state: friendState(m.status, r.groups), groups: r.groups.length, followers: r.followers, activity: activityOf(r.results), money: m.shareResults ? moneyOf(r.results) : null }
      }),
  }))
  const following: FollowedStrategy[] = memberships.map((m) => {
    const r = of(userId, m.accountId)
    return { shareId: m.shareId, accountId: m.accountId, name: m.name, owner: firstName(m.owner), joinedAt: m.joinedAt.toISOString(), state: friendState(m.status, r.groups), sharesResults: m.shareResults, groups: r.groups, followers: r.followers, activity: activityOf(r.results), money: moneyOf(r.results) }
  })
  return { sharing, following, totals: friendsTotals(sharing) }
}

type Result = { groups: { id: number; name: string; status: string }[]; followers: number; results: CopyResults }

// What each trader's groups on each shared account came to. Keyed "userId|accountId".
async function copyResults(pairs: { userId: string; accountId: number }[], timeZone: string): Promise<Map<string, Result>> {
  const out = new Map<string, Result>()
  if (!pairs.length) return out
  const wanted = new Set(pairs.map((p) => `${p.userId}|${p.accountId}`))
  const groups = (await db.select({ id: copyGroups.id, userId: copyGroups.userId, leaderAccountId: copyGroups.leaderAccountId, name: copyGroups.name, status: copyGroups.status }).from(copyGroups).where(and(inArray(copyGroups.userId, [...new Set(pairs.map((p) => p.userId))]), inArray(copyGroups.leaderAccountId, [...new Set(pairs.map((p) => p.accountId))])))).filter((g) => wanted.has(`${g.userId}|${g.leaderAccountId}`))
  if (!groups.length) return out
  const ids = groups.map((g) => g.id)
  const [followers, orders, positions] = await Promise.all([
    db.select({ groupId: copyGroupFollowers.groupId, accountId: copyGroupFollowers.accountId }).from(copyGroupFollowers).where(inArray(copyGroupFollowers.groupId, ids)),
    db.select({ groupId: copyOrders.groupId, masterOrderId: copyOrders.masterOrderId, followerAccountId: copyOrders.followerAccountId, action: copyOrders.action, status: copyOrders.status, simulated: copyOrders.simulated, createdAt: copyOrders.createdAt }).from(copyOrders).where(and(inArray(copyOrders.groupId, ids), inArray(copyOrders.action, ["open", "increase"]))).limit(MAX_ROWS),
    db.select({ groupId: copyPositions.groupId, accountId: copyPositions.accountId, status: copyPositions.status, simulated: copyPositions.simulated, positionRef: copyPositions.positionRef, realizedPnl: copyPositions.realizedPnl, openedAt: copyPositions.openedAt, closedAt: copyPositions.closedAt }).from(copyPositions).where(and(inArray(copyPositions.groupId, ids), eq(copyPositions.role, "follower"))).limit(MAX_ROWS),
  ])

  // The real positions: the broker's own account behind each, what it reports open now, and the trades it has closed.
  const real = positions.filter((p) => !p.simulated && p.positionRef)
  const accounts = [...new Set(real.map((p) => p.accountId))]
  const connections = accounts.length ? await db.select({ accountId: metatraderConnections.accountId, platform: metatraderConnections.platform, login: metatraderConnections.login, open: metatraderConnections.openPositionsData }).from(metatraderConnections).where(inArray(metatraderConnections.accountId, accounts)) : []
  const earliest = real.filter((p) => p.status === "closed").reduce<Date | null>((first, p) => (!first || p.openedAt < first ? p.openedAt : first), null)
  const closedTrades: TradeRow[] =
    earliest && accounts.length
      ? (await db.select({ accountId: trades.accountId, externalId: trades.externalId, pnl: trades.pnl, exitTime: trades.exitTime }).from(trades).where(and(inArray(trades.accountId, accounts), eq(trades.status, "closed"), isNotNull(trades.externalId), gte(trades.exitTime, earliest))).limit(MAX_ROWS)).map((t) => ({ accountId: t.accountId!, externalId: t.externalId!, pnl: Number(t.pnl), exitTime: t.exitTime }))
      : []
  const key = new Map(connections.map((c) => [c.accountId!, `${c.platform}:${c.login}`]))
  const openNow = new Map(connections.flatMap((c) => (c.open ?? []).filter((p) => p.identifier && p.profit != null).map((p) => [`${c.accountId}|${p.identifier}`, Number(p.profit)] as const)))
  const today = localDay(new Date(), timeZone)

  for (const pair of wanted) {
    const mine = groups.filter((g) => `${g.userId}|${g.leaderAccountId}` === pair)
    if (!mine.length) continue
    const mineIds = new Set(mine.map((g) => g.id))
    out.set(pair, {
      groups: mine.map((g) => ({ id: g.id, name: g.name, status: g.status })),
      followers: new Set(followers.filter((f) => mineIds.has(f.groupId)).map((f) => f.accountId)).size,
      results: tallyCopies(
        orders.filter((o) => mineIds.has(o.groupId)),
        positions.filter((p) => mineIds.has(p.groupId)).map((p) => ({ accountId: p.accountId, status: p.status, simulated: p.simulated, positionRef: p.positionRef, realizedPnl: p.realizedPnl != null ? Number(p.realizedPnl) : null, closedAt: p.closedAt })),
        { today, dayOf: (at) => localDay(at, timeZone), keyOf: (accountId) => key.get(accountId) ?? null, trades: closedTrades, openPnl: (accountId, ref) => openNow.get(`${accountId}|${ref}`) ?? null },
      ),
    })
  }
  return out
}
