import { randomBytes } from "node:crypto"
import { and, eq, inArray, ne, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { copyGroups, copyShareMembers, copyShares, metatraderConnections, propAccount, propFirmRules, rithmicConnections, tradingAccounts, user } from "@/lib/db/schema"
import { detectProvider } from "@/lib/compliance/engine"
import { accountKind, type AccountFacts, type AccountKind } from "@/lib/compliance/kind"
import { ruleSets } from "@/lib/compliance/server"

// Sharing a strategy with friends. A trader lets the people they invite copy
// one of their Leader accounts onto accounts of their own: each friend builds
// an ordinary Copy Group whose Leader is the shared account, with their own
// followers, their own sizes and their own limits.
//
// What holds, here and in the engine (lib/copy/server.ts):
//  - Broker accounts only, on both sides (lib/compliance/kind.ts). A prop-firm
//    account is never shared, and never follows a friend's strategy.
//  - A friend gets the trades, and nothing else of the owner's: no login, no
//    password, no balance. And nothing a friend does reaches the owner's
//    account: it is read, never traded on, never flattened.
//  - The owner sees who follows, and ends it for one friend or for all.
//  - It is by invitation: there is no list of strategies to browse.

export const MAX_FRIENDS = 10
export const MAX_JOINED = 10

const cleanName = (raw: unknown) => String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 60)
const newToken = () => randomBytes(24).toString("base64url")
// what a friend is shown of the owner: the name they go by, never the email
const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "A trader"

// What is known about accounts, whoever's they are: for telling a broker's from a prop firm's.
export async function accountFacts(accountIds: number[]): Promise<Map<number, AccountFacts & { userId: string; name: string }>> {
  const out = new Map<number, AccountFacts & { userId: string; name: string }>()
  const ids = [...new Set(accountIds)].filter((id) => Number.isInteger(id) && id > 0)
  if (!ids.length) return out
  const [accounts, mt, rith, tracked, legacy, sets] = await Promise.all([
    db.select({ id: tradingAccounts.id, userId: tradingAccounts.userId, name: tradingAccounts.name, broker: tradingAccounts.broker }).from(tradingAccounts).where(and(inArray(tradingAccounts.id, ids), eq(tradingAccounts.archived, false))),
    db.select({ accountId: metatraderConnections.accountId, platform: metatraderConnections.platform, server: metatraderConnections.server }).from(metatraderConnections).where(inArray(metatraderConnections.accountId, ids)),
    db.select({ accountId: rithmicConnections.accountId }).from(rithmicConnections).where(inArray(rithmicConnections.accountId, ids)),
    db.select({ accountId: propAccount.accountId }).from(propAccount).where(inArray(propAccount.accountId, ids)),
    db.select({ accountId: propFirmRules.accountId }).from(propFirmRules).where(inArray(propFirmRules.accountId, ids)),
    ruleSets(),
  ])
  for (const a of accounts) {
    const m = mt.find((x) => x.accountId === a.id)
    const platform = m ? (m.platform === "mt4" ? "mt4" : "mt5") : rith.some((r) => r.accountId === a.id) ? "rithmic" : null
    out.set(a.id, { userId: a.userId, name: a.name, platform, server: m?.server ?? null, broker: a.broker, provider: detectProvider(sets, m?.server)?.name ?? null, propTracked: tracked.some((t) => t.accountId === a.id) || legacy.some((t) => t.accountId === a.id) })
  }
  return out
}

export async function kindsOf(accountIds: number[]): Promise<Map<number, AccountKind>> {
  const facts = await accountFacts(accountIds)
  return new Map([...facts].map(([id, f]) => [id, accountKind(f)]))
}

// ------------------------------------------------------------------ the owner's side

export type ShareMember = { userId: string; name: string; joinedAt: string; copying: boolean }
export type ShareView = { id: number; accountId: number; name: string; token: string; status: "active" | "paused"; maxFriends: number; members: ShareMember[]; createdAt: string }

async function ownShare(ownerId: string, shareId: number) {
  const [s] = await db.select().from(copyShares).where(and(eq(copyShares.id, shareId), eq(copyShares.ownerId, ownerId), ne(copyShares.status, "revoked"))).limit(1)
  if (!s) throw new Error("That shared strategy no longer exists.")
  return s
}

// Every strategy a trader shares, with who follows each. `copying`: the friend has a group on it that is switched on.
export async function listShares(ownerId: string): Promise<ShareView[]> {
  const shares = await db.select().from(copyShares).where(and(eq(copyShares.ownerId, ownerId), ne(copyShares.status, "revoked"))).orderBy(copyShares.createdAt)
  if (!shares.length) return []
  const members = await db
    .select({ shareId: copyShareMembers.shareId, userId: copyShareMembers.userId, joinedAt: copyShareMembers.joinedAt, name: user.name })
    .from(copyShareMembers)
    .leftJoin(user, eq(user.id, copyShareMembers.userId))
    .where(and(inArray(copyShareMembers.shareId, shares.map((s) => s.id)), eq(copyShareMembers.status, "active")))
    .orderBy(copyShareMembers.joinedAt)
  const active = await db.select({ userId: copyGroups.userId, leaderAccountId: copyGroups.leaderAccountId }).from(copyGroups).where(and(inArray(copyGroups.leaderAccountId, shares.map((s) => s.accountId)), eq(copyGroups.status, "active")))
  return shares.map((s) => ({
    id: s.id,
    accountId: s.accountId,
    name: s.name,
    token: s.token,
    status: s.status === "paused" ? "paused" : "active",
    maxFriends: s.maxFriends,
    members: members.filter((m) => m.shareId === s.id).map((m) => ({ userId: m.userId, name: firstName(m.name), joinedAt: m.joinedAt.toISOString(), copying: active.some((g) => g.userId === m.userId && g.leaderAccountId === s.accountId) })),
    createdAt: s.createdAt.toISOString(),
  }))
}

// Starts sharing one of the trader's own accounts. It must be a broker's, and
// the trader says so themselves as well: what can be told from here is not all there is to know.
export async function createShare(ownerId: string, input: { accountId: number; name: unknown; attested: boolean }): Promise<ShareView> {
  const accountId = Number(input.accountId)
  const name = cleanName(input.name)
  if (name.length < 2) throw new Error("Give the strategy a name your friends will recognise.")
  const facts = (await accountFacts([accountId])).get(accountId)
  if (!facts || facts.userId !== ownerId) throw new Error("That account isn't yours, or has been archived.")
  const kind = accountKind(facts)
  if (kind.kind !== "broker") throw new Error(kind.reason)
  if (input.attested !== true) throw new Error("Confirm that this is your own account with a broker, and not a prop-firm account.")
  const [existing] = await db.select({ id: copyShares.id }).from(copyShares).where(and(eq(copyShares.accountId, accountId), ne(copyShares.status, "revoked"))).limit(1)
  if (existing) throw new Error("This account is already shared.")
  await db.insert(copyShares).values({ ownerId, accountId, name, token: newToken(), attestedAt: new Date() })
  return (await listShares(ownerId)).find((s) => s.accountId === accountId)!
}

export async function renameShare(ownerId: string, shareId: number, raw: unknown): Promise<void> {
  await ownShare(ownerId, shareId)
  const name = cleanName(raw)
  if (name.length < 2) throw new Error("Give the strategy a name your friends will recognise.")
  await db.update(copyShares).set({ name, updatedAt: new Date() }).where(eq(copyShares.id, shareId))
}

// A new link: the old one stops working. Friends who already joined stay.
export async function rotateShareLink(ownerId: string, shareId: number): Promise<string> {
  await ownShare(ownerId, shareId)
  const token = newToken()
  await db.update(copyShares).set({ token, updatedAt: new Date() }).where(eq(copyShares.id, shareId))
  return token
}

// "paused": nobody new can join; friends who already follow keep copying.
export async function setShareOpen(ownerId: string, shareId: number, open: boolean): Promise<void> {
  await ownShare(ownerId, shareId)
  await db.update(copyShares).set({ status: open ? "active" : "paused", updatedAt: new Date() }).where(eq(copyShares.id, shareId))
}

// Ends it for one friend. Returns the friend, whose groups on this account the caller then stops.
export async function removeMember(ownerId: string, shareId: number, memberUserId: string): Promise<{ userId: string; accountId: number; name: string }> {
  const s = await ownShare(ownerId, shareId)
  await db.update(copyShareMembers).set({ status: "removed", updatedAt: new Date() }).where(and(eq(copyShareMembers.shareId, shareId), eq(copyShareMembers.userId, String(memberUserId))))
  return { userId: String(memberUserId), accountId: s.accountId, name: s.name }
}

// Ends it for everyone. Returns who followed, whose groups on this account the caller then stops.
export async function revokeShare(ownerId: string, shareId: number): Promise<{ userIds: string[]; accountId: number; name: string }> {
  const s = await ownShare(ownerId, shareId)
  const members = await db.select({ userId: copyShareMembers.userId }).from(copyShareMembers).where(and(eq(copyShareMembers.shareId, shareId), eq(copyShareMembers.status, "active")))
  await db.update(copyShares).set({ status: "revoked", updatedAt: new Date() }).where(eq(copyShares.id, shareId))
  await db.update(copyShareMembers).set({ status: "removed", updatedAt: new Date() }).where(eq(copyShareMembers.shareId, shareId))
  return { userIds: members.map((m) => m.userId), accountId: s.accountId, name: s.name }
}

// ------------------------------------------------------------------ the friend's side

export type InviteView = { name: string; owner: string; platform: string; state: "open" | "joined" | "own" | "full" | "closed" }

// What an invitation shows before it is accepted: the strategy's name, who
// shares it, and the platform. Nothing about the account itself.
export async function readInvite(userId: string, token: string): Promise<InviteView | null> {
  const [s] = await db
    .select({ id: copyShares.id, ownerId: copyShares.ownerId, accountId: copyShares.accountId, name: copyShares.name, status: copyShares.status, maxFriends: copyShares.maxFriends, owner: user.name })
    .from(copyShares)
    .leftJoin(user, eq(user.id, copyShares.ownerId))
    .where(and(eq(copyShares.token, String(token ?? "").slice(0, 80)), ne(copyShares.status, "revoked")))
    .limit(1)
  if (!s) return null
  const [mt] = await db.select({ platform: metatraderConnections.platform }).from(metatraderConnections).where(eq(metatraderConnections.accountId, s.accountId)).limit(1)
  const members = await db.select({ userId: copyShareMembers.userId }).from(copyShareMembers).where(and(eq(copyShareMembers.shareId, s.id), eq(copyShareMembers.status, "active")))
  const state: InviteView["state"] = s.ownerId === userId ? "own" : members.some((m) => m.userId === userId) ? "joined" : s.status !== "active" ? "closed" : members.length >= s.maxFriends ? "full" : "open"
  return { name: s.name, owner: firstName(s.owner), platform: mt?.platform === "mt4" ? "MetaTrader 4" : "MetaTrader 5", state }
}

// Accepts an invitation. The friend says they will copy it to broker accounts
// of their own only; the engine checks each account all the same.
export async function joinShare(userId: string, token: string, attested: boolean): Promise<{ shareId: number; name: string }> {
  const [s] = await db.select().from(copyShares).where(and(eq(copyShares.token, String(token ?? "").slice(0, 80)), ne(copyShares.status, "revoked"))).limit(1)
  if (!s) throw new Error("This invitation is no longer valid. Ask your friend for a new link.")
  if (s.ownerId === userId) throw new Error("This is your own strategy.")
  if (attested !== true) throw new Error("Confirm that you will copy it only to your own broker accounts.")
  const [mine] = await db.select().from(copyShareMembers).where(and(eq(copyShareMembers.shareId, s.id), eq(copyShareMembers.userId, userId))).limit(1)
  if (mine?.status === "active") return { shareId: s.id, name: s.name }
  if (s.status !== "active") throw new Error("This strategy isn't taking new friends at the moment.")
  // counted and added in one statement each way round: two friends accepting the last place don't both get it
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(copyShareMembers).where(and(eq(copyShareMembers.shareId, s.id), eq(copyShareMembers.status, "active")))
  if (n >= s.maxFriends) throw new Error("This strategy already has as many friends as it allows.")
  const [{ joined }] = await db.select({ joined: sql<number>`count(*)::int` }).from(copyShareMembers).where(and(eq(copyShareMembers.userId, userId), eq(copyShareMembers.status, "active")))
  if (joined >= MAX_JOINED) throw new Error(`You can follow up to ${MAX_JOINED} shared strategies.`)
  if (mine) await db.update(copyShareMembers).set({ status: "active", joinedAt: new Date(), updatedAt: new Date() }).where(eq(copyShareMembers.id, mine.id))
  else await db.insert(copyShareMembers).values({ shareId: s.id, userId }).onConflictDoNothing()
  return { shareId: s.id, name: s.name }
}

// Stops following. Returns the account, whose groups of this friend's the caller then stops.
export async function leaveShare(userId: string, shareId: number): Promise<{ accountId: number; name: string } | null> {
  const [s] = await db.select({ accountId: copyShares.accountId, name: copyShares.name }).from(copyShares).where(eq(copyShares.id, Number(shareId))).limit(1)
  const [row] = await db.update(copyShareMembers).set({ status: "left", updatedAt: new Date() }).where(and(eq(copyShareMembers.shareId, Number(shareId)), eq(copyShareMembers.userId, userId), eq(copyShareMembers.status, "active"))).returning({ id: copyShareMembers.id })
  return s && row ? s : null
}

export type JoinedShare = { shareId: number; accountId: number; ownerId: string; name: string; owner: string }

// The strategies a trader may copy from: accepted, and still shared.
export async function joinedShares(userId: string): Promise<JoinedShare[]> {
  const rows = await db
    .select({ shareId: copyShares.id, accountId: copyShares.accountId, ownerId: copyShares.ownerId, name: copyShares.name, owner: user.name })
    .from(copyShareMembers)
    .innerJoin(copyShares, eq(copyShares.id, copyShareMembers.shareId))
    .leftJoin(user, eq(user.id, copyShares.ownerId))
    .where(and(eq(copyShareMembers.userId, userId), eq(copyShareMembers.status, "active"), ne(copyShares.status, "revoked")))
    .orderBy(copyShareMembers.joinedAt)
  return rows.map((r) => ({ ...r, owner: firstName(r.owner) }))
}
