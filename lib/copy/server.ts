import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { copyAccountPrefs, copyEvents, copyGroupContracts, copyGroupFollowers, copyGroups, copyOrders, copyPositions, copyRiskLimits, copyRules, copySymbolMappings, metatraderConnections, orderCommands, providerAccounts, rithmicConnections, trades, tradingAccounts } from "@/lib/db/schema"
import { getAppSetting } from "@/lib/app-settings"
import type { AccountEvaluation } from "@/lib/propmax/engine"
import type { OpenTradeView } from "@/lib/trade-manager"
import { localDay } from "@/lib/timezone"
import { pointValueAt, specFor, type ContractSpec } from "./contracts"
import { DEFAULT_FOLLOWER, DEFAULT_RULES, NO_PROPSYNC, activationProblems, calculateFollowerOrder, connectionHealth, followerOrderId, masterOrderId, planLeaderEvents, proportionalClose, translatePrice, validateCopyRules, type CopyAction, type CopyRules, type Decision, type FollowerConfig, type LivePosition, type PropSyncState, type RoundingRule, type Side, type SizingMode, type Step } from "./engine"
import type { AccountView, CopyState, EventView, FollowerView, GroupLimits, GroupStatus, GroupView, OrderView, PositionView, Role } from "./view"

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
export const MAX_GROUPS = 20
export const MAX_FOLLOWERS = 25
export const MAX_CONTRACTS = 30

const num = (v: unknown) => (v == null ? null : Number(v))
const str = (v: number | null | undefined) => (v == null ? null : String(v))
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Where the live positions come from: the same reader as the Trade Manager,
// for the signed-in trader. null = they couldn't be read this time.
type LiveReader = (userId: string) => Promise<Pick<OpenTradeView, "id" | "accountId" | "symbol" | "side" | "quantity" | "entryPrice" | "currentPrice" | "unrealizedPnl" | "stopLoss" | "takeProfit" | "positionRef">[] | null>
let readLive: LiveReader = async () => {
  try {
    const { getOpenTradesOverview } = await import("@/app/actions/trade-manager")
    return (await getOpenTradesOverview()).trades
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
  const [accountRows, mt, rith, prov, prefs, groupRows, followerRows, contractRows, ruleRows, limitRows, mappingRows, managed, orderRows, eventRows, closed, mode, live, prop] = await Promise.all([
    db.select().from(tradingAccounts).where(and(eq(tradingAccounts.userId, userId), eq(tradingAccounts.archived, false))),
    db
      .select({ accountId: metatraderConnections.accountId, platform: metatraderConnections.platform, login: metatraderConnections.login, status: metatraderConnections.status, message: metatraderConnections.statusMessage, balance: metatraderConnections.balance, equity: metatraderConnections.equity, open: metatraderConnections.openPositions, lastSyncedAt: metatraderConnections.lastSyncedAt, hasTrading: sql<boolean>`${metatraderConnections.tradingPasswordEnc} is not null` })
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
  ])

  const today = localDay(new Date(), timeZone)
  const closedToday = new Map<number, number>()
  for (const t of closed) if (t.accountId != null && t.exitTime && localDay(t.exitTime, timeZone) === today) closedToday.set(t.accountId, (closedToday.get(t.accountId) ?? 0) + Number(t.pnl))

  // live positions, as the brokers report them
  const positions: PositionView[] = []
  const keys = new Map<PositionView, string>()
  for (const t of live ?? []) {
    if (t.accountId == null) continue
    const p: PositionView = { accountId: t.accountId, symbol: t.symbol, side: t.side, quantity: t.quantity, entry: t.entryPrice, current: t.currentPrice, openPnl: t.unrealizedPnl, stopLoss: t.stopLoss, takeProfit: t.takeProfit, simulated: false, groupId: null }
    positions.push(p)
    keys.set(p, t.positionRef ?? `t${t.id}`)
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
    const canExecute = !!m && m.platform === "mt5" && !!m.hasTrading
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
      executionNote: canExecute ? "Orders can be placed on this account." : m ? (m.platform === "mt4" ? "MetaTrader 4 can't receive orders from TradeLoop yet." : "Add the account's master (trading) password in the Trade Manager to allow orders.") : r || p ? `${r ? "Rithmic" : title(p!.provider)} accounts can't receive orders from TradeLoop yet.` : "A manual account can't receive orders.",
      dayPnl: (closedToday.get(a.id) ?? 0) + (openPnl ?? 0),
      openPnl,
      openNotional: mine.reduce((s, x) => {
        const point = pointValueAt(specFor(x.symbol), x.current ?? x.entry)
        const at = x.current ?? x.entry
        return point != null && at != null ? s + x.quantity * at * point : s
      }, 0),
      propSync: prop.get(a.id)?.state ?? NO_PROPSYNC,
    }
  })

  const groups: GroupView[] = groupRows.map((g) => {
    const limits = limitRows.find((l) => l.groupId === g.id)
    return {
      id: g.id,
      name: g.name,
      status: g.status as GroupStatus,
      leaderAccountId: g.leaderAccountId,
      followers: followerRows.filter((f) => f.groupId === g.id).map((f): FollowerView => ({ id: f.id, accountId: f.accountId, config: toConfig(f), mappings: mappingRows.filter((m) => m.followerId === f.id).map((m) => ({ leaderSymbol: m.leaderSymbol, followerSymbol: m.followerSymbol })) })),
      contracts: contractRows.filter((c) => c.groupId === g.id).map(toSpec),
      rules: toRules(ruleRows.find((r) => r.groupId === g.id)),
      limits: { defaultMode: limits?.defaultMode ?? "same", defaultRatio: Number(limits?.defaultRatio ?? 1), globalRiskPct: Number(limits?.globalRiskPct ?? 1), respectPropSync: limits?.respectPropSync ?? true },
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

  const orders: OrderView[] = orderRows.map((o) => ({ id: o.id, groupId: o.groupId, correlationId: o.correlationId, masterOrderId: o.masterOrderId, masterAccountId: o.masterAccountId, followerAccountId: o.followerAccountId, action: o.action, symbol: o.symbol, leaderSymbol: o.leaderSymbol, side: o.side as Side, quantity: Number(o.quantity), leaderQuantity: num(o.leaderQuantity), requestedPrice: num(o.requestedPrice), executionPrice: num(o.executionPrice), status: o.status, reason: o.reason, slippage: num(o.slippage), latencyMs: o.latencyMs, simulated: o.simulated, createdAt: o.createdAt.toISOString(), steps: (Array.isArray((o.decision as { steps?: Step[] } | null)?.steps) ? (o.decision as { steps: Step[] }).steps : []) as Step[] }))
  const events: EventView[] = eventRows.map((e) => ({ id: e.id, groupId: e.groupId, accountId: e.accountId, level: e.level as EventView["level"], code: e.code, title: e.title, body: e.body, action: e.action, masterOrderId: e.masterOrderId, createdAt: e.createdAt.toISOString(), unread: !e.readAt }))

  return { mode, accounts, groups, positions, orders, events, liveData: live != null, at: new Date().toISOString() }
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

export type GroupInput = { name: string; leaderAccountId: number; followers: { accountId: number; config: unknown }[]; contracts: string[]; rules: unknown; limits?: Partial<GroupLimits> }

export async function createGroup(userId: string, input: GroupInput): Promise<number> {
  const name = String(input.name ?? "").trim().slice(0, 60)
  if (name.length < 2) throw new Error("Give the group a name.")
  const leader = Number(input.leaderAccountId)
  const followers = (input.followers ?? []).map((f) => ({ accountId: Number(f.accountId), config: cleanConfig(f.config) }))
  if (followers.some((f) => f.accountId === leader)) throw new Error("The Leader can't also follow itself.")
  if (new Set(followers.map((f) => f.accountId)).size !== followers.length) throw new Error("An account is listed twice.")
  if (followers.length > MAX_FOLLOWERS) throw new Error(`A group can have up to ${MAX_FOLLOWERS} followers.`)
  await ownAccounts(userId, [leader, ...followers.map((f) => f.accountId)])
  const existing = await db.select({ id: copyGroups.id, name: copyGroups.name }).from(copyGroups).where(eq(copyGroups.userId, userId))
  if (existing.length >= MAX_GROUPS) throw new Error(`You can have up to ${MAX_GROUPS} copy groups.`)
  if (existing.some((g) => g.name.toLowerCase() === name.toLowerCase())) throw new Error("You already have a group with that name.")
  const rules = cleanRules(input.rules)
  const symbols = [...new Set((input.contracts ?? []).map((s) => String(s).trim().toUpperCase()).filter((s) => /^[A-Z0-9._-]{1,20}$/.test(s)))].slice(0, MAX_CONTRACTS)

  const [g] = await db.insert(copyGroups).values({ userId, name, leaderAccountId: leader, status: "draft" }).returning({ id: copyGroups.id })
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
  const byId = new Map(state.accounts.map((a) => [a.id, a]))
  const online = (id: number) => ["connected", "syncing", "warning"].includes(byId.get(id)?.health ?? "disconnected")
  const problems = activationProblems({ hasLeader: byId.has(g.leaderAccountId), leaderConnected: online(g.leaderAccountId), followers: g.followers.map((f) => ({ name: byId.get(f.accountId)?.name ?? "A follower", config: f.config, connected: online(f.accountId) })), contracts: g.contracts.length, symbolScope: g.rules.symbolScope })
  if (problems.length) throw new Error(problems.join(" "))
  await baseline(userId, g, state)
  await db.update(copyGroups).set({ status: "active", updatedAt: new Date() }).where(eq(copyGroups.id, groupId))
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
  await ownAccounts(userId, [accountId])
  if (g.leaderAccountId === accountId) return
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
    const a = String(m?.leaderSymbol ?? "").trim().toUpperCase()
    const b = String(m?.followerSymbol ?? "").trim().toUpperCase()
    if (!/^[A-Z0-9._-]{1,20}$/.test(a) || !/^[A-Z0-9._-]{1,20}$/.test(b) || a === b || seen.has(a)) continue
    seen.add(a)
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
  await db.insert(copyAccountPrefs).values({ accountId, userId, role: clean }).onConflictDoUpdate({ target: copyAccountPrefs.accountId, set: { role: clean, updatedAt: new Date() } })
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

function clock(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0"
  return { minutes: Number(get("hour")) * 60 + Number(get("minute")), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")) }
}

const followerSymbol = (f: FollowerView, leaderSymbol: string) => f.mappings.find((m) => m.leaderSymbol === leaderSymbol.toUpperCase())?.followerSymbol ?? f.mappings.find((m) => specFor(m.leaderSymbol).root === specFor(leaderSymbol).root)?.followerSymbol ?? leaderSymbol
const specOf = (g: GroupView, symbol: string) => g.contracts.find((c) => c.symbol === symbol.toUpperCase()) ?? specFor(symbol)

// Hands one order to the broker's queue — the same queue, with the same
// prop-rule guard, as an order placed by hand in the Trade Manager.
async function queue(ctx: Ctx, accountId: number, command: { kind: "place" | "close" | "partial_close" | "modify"; symbol: string; side: Side; volume?: number | null; stopLoss?: number | null; takeProfit?: number | null; positionRef?: string | null }): Promise<{ id: number | null; status: string; reason: string | null }> {
  const account = ctx.state.accounts.find((a) => a.id === accountId)
  if (!account?.canExecute) return { id: null, status: "unsupported", reason: account?.executionNote ?? "This account can't receive orders." }
  const input = { accountId, broker: "mt5" as const, kind: command.kind, symbol: command.symbol, side: command.side, volume: command.volume ?? null, stopLoss: command.stopLoss ?? null, takeProfit: command.takeProfit ?? null, positionRef: command.positionRef ?? null, orderType: command.kind === "place" ? ("market" as const) : null }
  const { guardOrder } = await import("@/lib/order-execution/guard")
  const decision = guardOrder(input, ctx.prop.get(accountId)?.evaluation ?? null)
  const [row] = await db
    .insert(orderCommands)
    .values({ userId: ctx.userId, accountId, broker: "mt5", kind: command.kind, status: decision.allowed ? "pending" : "blocked", positionRef: input.positionRef, symbol: command.symbol, side: command.side, volume: str(input.volume), stopLoss: str(input.stopLoss), takeProfit: str(input.takeProfit), orderType: input.orderType, ruleCheck: decision, resultMessage: decision.allowed ? null : decision.reasons.join(" ") })
    .returning({ id: orderCommands.id })
  return { id: row.id, status: decision.allowed ? "sent" : "blocked", reason: decision.allowed ? null : `Blocked by the account's prop-firm rules. ${decision.reasons.join(" ")}` }
}

// A new position on the leader, or more added to one: an order for each follower.
async function copyEntry(ctx: Ctx, leader: { id: number; version: number }, p: LivePosition, quantity: number, action: "open" | "increase", only?: { accountId: number; suffix: string }) {
  const { group: g, state } = ctx
  const master = masterOrderId(g.id, leader.id, leader.version)
  const leaderAccount = state.accounts.find((a) => a.id === g.leaderAccountId)
  for (const f of g.followers) {
    if (only && f.accountId !== only.accountId) continue
    const account = state.accounts.find((a) => a.id === f.accountId)
    if (!account) continue
    const symbol = followerSymbol(f, p.symbol)
    const spec = specOf(g, symbol)
    const open = state.positions.filter((x) => x.accountId === f.accountId && x.symbol.toUpperCase() === symbol.toUpperCase() && x.side === p.side).reduce((s, x) => s + x.quantity, 0)
    const decision = calculateFollowerOrder({
      order: { symbol: p.symbol, side: p.side, quantity, orderType: "market", entry: p.price ?? p.entry, stopLoss: p.stopLoss, takeProfit: p.takeProfit },
      spec,
      config: f.config,
      leaderEquity: leaderAccount?.equity ?? leaderAccount?.balance ?? null,
      account: { equity: account.equity ?? account.balance, dayPnl: account.dayPnl, openNotional: account.openNotional, openQuantity: open, connected: ["connected", "syncing", "warning"].includes(account.health) },
      propSync: g.limits.respectPropSync ? account.propSync : NO_PROPSYNC,
      rules: { rules: g.rules, imported: g.contracts.map((c) => c.symbol), minutes: ctx.minutes, weekday: ctx.weekday },
      now: ctx.now,
    })
    const correlationId = followerOrderId(master, f.accountId) + (only?.suffix ?? "")
    const entry = p.price ?? p.entry
    const sl = g.rules.stopLoss ? translatePrice({ leaderPrice: p.stopLoss, leaderEntry: p.entry, followerEntry: entry, leaderSymbol: p.symbol, followerSymbol: symbol }) : null
    const tp = g.rules.takeProfit ? translatePrice({ leaderPrice: p.takeProfit, leaderEntry: p.entry, followerEntry: entry, leaderSymbol: p.symbol, followerSymbol: symbol }) : null
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
    await place(ctx, order.id, { leaderPositionId: leader.id, accountId: f.accountId, symbol, side: p.side, quantity: decision.finalQuantity, entry, stopLoss: sl, takeProfit: tp, correlationId })
  }
}

async function alert(ctx: Ctx, accountId: number, accountName: string, decision: Decision, master: string, what: string) {
  const a = ALERTS[decision.blockedBy ?? "rules"] ?? ALERTS.rules
  await note(ctx.userId, { groupId: ctx.group.id, accountId, level: a.level, code: `blocked_${decision.blockedBy ?? "rules"}`, title: `${a.title} — ${accountName}`, body: `Leader: ${what}. ${decision.reason}`, action: a.action, masterOrderId: master })
}

async function place(ctx: Ctx, orderId: number, o: { leaderPositionId: number; accountId: number; symbol: string; side: Side; quantity: number; entry: number | null; stopLoss: number | null; takeProfit: number | null; correlationId: string }) {
  let status = "filled"
  let reason: string | null = null
  let commandId: number | null = null
  if (ctx.mode === "live") {
    const sent = await queue(ctx, o.accountId, { kind: "place", symbol: o.symbol, side: o.side, volume: o.quantity, stopLoss: o.stopLoss, takeProfit: o.takeProfit })
    status = sent.status
    reason = sent.reason
    commandId = sent.id
  }
  await db.update(copyOrders).set({ status, reason, orderCommandId: commandId, executionPrice: ctx.mode === "simulation" ? str(o.entry) : null, updatedAt: new Date() }).where(eq(copyOrders.id, orderId))
  if (status !== "filled" && status !== "sent") {
    const name = ctx.state.accounts.find((a) => a.id === o.accountId)?.name ?? "A follower"
    await note(ctx.userId, { groupId: ctx.group.id, accountId: o.accountId, level: "error", code: `order_${status}`, title: `Order ${status === "unsupported" ? "not sent" : status} — ${name}`, body: reason, action: status === "unsupported" ? "Use a MetaTrader 5 account with its master password added, or keep this group in simulation." : "Check the account in the Trade Manager." })
    return
  }
  // the follower's own position: added to when it already holds this trade
  const [held] = await db.select().from(copyPositions).where(and(eq(copyPositions.groupId, ctx.group.id), eq(copyPositions.role, "follower"), eq(copyPositions.accountId, o.accountId), eq(copyPositions.leaderPositionId, o.leaderPositionId), eq(copyPositions.status, "open")))
  if (held) await db.update(copyPositions).set({ quantity: String(Number(held.quantity) + o.quantity), updatedAt: new Date() }).where(eq(copyPositions.id, held.id))
  else await db.insert(copyPositions).values({ userId: ctx.userId, groupId: ctx.group.id, accountId: o.accountId, role: "follower", symbol: o.symbol, side: o.side, quantity: String(o.quantity), entryPrice: str(o.entry), stopLoss: str(o.stopLoss), takeProfit: str(o.takeProfit), leaderPositionId: o.leaderPositionId, correlationId: o.correlationId, simulated: ctx.mode === "simulation" })
}

// A change to a position the followers already hold: partial close, close, stop, target.
async function copyChange(ctx: Ctx, leader: typeof copyPositions.$inferSelect, version: number, action: CopyAction, p: LivePosition, change: { fraction?: number }) {
  const { group: g } = ctx
  const master = masterOrderId(g.id, leader.id, version)
  const held = await db.select().from(copyPositions).where(and(eq(copyPositions.groupId, g.id), eq(copyPositions.role, "follower"), eq(copyPositions.leaderPositionId, leader.id), eq(copyPositions.status, "open")))
  const allowed = validateCopyRules(g.rules, action, { side: p.side, orderType: "market", symbol: p.symbol }, { imported: g.contracts.map((c) => c.symbol), minutes: ctx.minutes, weekday: ctx.weekday })
  for (const pos of held) {
    const follower = g.followers.find((f) => f.accountId === pos.accountId)
    const spec = specOf(g, pos.symbol)
    const quantity = Number(pos.quantity)
    const closing = action === "close" ? quantity : action === "partial_close" ? proportionalClose(quantity, change.fraction ?? 0, spec) : 0
    const stopLoss = action === "modify_sl" || action === "trailing_stop" ? translatePrice({ leaderPrice: p.stopLoss, leaderEntry: num(leader.entryPrice), followerEntry: num(pos.entryPrice), leaderSymbol: leader.symbol, followerSymbol: pos.symbol }) : num(pos.stopLoss)
    const takeProfit = action === "modify_tp" ? translatePrice({ leaderPrice: p.takeProfit, leaderEntry: num(leader.entryPrice), followerEntry: num(pos.entryPrice), leaderSymbol: leader.symbol, followerSymbol: pos.symbol }) : num(pos.takeProfit)
    // a follower that was switched off after it entered still follows the exit; nothing else
    const off = follower && !follower.config.enabled && action !== "close" && action !== "partial_close"
    const skip = !allowed.ok ? allowed.reason : off ? "Copying is switched off for this account." : action === "partial_close" && closing <= 0 ? "The proportional close is below the minimum quantity." : null
    const [order] = await db
      .insert(copyOrders)
      .values({ userId: ctx.userId, groupId: g.id, correlationId: followerOrderId(master, pos.accountId), masterOrderId: master, masterAccountId: g.leaderAccountId, followerAccountId: pos.accountId, action, symbol: pos.symbol, leaderSymbol: leader.symbol, side: pos.side, quantity: String(closing || quantity), leaderQuantity: String(p.quantity), requestedPrice: str(p.price ?? p.entry), stopLoss: str(stopLoss), takeProfit: str(takeProfit), status: skip ? "skipped" : "pending", reason: skip, simulated: pos.simulated })
      .onConflictDoNothing()
      .returning({ id: copyOrders.id })
    if (!order || skip) continue

    let status = "filled"
    let reason: string | null = null
    let commandId: number | null = null
    if (!pos.simulated) {
      if (!pos.positionRef) {
        status = "failed"
        reason = "The follower's position hasn't been confirmed by its broker yet, so it can't be changed."
      } else {
        const sent = await queue(ctx, pos.accountId, closing > 0 ? { kind: closing >= quantity ? "close" : "partial_close", symbol: pos.symbol, side: pos.side as Side, volume: closing, positionRef: pos.positionRef } : { kind: "modify", symbol: pos.symbol, side: pos.side as Side, stopLoss, takeProfit, positionRef: pos.positionRef })
        status = sent.status
        reason = sent.reason
        commandId = sent.id
      }
    }
    await db.update(copyOrders).set({ status, reason, orderCommandId: commandId, executionPrice: pos.simulated ? str(p.price ?? p.entry) : null, updatedAt: new Date() }).where(eq(copyOrders.id, order.id))
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
  if (state.accounts.find((x) => x.id === g.leaderAccountId)?.health !== "connected") return 0
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

// Live orders: what the broker's executor said, written back to the copy.
async function reconcile(userId: string, state: CopyState) {
  const waiting = await db.select().from(copyOrders).where(and(eq(copyOrders.userId, userId), inArray(copyOrders.status, ["sent", "pending"]), eq(copyOrders.simulated, false))).limit(100)
  const ids = waiting.map((o) => o.orderCommandId).filter((id): id is number => id != null)
  if (!ids.length) return
  const commands = await db.select({ id: orderCommands.id, status: orderCommands.status, message: orderCommands.resultMessage, updatedAt: orderCommands.updatedAt }).from(orderCommands).where(and(eq(orderCommands.userId, userId), inArray(orderCommands.id, ids)))
  const keys = liveKeys.get(state.positions)
  for (const o of waiting) {
    const c = commands.find((x) => x.id === o.orderCommandId)
    if (!c || c.status === "pending" || c.status === "sent") continue
    const filled = c.status === "filled"
    let price: number | null = null
    if (filled && (o.action === "open" || o.action === "increase")) {
      // the follower's own position, as its broker now reports it
      const live = state.positions.find((p) => !p.simulated && p.accountId === o.followerAccountId && p.symbol.toUpperCase() === o.symbol.toUpperCase() && p.side === o.side)
      if (live) {
        price = live.entry
        await db.update(copyPositions).set({ positionRef: keys?.get(live) ?? null, entryPrice: str(live.entry), updatedAt: new Date() }).where(and(eq(copyPositions.userId, userId), eq(copyPositions.correlationId, o.correlationId), eq(copyPositions.status, "open")))
      }
    }
    if (!filled && (o.action === "open" || o.action === "increase")) await db.update(copyPositions).set({ status: "closed", closedAt: new Date(), quantity: "0" }).where(and(eq(copyPositions.userId, userId), eq(copyPositions.correlationId, o.correlationId), eq(copyPositions.status, "open")))
    const requested = num(o.requestedPrice)
    await db.update(copyOrders).set({ status: c.status, reason: filled ? null : c.message, executionPrice: str(price), slippage: price != null && requested != null ? str((price - requested) * (o.side === "long" ? 1 : -1)) : null, latencyMs: filled ? Math.max(0, c.updatedAt.getTime() - o.createdAt.getTime()) : null, updatedAt: new Date() }).where(eq(copyOrders.id, o.id))
    if (!filled) await note(userId, { groupId: o.groupId, accountId: o.followerAccountId, level: "error", code: `order_${c.status}`, title: `Order ${c.status} — ${state.accounts.find((a) => a.id === o.followerAccountId)?.name ?? "a follower"}`, body: c.message, action: "Check the account in the Trade Manager.", masterOrderId: o.masterOrderId })
  }
}

// The engine's heartbeat: every active group, once. It runs when a Copy Trading
// page asks for fresh data, so it is as fast as the pages poll.
export async function runEngine(userId: string, timeZone: string): Promise<CopyState> {
  const state = await loadCopyState(userId, timeZone)
  const active = state.groups.filter((g) => g.status === "active")
  // without the leader's positions there is nothing to compare: do nothing rather than read "no positions" as "all closed"
  if (!active.length || !state.liveData) return state
  const now = new Date()
  const prop = await propSync(userId)
  let changes = 0
  for (const group of active) changes += await runGroup({ userId, state, group, mode: state.mode, ...clock(timeZone, now), prop, now })
  if (state.mode === "live") await reconcile(userId, state)
  return changes > 0 || state.mode === "live" ? loadCopyState(userId, timeZone) : state
}

// Tries a refused entry again with the follower's current settings, while the
// leader still holds the position.
export async function retryOrder(userId: string, orderId: number, timeZone: string): Promise<void> {
  const [o] = await db.select().from(copyOrders).where(and(eq(copyOrders.id, orderId), eq(copyOrders.userId, userId))).limit(1)
  if (!o) throw new Error("That order no longer exists.")
  if (o.action !== "open" && o.action !== "increase") throw new Error("Only an entry can be tried again.")
  if (!["blocked", "failed", "rejected", "unsupported"].includes(o.status)) throw new Error("That order doesn't need to be tried again.")
  const state = await loadCopyState(userId, timeZone)
  const group = state.groups.find((g) => g.id === o.groupId)
  if (!group || group.status !== "active") throw new Error("The group isn't copying. Activate it first.")
  const m = o.masterOrderId.match(/^m\d+-p(\d+)-v(\d+)$/)
  const [leader] = m ? await db.select().from(copyPositions).where(and(eq(copyPositions.id, Number(m[1])), eq(copyPositions.userId, userId), eq(copyPositions.status, "open"))) : []
  if (!leader) throw new Error("The Leader has closed this position, so there is nothing left to copy.")
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(copyOrders).where(and(eq(copyOrders.userId, userId), eq(copyOrders.masterOrderId, o.masterOrderId), eq(copyOrders.followerAccountId, o.followerAccountId)))
  const live = state.positions.find((p) => !p.simulated && p.accountId === leader.accountId && p.symbol === leader.symbol && p.side === leader.side)
  const p: LivePosition = { key: leader.positionRef ?? "", symbol: leader.symbol, side: leader.side as Side, quantity: Number(leader.quantity), entry: num(leader.entryPrice), stopLoss: num(leader.stopLoss), takeProfit: num(leader.takeProfit), price: live?.current ?? null }
  const now = new Date()
  await copyEntry({ userId, state, group, mode: state.mode, ...clock(timeZone, now), prop: await propSync(userId), now }, { id: leader.id, version: Number(m![2]) }, p, Number(o.leaderQuantity ?? leader.quantity), o.action as "open" | "increase", { accountId: o.followerAccountId, suffix: `-r${n}` })
}

// ------------------------------------------------------------------ emergency controls

// Stops new copies for every follower of the group. Nothing is closed.
export async function disableAll(userId: string, groupId: number): Promise<void> {
  const g = await ownGroup(userId, groupId)
  await db.update(copyGroupFollowers).set({ enabled: false, updatedAt: new Date() }).where(eq(copyGroupFollowers.groupId, groupId))
  await db.update(copyGroups).set({ status: g.status === "active" ? "paused" : g.status, updatedAt: new Date() }).where(eq(copyGroups.id, groupId))
  await note(userId, { groupId, level: "warning", code: "disabled_all", title: "All followers disabled", body: "No new trades are copied. Open positions were not closed.", action: "Switch followers back on in the Cockpit, then activate the group." })
}

// Withdraws copy orders that haven't reached a broker yet.
export async function cancelOrders(userId: string, groupId: number): Promise<number> {
  await ownGroup(userId, groupId)
  const open = await db.select({ id: copyOrders.id, commandId: copyOrders.orderCommandId }).from(copyOrders).where(and(eq(copyOrders.groupId, groupId), eq(copyOrders.userId, userId), inArray(copyOrders.status, ["pending", "sent"])))
  const commands = open.map((o) => o.commandId).filter((id): id is number => id != null)
  // only what the executor hasn't picked up: an order already at the broker is the broker's
  const stopped = commands.length ? await db.update(orderCommands).set({ status: "blocked", resultMessage: "Cancelled from Copy Trading before it was sent.", updatedAt: new Date() }).where(and(eq(orderCommands.userId, userId), inArray(orderCommands.id, commands), eq(orderCommands.status, "pending"))).returning({ id: orderCommands.id }) : []
  const cancelled = open.filter((o) => o.commandId == null || stopped.some((s) => s.id === o.commandId))
  if (cancelled.length) await db.update(copyOrders).set({ status: "cancelled", reason: "Cancelled from the Cockpit.", updatedAt: new Date() }).where(inArray(copyOrders.id, cancelled.map((o) => o.id)))
  await note(userId, { groupId, level: "warning", code: "orders_cancelled", title: `${cancelled.length} pending copy ${cancelled.length === 1 ? "order" : "orders"} cancelled`, body: open.length > cancelled.length ? `${open.length - cancelled.length} had already been sent to a broker and could not be withdrawn.` : null, action: open.length > cancelled.length ? "Cancel those in the Trade Manager or on the broker's platform." : null })
  return cancelled.length
}

// Closes every position the group's followers hold through Copy Trading.
export async function flattenAll(userId: string, groupId: number, confirm: string, timeZone: string): Promise<{ closed: number; failed: number }> {
  if (confirm !== "FLATTEN") throw new Error("Type FLATTEN to confirm.")
  await ownGroup(userId, groupId)
  const state = await loadCopyState(userId, timeZone)
  const group = state.groups.find((g) => g.id === groupId)!
  const now = new Date()
  const ctx: Ctx = { userId, state, group, mode: state.mode, ...clock(timeZone, now), prop: await propSync(userId), now }
  const held = await db.select().from(copyPositions).where(and(eq(copyPositions.groupId, groupId), eq(copyPositions.userId, userId), eq(copyPositions.role, "follower"), eq(copyPositions.status, "open")))
  let closed = 0
  let failed = 0
  for (const pos of held) {
    if (!pos.simulated) {
      const sent = pos.positionRef ? await queue(ctx, pos.accountId, { kind: "close", symbol: pos.symbol, side: pos.side as Side, volume: Number(pos.quantity), positionRef: pos.positionRef }) : { status: "failed" }
      if (sent.status !== "sent") {
        failed++
        continue
      }
    }
    await db.update(copyPositions).set({ status: "closed", closedAt: now, quantity: "0", updatedAt: now }).where(eq(copyPositions.id, pos.id))
    closed++
  }
  await db.update(copyGroupFollowers).set({ enabled: false, updatedAt: now }).where(eq(copyGroupFollowers.groupId, groupId))
  await db.update(copyGroups).set({ status: "paused", updatedAt: now }).where(and(eq(copyGroups.id, groupId), eq(copyGroups.status, "active")))
  await note(userId, { groupId, level: failed ? "error" : "warning", code: "flattened", title: `Flatten All: ${closed} ${closed === 1 ? "position" : "positions"} closed${failed ? `, ${failed} could not be` : ""}`, body: `${state.mode === "simulation" ? "Simulated positions were closed. " : ""}Copying is paused and every follower is switched off. The Leader's own positions were not touched.`, action: failed ? "Close the remaining positions in the Trade Manager or on the broker's platform now." : "Switch followers back on and activate the group when you are ready." })
  return { closed, failed }
}
