import { randomBytes } from "node:crypto"
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { copyGroupFollowers, copyGroups, metatraderConnections, pnlCards, providerAccounts, rithmicConnections, trades, tradingAccounts, user } from "@/lib/db/schema"
import { isPro } from "@/lib/subscription"
import { localDay } from "@/lib/timezone"
import {
  DEFAULT_VISIBILITY,
  accountLabel,
  cardStats,
  cleanLayout,
  cleanPeriod,
  cleanPrivacy,
  cleanVisibility,
  publicCard,
  resolveCardPeriod,
  type PnlCardData,
  type PnlCardLayout,
  type PnlCardScope,
  type PnlCardSummary,
  type PnlCardView,
  type PnlPeriodKey,
  type PublicPnlCard,
} from "./model"

// PNL Cards, on the server (lib/pnl-cards/model.ts says what a card is).
//
// The figures. A card's accounts are worked out here from who is asking: the
// accounts of a Copy Group of theirs, accounts they name that are theirs, or
// all of theirs. An id from the page that is somebody else's makes no card.
// Profit and the trade figures are the closed trades of those accounts in the
// period, from the journal; a balance is the broker's last reported one, or
// the journal's. An account is named by its platform and the last four digits
// of its number. No password, no server name, no full account number and no
// connection detail is read into a card, so none can leave in one.
//
// Who may open one. Its owner, always. Anyone else only while it is public,
// and then only what is switched on (publicCard): the rest is not in what the
// page is given. The link carries a random token and nothing else.

const MAX_CARDS = 200
const MAX_ACCOUNTS = 60
// 192 bits from the system's generator: not guessable, not in sequence, and nothing of the trader's in it
const newToken = () => randomBytes(24).toString("base64url")
const round = (n: number) => Math.round(n * 100) / 100
const num = (v: string | number | null | undefined) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v))

type Owned = { id: number; name: string; currency: string; startingBalance: string; currentBalance: string | null }

// The accounts a card is of, and what the set is called. Only the asker's own, whatever was asked for.
async function scopeAccounts(userId: string, scope: PnlCardScope): Promise<{ label: string; accounts: Owned[] }> {
  const own = (ids?: number[]) =>
    db
      .select({ id: tradingAccounts.id, name: tradingAccounts.name, currency: tradingAccounts.currency, startingBalance: tradingAccounts.startingBalance, currentBalance: tradingAccounts.currentBalance })
      .from(tradingAccounts)
      .where(and(eq(tradingAccounts.userId, userId), eq(tradingAccounts.archived, false), ids ? inArray(tradingAccounts.id, ids) : undefined))
      .orderBy(tradingAccounts.id)
  if (scope?.kind === "copy_group") {
    const groupId = Number(scope.groupId)
    const [group] = Number.isInteger(groupId) ? await db.select({ name: copyGroups.name, leader: copyGroups.leaderAccountId }).from(copyGroups).where(and(eq(copyGroups.id, groupId), eq(copyGroups.userId, userId))).limit(1) : []
    if (!group) throw new Error("That Copy Group no longer exists.")
    const followers = await db.select({ accountId: copyGroupFollowers.accountId }).from(copyGroupFollowers).where(eq(copyGroupFollowers.groupId, groupId)).orderBy(copyGroupFollowers.position, copyGroupFollowers.id)
    // the Leader first, when it is the trader's own (a strategy a friend shares is not theirs, and is on nobody's card but its owner's)
    const order = [group.leader, ...followers.map((f) => f.accountId)]
    const mine = await own(order)
    return { label: `Copy group “${group.name}”`, accounts: order.flatMap((id) => mine.filter((a) => a.id === id)) }
  }
  if (scope?.kind === "accounts") {
    const ids = [...new Set((Array.isArray(scope.accountIds) ? scope.accountIds : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, MAX_ACCOUNTS)
    const mine = ids.length ? await own(ids) : []
    if (!ids.length || mine.length !== ids.length) throw new Error("One of those accounts isn't yours, or has been archived.")
    return { label: mine.length === 1 ? mine[0].name.replace(/\d{5,}/g, (d) => `•••${d.slice(-4)}`).slice(0, 40) : `${mine.length} accounts`, accounts: mine }
  }
  if (scope?.kind === "all") return { label: "All accounts", accounts: (await own()).slice(0, MAX_ACCOUNTS) }
  throw new Error("Choose which accounts the card is of.")
}

// Everything a card of these accounts would say, for this period, as of now.
export async function buildCardData(userId: string, scope: PnlCardScope, periodKey: PnlPeriodKey, timeZone: string): Promise<PnlCardData> {
  const { label, accounts } = await scopeAccounts(userId, scope)
  if (!accounts.length) throw new Error("There is no account of your own here to make a card of.")
  const ids = accounts.map((a) => a.id)
  const period = resolveCardPeriod(periodKey, localDay(new Date(), timeZone))
  // a day's margin either side for the time zone; the days themselves are kept to below
  const from = period.start ? new Date(new Date(`${period.start}T00:00:00Z`).getTime() - 2 * 86_400_000) : null
  const [mt, rithmic, provider, closed, [me], pro] = await Promise.all([
    db.select({ accountId: metatraderConnections.accountId, platform: metatraderConnections.platform, login: metatraderConnections.login, balance: metatraderConnections.balance }).from(metatraderConnections).where(inArray(metatraderConnections.accountId, ids)),
    db.select({ accountId: rithmicConnections.accountId, login: rithmicConnections.rithmicAccountId }).from(rithmicConnections).where(inArray(rithmicConnections.accountId, ids)),
    db.select({ accountId: providerAccounts.tradingAccountId, provider: providerAccounts.provider, balance: providerAccounts.balance }).from(providerAccounts).where(inArray(providerAccounts.tradingAccountId, ids)),
    db
      .select({ accountId: trades.accountId, pnl: trades.pnl, exitTime: trades.exitTime, entryTime: trades.entryTime })
      .from(trades)
      .where(and(eq(trades.userId, userId), eq(trades.status, "closed"), inArray(trades.accountId, ids), from ? or(gte(trades.exitTime, from), and(isNull(trades.exitTime), gte(trades.entryTime, from))) : undefined))
      .limit(50_000),
    db.select({ name: user.name, image: user.image }).from(user).where(eq(user.id, userId)).limit(1),
    isPro(userId),
  ])
  const inPeriod = closed
    .map((t) => ({ accountId: t.accountId!, pnl: Number(t.pnl), at: t.exitTime ?? t.entryTime }))
    .filter((t) => Number.isFinite(t.pnl) && t.at != null)
    .filter((t) => {
      const day = localDay(t.at!, timeZone)
      return day <= period.end && (period.start == null || day >= period.start)
    })
    .sort((a, b) => new Date(a.at!).getTime() - new Date(b.at!).getTime())
  const stats = cardStats(inPeriod.map((t) => t.pnl))

  const rows = accounts.map((a) => {
    const m = mt.find((x) => x.accountId === a.id)
    const r = rithmic.find((x) => x.accountId === a.id)
    const p = provider.find((x) => x.accountId === a.id)
    return {
      label: accountLabel({ platform: m ? m.platform : r ? "rithmic" : p ? p.provider : null, login: m?.login ?? r?.login ?? null, name: a.name }),
      balance: num(m?.balance) ?? num(p?.balance) ?? num(a.currentBalance) ?? num(a.startingBalance),
      pnl: round(inPeriod.filter((t) => t.accountId === a.id).reduce((s, t) => s + t.pnl, 0)),
    }
  })
  const balances = rows.map((r) => r.balance).filter((b): b is number => b != null)
  return {
    scopeLabel: label,
    currency: accounts[0].currency || "USD",
    profit: stats.profit,
    curve: stats.curve,
    balance: balances.length ? round(balances.reduce((s, b) => s + b, 0)) : null,
    accountCount: accounts.length,
    accounts: rows,
    trader: { name: me?.name?.trim() || "Trader", image: me?.image ?? null, pro },
    period: { key: period.key, label: period.label },
    stats: { trades: stats.trades, winRate: stats.winRate, averageTrade: stats.averageTrade, bestTrade: stats.bestTrade, worstTrade: stats.worstTrade },
    exportedAt: new Date().toISOString(),
  }
}

type Row = typeof pnlCards.$inferSelect
const view = (c: Row): PnlCardView => ({ id: c.id, token: c.token, layout: cleanLayout(c.layout), visibility: cleanVisibility(c.visibility), privacy: cleanPrivacy(c.privacy), data: c.data, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() })

async function ownCard(userId: string, id: number): Promise<Row> {
  const [c] = Number.isInteger(id) ? await db.select().from(pnlCards).where(and(eq(pnlCards.id, id), eq(pnlCards.userId, userId))).limit(1) : []
  if (!c) throw new Error("That card no longer exists.")
  return c
}

// Makes a card: the figures as they stand, in the layout chosen, private until its owner shares it.
export async function createCard(userId: string, input: { scope: PnlCardScope; period?: unknown; layout?: unknown }, timeZone: string): Promise<PnlCardView> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(pnlCards).where(eq(pnlCards.userId, userId))
  if (n >= MAX_CARDS) throw new Error(`You have ${MAX_CARDS} saved cards. Delete some to make another.`)
  const period = cleanPeriod(input.period)
  const data = await buildCardData(userId, input.scope, period, timeZone)
  const [row] = await db
    .insert(pnlCards)
    .values({ userId, token: newToken(), layout: cleanLayout(input.layout), visibility: { ...DEFAULT_VISIBILITY }, privacy: "private", scope: { ...input.scope, period }, data })
    .returning()
  return view(row)
}

// The layout, what is visible, who may open it. Only what is given changes; the figures never do.
export async function updateCard(userId: string, id: number, patch: { layout?: unknown; visibility?: unknown; privacy?: unknown }): Promise<PnlCardView> {
  const c = await ownCard(userId, id)
  const [row] = await db
    .update(pnlCards)
    .set({
      layout: patch.layout !== undefined ? cleanLayout(patch.layout) : c.layout,
      visibility: patch.visibility !== undefined ? cleanVisibility(patch.visibility, cleanVisibility(c.visibility)) : c.visibility,
      privacy: patch.privacy !== undefined ? cleanPrivacy(patch.privacy) : c.privacy,
      updatedAt: new Date(),
    })
    .where(eq(pnlCards.id, c.id))
    .returning()
  return view(row)
}

// Gone, and its link with it.
export async function deleteCard(userId: string, id: number): Promise<void> {
  const c = await ownCard(userId, id)
  await db.delete(pnlCards).where(eq(pnlCards.id, c.id))
}

export async function getCard(userId: string, id: number): Promise<PnlCardView> {
  return view(await ownCard(userId, id))
}

export async function listCards(userId: string, limit = 8): Promise<PnlCardSummary[]> {
  const rows = await db.select({ id: pnlCards.id, token: pnlCards.token, layout: pnlCards.layout, privacy: pnlCards.privacy, data: pnlCards.data, createdAt: pnlCards.createdAt }).from(pnlCards).where(eq(pnlCards.userId, userId)).orderBy(desc(pnlCards.createdAt)).limit(Math.min(50, Math.max(1, limit)))
  return rows.map((c) => ({ id: c.id, token: c.token, layout: cleanLayout(c.layout), privacy: cleanPrivacy(c.privacy), scopeLabel: c.data.scopeLabel, createdAt: c.createdAt.toISOString() }))
}

// A card by its link. Its owner gets it whatever it is; anyone else only while it is public, and only
// what is switched on. null: there is no such card (never was, or deleted).
export async function readSharedCard(token: string, viewerId: string | null): Promise<{ state: "ok"; card: PublicPnlCard; own: boolean } | { state: "private" } | null> {
  const clean = String(token ?? "")
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(clean)) return null
  const [c] = await db.select().from(pnlCards).where(eq(pnlCards.token, clean)).limit(1)
  if (!c) return null
  const own = viewerId != null && c.userId === viewerId
  if (cleanPrivacy(c.privacy) !== "public" && !own) return { state: "private" }
  // the owner sees what everyone would: the page is the card as it is shared, not the editor
  return { state: "ok", own, card: publicCard({ token: c.token, layout: cleanLayout(c.layout) as PnlCardLayout, visibility: cleanVisibility(c.visibility), data: c.data }) }
}
