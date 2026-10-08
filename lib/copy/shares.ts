import { randomBytes } from "node:crypto"
import { and, eq, inArray, ne, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { copyGroups, copyShareMembers, copyShares, metatraderConnections, propAccount, propFirmRules, rithmicConnections, tradingAccounts, user } from "@/lib/db/schema"
import { detectProvider } from "@/lib/compliance/engine"
import { accountKind, type AccountFacts, type AccountKind } from "@/lib/compliance/kind"
import { ruleSets } from "@/lib/compliance/server"
import { MAX_FRIENDS } from "./friends"

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

export { MAX_FRIENDS }
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

// A friend keeps their place while the owner has paused them: counted, listed, and not copying.
const MEMBER = ["active", "paused"]
export type ShareMember = { userId: string; name: string; joinedAt: string; copying: boolean; paused: boolean }
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
    .select({ shareId: copyShareMembers.shareId, userId: copyShareMembers.userId, status: copyShareMembers.status, joinedAt: copyShareMembers.joinedAt, name: user.name })
    .from(copyShareMembers)
    .leftJoin(user, eq(user.id, copyShareMembers.userId))
    .where(and(inArray(copyShareMembers.shareId, shares.map((s) => s.id)), inArray(copyShareMembers.status, MEMBER)))
    .orderBy(copyShareMembers.joinedAt)
  const active = await db.select({ userId: copyGroups.userId, leaderAccountId: copyGroups.leaderAccountId }).from(copyGroups).where(and(inArray(copyGroups.leaderAccountId, shares.map((s) => s.accountId)), eq(copyGroups.status, "active")))
  return shares.map((s) => ({
    id: s.id,
    accountId: s.accountId,
    name: s.name,
    token: s.token,
    status: s.status === "paused" ? "paused" : "active",
    maxFriends: s.maxFriends,
    members: members.filter((m) => m.shareId === s.id).map((m) => ({ userId: m.userId, name: firstName(m.name), joinedAt: m.joinedAt.toISOString(), paused: m.status === "paused", copying: m.status === "active" && active.some((g) => g.userId === m.userId && g.leaderAccountId === s.accountId) })),
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

// How many friends may follow it, from one to the most there can be. Lowering it below how many
// follow already removes nobody: it only keeps anyone new out until there is room.
export async function setShareLimit(ownerId: string, shareId: number, raw: unknown): Promise<void> {
  await ownShare(ownerId, shareId)
  const max = Number(raw)
  if (!Number.isInteger(max) || max < 1 || max > MAX_FRIENDS) throw new Error(`A strategy can have from 1 to ${MAX_FRIENDS} friends.`)
  await db.update(copyShares).set({ maxFriends: max, updatedAt: new Date() }).where(eq(copyShares.id, shareId))
}

// Pauses one friend, or lets them carry on. Paused, they keep their place and
// the strategy is not shared with them: every check of "is this shared with
// me" reads active memberships only (joinedShares), so nothing is read from the
// account for them and none of their groups on it can run. Returns the friend,
// whose groups the caller then stops (pause) or who is told (resume).
export async function pauseMember(ownerId: string, shareId: number, memberUserId: string, paused: boolean): Promise<{ userId: string; accountId: number; name: string }> {
  const s = await ownShare(ownerId, shareId)
  const [row] = await db
    .update(copyShareMembers)
    .set({ status: paused ? "paused" : "active", updatedAt: new Date() })
    .where(and(eq(copyShareMembers.shareId, shareId), eq(copyShareMembers.userId, String(memberUserId)), eq(copyShareMembers.status, paused ? "active" : "paused")))
    .returning({ id: copyShareMembers.id })
  if (!row) throw new Error(paused ? "That friend isn't following this strategy." : "That friend isn't paused.")
  return { userId: String(memberUserId), accountId: s.accountId, name: s.name }
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

export type InviteView = { name: string; owner: string; platform: string; state: "open" | "joined" | "paused" | "own" | "full" | "closed" }

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
  const members = await db.select({ userId: copyShareMembers.userId, status: copyShareMembers.status }).from(copyShareMembers).where(and(eq(copyShareMembers.shareId, s.id), inArray(copyShareMembers.status, MEMBER)))
  const mine = members.find((m) => m.userId === userId)
  const state: InviteView["state"] = s.ownerId === userId ? "own" : mine ? (mine.status === "paused" ? "paused" : "joined") : s.status !== "active" ? "closed" : members.length >= s.maxFriends ? "full" : "open"
  return { name: s.name, owner: firstName(s.owner), platform: mt?.platform === "mt4" ? "MetaTrader 4" : "MetaTrader 5", state }
}

// Accepts an invitation. The friend says they will copy it to broker accounts
// of their own only; the engine checks each account all the same.
// `shareResults`: they let the owner see what their copies of it come to (lib/copy/friends.ts); theirs to change later.
export async function joinShare(userId: string, token: string, attested: boolean, shareResults = false): Promise<{ shareId: number; name: string }> {
  const [s] = await db.select().from(copyShares).where(and(eq(copyShares.token, String(token ?? "").slice(0, 80)), ne(copyShares.status, "revoked"))).limit(1)
  if (!s) throw new Error("This invitation is no longer valid. Ask your friend for a new link.")
  if (s.ownerId === userId) throw new Error("This is your own strategy.")
  if (attested !== true) throw new Error("Confirm that you will copy it only to your own broker accounts.")
  const [mine] = await db.select().from(copyShareMembers).where(and(eq(copyShareMembers.shareId, s.id), eq(copyShareMembers.userId, userId))).limit(1)
  if (mine?.status === "active") return { shareId: s.id, name: s.name }
  // paused by the owner: the link does not undo that
  if (mine?.status === "paused") throw new Error("The owner of this strategy has paused your copying of it. Ask them to switch it back on.")
  if (s.status !== "active") throw new Error("This strategy isn't taking new friends at the moment.")
  // counted and added in one statement each way round: two friends accepting the last place don't both get it
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(copyShareMembers).where(and(eq(copyShareMembers.shareId, s.id), inArray(copyShareMembers.status, MEMBER)))
  if (n >= s.maxFriends) throw new Error("This strategy already has as many friends as it allows.")
  const [{ joined }] = await db.select({ joined: sql<number>`count(*)::int` }).from(copyShareMembers).where(and(eq(copyShareMembers.userId, userId), inArray(copyShareMembers.status, MEMBER)))
  if (joined >= MAX_JOINED) throw new Error(`You can follow up to ${MAX_JOINED} shared strategies.`)
  if (mine) await db.update(copyShareMembers).set({ status: "active", shareResults: shareResults === true, joinedAt: new Date(), updatedAt: new Date() }).where(eq(copyShareMembers.id, mine.id))
  else await db.insert(copyShareMembers).values({ shareId: s.id, userId, shareResults: shareResults === true }).onConflictDoNothing()
  return { shareId: s.id, name: s.name }
}

// Stops following. Returns the account, whose groups of this friend's the caller then stops.
export async function leaveShare(userId: string, shareId: number): Promise<{ accountId: number; name: string } | null> {
  const [s] = await db.select({ accountId: copyShares.accountId, name: copyShares.name }).from(copyShares).where(eq(copyShares.id, Number(shareId))).limit(1)
  const [row] = await db.update(copyShareMembers).set({ status: "left", updatedAt: new Date() }).where(and(eq(copyShareMembers.shareId, Number(shareId)), eq(copyShareMembers.userId, userId), inArray(copyShareMembers.status, MEMBER))).returning({ id: copyShareMembers.id })
  return s && row ? s : null
}

// Whether the owner of a strategy may see what this trader's copies of it came to. The trader's own switch.
export async function setResultsShared(userId: string, shareId: number, on: boolean): Promise<void> {
  const [row] = await db.update(copyShareMembers).set({ shareResults: on === true, updatedAt: new Date() }).where(and(eq(copyShareMembers.shareId, Number(shareId)), eq(copyShareMembers.userId, userId), inArray(copyShareMembers.status, MEMBER))).returning({ id: copyShareMembers.id })
  if (!row) throw new Error("You don't follow that strategy.")
}

// The shared accounts this trader's copying of has been paused by its owner: to say so, where a group on one is refused.
export async function pausedShares(userId: string): Promise<{ accountId: number; name: string; owner: string }[]> {
  const rows = await db
    .select({ accountId: copyShares.accountId, name: copyShares.name, owner: user.name })
    .from(copyShareMembers)
    .innerJoin(copyShares, eq(copyShares.id, copyShareMembers.shareId))
    .leftJoin(user, eq(user.id, copyShares.ownerId))
    .where(and(eq(copyShareMembers.userId, userId), eq(copyShareMembers.status, "paused"), ne(copyShares.status, "revoked")))
  return rows.map((r) => ({ ...r, owner: firstName(r.owner) }))
}

// Copy Trading by invitation: someone a trader shares a strategy with may use
// Copy Trading while they follow it, whatever stage the feature is in
// (lib/features/server.ts). And for as long as they still have a group of their
// own afterwards, so what they copied is never left where they can't reach it.
export async function invitedToCopyTrading(userId: string): Promise<boolean> {
  try {
    const [member] = await db
      .select({ id: copyShareMembers.id })
      .from(copyShareMembers)
      .innerJoin(copyShares, eq(copyShares.id, copyShareMembers.shareId))
      .where(and(eq(copyShareMembers.userId, userId), inArray(copyShareMembers.status, MEMBER), ne(copyShares.status, "revoked")))
      .limit(1)
    if (member) return true
    const [was] = await db.select({ id: copyShareMembers.id }).from(copyShareMembers).where(eq(copyShareMembers.userId, userId)).limit(1)
    if (!was) return false
    const [group] = await db.select({ id: copyGroups.id }).from(copyGroups).where(eq(copyGroups.userId, userId)).limit(1)
    return !!group
  } catch {
    // unreadable means "not invited", never "let in"
    return false
  }
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
