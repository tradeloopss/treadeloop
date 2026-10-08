import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { copyAccountPrefs, copyEvents, copyGroupContracts, copyGroupFollowers, copyGroups, copyOrders, copyPositions, copyRiskLimits, copyRules, copySymbolMappings, metatraderConnections, orderCommands, providerAccounts, rithmicConnections, trades, tradingAccounts } from "@/lib/db/schema"
import { getAppSetting } from "@/lib/app-settings"
import { encrypt } from "@/lib/crypto"
import { TRADING_CHECK_NOTES, tradingCheckOf, tradingUsable } from "@/lib/order-execution/trading-check"
import { readHeartbeat } from "@/lib/heartbeat"
import type { AccountEvaluation } from "@/lib/propmax/engine"
import type { OpenTradeView } from "@/lib/trade-manager"
import { localDay } from "@/lib/timezone"
import { detectProvider, providerProfile, validateConnection, validateDirection, validateExecution, validateRole, type Party, type Verdict } from "@/lib/compliance/engine"
import { ComplianceError, parties, recordBlock, ruleSets } from "@/lib/compliance/server"
import { accountKind, validateSharing } from "@/lib/compliance/kind"
import { accountFacts, joinedShares, listShares } from "./shares"
import { pointValueAt, sameInstrument, specFor, type ContractSpec } from "./contracts"
import { DEFAULT_FOLLOWER, DEFAULT_RULES, NO_PROPSYNC, activationProblems, connectionHealth, followerOrderId, masterOrderId, planLeaderEvents, proportionalClose, translatePrice, validateCopyRules, type CopyAction, type CopyRules, type Decision, type FollowerConfig, type LivePosition, type PropSyncState, type RoundingRule, type Side, type SizingMode, type Step } from "./engine"
import { PLAN_TTL_MS, clock, closeRef, decideEntry, entryRef, guardView, specOf, type LanePlan } from "./plan"
import { classifyFailure } from "./errors"
import { groupScope, symbolScope, accountIn, isUnderway, type AccountScope, type AccountView, type ComplianceProblem, type CopyState, type EventView, type FollowerView, type GroupLimits, type GroupStatus, type GroupView, type OrderView, type PositionView, type Role } from "./view"

// Copy Trading's server side: what a trader's setup is, and the engine that
// turns a change on the leader's account into orders for the followers.
//
// Every query is scoped by the user id the session resolved, and every account
// id handed in is checked to be that user's before anything is written.
//
// The engine has two modes. In SIMULATION (the default) it does everything —
// reads the leader, applies the rules, sizes each follower, records each order
// and why — and sends nothing to a broker. In LIVE it hands each follower order
// to the existing order queue (order_commands), which has its own prop-rule
// guard and is the same path the Trade Manager uses.

export const LIVE_SETTING = "copy_trading_live"
export const BACKGROUND_SETTING = "copy_trading_background"
// A leader whose last sync is older than this is not acted on: its picture is too old to copy from.
export const LEADER_FRESH_MS = 5 * 60_000
// How recently the copy lane must have read an account for the account to count as on it.
export const LANE_FRESH_MS = 20_000
export const MAX_GROUPS = 20
export const MAX_FOLLOWERS = 25
export const MAX_CONTRACTS = 30

const num = (v: unknown) => (v == null ? null : Number(v))
const str = (v: number | null | undefined) => (v == null ? null : String(v))
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Where the live positions come from: the same reader as the Trade Manager,
// for the signed-in trader. null = they couldn't be read this time.
type LiveReader = (userId: string, onlyAccountId?: number) => Promise<Pick<OpenTradeView, "id" | "accountId" | "symbol" | "side" | "quantity" | "entryPrice" | "currentPrice" | "unrealizedPnl" | "stopLoss" | "takeProfit" | "positionRef">[] | null>
let readLive: LiveReader = async (userId, onlyAccountId) => {
  try {
    const { loadOpenPositions } = await import("@/lib/trade-manager-server")
    return (await loadOpenPositions(userId, onlyAccountId)).trades
  } catch {
    return null
  }
}
// Replaces the reader (the integration tests give the engine a leader of their own).
export const setLiveReader = (reader: LiveReader) => {
  readLive = reader
}

export async function engineMode(): Promise<"simulation" | "live"> {
  return (await getAppSetting<boolean>(LIVE_SETTING).catch(() => null)) === true ? "live" : "simulation"
}

// PropSync's view of every account, kept for half a minute: the pages poll.
type Prop = { state: PropSyncState; evaluation: AccountEvaluation | null }
const propCache = new Map<string, { at: number; byAccount: Map<number, Prop> }>()
async function propSync(userId: string): Promise<Map<number, Prop>> {
  const hit = propCache.get(userId)
  if (hit && Date.now() - hit.at < 30_000) return hit.byAccount
  const byAccount = new Map<number, Prop>()
  try {
    const { getPropMaxOverview } = await import("@/lib/propmax/account")
    for (const view of await getPropMaxOverview(userId)) {
      const e = view.evaluation
      if (!view.binding || !e) continue
      const breached = e.rules.filter((r) => r.status === "breached")
      const blocked = e.risk.status === "breached" || breached.length > 0
      const daily = e.rules.find((r) => r.type === "max_daily_loss" && r.remainingValue != null)
      byAccount.set(view.accountId, { evaluation: e, state: { tracked: true, blocked, reason: blocked ? `${breached[0]?.name ?? "A prop-firm rule"} is breached, so new trades are blocked on this account.` : null, dailyLossRemaining: daily?.remainingValue ?? null } })
    }
  } catch {
    // PropSync unavailable: accounts are treated as not tracked rather than blocked
  }
  if (propCache.size > 200) propCache.clear()
  propCache.set(userId, { at: Date.now(), byAccount })
  return byAccount
}

const toConfig = (r: typeof copyGroupFollowers.$inferSelect): FollowerConfig => ({
  enabled: r.enabled,
  sizingMode: r.sizingMode as SizingMode,
  percentage: num(r.percentage),
  multiplier: num(r.multiplier),
  fixedQuantity: num(r.fixedQuantity),
  riskPercentage: num(r.riskPercentage),
  customFactor: num(r.customFactor),
  minQuantity: num(r.minQuantity),
  maxPositionSize: num(r.maxPositionSize),
  maxDailyLoss: num(r.maxDailyLoss),
  maxExposure: num(r.maxExposure),
  roundingRule: r.roundingRule as RoundingRule,
})
const toSpec = (r: typeof copyGroupContracts.$inferSelect): ContractSpec => ({ symbol: r.symbol, root: r.root, name: r.name, exchange: r.exchange, type: r.type as ContractSpec["type"], expiration: r.expiration, tickSize: Number(r.tickSize), tickValue: num(r.tickValue), pointValue: num(r.pointValue), contractMultiplier: Number(r.contractMultiplier), minimumQuantity: Number(r.minimumQuantity), quantityStep: Number(r.quantityStep) })
const toRules = (r: typeof copyRules.$inferSelect | undefined): CopyRules => (r ? { marketOrders: r.marketOrders, limitOrders: r.limitOrders, stopOrders: r.stopOrders, stopLoss: r.stopLoss, takeProfit: r.takeProfit, modifications: r.modifications, partialClose: r.partialClose, fullClose: r.fullClose, cancel: r.cancel, trailingStop: r.trailingStop, direction: r.direction as CopyRules["direction"], symbolScope: r.symbolScope as CopyRules["symbolScope"], hoursFrom: r.hoursFrom, hoursTo: r.hoursTo, days: Array.isArray(r.days) ? r.days : [1, 2, 3, 4, 5] } : { ...DEFAULT_RULES })

// ------------------------------------------------------------------ reading

export async function loadCopyState(userId: string, timeZone: string): Promise<CopyState> {
  const since = new Date(Date.now() - 36 * 3_600_000)
  const [accountRows, mt, rith, prov, prefs, groupRows, followerRows, contractRows, ruleRows, limitRows, mappingRows, managed, orderRows, eventRows, closed, mode, live, prop, traded, background, beat] = await Promise.all([
    db.select().from(tradingAccounts).where(and(eq(tradingAccounts.userId, userId), eq(tradingAccounts.archived, false))),
    db
      .select({ accountId: metatraderConnections.accountId, platform: metatraderConnections.platform, login: metatraderConnections.login, server: metatraderConnections.server, status: metatraderConnections.status, message: metatraderConnections.statusMessage, balance: metatraderConnections.balance, equity: metatraderConnections.equity, open: metatraderConnections.openPositions, lastSyncedAt: metatraderConnections.lastSyncedAt, hasTrading: sql<boolean>`${metatraderConnections.tradingPasswordEnc} is not null`, tradingCheck: metatraderConnections.tradingCheck, copySlot: metatraderConnections.copySlot, copySeenAt: metatraderConnections.copySeenAt, copyPingMs: metatraderConnections.copyPingMs })
      .from(metatraderConnections)
      .where(eq(metatraderConnections.userId, userId)),
    db.select({ accountId: rithmicConnections.accountId, login: rithmicConnections.login, lastSyncedAt: rithmicConnections.lastSyncedAt, lastSyncStatus: rithmicConnections.lastSyncStatus }).from(rithmicConnections).where(eq(rithmicConnections.userId, userId)),
    // provider accounts carry no user id of their own: they are reached through the journal account they feed
    db.select({ accountId: providerAccounts.tradingAccountId, provider: providerAccounts.provider, status: providerAccounts.status, balance: providerAccounts.balance, equity: providerAccounts.equity }).from(providerAccounts).innerJoin(tradingAccounts, eq(tradingAccounts.id, providerAccounts.tradingAccountId)).where(and(eq(tradingAccounts.userId, userId), eq(providerAccounts.enabled, true))),
    db.select().from(copyAccountPrefs).where(eq(copyAccountPrefs.userId, userId)),
    db.select().from(copyGroups).where(eq(copyGroups.userId, userId)).orderBy(copyGroups.createdAt),
    db.select().from(copyGroupFollowers).where(eq(copyGroupFollowers.userId, userId)).orderBy(copyGroupFollowers.position, copyGroupFollowers.id),
    db.select().from(copyGroupContracts).where(eq(copyGroupContracts.userId, userId)).orderBy(copyGroupContracts.id),
    db.select().from(copyRules).where(eq(copyRules.userId, userId)),
    db.select().from(copyRiskLimits).where(eq(copyRiskLimits.userId, userId)),
    db.select().from(copySymbolMappings).where(eq(copySymbolMappings.userId, userId)),
    db.select().from(copyPositions).where(and(eq(copyPositions.userId, userId), eq(copyPositions.status, "open"))),
    db.select().from(copyOrders).where(eq(copyOrders.userId, userId)).orderBy(desc(copyOrders.createdAt)).limit(300),
    db.select().from(copyEvents).where(eq(copyEvents.userId, userId)).orderBy(desc(copyEvents.createdAt)).limit(120),
    db.select({ accountId: trades.accountId, pnl: trades.pnl, exitTime: trades.exitTime }).from(trades).where(and(eq(trades.userId, userId), eq(trades.status, "closed"), gte(trades.exitTime, since))),
    engineMode(),
    readLive(userId),
    propSync(userId),
    db.select({ accountId: trades.accountId, symbol: trades.symbol }).from(trades).where(eq(trades.userId, userId)).groupBy(trades.accountId, trades.symbol),
    getAppSetting<boolean>(BACKGROUND_SETTING).catch(() => null),
    readHeartbeat("copy_engine").catch(() => null),
  ])
  // The providers' rules in force (lib/compliance), and what each account is to them.
  const sets = await ruleSets()
  const atProvider = mt.filter((m) => m.accountId != null && detectProvider(sets, m.server)).map((m) => m.accountId!)
  // (whether a login is shared with another user is only looked up for an account that has a provider's rules on it)
  const party = atProvider.length ? await parties(userId, atProvider) : new Map<number, Party>()

  const today = localDay(new Date(), timeZone)
  const closedToday = new Map<number, number>()
  for (const t of closed) if (t.accountId != null && t.exitTime && localDay(t.exitTime, timeZone) === today) closedToday.set(t.accountId, (closedToday.get(t.accountId) ?? 0) + Number(t.pnl))

  // live positions, as the brokers report them
  const positions: PositionView[] = []
  const keys = new Map<PositionView, string>()
  const ownIds = new Set(accountRows.map((a) => a.id))
  const take = (t: NonNullable<typeof live>[number]) => {
    const p: PositionView = { accountId: t.accountId!, symbol: t.symbol, side: t.side, quantity: t.quantity, entry: t.entryPrice, current: t.currentPrice, openPnl: t.unrealizedPnl, stopLoss: t.stopLoss, takeProfit: t.takeProfit, simulated: false, groupId: null }
    positions.push(p)
    keys.set(p, t.positionRef ?? `t${t.id}`)
  }
  // the trader's own accounts only: what belongs to anybody else comes through a share, below
  for (const t of live ?? []) if (t.accountId != null && ownIds.has(t.accountId)) take(t)

  // Strategies friends share with this trader (lib/copy/shares.ts): each is a
  // Leader to copy from and nothing more. Its open trades are read, through its
  // owner's own connection; its balance, its login and its owner's other
  // accounts are not. One that couldn't be read makes the whole reading
  // unusable: an unread Leader must never look like one that closed everything.
  const joined = await joinedShares(userId)
  let sharedRead = true
  for (const j of joined) {
    const theirs = await readLive(j.ownerId, j.accountId)
    if (theirs == null) sharedRead = false
    for (const t of theirs ?? []) if (t.accountId === j.accountId) take(t)
  }
  liveKeys.set(positions, keys)
  // the price of a symbol, from any account that reports one
  const lastPrice = new Map<string, number>()
  for (const p of positions) if (p.current != null) lastPrice.set(p.symbol.toUpperCase(), p.current)

  const groupName = new Map(groupRows.map((g) => [g.id, g.name]))
  const memberships = new Map<number, { id: number; name: string; as: "leader" | "follower" }[]>()
  const join = (accountId: number, m: { id: number; name: string; as: "leader" | "follower" }) => memberships.set(accountId, [...(memberships.get(accountId) ?? []), m])
  for (const g of groupRows) join(g.leaderAccountId, { id: g.id, name: g.name, as: "leader" })
  for (const f of followerRows) join(f.accountId, { id: f.groupId, name: groupName.get(f.groupId) ?? "", as: "follower" })

  const accounts: AccountView[] = accountRows.map((a) => {
    const m = mt.find((x) => x.accountId === a.id)
    const r = rith.find((x) => x.accountId === a.id)
    const p = prov.find((x) => x.accountId === a.id)
    const pref = prefs.find((x) => x.accountId === a.id)
    const mine = positions.filter((x) => x.accountId === a.id)
    const balance = num(m?.balance) ?? num(p?.balance) ?? num(a.currentBalance) ?? Number(a.startingBalance)
    const known = mine.filter((x) => x.openPnl != null)
    const openPnl = known.length ? known.reduce((s, x) => s + x.openPnl!, 0) : null
    const health = m
      ? connectionHealth({ linked: true, status: m.status, lastSyncAt: m.lastSyncedAt?.getTime() ?? null, message: m.message })
      : r
        ? connectionHealth({ linked: true, status: r.lastSyncStatus ?? "pending", lastSyncAt: r.lastSyncedAt?.getTime() ?? null })
        : p
          ? connectionHealth({ linked: true, status: p.status === "active" ? "ok" : "inactive", lastSyncAt: Date.now() })
          : "disconnected"
    const groups = memberships.get(a.id) ?? []
    const leads = groups.some((g) => g.as === "leader")
    const follows = groups.some((g) => g.as === "follower")
    const preferred = (pref?.role ?? "unassigned") as Role
    // what the account's provider allows (lib/compliance): no order is sent where it doesn't
    const set = m ? detectProvider(sets, m.server) : null
    const execution = validateExecution(set)
    // what the broker said of the saved trading password, when it was asked: no order is sent with one it turned down
    const ordersCheck = m?.hasTrading ? tradingCheckOf(m.tradingCheck) : null
    const canExecute = !!m && m.platform === "mt5" && !!m.hasTrading && execution.allowed && tradingUsable(ordersCheck)
    const canAllowOrders = !!m && m.platform === "mt5" && execution.allowed && validateConnection(set, { credential: "trading", acknowledged: true }).allowed
    return {
      id: a.id,
      name: a.name,
      broker: a.broker,
      platform: m ? `MetaTrader ${m.platform === "mt4" ? 4 : 5}` : r ? "Rithmic" : p ? title(p.provider) : "Manual",
      login: m?.login ?? r?.login ?? null,
      currency: a.currency,
      balance,
      equity: num(m?.equity) ?? num(p?.equity) ?? (openPnl != null ? balance + openPnl : balance),
      openPositions: live ? mine.length : (m?.open ?? 0),
      linked: !!(m || r || p),
      health,
      healthNote: m?.message ?? (!(m || r || p) ? "No broker connection is linked to this account." : null),
      lastSyncAt: (m?.lastSyncedAt ?? r?.lastSyncedAt ?? null)?.toISOString() ?? null,
      latencyMs: pref?.lastLatencyMs ?? null,
      heartbeatAt: (m?.lastSyncedAt ?? r?.lastSyncedAt ?? null)?.toISOString() ?? null,
      preferredRole: preferred,
      role: leads && follows ? "both" : leads ? "leader" : follows ? "follower" : preferred,
      groups,
      canExecute,
      provider: set?.provider ?? null,
      connectedBy: m || r ? "TradeLoop cloud" : p ? (p.provider === "tradingview" ? "Browser extension" : title(p.provider)) : "Not connected",
      // TradeLoop can't tell an investor password from a master one: only whether a password to trade with is kept
      authentication: m ? (m.hasTrading ? "Login password + trading password" : "Login password only (orders not allowed)") : r ? "Rithmic login" : p ? "Paired session" : null,
      canAllowOrders,
      ordersAllowed: !!m?.hasTrading,
      ordersCheck,
      executionNote: canExecute ? "Orders can be placed on this account." : !execution.allowed ? execution.message : m ? (m.platform === "mt4" ? "MetaTrader 4 can't receive orders from TradeLoop yet." : canAllowOrders && m.hasTrading && (ordersCheck === "rejected" || ordersCheck === "read_only") ? TRADING_CHECK_NOTES[ordersCheck] : canAllowOrders ? "Orders aren't allowed on this account yet. Allow them on the Connection page: Manage, then Allow orders." : "TradeLoop can't place orders on this account.") : r || p ? `${r ? "Rithmic" : title(p!.provider)} accounts can't receive orders from TradeLoop yet.` : "A manual account can't receive orders.",
      dayPnl: (closedToday.get(a.id) ?? 0) + (openPnl ?? 0),
      openPnl,
      openNotional: mine.reduce((s, x) => {
        const point = pointValueAt(specFor(x.symbol), x.current ?? x.entry)
        const at = x.current ?? x.entry
        return point != null && at != null ? s + x.quantity * at * point : s
      }, 0),
      propSync: prop.get(a.id)?.state ?? NO_PROPSYNC,
      symbols: [...new Set([...mine.map((x) => x.symbol), ...traded.filter((t) => t.accountId === a.id).map((t) => t.symbol)])].slice(0, 120),
      lane: m?.copySlot && m.copySeenAt && Date.now() - m.copySeenAt.getTime() < LANE_FRESH_MS ? "fast" : "standard",
      pingMs: m?.copySlot ? (m.copyPingMs ?? null) : null,
      shared: null,
      sharing: ((k) => (k.kind === "broker" ? { ok: true as const } : { ok: false as const, reason: k.reason }))(accountKind({ platform: m ? (m.platform === "mt4" ? "mt4" : "mt5") : r ? "rithmic" : p ? "other" : null, server: m?.server ?? null, broker: a.broker, provider: set?.name ?? null, propTracked: prop.get(a.id)?.state.tracked === true })),
    }
  })

  // the friends' strategies, as accounts this trader can only lead a group with
  const shared: AccountView[] = []
  if (joined.length) {
    const ids = joined.map((j) => j.accountId)
    const [theirAccounts, theirConnections] = await Promise.all([
      db.select({ id: tradingAccounts.id, currency: tradingAccounts.currency }).from(tradingAccounts).where(and(inArray(tradingAccounts.id, ids), eq(tradingAccounts.archived, false))),
      db.select({ accountId: metatraderConnections.accountId, platform: metatraderConnections.platform, status: metatraderConnections.status, lastSyncedAt: metatraderConnections.lastSyncedAt, copySlot: metatraderConnections.copySlot, copySeenAt: metatraderConnections.copySeenAt }).from(metatraderConnections).where(inArray(metatraderConnections.accountId, ids)),
    ])
    for (const j of joined) {
      const a = theirAccounts.find((x) => x.id === j.accountId)
      if (!a) continue
      const m = theirConnections.find((x) => x.accountId === j.accountId)
      const mine = positions.filter((x) => x.accountId === j.accountId)
      shared.push({
        id: j.accountId,
        name: j.name,
        broker: null,
        platform: m ? `MetaTrader ${m.platform === "mt4" ? 4 : 5}` : "Manual",
        login: null,
        currency: a.currency,
        balance: null,
        equity: null,
        openPositions: mine.length,
        linked: !!m,
        // (never the owner's own status message: that is theirs to read)
        health: m ? connectionHealth({ linked: true, status: m.status, lastSyncAt: m.lastSyncedAt?.getTime() ?? null }) : "disconnected",
        healthNote: null,
        lastSyncAt: m?.lastSyncedAt?.toISOString() ?? null,
        latencyMs: null,
        heartbeatAt: m?.lastSyncedAt?.toISOString() ?? null,
        preferredRole: "leader",
        role: "leader",
        groups: memberships.get(j.accountId) ?? [],
        provider: null,
        connectedBy: `Shared by ${j.owner}`,
        authentication: null,
        shared: { shareId: j.shareId, owner: j.owner },
        sharing: { ok: true },
        canExecute: false,
        canAllowOrders: false,
        ordersAllowed: false,
        ordersCheck: null,
        executionNote: "A friend's account: TradeLoop reads its trades for you, and never places an order on it.",
        dayPnl: 0,
        openPnl: null,
        openNotional: 0,
        propSync: NO_PROPSYNC,
        symbols: [...new Set(mine.map((x) => x.symbol))],
        lane: m?.copySlot && m.copySeenAt && Date.now() - m.copySeenAt.getTime() < LANE_FRESH_MS ? "fast" : "standard",
        pingMs: null,
      })
    }
  }
  // a group led by somebody else's account: is it still shared with this trader, and are both ends broker accounts?
  const led = groupRows.filter((g) => !ownIds.has(g.leaderAccountId))
  const sharingOf = new Map<number, ComplianceProblem[]>()
  for (const g of led) sharingOf.set(g.id, await sharingProblems(userId, g.leaderAccountId, followerRows.filter((f) => f.groupId === g.id).map((f) => f.accountId)))

  const groups: GroupView[] = groupRows.map((g) => {
    const limits = limitRows.find((l) => l.groupId === g.id)
    const members = followerRows.filter((f) => f.groupId === g.id).map((f) => f.accountId)
    // only a group with an account at a provider that has rules is asked anything
    const compliance = [...(sharingOf.get(g.id) ?? []), ...([g.leaderAccountId, ...members].some((id) => party.has(id)) ? groupProblems(party, g.leaderAccountId, members) : [])]
    return {
      id: g.id,
      name: g.name,
      status: g.status as GroupStatus,
      leaderAccountId: g.leaderAccountId,
      followers: followerRows.filter((f) => f.groupId === g.id).map((f): FollowerView => ({ id: f.id, accountId: f.accountId, config: toConfig(f), mappings: mappingRows.filter((m) => m.followerId === f.id).map((m) => ({ leaderSymbol: m.leaderSymbol, followerSymbol: m.followerSymbol })) })),
      contracts: contractRows.filter((c) => c.groupId === g.id).map(toSpec),
      rules: toRules(ruleRows.find((r) => r.groupId === g.id)),
      limits: { defaultMode: limits?.defaultMode ?? "same", defaultRatio: Number(limits?.defaultRatio ?? 1), globalRiskPct: Number(limits?.globalRiskPct ?? 1), respectPropSync: limits?.respectPropSync ?? true },
      compliance,
      createdAt: g.createdAt.toISOString(),
    }
  })

  // followers' simulated positions: marked at the leader's price for the same symbol
  for (const m of managed) {
    if (m.role !== "follower" || !m.simulated) continue
    const entry = num(m.entryPrice)
    const leaderRow = managed.find((x) => x.id === m.leaderPositionId)
    const current = (leaderRow && lastPrice.get(leaderRow.symbol.toUpperCase())) ?? lastPrice.get(m.symbol.toUpperCase()) ?? null
    const point = pointValueAt(specFor(m.symbol), current ?? entry)
    const quantity = Number(m.quantity)
    positions.push({ accountId: m.accountId, symbol: m.symbol, side: m.side as Side, quantity, entry, current, openPnl: entry != null && current != null && point != null ? (current - entry) * (m.side === "long" ? 1 : -1) * quantity * point : null, stopLoss: num(m.stopLoss), takeProfit: num(m.takeProfit), simulated: true, groupId: m.groupId })
  }

  const orders: OrderView[] = orderRows.map((o) => ({ id: o.id, groupId: o.groupId, correlationId: o.correlationId, masterOrderId: o.masterOrderId, masterAccountId: o.masterAccountId, followerAccountId: o.followerAccountId, action: o.action, symbol: o.symbol, leaderSymbol: o.leaderSymbol, side: o.side as Side, quantity: Number(o.quantity), leaderQuantity: num(o.leaderQuantity), requestedPrice: num(o.requestedPrice), executionPrice: num(o.executionPrice), status: o.status, reason: o.reason, slippage: num(o.slippage), latencyMs: o.latencyMs, tradeloopMs: o.tradeloopMs, simulated: o.simulated, createdAt: o.createdAt.toISOString(), steps: (Array.isArray((o.decision as { steps?: Step[] } | null)?.steps) ? (o.decision as { steps: Step[] }).steps : []) as Step[] }))
  const events: EventView[] = eventRows.map((e) => ({ id: e.id, groupId: e.groupId, accountId: e.accountId, level: e.level as EventView["level"], code: e.code, title: e.title, body: e.body, action: e.action, masterOrderId: e.masterOrderId, createdAt: e.createdAt.toISOString(), unread: !e.readAt }))

  return { mode, accounts, shared, shares: await listShares(userId), groups, positions, orders, events, providers: sets.map(providerProfile), liveData: live != null && sharedRead, engine: { background: background !== false, lastRunAt: beat?.at.toISOString() ?? null, ok: beat?.ok ?? false }, at: new Date().toISOString() }
}
// the broker's own id of each live position, kept beside the state rather than sent to the browser
const liveKeys = new WeakMap<PositionView[], Map<PositionView, string>>()

// ------------------------------------------------------------------ writing: setup

async function ownAccounts(userId: string, ids: number[]): Promise<void> {
  const unique = [...new Set(ids)]
  if (unique.some((id) => !Number.isInteger(id) || id <= 0)) throw new Error("That account doesn't exist.")
  if (!unique.length) return
  const rows = await db.select({ id: tradingAccounts.id }).from(tradingAccounts).where(and(eq(tradingAccounts.userId, userId), inArray(tradingAccounts.id, unique), eq(tradingAccounts.archived, false)))
  if (rows.length !== unique.length) throw new Error("One of those accounts isn't yours, or has been archived.")
}
// What the providers' rules have against a Master and its Followers
// (lib/compliance): the first objection to each account. An account at no
// provider with rules is never asked about.
function groupProblems(party: Map<number, Party>, leader: number, followers: number[]): ComplianceProblem[] {
  const master = party.get(leader) ?? { set: null }
  const problems: ComplianceProblem[] = []
  const add = (accountId: number, v: Verdict) => {
    if (!v.allowed) problems.push({ accountId, provider: v.provider, reasonCode: v.reasonCode, message: v.message })
  }
  // a Master that may not be read is a problem with no follower at all
  const reading = validateRole(master, "leader")
  add(leader, reading)
  for (const id of followers) {
    const follower = party.get(id) ?? { set: null }
    const v = validateDirection(master, follower)
    // the Master's own objection is listed once, against the Master
    if (!v.allowed && !reading.allowed && v.reasonCode === reading.reasonCode && !follower.set) continue
    add(id, v)
  }
  return problems
}
const asVerdict = (p: ComplianceProblem) => ({ allowed: false as const, provider: p.provider, reasonCode: p.reasonCode as Extract<Verdict, { allowed: false }>["reasonCode"], message: p.message })

// The Leader of a group is the trader's own account, or a strategy a friend
// shares with them (lib/copy/shares.ts). Nobody else's account, ever.
async function ownLeader(userId: string, accountId: number): Promise<"own" | "shared"> {
  if (!Number.isInteger(accountId) || accountId <= 0) throw new Error("That account doesn't exist.")
  const [own] = await db.select({ id: tradingAccounts.id }).from(tradingAccounts).where(and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.userId, userId), eq(tradingAccounts.archived, false))).limit(1)
  if (own) return "own"
  if ((await joinedShares(userId)).some((s) => s.accountId === accountId)) return "shared"
  throw new Error("One of those accounts isn't yours, or has been archived.")
}

// A strategy shared between people is copied between broker accounts only
// (lib/compliance/kind.ts): asked whenever a group's Leader is not the
// trader's own account. Nothing when the Leader is their own.
const SHARED = "Shared strategy"
async function sharingProblems(userId: string, leader: number, followers: number[]): Promise<ComplianceProblem[]> {
  const facts = await accountFacts([leader, ...followers])
  const lead = facts.get(leader)
  if (lead?.userId === userId) return []
  // not shared with this trader (any more): nothing is read from it
  if (!lead || !(await joinedShares(userId)).some((s) => s.accountId === leader)) return [{ accountId: leader, provider: SHARED, reasonCode: "SHARE_ENDED", message: "This strategy is no longer shared with you." }]
  const leaderKind = accountKind(lead)
  if (leaderKind.kind !== "broker") return [{ accountId: leader, provider: SHARED, reasonCode: "SHARED_LEADER_NOT_BROKER", message: `This strategy can't be copied any more. ${leaderKind.reason}` }]
  const problems: ComplianceProblem[] = []
  for (const id of followers) {
    const f = facts.get(id)
    if (!f) continue
    const v = validateSharing(leaderKind, accountKind(f))
    if (!v.allowed) problems.push({ accountId: id, provider: SHARED, reasonCode: v.reasonCode, message: v.message })
  }
  return problems
}

// When a strategy stops being shared with someone (removed by the owner, the
// owner stops sharing, or they leave): their groups on it stop copying. What
// they already hold is left as it is: only they close their own positions.
export async function endSharedGroups(userIds: string[], accountId: number, why: string): Promise<number> {
  if (!userIds.length) return 0
  const groups = await db.update(copyGroups).set({ status: "paused", updatedAt: new Date() }).where(and(inArray(copyGroups.userId, userIds), eq(copyGroups.leaderAccountId, accountId), eq(copyGroups.status, "active"))).returning({ id: copyGroups.id, userId: copyGroups.userId })
  for (const g of groups) {
    await note(g.userId, { groupId: g.id, level: "warning", code: "group_paused", title: "Copying paused: the strategy is no longer shared", body: `${why} Positions that are already open are left as they are.`, action: "Close them yourself in the Cockpit if you want to, or choose another Leader for the group." })
    await clearPlans(g.userId)
    await syncCopyRoles(g.userId)
  }
  return groups.length
}

// A Copy Group is set up only as the providers of its accounts allow, and a
// shared strategy only between broker accounts: asked here for every change,
// whatever the page showed. A refusal is recorded.
async function comply(userId: string, ask: { leader: number; followers: number[]; groupId?: number | null; action: string }): Promise<void> {
  const party = await parties(userId, [ask.leader, ...ask.followers])
  // a follower's own objection says more than the Master's (which way round is wrong, not just that it can't be read)
  const found = [...(await sharingProblems(userId, ask.leader, ask.followers)), ...groupProblems(party, ask.leader, ask.followers)]
  const first = found.find((p) => p.accountId !== ask.leader) ?? found[0]
  if (!first) return
  await recordBlock(userId, asVerdict(first), { groupId: ask.groupId, accountId: first.accountId, action: ask.action })
  throw new ComplianceError(asVerdict(first))
}
// What the review step of the Copy Group wizard is told, before anything is saved.
export async function previewCompliance(userId: string, leader: number, followers: number[]): Promise<ComplianceProblem[]> {
  const ids = [leader, ...followers]
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) return []
  await ownAccounts(userId, followers)
  await ownLeader(userId, leader)
  return [...(await sharingProblems(userId, leader, followers)), ...groupProblems(await parties(userId, ids), leader, followers)]
}
// After a provider's rules change: every active group with one of its
// accounts is asked again, and one the rules now object to stops copying. Its
// open positions are left as they are: pausing never closes anything. Returns
// how many groups were paused.
export async function revalidateGroups(provider: string): Promise<number> {
  const sets = await ruleSets()
  const rows = await db.select({ accountId: metatraderConnections.accountId, server: metatraderConnections.server }).from(metatraderConnections).where(isNotNull(metatraderConnections.accountId))
  const accounts = rows.filter((r) => detectProvider(sets, r.server)?.provider === provider).map((r) => r.accountId!)
  if (!accounts.length) return 0
  const following = await db.select({ groupId: copyGroupFollowers.groupId }).from(copyGroupFollowers).where(inArray(copyGroupFollowers.accountId, accounts))
  const groups = await db
    .select({ id: copyGroups.id, userId: copyGroups.userId, leaderAccountId: copyGroups.leaderAccountId })
    .from(copyGroups)
    .where(and(eq(copyGroups.status, "active"), following.length ? or(inArray(copyGroups.leaderAccountId, accounts), inArray(copyGroups.id, following.map((f) => f.groupId))) : inArray(copyGroups.leaderAccountId, accounts)))
  let paused = 0
  for (const g of groups) {
    const members = (await db.select({ accountId: copyGroupFollowers.accountId }).from(copyGroupFollowers).where(eq(copyGroupFollowers.groupId, g.id))).map((f) => f.accountId)
    const found = groupProblems(await parties(g.userId, [g.leaderAccountId, ...members]), g.leaderAccountId, members)
    if (!found.length) continue
    const first = found.find((p) => p.accountId !== g.leaderAccountId) ?? found[0]
    await db.update(copyGroups).set({ status: "paused", updatedAt: new Date() }).where(eq(copyGroups.id, g.id))
    await recordBlock(g.userId, asVerdict(first), { groupId: g.id, accountId: first.accountId, action: "rules_changed" })
    await note(g.userId, { groupId: g.id, level: "warning", code: "group_paused", title: `Copying paused: ${first.provider}'s rules`, body: `${first.message} Positions that are already open are left as they are.` })
    // the sync server stops acting for this trader by itself, now
    await clearPlans(g.userId)
    await syncCopyRoles(g.userId)
    paused++
  }
  return paused
}
async function ownGroup(userId: string, groupId: number) {
  const [g] = await db.select().from(copyGroups).where(and(eq(copyGroups.id, groupId), eq(copyGroups.userId, userId))).limit(1)
  if (!g) throw new Error("That copy group no longer exists.")
  return g
}

const positive = (v: unknown, max: number) => (v == null || v === "" ? null : Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= max ? Number(v) : NaN)
const MODES: SizingMode[] = ["same", "percentage", "multiplier", "risk", "fixed", "custom"]
const ROUNDING: RoundingRule[] = ["down", "up", "nearest", "min1"]

// A follower's settings as typed, checked: a number that makes no sense is refused, not corrected.
export function cleanConfig(raw: unknown): FollowerConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const out: FollowerConfig = {
    enabled: r.enabled !== false,
    sizingMode: MODES.includes(r.sizingMode as SizingMode) ? (r.sizingMode as SizingMode) : "same",
    percentage: positive(r.percentage, 10_000),
    multiplier: positive(r.multiplier, 1_000),
    fixedQuantity: positive(r.fixedQuantity, 100_000),
    riskPercentage: positive(r.riskPercentage, 100),
    customFactor: positive(r.customFactor, 10_000),
    minQuantity: positive(r.minQuantity, 100_000),
    maxPositionSize: positive(r.maxPositionSize, 1_000_000),
    maxDailyLoss: positive(r.maxDailyLoss, 1_000_000_000),
    maxExposure: positive(r.maxExposure, 1_000_000),
    roundingRule: ROUNDING.includes(r.roundingRule as RoundingRule) ? (r.roundingRule as RoundingRule) : "nearest",
  }
  for (const [k, v] of Object.entries(out)) if (typeof v === "number" && Number.isNaN(v)) throw new Error(`That isn't a valid value for ${k.replace(/([A-Z])/g, " $1").toLowerCase()}.`)
  return out
}
const configColumns = (c: FollowerConfig) => ({ enabled: c.enabled, sizingMode: c.sizingMode, percentage: str(c.percentage), multiplier: str(c.multiplier), fixedQuantity: str(c.fixedQuantity), riskPercentage: str(c.riskPercentage), customFactor: str(c.customFactor), minQuantity: str(c.minQuantity), maxPositionSize: str(c.maxPositionSize), maxDailyLoss: str(c.maxDailyLoss), maxExposure: str(c.maxExposure), roundingRule: c.roundingRule, updatedAt: new Date() })

export function cleanRules(raw: unknown): CopyRules {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const time = (v: unknown) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null)
  const out = { ...DEFAULT_RULES }
  for (const k of ["marketOrders", "limitOrders", "stopOrders", "stopLoss", "takeProfit", "modifications", "partialClose", "fullClose", "cancel", "trailingStop"] as const) if (typeof r[k] === "boolean") out[k] = r[k] as boolean
  if (r.direction === "long" || r.direction === "short" || r.direction === "both") out.direction = r.direction
  if (r.symbolScope === "all" || r.symbolScope === "selected") out.symbolScope = r.symbolScope
  const [from, to] = [time(r.hoursFrom), time(r.hoursTo)]
  out.hoursFrom = from && to ? from : null
  out.hoursTo = from && to ? to : null
  if (Array.isArray(r.days)) out.days = [...new Set(r.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
  return out
}

async function note(userId: string, e: { groupId?: number | null; accountId?: number | null; level: EventView["level"]; code: string; title: string; body?: string | null; action?: string | null; masterOrderId?: string | null }) {
  await db.insert(copyEvents).values({ userId, groupId: e.groupId ?? null, accountId: e.accountId ?? null, level: e.level, code: e.code, title: e.title.slice(0, 200), body: e.body ?? null, action: e.action ?? null, masterOrderId: e.masterOrderId ?? null })
}

export type GroupInput = { name: string; leaderAccountId: number; followers: { accountId: number; config: unknown }[]; contracts: string[]; rules: unknown; limits?: Partial<GroupLimits>; timeZone?: string | null }

export async function createGroup(userId: string, input: GroupInput): Promise<number> {
  const name = String(input.name ?? "").trim().slice(0, 60)
  if (name.length < 2) throw new Error("Give the group a name.")
  const leader = Number(input.leaderAccountId)
  const followers = (input.followers ?? []).map((f) => ({ accountId: Number(f.accountId), config: cleanConfig(f.config) }))
  if (followers.some((f) => f.accountId === leader)) throw new Error("The Leader can't also follow itself.")
  if (new Set(followers.map((f) => f.accountId)).size !== followers.length) throw new Error("An account is listed twice.")
  if (followers.length > MAX_FOLLOWERS) throw new Error(`A group can have up to ${MAX_FOLLOWERS} followers.`)
  // the followers are the trader's own; the Leader is too, or is a strategy a friend shares with them
  await ownAccounts(userId, followers.map((f) => f.accountId))
  await ownLeader(userId, leader)
  await comply(userId, { leader, followers: followers.map((f) => f.accountId), action: "create_group" })
  const existing = await db.select({ id: copyGroups.id, name: copyGroups.name }).from(copyGroups).where(eq(copyGroups.userId, userId))
  if (existing.length >= MAX_GROUPS) throw new Error(`You can have up to ${MAX_GROUPS} copy groups.`)
  if (existing.some((g) => g.name.toLowerCase() === name.toLowerCase())) throw new Error("You already have a group with that name.")
  const rules = cleanRules(input.rules)
  const symbols = [...new Set((input.contracts ?? []).map((s) => String(s).trim().toUpperCase()).filter((s) => /^[A-Z0-9._-]{1,20}$/.test(s)))].slice(0, MAX_CONTRACTS)

  const [g] = await db.insert(copyGroups).values({ userId, name, leaderAccountId: leader, status: "draft", timeZone: input.timeZone ?? null }).returning({ id: copyGroups.id })
  if (followers.length) await db.insert(copyGroupFollowers).values(followers.map((f, i) => ({ userId, groupId: g.id, accountId: f.accountId, position: i, ...configColumns(f.config) })))
  if (symbols.length) await db.insert(copyGroupContracts).values(symbols.map((s) => contractRow(userId, g.id, specFor(s))))
  await db.insert(copyRules).values({ groupId: g.id, userId, ...rules })
  const l = input.limits ?? {}
  await db.insert(copyRiskLimits).values({ groupId: g.id, userId, defaultMode: MODES.includes(l.defaultMode as SizingMode) ? l.defaultMode! : "same", defaultRatio: str(positive(l.defaultRatio, 1000) || 1)!, globalRiskPct: str(positive(l.globalRiskPct, 100) || 1)!, respectPropSync: l.respectPropSync !== false })
  await note(userId, { groupId: g.id, level: "info", code: "group_created", title: `Copy group “${name}” created`, body: "It is saved as a draft: nothing is copied until you activate it." })
  return g.id
}

const contractRow = (userId: string, groupId: number, s: ContractSpec) => ({ userId, groupId, symbol: s.symbol, root: s.root, name: s.name, exchange: s.exchange, type: s.type, expiration: s.expiration, tickSize: String(s.tickSize), tickValue: str(s.tickValue), pointValue: str(s.pointValue), contractMultiplier: String(s.contractMultiplier), minimumQuantity: String(s.minimumQuantity), quantityStep: String(s.quantityStep) })

export async function renameGroup(userId: string, groupId: number, name: string): Promise<void> {
  await ownGroup(userId, groupId)
  const clean = String(name ?? "").trim().slice(0, 60)
  if (clean.length < 2) throw new Error("Give the group a name.")
  await db.update(copyGroups).set({ name: clean, updatedAt: new Date() }).where(eq(copyGroups.id, groupId))
}

// Removes the group's setup. What it copied stays in the history.
export async function deleteGroup(userId: string, groupId: number): Promise<void> {
  const g = await ownGroup(userId, groupId)
  if (g.status === "active") throw new Error("Pause the group before deleting it.")
  const followers = await db.select({ id: copyGroupFollowers.id }).from(copyGroupFollowers).where(eq(copyGroupFollowers.groupId, groupId))
  if (followers.length) await db.delete(copySymbolMappings).where(inArray(copySymbolMappings.followerId, followers.map((f) => f.id)))
  await db.delete(copyGroupFollowers).where(eq(copyGroupFollowers.groupId, groupId))
  await db.delete(copyGroupContracts).where(eq(copyGroupContracts.groupId, groupId))
  await db.delete(copyRules).where(eq(copyRules.groupId, groupId))
  await db.delete(copyRiskLimits).where(eq(copyRiskLimits.groupId, groupId))
  await db.update(copyPositions).set({ status: "closed", closedAt: new Date() }).where(and(eq(copyPositions.groupId, groupId), eq(copyPositions.status, "open")))
  await db.delete(copyGroups).where(eq(copyGroups.id, groupId))
}

// Switching a group on. It must be complete; and whatever the leader already
// has open is taken as the starting point, not copied after the fact.
export async function setGroupActive(userId: string, groupId: number, active: boolean, timeZone: string): Promise<void> {
  await ownGroup(userId, groupId)
  if (!active) {
    await db.update(copyGroups).set({ status: "paused", updatedAt: new Date() }).where(eq(copyGroups.id, groupId))
    await note(userId, { groupId, level: "info", code: "group_paused", title: "Copying paused", body: "No new trades are copied. Positions that are already open are left as they are." })
    return
  }
  const state = await loadCopyState(userId, timeZone)
  const g = state.groups.find((x) => x.id === groupId)!
  const byId = new Map([...state.accounts, ...state.shared].map((a) => [a.id, a]))
  const online = (id: number) => ["connected", "syncing", "warning"].includes(byId.get(id)?.health ?? "disconnected")
  const problems = activationProblems({ hasLeader: byId.has(g.leaderAccountId), leaderConnected: online(g.leaderAccountId), followers: g.followers.map((f) => ({ name: byId.get(f.accountId)?.name ?? "A follower", config: f.config, connected: online(f.accountId) })), contracts: g.contracts.length, symbolScope: g.rules.symbolScope })
  // what the rules have against the group comes first: a strategy that is no
  // longer shared is not "a group with no Leader chosen"
  if (g.compliance.length) {
    const first = g.compliance.find((p) => p.accountId !== g.leaderAccountId) ?? g.compliance[0]
    await recordBlock(userId, asVerdict(first), { groupId, accountId: first.accountId, action: "activate_group" })
    throw new ComplianceError(asVerdict(first))
  }
  if (problems.length) throw new Error(problems.join(" "))
  await baseline(userId, g, state)
  await db.update(copyGroups).set({ status: "active", timeZone, updatedAt: new Date() }).where(eq(copyGroups.id, groupId))
  await note(userId, { groupId, level: "success", code: "group_activated", title: `“${g.name}” is copying`, body: state.mode === "live" ? "New trades on the Leader are sent to the followers." : "Simulation: new trades on the Leader are worked out and recorded for each follower, and nothing is sent to a broker." })
}

// The leader's open positions, recorded without follower orders.
async function baseline(userId: string, g: GroupView, state: CopyState) {
  await db.update(copyPositions).set({ status: "closed", closedAt: new Date() }).where(and(eq(copyPositions.groupId, g.id), eq(copyPositions.role, "leader"), eq(copyPositions.status, "open")))
  const keys = liveKeys.get(state.positions)
  for (const p of state.positions.filter((x) => x.accountId === g.leaderAccountId && !x.simulated)) {
    await db.insert(copyPositions).values({ userId, groupId: g.id, accountId: g.leaderAccountId, role: "leader", symbol: p.symbol, side: p.side, quantity: String(p.quantity), entryPrice: str(p.entry), stopLoss: str(p.stopLoss), takeProfit: str(p.takeProfit), positionRef: keys?.get(p) ?? `${p.symbol}|${p.side}`, correlationId: "baseline", simulated: false }).onConflictDoNothing()
  }
}

export async function changeLeader(userId: string, groupId: number, accountId: number, timeZone: string): Promise<void> {
  const g = await ownGroup(userId, groupId)
  await ownLeader(userId, accountId)
  if (g.leaderAccountId === accountId) return
  const others = await db.select({ accountId: copyGroupFollowers.accountId }).from(copyGroupFollowers).where(eq(copyGroupFollowers.groupId, groupId))
  await comply(userId, { leader: accountId, followers: others.map((f) => f.accountId).filter((id) => id !== accountId), groupId, action: "change_leader" })
  // a follower promoted to leader stops following
  const [was] = await db.select({ id: copyGroupFollowers.id }).from(copyGroupFollowers).where(and(eq(copyGroupFollowers.groupId, groupId), eq(copyGroupFollowers.accountId, accountId)))
  if (was) {
    await db.delete(copySymbolMappings).where(eq(copySymbolMappings.followerId, was.id))
    await db.delete(copyGroupFollowers).where(eq(copyGroupFollowers.id, was.id))
  }
  await db.update(copyGroups).set({ leaderAccountId: accountId, updatedAt: new Date() }).where(eq(copyGroups.id, groupId))
  // future trades come from the new leader; what is open is left alone
  const state = await loadCopyState(userId, timeZone)
  const view = state.groups.find((x) => x.id === groupId)
  if (view) await baseline(userId, view, state)
  await note(userId, { groupId, accountId, level: "info", code: "leader_changed", title: "Leader changed", body: "Future copied trades come from the new Leader. Positions that are already open were not changed." })
}

export type FollowerInput = { accountId: number; config: unknown; mappings?: { leaderSymbol: string; followerSymbol: string }[] }

// The whole follower list of a group, as the Risk Management page saves it.
export async function saveFollowers(userId: string, groupId: number, input: FollowerInput[]): Promise<void> {
  const g = await ownGroup(userId, groupId)
  const list = input.map((f) => ({ accountId: Number(f.accountId), config: cleanConfig(f.config), mappings: cleanMappings(f.mappings) }))
  if (list.length > MAX_FOLLOWERS) throw new Error(`A group can have up to ${MAX_FOLLOWERS} followers.`)
  if (list.some((f) => f.accountId === g.leaderAccountId)) throw new Error("The Leader can't also follow itself.")
  if (new Set(list.map((f) => f.accountId)).size !== list.length) throw new Error("An account is listed twice.")
  await ownAccounts(userId, list.map((f) => f.accountId))
  await comply(userId, { leader: g.leaderAccountId, followers: list.map((f) => f.accountId), groupId, action: "save_followers" })
  const existing = await db.select().from(copyGroupFollowers).where(eq(copyGroupFollowers.groupId, groupId))
  const gone = existing.filter((e) => !list.some((f) => f.accountId === e.accountId))
  if (gone.length) {
    await db.delete(copySymbolMappings).where(inArray(copySymbolMappings.followerId, gone.map((e) => e.id)))
    await db.delete(copyGroupFollowers).where(inArray(copyGroupFollowers.id, gone.map((e) => e.id)))
  }
  for (const [i, f] of list.entries()) {
    const row = existing.find((e) => e.accountId === f.accountId)
    const id = row ? row.id : (await db.insert(copyGroupFollowers).values({ userId, groupId, accountId: f.accountId, position: i, ...configColumns(f.config) }).returning({ id: copyGroupFollowers.id }))[0].id
    if (row) await db.update(copyGroupFollowers).set({ position: i, ...configColumns(f.config) }).where(eq(copyGroupFollowers.id, row.id))
    await db.delete(copySymbolMappings).where(eq(copySymbolMappings.followerId, id))
    if (f.mappings.length) await db.insert(copySymbolMappings).values(f.mappings.map((m) => ({ userId, followerId: id, ...m })))
  }
}
const cleanMappings = (raw: unknown) => {
  const seen = new Set<string>()
  const out: { leaderSymbol: string; followerSymbol: string }[] = []
  for (const m of Array.isArray(raw) ? raw : []) {
    // kept exactly as typed: MetaTrader symbols are case-sensitive (XAUUSDm is not XAUUSDM)
    const a = String(m?.leaderSymbol ?? "").trim()
    const b = String(m?.followerSymbol ?? "").trim()
    if (!/^[A-Za-z0-9._#-]{1,20}$/.test(a) || !/^[A-Za-z0-9._#-]{1,20}$/.test(b) || a === b || seen.has(a.toUpperCase())) continue
    seen.add(a.toUpperCase())
    out.push({ leaderSymbol: a, followerSymbol: b })
  }
  return out.slice(0, 30)
}

// One follower's Sync switch. The others are untouched.
export async function setFollowerEnabled(userId: string, groupId: number, accountId: number, enabled: boolean): Promise<void> {
  await ownGroup(userId, groupId)
  const rows = await db.update(copyGroupFollowers).set({ enabled, updatedAt: new Date() }).where(and(eq(copyGroupFollowers.groupId, groupId), eq(copyGroupFollowers.accountId, accountId), eq(copyGroupFollowers.userId, userId))).returning({ id: copyGroupFollowers.id })
  if (!rows.length) throw new Error("That account isn't a follower of this group.")
}

export async function importContract(userId: string, groupId: number, symbol: string): Promise<ContractSpec> {
  await ownGroup(userId, groupId)
  const s = String(symbol ?? "").trim().toUpperCase()
  if (!/^[A-Z0-9._-]{1,20}$/.test(s)) throw new Error("That isn't a contract symbol.")
  const have = await db.select({ symbol: copyGroupContracts.symbol }).from(copyGroupContracts).where(eq(copyGroupContracts.groupId, groupId))
  if (have.some((c) => c.symbol === s)) throw new Error(`${s} is already imported.`)
  if (have.length >= MAX_CONTRACTS) throw new Error(`A group can have up to ${MAX_CONTRACTS} contracts.`)
  const spec = specFor(s)
  await db.insert(copyGroupContracts).values(contractRow(userId, groupId, spec))
  return spec
}
export async function removeContract(userId: string, groupId: number, symbol: string): Promise<void> {
  await ownGroup(userId, groupId)
  await db.delete(copyGroupContracts).where(and(eq(copyGroupContracts.groupId, groupId), eq(copyGroupContracts.symbol, String(symbol).toUpperCase())))
}

export async function saveRules(userId: string, groupId: number, raw: unknown): Promise<void> {
  await ownGroup(userId, groupId)
  const rules = cleanRules(raw)
  await db.insert(copyRules).values({ groupId, userId, ...rules }).onConflictDoUpdate({ target: copyRules.groupId, set: { ...rules, updatedAt: new Date() } })
}
export async function saveLimits(userId: string, groupId: number, l: Partial<GroupLimits>): Promise<void> {
  await ownGroup(userId, groupId)
  const values = { defaultMode: MODES.includes(l.defaultMode as SizingMode) ? l.defaultMode! : "same", defaultRatio: str(positive(l.defaultRatio, 1000) || 1)!, globalRiskPct: str(positive(l.globalRiskPct, 100) || 1)!, respectPropSync: l.respectPropSync !== false, updatedAt: new Date() }
  await db.insert(copyRiskLimits).values({ groupId, userId, ...values }).onConflictDoUpdate({ target: copyRiskLimits.groupId, set: values })
}

export async function setAccountRole(userId: string, accountId: number, role: string): Promise<void> {
  await ownAccounts(userId, [accountId])
  const clean = (["leader", "follower", "both", "unassigned"] as const).find((r) => r === role) ?? "unassigned"
  if (clean !== "unassigned") {
    const v = validateRole((await parties(userId, [accountId])).get(accountId) ?? { set: null }, clean)
    if (!v.allowed) {
      await recordBlock(userId, v, { accountId, action: "set_role" })
      throw new ComplianceError(v)
    }
  }
  await db.insert(copyAccountPrefs).values({ accountId, userId, role: clean }).onConflictDoUpdate({ target: copyAccountPrefs.accountId, set: { role: clean, updatedAt: new Date() } })
}

// Orders on a follower, switched on from inside Copy Trading.
//
// A MetaTrader 5 account is read with the password it was connected with, and
// takes orders only when a password to trade with is kept beside it. That is
// the trader's own decision, account by account, and it is made here as well
// as in the Trade Manager: `password` is the master password they typed, or
// null for "the one I connected with". Someone who connected with the master
// password has already given the one that trades, and being sent to another
// page to type it again read as a refusal. In that case the stored ciphertext
// is kept a second time; nothing is decrypted here.
//
// The provider's rules are asked first (lib/compliance): where they keep an
// account read-only, no trading password is kept for it by either route.
// Whether the password really can trade is the broker's to say. An investor
// password logs in and has its first order refused ("Trade disabled"), and
// the alert for that says so (lib/copy/errors.ts).
export async function enableOrders(userId: string, accountId: number, password: string | null): Promise<void> {
  await ownAccounts(userId, [accountId])
  const typed = password?.trim() ?? null
  if (typed != null && !typed) throw new Error("Enter the account's master (trading) password.")
  if (typed != null && typed.length > 128) throw new Error("That password is too long.")
  const [mt] = await db.select({ id: metatraderConnections.id, platform: metatraderConnections.platform, server: metatraderConnections.server, name: tradingAccounts.name }).from(metatraderConnections).innerJoin(tradingAccounts, eq(tradingAccounts.id, metatraderConnections.accountId)).where(and(eq(metatraderConnections.userId, userId), eq(metatraderConnections.accountId, accountId)))
  if (!mt) throw new Error("Only a MetaTrader 5 account can receive orders from TradeLoop.")
  if (mt.platform !== "mt5") throw new Error("MetaTrader 4 can't receive orders from TradeLoop yet.")
  const permitted = validateConnection(detectProvider(await ruleSets(), mt.server), { credential: "trading", acknowledged: true })
  if (!permitted.allowed) {
    await recordBlock(userId, permitted, { accountId, action: "allow_orders" })
    throw new ComplianceError(permitted)
  }
  // saved, and marked to be put to the broker: the sync server logs in with it once and writes what the broker said
  await db.update(metatraderConnections).set({ tradingPasswordEnc: typed != null ? encrypt(typed) : sql`${metatraderConnections.passwordEnc}`, tradingCheck: "pending", tradingCheckAt: null }).where(eq(metatraderConnections.id, mt.id))
  await note(userId, { accountId, level: "success", code: "orders_allowed", title: `Orders allowed — ${mt.name}`, body: typed != null ? "TradeLoop places orders on it with the trading password you entered." : "TradeLoop places orders on it with the password it was connected with.", action: "The password is being checked with the broker: the account shows whether it can trade." })
}

// And off again: the trading password is forgotten, and the account goes back to being read only.
export async function disableOrders(userId: string, accountId: number): Promise<void> {
  await ownAccounts(userId, [accountId])
  const [mt] = await db.update(metatraderConnections).set({ tradingPasswordEnc: null, tradingCheck: null, tradingCheckAt: null }).where(and(eq(metatraderConnections.userId, userId), eq(metatraderConnections.accountId, accountId), isNotNull(metatraderConnections.tradingPasswordEnc))).returning({ id: metatraderConnections.id })
  if (!mt) return
  const [a] = await db.select({ name: tradingAccounts.name }).from(tradingAccounts).where(eq(tradingAccounts.id, accountId))
  await note(userId, { accountId, level: "info", code: "orders_stopped", title: `Orders turned off — ${a?.name ?? "account"}`, body: "TradeLoop no longer keeps a trading password for this account, and places no orders on it." })
}

// Takes an account out of every group it follows (the Connection page's "Disconnect").
export async function detachAccount(userId: string, accountId: number): Promise<void> {
  await ownAccounts(userId, [accountId])
  const leads = await db.select({ name: copyGroups.name }).from(copyGroups).where(and(eq(copyGroups.userId, userId), eq(copyGroups.leaderAccountId, accountId)))
  if (leads.length) throw new Error(`This account is the Leader of “${leads[0].name}”. Change that group's Leader first.`)
  const rows = await db.select({ id: copyGroupFollowers.id }).from(copyGroupFollowers).where(and(eq(copyGroupFollowers.userId, userId), eq(copyGroupFollowers.accountId, accountId)))
  if (rows.length) {
    await db.delete(copySymbolMappings).where(inArray(copySymbolMappings.followerId, rows.map((r) => r.id)))
    await db.delete(copyGroupFollowers).where(inArray(copyGroupFollowers.id, rows.map((r) => r.id)))
  }
  await db.insert(copyAccountPrefs).values({ accountId, userId, role: "unassigned" }).onConflictDoUpdate({ target: copyAccountPrefs.accountId, set: { role: "unassigned", updatedAt: new Date() } })
}

export async function markEventsRead(userId: string): Promise<void> {
  await db.update(copyEvents).set({ readAt: new Date() }).where(and(eq(copyEvents.userId, userId), isNull(copyEvents.readAt)))
}

// ------------------------------------------------------------------ the engine

const ALERTS: Record<string, { title: string; action: string; level: EventView["level"] }> = {
  rounding: { title: "Trade not copied: size below the minimum", action: "Set the rounding rule to Round up or Minimum 1, or raise this account's ratio, in Risk Management.", level: "warning" },
  position: { title: "Maximum position size reached", action: "Raise the account's maximum position size in Risk Management if you want it to copy more.", level: "warning" },
  daily_loss: { title: "Risk limit reached", action: "Copying resumes tomorrow. To copy sooner, raise the daily loss limit in Risk Management.", level: "error" },
  exposure: { title: "Maximum exposure reached", action: "Close something on the account, or raise its maximum exposure in Risk Management.", level: "warning" },
  propsync: { title: "Trade blocked by PropSync", action: "Check the account's rules in PropSync. TradeLoop doesn't copy a trade that would break them.", level: "error" },
  connection: { title: "Connection lost", action: "Reconnect the account on the Connection page.", level: "error" },
  contract: { title: "Contract unavailable", action: "Import the current contract in the Cockpit.", level: "warning" },
  rules: { title: "Trade not copied", action: "Change the group's copy rules or contracts in the Cockpit if you want trades like this copied.", level: "info" },
  sizing: { title: "Trade not copied: size can't be worked out", action: "Place the stop with the order, or choose another copy mode for this account in Risk Management.", level: "warning" },
}

type Ctx = { userId: string; state: CopyState; group: GroupView; mode: "simulation" | "live"; minutes: number; weekday: number; prop: Map<number, Prop>; now: Date }

// Hands one order to the broker's queue — the same queue, with the same
// prop-rule guard, as an order placed by hand in the Trade Manager.
//
// `clientRef` names the copy the order is (plan.ts). The sync server's copy
// lane sends a leader's entries and closes by itself, the instant they happen,
// under the same name; when it already has, that order IS this one, and
// nothing more is sent. The name is unique in the table, so even if both
// wrote at the same moment only one order would exist.
async function queue(ctx: Pick<Ctx, "userId" | "state" | "prop">, accountId: number, command: { kind: "place" | "close" | "partial_close" | "modify"; symbol: string; side: Side; volume?: number | null; stopLoss?: number | null; takeProfit?: number | null; positionRef?: string | null; clientRef?: string | null }): Promise<{ id: number | null; status: string; reason: string | null }> {
  const theirs = async () => {
    if (!command.clientRef) return null
    // Found and marked as booked in one statement. The lane takes back an
    // order that never left only while it is not marked, so the order is
    // either gone before this (and is queued below) or stays for good.
    const [row] = await db.update(orderCommands).set({ lane: sql`${orderCommands.lane} || '{"booked":true}'::jsonb` }).where(and(eq(orderCommands.userId, ctx.userId), eq(orderCommands.clientRef, command.clientRef))).returning({ id: orderCommands.id })
    return row ? { id: row.id, status: "sent", reason: null } : null
  }
  const already = await theirs()
  if (already) return already
  const account = ctx.state.accounts.find((a) => a.id === accountId)
  if (!account?.canExecute) return { id: null, status: "unsupported", reason: account?.executionNote ?? "This account can't receive orders." }
  const input = { accountId, broker: "mt5" as const, kind: command.kind, symbol: command.symbol, side: command.side, volume: command.volume ?? null, stopLoss: command.stopLoss ?? null, takeProfit: command.takeProfit ?? null, positionRef: command.positionRef ?? null, orderType: command.kind === "place" ? ("market" as const) : null }
  const { guardOrder } = await import("@/lib/order-execution/guard")
  const decision = guardOrder(input, ctx.prop.get(accountId)?.evaluation ?? null)
  const [row] = await db
    .insert(orderCommands)
    .values({ userId: ctx.userId, accountId, broker: account.lane === "fast" ? "mt5c" : "mt5", kind: command.kind, status: decision.allowed ? "pending" : "blocked", positionRef: input.positionRef, symbol: command.symbol, side: command.side, volume: str(input.volume), stopLoss: str(input.stopLoss), takeProfit: str(input.takeProfit), orderType: input.orderType, ruleCheck: decision, resultMessage: decision.allowed ? null : decision.reasons.join(" "), clientRef: command.clientRef ?? null })
    .onConflictDoNothing()
    .returning({ id: orderCommands.id })
  // the lane wrote the same order in the meantime
  if (!row) return (await theirs()) ?? { id: null, status: "failed", reason: "The order couldn't be queued." }
  return { id: row.id, status: decision.allowed ? "sent" : "blocked", reason: decision.allowed ? null : `Blocked by the account's prop-firm rules. ${decision.reasons.join(" ")}` }
}

// A new position on the leader, or more added to one: an order for each follower.
async function copyEntry(ctx: Ctx, leader: { id: number; version: number }, p: LivePosition, quantity: number, action: "open" | "increase", only?: { accountId: number; suffix: string }) {
  const { group: g, state } = ctx
  const master = masterOrderId(g.id, leader.id, leader.version)
  const leaderAccount = accountIn(state, g.leaderAccountId)
  // A new position, live: each follower's order has a name of its own, and the
  // copy lane may already have sent it (a retry is a different order: no name).
  const named = ctx.mode === "live" && action === "open" && !only
  const refs = named ? g.followers.map((f) => entryRef(g.id, p.key, f.accountId)) : []
  const sent = refs.length ? await db.select({ clientRef: orderCommands.clientRef, symbol: orderCommands.symbol, stopLoss: orderCommands.stopLoss, takeProfit: orderCommands.takeProfit, lane: orderCommands.lane }).from(orderCommands).where(and(eq(orderCommands.userId, ctx.userId), inArray(orderCommands.clientRef, refs), isNotNull(orderCommands.lane))) : []
  for (const f of g.followers) {
    if (only && f.accountId !== only.accountId) continue
    const account = state.accounts.find((a) => a.id === f.accountId)
    if (!account) continue
    // a follower its provider's rules don't allow to be copied to gets nothing, in Simulation either (lib/compliance)
    if (g.compliance.some((c) => c.accountId === f.accountId || c.accountId === g.leaderAccountId)) continue
    const clientRef = named ? entryRef(g.id, p.key, f.accountId) : null
    const theirs = clientRef ? sent.find((c) => c.clientRef === clientRef && c.lane?.decision && c.symbol) : undefined
    const own = decideEntry({
      rules: g.rules,
      contracts: g.contracts,
      follower: { config: f.config, mappings: f.mappings, symbols: account.symbols },
      position: p,
      quantity,
      leaderEquity: leaderAccount?.equity ?? leaderAccount?.balance ?? null,
      account: { equity: account.equity ?? account.balance, dayPnl: account.dayPnl, openNotional: account.openNotional, connected: ["connected", "syncing", "warning"].includes(account.health), openQuantity: (symbol, side) => state.positions.filter((x) => x.accountId === f.accountId && x.symbol.toUpperCase() === symbol.toUpperCase() && x.side === side).reduce((s, x) => s + x.quantity, 0) },
      propSync: g.limits.respectPropSync ? account.propSync : NO_PROPSYNC,
      minutes: ctx.minutes,
      weekday: ctx.weekday,
      now: ctx.now,
    })
    // An order the lane has sent is recorded as it was sent, not as it would be
    // worked out now (the follower's own new position already counts by now).
    const decision: Decision = theirs?.lane?.decision ?? own.decision
    const symbol = theirs?.symbol ?? own.symbol
    const correlationId = followerOrderId(master, f.accountId) + (only?.suffix ?? "")
    const entry = own.entry
    const sl = theirs ? num(theirs.stopLoss) : own.stopLoss
    const tp = theirs ? num(theirs.takeProfit) : own.takeProfit
    const skipped = decision.blockedBy === "disabled"
    const [order] = await db
      .insert(copyOrders)
      .values({ userId: ctx.userId, groupId: g.id, correlationId, masterOrderId: master, masterAccountId: g.leaderAccountId, followerAccountId: f.accountId, action, symbol, leaderSymbol: p.symbol, side: p.side, quantity: String(decision.finalQuantity), leaderQuantity: String(quantity), requestedPrice: str(entry), stopLoss: str(sl), takeProfit: str(tp), status: decision.allowed ? "pending" : skipped ? "skipped" : "blocked", reason: decision.allowed ? null : decision.reason, decision: decision as unknown as Record<string, unknown>, simulated: ctx.mode === "simulation" })
      .onConflictDoNothing()
      .returning({ id: copyOrders.id })
    // already handled by another run of the engine
    if (!order) continue
    if (!decision.allowed) {
      if (!skipped) await alert(ctx, f.accountId, account.name, decision, master, `${p.side === "long" ? "BUY" : "SELL"} ${quantity} ${p.symbol}`)
      continue
    }
    await place(ctx, order.id, { leaderPositionId: leader.id, accountId: f.accountId, symbol, side: p.side, quantity: decision.finalQuantity, entry, stopLoss: sl, takeProfit: tp, correlationId, clientRef, positionRef: theirs?.lane?.ticket ?? null })
  }
}

async function alert(ctx: Ctx, accountId: number, accountName: string, decision: Decision, master: string, what: string) {
  const a = ALERTS[decision.blockedBy ?? "rules"] ?? ALERTS.rules
  await note(ctx.userId, { groupId: ctx.group.id, accountId, level: a.level, code: `blocked_${decision.blockedBy ?? "rules"}`, title: `${a.title} — ${accountName}`, body: `Leader: ${what}. ${decision.reason}`, action: a.action, masterOrderId: master })
}

async function place(ctx: Ctx, orderId: number, o: { leaderPositionId: number; accountId: number; symbol: string; side: Side; quantity: number; entry: number | null; stopLoss: number | null; takeProfit: number | null; correlationId: string; clientRef?: string | null; positionRef?: string | null }) {
  let status = "filled"
  let reason: string | null = null
  let commandId: number | null = null
  if (ctx.mode === "live") {
    const sent = await queue(ctx, o.accountId, { kind: "place", symbol: o.symbol, side: o.side, volume: o.quantity, stopLoss: o.stopLoss, takeProfit: o.takeProfit, clientRef: o.clientRef })
    status = sent.status
    reason = sent.reason
    commandId = sent.id
  }
  await db.update(copyOrders).set({ status, reason, orderCommandId: commandId, executionPrice: ctx.mode === "simulation" ? str(o.entry) : null, updatedAt: new Date() }).where(eq(copyOrders.id, orderId))
  if (status !== "filled" && status !== "sent") {
    const account = ctx.state.accounts.find((a) => a.id === o.accountId)
    const name = account?.name ?? "A follower"
    await note(ctx.userId, { groupId: ctx.group.id, accountId: o.accountId, level: "error", code: `order_${status}`, title: `${status === "unsupported" ? "Order not sent" : `${classifyFailure(reason).label}: order ${status}`} — ${name}`, body: reason, action: status === "unsupported" ? (account?.canAllowOrders ? "Allow orders on this account, then use Retry." : "Use a MetaTrader 5 account that orders are allowed on, or keep this group in simulation.") : classifyFailure(reason).action })
    return
  }
  // the follower's own position: added to when it already holds this trade
  const [held] = await db.select().from(copyPositions).where(and(eq(copyPositions.groupId, ctx.group.id), eq(copyPositions.role, "follower"), eq(copyPositions.accountId, o.accountId), eq(copyPositions.leaderPositionId, o.leaderPositionId), eq(copyPositions.status, "open")))
  if (held) await db.update(copyPositions).set({ quantity: String(Number(held.quantity) + o.quantity), updatedAt: new Date() }).where(eq(copyPositions.id, held.id))
  else await db.insert(copyPositions).values({ userId: ctx.userId, groupId: ctx.group.id, accountId: o.accountId, role: "follower", symbol: o.symbol, side: o.side, quantity: String(o.quantity), entryPrice: str(o.entry), stopLoss: str(o.stopLoss), takeProfit: str(o.takeProfit), leaderPositionId: o.leaderPositionId, correlationId: o.correlationId, positionRef: o.positionRef ?? null, simulated: ctx.mode === "simulation" })
}

// A change to a position the followers already hold: partial close, close, stop, target.
async function copyChange(ctx: Ctx, leader: typeof copyPositions.$inferSelect, version: number, action: CopyAction, p: LivePosition, change: { fraction?: number }) {
  const { group: g } = ctx
  const master = masterOrderId(g.id, leader.id, version)
  const held = await db.select().from(copyPositions).where(and(eq(copyPositions.groupId, g.id), eq(copyPositions.role, "follower"), eq(copyPositions.leaderPositionId, leader.id), eq(copyPositions.status, "open")))
  const allowed = validateCopyRules(g.rules, action, { side: p.side, orderType: "market", symbol: p.symbol }, { imported: g.contracts.map((c) => c.symbol), minutes: ctx.minutes, weekday: ctx.weekday })
  for (const pos of held) {
    const follower = g.followers.find((f) => f.accountId === pos.accountId)
    const spec = specOf(g.contracts, pos.symbol)
    const quantity = Number(pos.quantity)
    const closing = action === "close" ? quantity : action === "partial_close" ? proportionalClose(quantity, change.fraction ?? 0, spec) : 0
    const stopLoss = action === "modify_sl" || action === "trailing_stop" ? translatePrice({ leaderPrice: p.stopLoss, leaderEntry: num(leader.entryPrice), followerEntry: num(pos.entryPrice), leaderSymbol: leader.symbol, followerSymbol: pos.symbol }) : num(pos.stopLoss)
    const takeProfit = action === "modify_tp" ? translatePrice({ leaderPrice: p.takeProfit, leaderEntry: num(leader.entryPrice), followerEntry: num(pos.entryPrice), leaderSymbol: leader.symbol, followerSymbol: pos.symbol }) : num(pos.takeProfit)
    // a follower that was switched off after it entered still follows the exit; nothing else
    const off = follower && !follower.config.enabled && action !== "close" && action !== "partial_close"
    const skip = !allowed.ok ? allowed.reason : off ? "Copying is switched off for this account." : action === "partial_close" && closing <= 0 ? "The proportional close is below the minimum quantity." : action === "close" && pos.closeRequestedAt ? "This position is already being closed." : null
    const [order] = await db
      .insert(copyOrders)
      .values({ userId: ctx.userId, groupId: g.id, correlationId: followerOrderId(master, pos.accountId), masterOrderId: master, masterAccountId: g.leaderAccountId, followerAccountId: pos.accountId, action, symbol: pos.symbol, leaderSymbol: leader.symbol, side: pos.side, quantity: String(closing || quantity), leaderQuantity: String(p.quantity), requestedPrice: str(p.price ?? p.entry), stopLoss: str(stopLoss), takeProfit: str(takeProfit), status: skip ? "skipped" : "pending", reason: skip, decision: { positionId: pos.id }, simulated: pos.simulated })
      .onConflictDoNothing()
      .returning({ id: copyOrders.id })
    if (!order || skip) continue

    let status = "filled"
    let reason: string | null = null
    let commandId: number | null = null
    if (!pos.simulated) {
      if (!pos.positionRef) {
        status = "failed"
        reason = "The follower's position hasn't shown up on its account yet, so it couldn't be changed. Check the account and close or adjust it there."
      } else {
        // the leader's full close is the one change the lane also makes by itself
        const clientRef = action === "close" && leader.positionRef ? closeRef(g.id, leader.positionRef, pos.accountId) : null
        const sent = await queue(ctx, pos.accountId, closing > 0 ? { kind: closing >= quantity ? "close" : "partial_close", symbol: pos.symbol, side: pos.side as Side, volume: closing, positionRef: pos.positionRef, clientRef } : { kind: "modify", symbol: pos.symbol, side: pos.side as Side, stopLoss, takeProfit, positionRef: pos.positionRef })
        status = sent.status
        reason = sent.reason
        commandId = sent.id
      }
    }
    await db.update(copyOrders).set({ status, reason, orderCommandId: commandId, executionPrice: pos.simulated ? str(p.price ?? p.entry) : null, updatedAt: new Date() }).where(eq(copyOrders.id, order.id))
    // Live: nothing is taken as done until the broker says so (settle() applies
    // it then). A full close is remembered as wanted, so that if the broker
    // refuses it, or the ticket isn't known yet, it is tried again.
    if (!pos.simulated) {
      if (action === "close") await db.update(copyPositions).set({ closeRequestedAt: new Date(), updatedAt: new Date() }).where(eq(copyPositions.id, pos.id))
      else if (status !== "sent") await note(ctx.userId, { groupId: g.id, accountId: pos.accountId, level: "error", code: `order_${status}`, title: `Change not copied — ${ctx.state.accounts.find((a) => a.id === pos.accountId)?.name ?? "a follower"}`, body: reason, action: "Check the position in the Trade Manager and adjust it there if needed.", masterOrderId: master })
      continue
    }
    if (status !== "filled" && status !== "sent") {
      await note(ctx.userId, { groupId: g.id, accountId: pos.accountId, level: "error", code: `order_${status}`, title: `Change not copied — ${ctx.state.accounts.find((a) => a.id === pos.accountId)?.name ?? "a follower"}`, body: reason, action: "Check the position in the Trade Manager and adjust it there if needed.", masterOrderId: master })
      continue
    }
    if (closing > 0) {
      const exit = p.price ?? p.entry
      const entry = num(pos.entryPrice)
      const point = pointValueAt(spec, exit)
      const pnl = exit != null && entry != null && point != null ? (exit - entry) * (pos.side === "long" ? 1 : -1) * closing * point : null
      const left = Math.round((quantity - closing) * 1e8) / 1e8
      await db.update(copyPositions).set({ quantity: String(Math.max(0, left)), status: left <= 0 ? "closed" : "open", closedAt: left <= 0 ? new Date() : null, realizedPnl: pnl != null ? String(Math.round((Number(pos.realizedPnl ?? 0) + pnl) * 100) / 100) : pos.realizedPnl, updatedAt: new Date() }).where(eq(copyPositions.id, pos.id))
    } else await db.update(copyPositions).set({ stopLoss: str(stopLoss), takeProfit: str(takeProfit), updatedAt: new Date() }).where(eq(copyPositions.id, pos.id))
  }
}

// One look at one group's leader: what changed since the last look, copied.
async function runGroup(ctx: Ctx): Promise<number> {
  const { group: g, state } = ctx
  // A leader whose connection isn't up reports nothing — and "nothing" must
  // never be read as "everything was closed". Wait until it is back.
  const leaderAccount = accountIn(state, g.leaderAccountId)
  if (leaderAccount?.health !== "connected") return 0
  if (leaderAccount.lastSyncAt && ctx.now.getTime() - new Date(leaderAccount.lastSyncAt).getTime() > LEADER_FRESH_MS) return 0
  const keys = liveKeys.get(state.positions)
  const current: LivePosition[] = state.positions.filter((p) => p.accountId === g.leaderAccountId && !p.simulated).map((p) => ({ key: keys?.get(p) ?? `${p.symbol}|${p.side}`, symbol: p.symbol, side: p.side, quantity: p.quantity, entry: p.entry, stopLoss: p.stopLoss, takeProfit: p.takeProfit, price: p.current }))
  const rows = await db.select().from(copyPositions).where(and(eq(copyPositions.groupId, g.id), eq(copyPositions.role, "leader"), eq(copyPositions.status, "open")))
  const previous: LivePosition[] = rows.map((r) => ({ key: r.positionRef ?? `${r.symbol}|${r.side}`, symbol: r.symbol, side: r.side as Side, quantity: Number(r.quantity), entry: num(r.entryPrice), stopLoss: num(r.stopLoss), takeProfit: num(r.takeProfit), price: null }))
  const events = planLeaderEvents(previous, current)
  for (const e of events) {
    if (e.action === "open") {
      const p = e.position
      const [row] = await db.insert(copyPositions).values({ userId: ctx.userId, groupId: g.id, accountId: g.leaderAccountId, role: "leader", symbol: p.symbol, side: p.side, quantity: String(p.quantity), entryPrice: str(p.entry), stopLoss: str(p.stopLoss), takeProfit: str(p.takeProfit), positionRef: p.key, simulated: false }).onConflictDoNothing().returning({ id: copyPositions.id })
      // another run got there first
      if (row) await copyEntry(ctx, { id: row.id, version: 0 }, p, p.quantity, "open")
      continue
    }
    const row = rows.find((r) => (r.positionRef ?? `${r.symbol}|${r.side}`) === e.key)
    if (!row) continue
    const p = e.action === "close" ? { ...e.previous, price: state.positions.find((x) => x.symbol === e.previous.symbol && x.current != null)?.current ?? null } : e.position
    // take the change only if nobody else has: the version moves on exactly once
    const set = e.action === "close" ? { status: "closed", closedAt: new Date() } : { quantity: String(p.quantity), stopLoss: str(p.stopLoss), takeProfit: str(p.takeProfit) }
    const [next] = await db.update(copyPositions).set({ ...set, version: row.version + 1, updatedAt: new Date() }).where(and(eq(copyPositions.id, row.id), eq(copyPositions.version, row.version))).returning({ version: copyPositions.version })
    if (!next) continue
    row.version = next.version
    if (e.action === "increase") await copyEntry(ctx, { id: row.id, version: next.version }, p, e.added, "increase")
    else await copyChange(ctx, row, next.version, e.action, p, { fraction: e.action === "partial_close" ? e.fraction : undefined })
  }
  return events.length
}

// A follower's live position, tied to the ticket its broker gave it. Until
// that is known the position can't be closed or changed, so this is tried on
// every pass until the follower's account shows it.
async function bindPositions(userId: string, state: CopyState) {
  const unbound = await db.select().from(copyPositions).where(and(eq(copyPositions.userId, userId), eq(copyPositions.role, "follower"), eq(copyPositions.status, "open"), eq(copyPositions.simulated, false), isNull(copyPositions.positionRef)))
  if (!unbound.length) return
  const keys = liveKeys.get(state.positions)
  const taken = new Set((await db.select({ ref: copyPositions.positionRef }).from(copyPositions).where(and(eq(copyPositions.userId, userId), eq(copyPositions.role, "follower"), eq(copyPositions.status, "open")))).map((r) => r.ref))
  for (const pos of unbound) {
    const live = state.positions.find((p) => !p.simulated && p.accountId === pos.accountId && p.symbol === pos.symbol && p.side === pos.side && keys?.get(p) && !taken.has(keys.get(p)!))
    const ref = live && keys?.get(live)
    if (!live || !ref) continue
    taken.add(ref)
    await db.update(copyPositions).set({ positionRef: ref, entryPrice: str(live.entry), updatedAt: new Date() }).where(eq(copyPositions.id, pos.id))
    if (pos.correlationId) await db.update(copyOrders).set({ executionPrice: str(live.entry), updatedAt: new Date() }).where(and(eq(copyOrders.userId, userId), eq(copyOrders.correlationId, pos.correlationId), isNull(copyOrders.executionPrice)))
  }
}

// How many times a close the broker refused is sent again, and how long between tries.
const CLOSE_ATTEMPTS = 4
const CLOSE_RETRY_MS = 8_000
// An order the copy lane sent and has said nothing about for this long is taken as lost.
const LANE_ORDER_LOST_MS = 120_000

// Live orders, settled against what the brokers say. Nothing here trusts the
// app's own records over the broker's: a position is closed when the broker
// confirms the close or stops listing the ticket — never just because a close
// was sent — and a close that was refused is sent again.
async function reconcile(userId: string, state: CopyState) {
  // an order the fast lane hasn't picked up in ten seconds goes to the sync worker instead
  await db.update(orderCommands).set({ broker: "mt5" }).where(and(eq(orderCommands.userId, userId), eq(orderCommands.broker, "mt5c"), eq(orderCommands.status, "pending"), isNull(orderCommands.leaseUntil), sql`${orderCommands.createdAt} < now() - interval '10 seconds'`))
  await bindPositions(userId, state)
  const keys = liveKeys.get(state.positions)
  const name = (accountId: number) => state.accounts.find((a) => a.id === accountId)?.name ?? "a follower"

  // 1. what the executor said about each order that was sent
  const waiting = await db.select().from(copyOrders).where(and(eq(copyOrders.userId, userId), inArray(copyOrders.status, ["sent", "pending"]), eq(copyOrders.simulated, false))).limit(100)
  const ids = waiting.map((o) => o.orderCommandId).filter((id): id is number => id != null)
  const commands = ids.length ? await db.select({ id: orderCommands.id, status: orderCommands.status, message: orderCommands.resultMessage, updatedAt: orderCommands.updatedAt, lane: orderCommands.lane }).from(orderCommands).where(and(eq(orderCommands.userId, userId), inArray(orderCommands.id, ids))) : []
  for (const o of waiting) {
    const c = commands.find((x) => x.id === o.orderCommandId) ?? (o.orderCommandId != null && o.status === "sent" ? { id: o.orderCommandId, status: "failed", message: "The order was not sent: its record is gone. Use Retry to send it again.", updatedAt: new Date(), lane: null } : undefined)
    if (!c || c.status === "pending") continue
    if (c.status === "sent") {
      // An order the lane sent and never reported on (it stopped in between).
      // It can't be known from here whether the broker took it, so it is not
      // sent again: the trader is told to look.
      if (!c.lane || Date.now() - c.updatedAt.getTime() < LANE_ORDER_LOST_MS) continue
      c.status = "failed"
      c.message = "The copy lane sent this order and stopped before the broker answered. Check the account: the position may or may not be open."
      await db.update(orderCommands).set({ status: "failed", resultMessage: c.message, updatedAt: new Date() }).where(and(eq(orderCommands.id, c.id), eq(orderCommands.status, "sent")))
    }
    const filled = c.status === "filled"
    const entry = o.action === "open" || o.action === "increase"
    const positionId = Number((o.decision as { positionId?: number } | null)?.positionId) || null
    // the fill price, when the follower's position is already visible
    const live = filled && entry ? state.positions.find((p) => !p.simulated && p.accountId === o.followerAccountId && p.symbol === o.symbol && p.side === o.side) : undefined
    const price = c.lane?.price ?? live?.entry ?? null
    // Timed by the lane when it sent the order itself: from seeing the leader's
    // trade to the broker's answer, and how much of that was TradeLoop's.
    const timed = c.lane && c.lane.brokerMs != null ? { latencyMs: Math.round(c.lane.tradeloopMs + c.lane.brokerMs), tradeloopMs: Math.round(c.lane.tradeloopMs) } : null
    if (!filled && entry) await db.update(copyPositions).set({ status: "closed", closedAt: new Date(), quantity: "0" }).where(and(eq(copyPositions.userId, userId), eq(copyPositions.correlationId, o.correlationId), eq(copyPositions.status, "open")))
    if (filled && positionId) {
      const [pos] = await db.select().from(copyPositions).where(and(eq(copyPositions.id, positionId), eq(copyPositions.userId, userId)))
      if (pos && pos.status === "open") {
        if (o.action === "close") await db.update(copyPositions).set({ status: "closed", closedAt: new Date(), quantity: "0", closeRequestedAt: null, updatedAt: new Date() }).where(eq(copyPositions.id, pos.id))
        else if (o.action === "partial_close") await db.update(copyPositions).set({ quantity: String(Math.max(0, Math.round((Number(pos.quantity) - Number(o.quantity)) * 1e8) / 1e8)), updatedAt: new Date() }).where(eq(copyPositions.id, pos.id))
        else await db.update(copyPositions).set({ stopLoss: o.stopLoss, takeProfit: o.takeProfit, updatedAt: new Date() }).where(eq(copyPositions.id, pos.id))
      }
    }
    const requested = num(o.requestedPrice)
    await db.update(copyOrders).set({ status: c.status, reason: filled ? null : c.message, executionPrice: str(price), slippage: entry && price != null && requested != null ? str((price - requested) * (o.side === "long" ? 1 : -1)) : null, latencyMs: filled ? (timed?.latencyMs ?? Math.max(0, c.updatedAt.getTime() - o.createdAt.getTime())) : null, tradeloopMs: filled ? (timed?.tradeloopMs ?? null) : null, updatedAt: new Date() }).where(eq(copyOrders.id, o.id))
    // a refused close is not reported yet: it is about to be tried again
    if (!filled && o.action !== "close") await note(userId, { groupId: o.groupId, accountId: o.followerAccountId, level: "error", code: `order_${c.status}`, title: `${classifyFailure(c.message).label}: order ${c.status} — ${name(o.followerAccountId)}`, body: c.message, action: classifyFailure(c.message).action, masterOrderId: o.masterOrderId })
  }

  // 2. a position recorded as closed that its broker still lists is not closed:
  //    put it back, wanted closed (a Flatten All or a leader's close the broker refused)
  const recent = await db.select().from(copyPositions).where(and(eq(copyPositions.userId, userId), eq(copyPositions.role, "follower"), eq(copyPositions.simulated, false), eq(copyPositions.status, "closed"), isNotNull(copyPositions.positionRef), gte(copyPositions.updatedAt, new Date(Date.now() - 24 * 3_600_000))))
  for (const pos of recent) {
    const still = state.positions.find((p) => !p.simulated && p.accountId === pos.accountId && keys?.get(p) === pos.positionRef)
    if (!still) continue
    await db.update(copyPositions).set({ status: "open", closedAt: null, quantity: String(still.quantity), closeRequestedAt: new Date(), closeAttempts: 0, updatedAt: new Date(0) }).where(eq(copyPositions.id, pos.id))
    await note(userId, { groupId: pos.groupId, accountId: pos.accountId, level: "warning", code: "close_unconfirmed", title: `Still open at the broker — ${name(pos.accountId)}`, body: `${pos.symbol} ${pos.side === "long" ? "BUY" : "SELL"} ${still.quantity} was recorded as closed, but the broker never confirmed it and still lists the position.`, action: "It is being closed now. If it is still there in a minute, close it on the broker's platform." })
  }

  // 3. every close that is wanted and not yet confirmed
  const wanted = await db.select().from(copyPositions).where(and(eq(copyPositions.userId, userId), eq(copyPositions.role, "follower"), eq(copyPositions.simulated, false), eq(copyPositions.status, "open"), isNotNull(copyPositions.closeRequestedAt)))
  if (!wanted.length) return
  const flying = new Set((await db.select({ decision: copyOrders.decision }).from(copyOrders).where(and(eq(copyOrders.userId, userId), eq(copyOrders.action, "close"), inArray(copyOrders.status, ["sent", "pending"]), eq(copyOrders.simulated, false)))).map((o) => Number((o.decision as { positionId?: number } | null)?.positionId)))
  const prop = await propSync(userId)
  for (const pos of wanted) {
    const account = state.accounts.find((a) => a.id === pos.accountId)
    const listed = !!pos.positionRef && state.positions.some((p) => !p.simulated && p.accountId === pos.accountId && keys?.get(p) === pos.positionRef)
    // gone from an account read after the close was asked for: the broker has closed it
    if (pos.positionRef && !listed && account?.lastSyncAt && new Date(account.lastSyncAt).getTime() > pos.closeRequestedAt!.getTime() && account.health === "connected") {
      await db.update(copyPositions).set({ status: "closed", closedAt: new Date(), quantity: "0", closeRequestedAt: null, updatedAt: new Date() }).where(eq(copyPositions.id, pos.id))
      continue
    }
    if (!pos.positionRef || flying.has(pos.id) || Date.now() - pos.updatedAt.getTime() < CLOSE_RETRY_MS) continue
    if (pos.closeAttempts >= CLOSE_ATTEMPTS) {
      // said once, then left for the trader
      if (pos.closeAttempts === CLOSE_ATTEMPTS) {
        await db.update(copyPositions).set({ closeAttempts: CLOSE_ATTEMPTS + 1, updatedAt: new Date() }).where(eq(copyPositions.id, pos.id))
        await note(userId, { groupId: pos.groupId, accountId: pos.accountId, level: "error", code: "close_failed", title: `Could not close a position — ${name(pos.accountId)}`, body: `The broker refused to close ${pos.symbol} ${pos.side === "long" ? "BUY" : "SELL"} ${Number(pos.quantity)} after ${CLOSE_ATTEMPTS} tries.`, action: "Close it on the broker's platform now. It is still open." })
      }
      continue
    }
    const attempt = pos.closeAttempts + 1
    const master = `x${pos.groupId}-p${pos.id}-${pos.closeRequestedAt!.getTime().toString(36)}`
    const [order] = await db.insert(copyOrders).values({ userId, groupId: pos.groupId, correlationId: `${master}-c${attempt}`, masterOrderId: master, masterAccountId: state.groups.find((g) => g.id === pos.groupId)?.leaderAccountId ?? pos.accountId, followerAccountId: pos.accountId, action: "close", symbol: pos.symbol, leaderSymbol: pos.symbol, side: pos.side, quantity: pos.quantity, status: "pending", decision: { positionId: pos.id }, simulated: false }).onConflictDoNothing().returning({ id: copyOrders.id })
    await db.update(copyPositions).set({ closeAttempts: attempt, updatedAt: new Date() }).where(eq(copyPositions.id, pos.id))
    if (!order) continue
    const sent = await queue({ userId, state, prop }, pos.accountId, { kind: "close", symbol: pos.symbol, side: pos.side as Side, volume: Number(pos.quantity), positionRef: pos.positionRef })
    await db.update(copyOrders).set({ status: sent.status, reason: sent.reason, orderCommandId: sent.id, updatedAt: new Date() }).where(eq(copyOrders.id, order.id))
  }
}

// Tells the sync server which accounts are copying right now, so its copy lane
// can keep a terminal open for each: the leader of a group that is switched
// on, and each follower of it that is switched on. Everything else is cleared.
//
// A follower whose positions are still being closed keeps its terminal until
// the broker has confirmed them, whatever has become of its group: Flatten All
// pauses the group, and that is exactly when its closes must go out fastest.
export async function syncCopyRoles(userId: string, deep = true): Promise<void> {
  const [groups, followers, connections, owed] = await Promise.all([
    db.select({ id: copyGroups.id, leaderAccountId: copyGroups.leaderAccountId }).from(copyGroups).where(and(eq(copyGroups.userId, userId), eq(copyGroups.status, "active"))),
    db.select({ groupId: copyGroupFollowers.groupId, accountId: copyGroupFollowers.accountId }).from(copyGroupFollowers).where(and(eq(copyGroupFollowers.userId, userId), eq(copyGroupFollowers.enabled, true))),
    db.select({ id: metatraderConnections.id, accountId: metatraderConnections.accountId, copyRole: metatraderConnections.copyRole }).from(metatraderConnections).where(eq(metatraderConnections.userId, userId)),
    db.selectDistinct({ accountId: copyPositions.accountId }).from(copyPositions).where(and(eq(copyPositions.userId, userId), eq(copyPositions.role, "follower"), eq(copyPositions.status, "open"), eq(copyPositions.simulated, false), isNotNull(copyPositions.closeRequestedAt), lte(copyPositions.closeAttempts, CLOSE_ATTEMPTS))),
  ])
  const active = new Set(groups.map((g) => g.id))
  // an account of this trader's that leads a friend's group (a shared strategy) is a Leader too
  const mine = connections.map((c) => c.accountId).filter((id): id is number => id != null)
  const followed = mine.length ? await db.select({ leaderAccountId: copyGroups.leaderAccountId }).from(copyGroups).where(and(eq(copyGroups.status, "active"), inArray(copyGroups.leaderAccountId, mine), ne(copyGroups.userId, userId))) : []
  const leads = new Set([...groups, ...followed].map((g) => g.leaderAccountId))
  const follows = new Set([...followers.filter((f) => active.has(f.groupId)).map((f) => f.accountId), ...owed.map((o) => o.accountId)])
  for (const c of connections) {
    const role = c.accountId == null ? null : leads.has(c.accountId) && follows.has(c.accountId) ? "both" : leads.has(c.accountId) ? "leader" : follows.has(c.accountId) ? "follower" : null
    if (role !== (c.copyRole ?? null)) await db.update(metatraderConnections).set({ copyRole: role, ...(role === "leader" || role === "both" ? {} : { copyPlan: null }) }).where(eq(metatraderConnections.id, c.id))
  }
  // and the owners of the strategies this trader copies: their account's role follows from this trader's groups too
  if (!deep) return
  const all = await db.select({ leaderAccountId: copyGroups.leaderAccountId }).from(copyGroups).where(eq(copyGroups.userId, userId))
  const foreign = [...new Set(all.map((g) => g.leaderAccountId))].filter((id) => !mine.includes(id))
  if (!foreign.length) return
  const owners = await db.selectDistinct({ userId: metatraderConnections.userId }).from(metatraderConnections).where(and(inArray(metatraderConnections.accountId, foreign), ne(metatraderConnections.userId, userId)))
  for (const o of owners) await syncCopyRoles(o.userId, false)
}

// Takes the plans away: the lane stops copying by itself at its next look (a
// second) and only reports, until the engine has written new ones from the
// setup as it is now. Called whenever the trader changes anything, and for
// everyone when Copy Trading goes back to simulation.
export async function clearPlans(userId?: string): Promise<void> {
  await db.update(metatraderConnections).set({ copyPlan: null }).where(and(isNotNull(metatraderConnections.copyPlan), userId ? eq(metatraderConnections.userId, userId) : sql`true`))
}

// Writes each leader's plan (plan.ts): what the copy lane needs to size and
// send the followers' orders the instant the leader trades. Live mode only,
// and only for a group that is switched on; rewritten on every pass of the
// engine, so the risk picture in it is never more than a few seconds old.
async function writePlans(userId: string, state: CopyState, prop: Map<number, Prop>, timeZone: string) {
  const connections = await db.select({ id: metatraderConnections.id, accountId: metatraderConnections.accountId, has: sql<boolean>`${metatraderConnections.copyPlan} is not null` }).from(metatraderConnections).where(and(eq(metatraderConnections.userId, userId), eq(metatraderConnections.platform, "mt5")))
  const leading = (accountId: number | null) => (state.mode === "live" && accountId != null ? state.groups.filter((g) => g.status === "active" && g.leaderAccountId === accountId) : [])
  if (!connections.some((c) => c.has || leading(c.accountId).length)) return
  // followers' positions already held for the leaders' open ones: what a leader's close closes
  const held = await db.select({ id: copyPositions.id, groupId: copyPositions.groupId, accountId: copyPositions.accountId, role: copyPositions.role, positionRef: copyPositions.positionRef, leaderPositionId: copyPositions.leaderPositionId, simulated: copyPositions.simulated, closeRequestedAt: copyPositions.closeRequestedAt }).from(copyPositions).where(and(eq(copyPositions.userId, userId), eq(copyPositions.status, "open")))
  const now = Date.now()
  for (const c of connections) {
    const groups = leading(c.accountId)
    if (!groups.length) {
      if (c.has) await db.update(metatraderConnections).set({ copyPlan: null }).where(eq(metatraderConnections.id, c.id))
      continue
    }
    const plan: LanePlan = {
      v: 1,
      userId,
      at: now,
      until: now + PLAN_TTL_MS,
      groups: groups.map((g) => ({
        id: g.id,
        timeZone,
        rules: g.rules,
        contracts: g.contracts,
        followers: g.followers.flatMap((f) => {
          const account = state.accounts.find((a) => a.id === f.accountId)
          if (!account?.canExecute || g.compliance.some((c) => c.accountId === f.accountId || c.accountId === g.leaderAccountId)) return []
          return [{ accountId: f.accountId, name: account.name, config: f.config, mappings: f.mappings, symbols: account.symbols, closedToday: account.dayPnl - (account.openPnl ?? 0), propSync: g.limits.respectPropSync ? account.propSync : NO_PROPSYNC, guard: guardView(prop.get(f.accountId)?.evaluation ?? null) }]
        }),
        links: held.flatMap((pos) => {
          if (pos.groupId !== g.id || pos.role !== "follower" || pos.simulated || !pos.positionRef || pos.closeRequestedAt) return []
          const leaderRef = held.find((x) => x.id === pos.leaderPositionId)?.positionRef
          return leaderRef ? [{ leaderRef, accountId: pos.accountId, positionRef: pos.positionRef }] : []
        }),
      })),
    }
    await db.update(metatraderConnections).set({ copyPlan: plan }).where(eq(metatraderConnections.id, c.id))
  }
}

// The engine's heartbeat: every active group, once. It runs when a Copy Trading
// page asks for fresh data, so it is as fast as the pages poll.
export async function runEngine(userId: string, timeZone: string): Promise<CopyState> {
  const state = await loadCopyState(userId, timeZone)
  await syncCopyRoles(userId).catch(() => undefined)
  const active = state.groups.filter((g) => g.status === "active")
  // without the brokers' positions there is nothing to compare: do nothing rather than read "no positions" as "all closed"
  if (!state.liveData) return state
  // Orders that went to a broker are settled whatever the mode or the groups'
  // state is now: a close that is owed is owed even after copying is paused.
  await reconcile(userId, state)
  if (!active.length) {
    // nothing is switched on: any plan left over is taken away
    await writePlans(userId, state, new Map(), timeZone).catch(() => undefined)
    return state
  }
  const now = new Date()
  const prop = await propSync(userId)
  let changes = 0
  for (const group of active) changes += await runGroup({ userId, state, group, mode: state.mode, ...clock(timeZone, now), prop, now })
  if (state.mode === "live" && changes > 0) await reconcile(userId, state)
  const after = changes > 0 || state.mode === "live" ? await loadCopyState(userId, timeZone) : state
  // from what the books say now, so a position just taken over is in it
  await writePlans(userId, after, prop, timeZone).catch(() => undefined)
  return after
}

// Tries a refused entry again with the follower's current settings, while the
// leader still holds the position.
export async function retryOrder(userId: string, orderId: number, timeZone: string): Promise<void> {
  const [o] = await db.select().from(copyOrders).where(and(eq(copyOrders.id, orderId), eq(copyOrders.userId, userId))).limit(1)
  if (!o) throw new Error("That order no longer exists.")
  if (o.action !== "open" && o.action !== "increase") throw new Error("Only an entry can be tried again.")
  if (!["blocked", "failed", "rejected", "unsupported"].includes(o.status)) throw new Error("That order doesn't need to be tried again.")
  // One copy of a trade per account. An earlier retry that went out is the
  // copy: Retry pressed again (the alert is still on the page) must not open it twice.
  const attempts = await db.select({ status: copyOrders.status }).from(copyOrders).where(and(eq(copyOrders.userId, userId), eq(copyOrders.masterOrderId, o.masterOrderId), eq(copyOrders.followerAccountId, o.followerAccountId)))
  if (attempts.some((a) => isUnderway(a.status))) throw new Error("This trade has already been sent to the account. Check its position before trying again.")
  const state = await loadCopyState(userId, timeZone)
  const group = state.groups.find((g) => g.id === o.groupId)
  if (!group || group.status !== "active") throw new Error("The group isn't copying. Activate it first.")
  const m = o.masterOrderId.match(/^m\d+-p(\d+)-v(\d+)$/)
  const [leader] = m ? await db.select().from(copyPositions).where(and(eq(copyPositions.id, Number(m[1])), eq(copyPositions.userId, userId), eq(copyPositions.status, "open"))) : []
  if (!leader) throw new Error("The Leader has closed this position, so there is nothing left to copy.")
  const n = attempts.length
  const live = state.positions.find((p) => !p.simulated && p.accountId === leader.accountId && p.symbol === leader.symbol && p.side === leader.side)
  const p: LivePosition = { key: leader.positionRef ?? "", symbol: leader.symbol, side: leader.side as Side, quantity: Number(leader.quantity), entry: num(leader.entryPrice), stopLoss: num(leader.stopLoss), takeProfit: num(leader.takeProfit), price: live?.current ?? null }
  const now = new Date()
  await copyEntry({ userId, state, group, mode: state.mode, ...clock(timeZone, now), prop: await propSync(userId), now }, { id: leader.id, version: Number(m![2]) }, p, Number(o.leaderQuantity ?? leader.quantity), o.action as "open" | "increase", { accountId: o.followerAccountId, suffix: `-r${n}` })
}

// ------------------------------------------------------------------ emergency controls

// Pause All Copying: every group of the trader's stops taking new copies, at
// once. Nothing is closed: pausing and flattening are different things, and
// only Flatten closes a position. Returns how many groups were running.
export async function pauseAll(userId: string): Promise<number> {
  const paused = await db.update(copyGroups).set({ status: "paused", updatedAt: new Date() }).where(and(eq(copyGroups.userId, userId), eq(copyGroups.status, "active"))).returning({ id: copyGroups.id })
  // the sync server stops acting for this trader by itself, now
  await clearPlans(userId)
  for (const g of paused) await note(userId, { groupId: g.id, level: "warning", code: "group_paused", title: "Copying paused (Pause all)", body: "No new trades are copied. Positions that are already open are left as they are.", action: "Activate the group again in the Cockpit when you want it to copy." })
  return paused.length
}

// Stops new copies for every follower of the group. Nothing is closed.
export async function disableAll(userId: string, groupId: number): Promise<void> {
  const g = await ownGroup(userId, groupId)
  await db.update(copyGroupFollowers).set({ enabled: false, updatedAt: new Date() }).where(eq(copyGroupFollowers.groupId, groupId))
  await db.update(copyGroups).set({ status: g.status === "active" ? "paused" : g.status, updatedAt: new Date() }).where(eq(copyGroups.id, groupId))
  await note(userId, { groupId, level: "warning", code: "disabled_all", title: "All followers disabled", body: "No new trades are copied. Open positions were not closed.", action: "Switch followers back on in the Cockpit, then activate the group." })
}

// Withdraws the copy orders of one symbol that haven't reached a broker yet
// (every symbol of the group when none is given). Open positions are not touched.
export async function cancelOrders(userId: string, groupId: number, symbol?: string | null): Promise<number> {
  await ownGroup(userId, groupId)
  const waiting = await db.select({ id: copyOrders.id, commandId: copyOrders.orderCommandId, symbol: copyOrders.symbol, leaderSymbol: copyOrders.leaderSymbol }).from(copyOrders).where(and(eq(copyOrders.groupId, groupId), eq(copyOrders.userId, userId), inArray(copyOrders.status, ["pending", "sent"])))
  const open = symbol ? waiting.filter((o) => sameInstrument(o.leaderSymbol, symbol) || sameInstrument(o.symbol, symbol)) : waiting
  const commands = open.map((o) => o.commandId).filter((id): id is number => id != null)
  // only what the executor hasn't picked up: an order already at the broker is the broker's
  const stopped = commands.length ? await db.update(orderCommands).set({ status: "blocked", resultMessage: "Cancelled from Copy Trading before it was sent.", updatedAt: new Date() }).where(and(eq(orderCommands.userId, userId), inArray(orderCommands.id, commands), eq(orderCommands.status, "pending"))).returning({ id: orderCommands.id }) : []
  const cancelled = open.filter((o) => o.commandId == null || stopped.some((s) => s.id === o.commandId))
  if (cancelled.length) await db.update(copyOrders).set({ status: "cancelled", reason: "Cancelled from the Cockpit.", updatedAt: new Date() }).where(inArray(copyOrders.id, cancelled.map((o) => o.id)))
  const what = symbol ? `${symbol} ` : ""
  await note(userId, { groupId, level: "warning", code: "orders_cancelled", title: `${cancelled.length} pending ${what}copy ${cancelled.length === 1 ? "order" : "orders"} cancelled`, body: open.length > cancelled.length ? `${open.length - cancelled.length} had already been sent to a broker and could not be withdrawn.` : null, action: open.length > cancelled.length ? "Cancel those in the Trade Manager or on the broker's platform." : null })
  return cancelled.length
}

export type FlattenResult = {
  // open positions of that symbol found on the accounts asked for
  total: number
  // simulated positions, closed here and now
  closed: number
  // live positions a close was sent for; each shows as closed once its broker confirms
  requested: number
  // what couldn't be closed from TradeLoop, and why
  skipped: { accountId: number; name: string; reason: string }[]
}

// Flatten: closes open positions at market.
//   symbol null  — everything the group's accounts hold, in every symbol, the
//                  Leader's included (the Cockpit's Flatten All)
//   symbol given — what they hold of that one contract, each account in its
//                  own name for it
//   accountId    — that account's only
// Pending orders are not touched (that is Cancel Orders), and nothing is
// paused: the group goes on copying.
//
// Which positions those are is worked out here, from the brokers' own lists and
// with the same functions the Cockpit counts with (groupScope / symbolScope),
// never from what the browser sent. A simulated position is closed in the
// books. A live one gets a close order at market and counts as closed only
// when its broker confirms; a refused close is sent again (reconcile). An
// account TradeLoop can't trade (a read-only connection, or any account while
// in Simulation) is left as it is and named.
export async function flattenPositions(userId: string, groupId: number, symbol: string | null, accountId: number | null, timeZone: string): Promise<FlattenResult> {
  await ownGroup(userId, groupId)
  const contract = symbol == null ? null : String(symbol).trim()
  if (contract != null && (!contract || contract.length > 40)) throw new Error("Choose the contract to flatten.")
  // The copy lane stops acting by itself first: when the Leader's positions
  // close a moment from now, it must not send the followers a second close.
  await clearPlans(userId)
  const state = await loadCopyState(userId, timeZone)
  const group = state.groups.find((g) => g.id === groupId)
  if (!group) throw new Error("That copy group no longer exists.")
  // an unreadable feed must not be taken for "nothing is open"
  if (!state.liveData) throw new Error("Live positions couldn't be read just now, so nothing was closed. Try again in a moment.")
  // A friend's shared account is read, never traded on: its positions are its
  // owner's to close, and are not part of anything flattened from here.
  const scope: (AccountScope & { symbol?: string })[] = (contract == null ? groupScope(group, state.positions) : symbolScope(group, [...state.accounts, ...state.shared], state.positions, contract)).filter((r) => !state.shared.some((s) => s.id === r.accountId))
  const rows = accountId == null ? scope : scope.filter((r) => r.accountId === accountId)
  if (accountId != null && !rows.length) throw new Error("That account isn't part of this group.")

  const keys = liveKeys.get(state.positions)
  const now = new Date()
  const managed = await db.select().from(copyPositions).where(and(eq(copyPositions.groupId, groupId), eq(copyPositions.userId, userId), eq(copyPositions.role, "follower"), eq(copyPositions.status, "open")))
  const prop = await propSync(userId)
  const out: FlattenResult = { total: rows.reduce((n, r) => n + r.positions.length, 0), closed: 0, requested: 0, skipped: [] }
  const skip = (id: number, reason: string) => {
    if (!out.skipped.some((s) => s.accountId === id)) out.skipped.push({ accountId: id, name: state.accounts.find((a) => a.id === id)?.name ?? "An account", reason })
  }
  let owed = false

  for (const row of rows) {
    const account = state.accounts.find((a) => a.id === row.accountId)
    // simulated copies on this account (of the one symbol, or all of them): closed in the books
    const sim = managed.filter((m) => m.simulated && m.accountId === row.accountId && (row.symbol == null || sameInstrument(m.symbol, row.symbol)))
    if (row.positions.some((p) => p.simulated) && sim.length) {
      await db.update(copyPositions).set({ status: "closed", closedAt: now, quantity: "0", updatedAt: now }).where(inArray(copyPositions.id, sim.map((m) => m.id)))
      out.closed += row.positions.filter((p) => p.simulated).length
    }
    for (const p of row.positions.filter((x) => !x.simulated)) {
      if (state.mode !== "live") {
        skip(row.accountId, "Simulation mode: no order is sent to a broker. Close it on the broker's platform, or switch to Live.")
        continue
      }
      if (!account?.canExecute) {
        skip(row.accountId, account?.executionNote ?? "This account can't receive orders from TradeLoop.")
        continue
      }
      const ref = keys?.get(p)
      if (!ref) {
        skip(row.accountId, "The broker hasn't given this position a ticket yet. Try again in a moment.")
        continue
      }
      const mine = managed.find((m) => !m.simulated && m.accountId === row.accountId && m.positionRef === ref)
      if (mine) {
        // A copied position: owed a close, sent below and again if the broker
        // refuses it. Asked for afresh every time (a new request, with tries of
        // its own): a close that was given up on earlier is sent again, and
        // one already on its way is not doubled (reconcile looks for that).
        await db.update(copyPositions).set({ closeRequestedAt: now, closeAttempts: 0, updatedAt: new Date(0) }).where(eq(copyPositions.id, mine.id))
        owed = true
        out.requested++
        continue
      }
      // the Leader's own position, or one opened by hand on a follower: a close of its own, once
      const [flying] = await db.select({ id: orderCommands.id }).from(orderCommands).where(and(eq(orderCommands.userId, userId), eq(orderCommands.accountId, row.accountId), eq(orderCommands.positionRef, ref), eq(orderCommands.kind, "close"), inArray(orderCommands.status, ["pending", "sent"]))).limit(1)
      if (!flying) {
        const sent = await queue({ userId, state, prop }, row.accountId, { kind: "close", symbol: p.symbol, side: p.side, volume: p.quantity, positionRef: ref })
        if (sent.status !== "sent") {
          skip(row.accountId, sent.reason ?? "The close order couldn't be queued.")
          continue
        }
      }
      out.requested++
    }
  }
  // send the owed closes now rather than on the next pass
  if (owed) await reconcile(userId, await loadCopyState(userId, timeZone))

  const who = accountId != null ? ` — ${state.accounts.find((a) => a.id === accountId)?.name ?? "one account"}` : ""
  const parts = [out.requested ? `${out.requested} close ${out.requested === 1 ? "order" : "orders"} sent` : "", out.closed ? `${out.closed} simulated ${out.closed === 1 ? "position" : "positions"} closed` : ""].filter(Boolean)
  await note(userId, {
    groupId,
    accountId,
    level: out.skipped.length ? "warning" : "info",
    code: "flattened",
    title: `Flatten ${contract ?? "All"}${who}: ${parts.join(", ") || "nothing was open"}`,
    body: [out.requested ? "A live position shows as closed once its broker confirms; a close the broker refuses is sent again." : "", ...out.skipped.map((s) => `${s.name} was not closed. ${s.reason}`)].filter(Boolean).join(" ") || null,
    action: out.skipped.length ? "Close what is left on the broker's platform." : null,
  })
  return out
}
