import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { analyticsCache, marketRegimes, playbooks, tagGroups, tagOptions, tradeExcursions, tradePsychology, trades, tradingAccounts } from "@/lib/db/schema"
import { cleanConditions, instrumentOf, prepareTrades, select, type Conditions, type EdgeTrade, type RawPsych, type RawTrade, type Regime } from "@/lib/edge/core"
import { yahooSymbolFor } from "@/lib/edge/market"

// Where Edge Lab and Psychology get their trades. The trade log itself is the
// source of truth — nothing is copied: this reads it, joins what the trader
// said about each trade, and hands the engines the same prepared list.
//
// Two layers keep it fast: a trader's prepared trades are held in memory for a
// few minutes (a page and the drawers it opens ask for them several times), and
// the heavier results are stored until the trades change (analytics_cache).

// ------------------------------------------------------------------ filters

export const RANGES = ["7d", "30d", "90d", "6m", "1y", "all"] as const
export type RangeKey = (typeof RANGES)[number] | "custom"
export const RANGE_LABELS: Record<string, string> = { "7d": "7D", "30d": "30D", "90d": "90D", "6m": "6M", "1y": "1Y", all: "All" }
const RANGE_DAYS: Record<string, number | null> = { "7d": 7, "30d": 30, "90d": 90, "6m": 183, "1y": 365, all: null }

export type Filters = {
  range: RangeKey
  // YYYY-MM-DD, for a custom range
  from: string | null
  to: string | null
  account: number | null
  // live = everything that isn't a backtest
  source: "live" | "backtest" | "all"
  // market / strategy / setup, as conditions every trade must meet
  base: Conditions
}

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)

export function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) as string | undefined
  const range = one("range")
  const custom = range === "custom" && isDay(one("from")) && isDay(one("to"))
  const account = Number(one("account"))
  const source = one("source")
  return {
    range: custom ? "custom" : (RANGES as readonly string[]).includes(range ?? "") ? (range as RangeKey) : "all",
    from: custom ? one("from")! : null,
    to: custom ? one("to")! : null,
    account: Number.isInteger(account) && account > 0 ? account : null,
    source: source === "backtest" || source === "all" ? source : "live",
    base: cleanConditions({ symbol: one("symbol"), strategy: one("strategy"), setup: one("setup") }),
  }
}

// The filters back as a query string (for links that keep them).
export function filterQuery(f: Filters, extra: Record<string, string | null | undefined> = {}): string {
  const p = new URLSearchParams()
  if (f.range !== "all") p.set("range", f.range)
  if (f.range === "custom" && f.from && f.to) {
    p.set("from", f.from)
    p.set("to", f.to)
  }
  if (f.account) p.set("account", String(f.account))
  if (f.source !== "live") p.set("source", f.source)
  for (const [k, v] of Object.entries(f.base)) if (v) p.set(k, v)
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ""
}
export const filterKey = (f: Filters) => filterQuery(f) || "all"

// ------------------------------------------------------------------ loading

export type Lookups = { accounts: { id: number; name: string }[]; playbooks: { id: number; name: string }[]; setups: string[]; symbols: string[] }
export type Loaded = { trades: EdgeTrade[]; all: EdgeTrade[]; lookups: Lookups; fingerprint: string; hasRegimes: boolean; hasExcursions: boolean; hasPsych: boolean }

const num = (v: unknown) => (v == null ? null : Number(v))

// What changes when the trader's trades — or what they said about them — change.
export async function tradesFingerprint(userId: string): Promise<string> {
  const [[t], [p], [x]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int`, top: sql<number>`coalesce(max(${trades.id}), 0)::int`, pnl: sql<string>`coalesce(sum(${trades.pnl}), 0)::text`, last: sql<string>`coalesce(max(${trades.exitTime})::text, '')` }).from(trades).where(eq(trades.userId, userId)),
    db.select({ n: sql<number>`count(*)::int`, last: sql<string>`coalesce(max(${tradePsychology.updatedAt})::text, '')` }).from(tradePsychology).where(eq(tradePsychology.userId, userId)),
    db.select({ n: sql<number>`count(*)::int` }).from(tradeExcursions).where(eq(tradeExcursions.userId, userId)),
  ])
  return `${t.n}.${t.top}.${t.pnl}.${t.last}|${p.n}.${p.last}|${x.n}`
}

type Held = { at: number; fingerprint: string; timeZone: string; source: string; account: number | null; all: EdgeTrade[]; lookups: Lookups; hasRegimes: boolean; hasExcursions: boolean; hasPsych: boolean }
const HELD = new Map<string, Held>()
const HOLD_MS = 5 * 60_000

async function prepare(userId: string, f: Pick<Filters, "account" | "source">, timeZone: string, fingerprint: string): Promise<Held> {
  const key = `${userId}|${f.account ?? ""}|${f.source}|${timeZone}`
  const held = HELD.get(key)
  if (held && held.fingerprint === fingerprint && Date.now() - held.at < HOLD_MS) return held

  const where = and(
    eq(trades.userId, userId),
    eq(trades.status, "closed"),
    f.account ? eq(trades.accountId, f.account) : undefined,
    f.source === "live" ? or(isNull(trades.source), ne(trades.source, "backtest")) : f.source === "backtest" ? eq(trades.source, "backtest") : undefined
  )
  const [rows, psychRows, accountRows, playbookRows, groups, options, excursionRows] = await Promise.all([
    db
      .select({ id: trades.id, symbol: trades.symbol, market: trades.market, side: trades.side, status: trades.status, pnl: trades.pnl, rMultiple: trades.rMultiple, quantity: trades.quantity, entryPrice: trades.entryPrice, exitPrice: trades.exitPrice, stopLoss: trades.stopLoss, takeProfit: trades.takeProfit, contractMultiplier: trades.contractMultiplier, entryTime: trades.entryTime, exitTime: trades.exitTime, accountId: trades.accountId, playbookId: trades.playbookId, tags: trades.tags, mistakes: trades.mistakes, rating: trades.rating, source: trades.source })
      .from(trades)
      .where(where),
    db.select().from(tradePsychology).where(eq(tradePsychology.userId, userId)),
    db.select({ id: tradingAccounts.id, name: tradingAccounts.name }).from(tradingAccounts).where(eq(tradingAccounts.userId, userId)),
    db.select({ id: playbooks.id, name: playbooks.name }).from(playbooks).where(eq(playbooks.userId, userId)),
    db.select({ id: tagGroups.id, name: tagGroups.name }).from(tagGroups).where(eq(tagGroups.userId, userId)),
    db.select({ name: tagOptions.name, groupId: tagOptions.groupId }).from(tagOptions).where(eq(tagOptions.userId, userId)),
    db.select().from(tradeExcursions).where(eq(tradeExcursions.userId, userId)),
  ])

  const raw: RawTrade[] = rows.map((t) => ({
    id: t.id,
    symbol: t.symbol,
    market: t.market,
    side: t.side,
    status: t.status,
    pnl: Number(t.pnl),
    rMultiple: num(t.rMultiple),
    quantity: Number(t.quantity),
    entryPrice: Number(t.entryPrice),
    exitPrice: num(t.exitPrice),
    stopLoss: num(t.stopLoss),
    takeProfit: num(t.takeProfit),
    contractMultiplier: Number(t.contractMultiplier) || 1,
    entryTime: t.entryTime,
    exitTime: t.exitTime,
    accountId: t.accountId,
    playbookId: t.playbookId,
    tags: Array.isArray(t.tags) ? t.tags : [],
    mistakes: Array.isArray(t.mistakes) ? t.mistakes : [],
    rating: t.rating,
    source: t.source,
  }))

  const psych = new Map<number, RawPsych>()
  for (const p of psychRows) psych.set(p.tradeId, { emotionBefore: p.emotionBefore, confidenceBefore: p.confidenceBefore, focusBefore: p.focusBefore, stressBefore: p.stressBefore, reason: p.reason, planBefore: p.planBefore, emotionAfter: p.emotionAfter, planFollowed: p.planFollowed, interference: Array.isArray(p.interference) ? p.interference : [] })

  // Which tags are setups: the ones in a group named for it. Without such a group, every tag is.
  const setupGroups = new Set(groups.filter((g) => /setup|strateg|pattern|entry/i.test(g.name)).map((g) => g.id))
  const setupTags = setupGroups.size ? new Set(options.filter((o) => setupGroups.has(o.groupId)).map((o) => o.name)) : null

  const excursions = new Map<number, { maeR: number | null; mfeR: number | null }>()
  for (const e of excursionRows) if (e.status === "ok") excursions.set(e.tradeId, { maeR: num(e.maeR), mfeR: num(e.mfeR) })

  const regimes = await regimesFor(raw)
  const all = prepareTrades(raw, {
    timeZone,
    playbooks: new Map(playbookRows.map((p) => [p.id, p.name])),
    accounts: new Map(accountRows.map((a) => [a.id, a.name])),
    setupTags,
    psych,
    regimes,
    excursions,
  })
  const symbols = [...new Set(all.map((t) => t.symbol))].sort()
  const setups = [...new Set(all.flatMap((t) => t.setups))].sort()
  const next: Held = { at: Date.now(), fingerprint, timeZone, source: f.source, account: f.account, all, lookups: { accounts: accountRows, playbooks: playbookRows, setups, symbols }, hasRegimes: regimes.size > 0, hasExcursions: excursions.size > 0, hasPsych: psych.size > 0 }
  HELD.set(key, next)
  // a small ceiling: the oldest entry goes
  if (HELD.size > 40) HELD.delete(HELD.keys().next().value!)
  return next
}

// For each trade: what its market was doing as of the day BEFORE it was opened
// (so nothing about the trade's own day leaks into its "conditions").
async function regimesFor(raw: RawTrade[]): Promise<Map<string, Regime>> {
  const out = new Map<string, Regime>()
  const bySymbol = new Map<string, { instrument: string; days: Set<string> }>()
  for (const t of raw) {
    const yahoo = yahooSymbolFor(t.symbol, t.market)
    if (!yahoo) continue
    const entry = bySymbol.get(yahoo) ?? { instrument: instrumentOf(t.symbol, t.market), days: new Set<string>() }
    entry.days.add(t.entryTime.toISOString().slice(0, 10))
    bySymbol.set(yahoo, entry)
  }
  if (!bySymbol.size) return out
  let rows: { symbol: string; day: string; trend: string; volatility: string; range: string }[] = []
  try {
    rows = await db.select({ symbol: marketRegimes.symbol, day: marketRegimes.day, trend: marketRegimes.trend, volatility: marketRegimes.volatility, range: marketRegimes.range }).from(marketRegimes).where(inArray(marketRegimes.symbol, [...bySymbol.keys()])).orderBy(marketRegimes.symbol, marketRegimes.day)
  } catch {
    return out
  }
  const series = new Map<string, typeof rows>()
  for (const r of rows) series.set(r.symbol, [...(series.get(r.symbol) ?? []), r])
  for (const [yahoo, { instrument, days }] of bySymbol) {
    const list = series.get(yahoo)
    if (!list?.length) continue
    for (const day of days) {
      // the latest analysed day before the trade's, and not a stale one
      let lo = 0
      let hi = list.length - 1
      let found = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (list[mid].day < day) {
          found = mid
          lo = mid + 1
        } else hi = mid - 1
      }
      if (found < 0) continue
      const row = list[found]
      if (Date.parse(day) - Date.parse(row.day) > 6 * 86_400_000) continue
      out.set(`${instrument}|${day}`, { trend: row.trend, volatility: row.volatility, range: row.range })
    }
  }
  return out
}

function inRange(trades: EdgeTrade[], f: Filters, now: Date): EdgeTrade[] {
  if (f.range === "custom" && f.from && f.to) return trades.filter((t) => t.day >= f.from! && t.day <= f.to!)
  const days = RANGE_DAYS[f.range]
  if (days == null) return trades
  const since = now.getTime() - days * 86_400_000
  return trades.filter((t) => t.exit >= since)
}

// The trader's prepared trades: `all` is everything the account and source
// filters leave; `trades` is that, in the date range and meeting the base
// conditions (market / strategy / setup).
export async function loadTrades(userId: string, f: Filters, timeZone: string, now = new Date()): Promise<Loaded> {
  const fingerprint = await tradesFingerprint(userId)
  const held = await prepare(userId, f, timeZone, fingerprint)
  return { trades: select(inRange(held.all, f, now), f.base), all: held.all, lookups: held.lookups, fingerprint, hasRegimes: held.hasRegimes, hasExcursions: held.hasExcursions, hasPsych: held.hasPsych }
}

// The same list for the period just before this one, for "against the previous period".
export function previousPeriod(all: EdgeTrade[], f: Filters, now = new Date()): EdgeTrade[] | null {
  const days = f.range === "custom" && f.from && f.to ? Math.round((Date.parse(f.to) - Date.parse(f.from)) / 86_400_000) + 1 : RANGE_DAYS[f.range]
  if (days == null) return null
  const end = f.range === "custom" && f.from ? Date.parse(f.from) : now.getTime() - days * 86_400_000
  const start = end - days * 86_400_000
  return select(all.filter((t) => t.exit >= start && t.exit < end), f.base)
}

// ------------------------------------------------------------------ stored results

// A heavier result, computed once and kept until the trades change.
export async function cached<T>(userId: string, key: string, fingerprint: string, compute: () => T | Promise<T>): Promise<T> {
  try {
    const [row] = await db.select({ fingerprint: analyticsCache.fingerprint, payload: analyticsCache.payload }).from(analyticsCache).where(and(eq(analyticsCache.userId, userId), eq(analyticsCache.key, key))).limit(1)
    if (row && row.fingerprint === fingerprint) return row.payload as T
  } catch {
    // no cache (before the migration, or a database blip): compute it
  }
  const value = await compute()
  try {
    // through JSON, so what is stored is exactly what a later read gives back
    const payload = JSON.parse(JSON.stringify(value))
    await db.insert(analyticsCache).values({ userId, key, fingerprint, payload }).onConflictDoUpdate({ target: [analyticsCache.userId, analyticsCache.key], set: { fingerprint, payload, computedAt: new Date() } })
    return payload as T
  } catch {
    return value
  }
}

// The most recent trades, for pickers and reviews.
export async function recentTradeRows(userId: string, limit = 20) {
  return db
    .select({ id: trades.id, symbol: trades.symbol, side: trades.side, pnl: trades.pnl, entryTime: trades.entryTime, exitTime: trades.exitTime, status: trades.status })
    .from(trades)
    .where(eq(trades.userId, userId))
    .orderBy(desc(trades.entryTime))
    .limit(limit)
}
