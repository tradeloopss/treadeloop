"use server"

import { db } from "@/lib/db"
import { backtestSessions, trades } from "@/lib/db/schema"
import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { computePnl, computeRMultiple, contractMultiplierForSymbol } from "@/lib/calc"
import { instrumentMarket, timeframeSeconds } from "@/lib/market-data"
import { regenerateJournalForDay } from "@/app/actions/trades"
import { getAdmin } from "@/lib/admin/guard"

// Backtesting is admin-only while it's still in progress, so every action here
// requires an admin — a non-admin who calls one directly is refused, not just
// hidden from the nav.
async function getUserId() {
  const admin = await getAdmin()
  if (!admin) throw new Error("Backtesting isn't available on your account yet.")
  return admin.id
}

export type BacktestSession = typeof backtestSessions.$inferSelect

// How much history to load before the replay-start anchor (context the trader
// opens onto) and how much to replay forward, in BARS — scaled to the timeframe
// so a 5m and a 1d session both feel right.
const CONTEXT_BARS = 120
const REPLAY_BARS = 260
// Rough ceiling on how far back each timeframe has intraday data on the free
// provider, so random mode never anchors somewhere with no candles.
const MAX_LOOKBACK_DAYS: Record<string, number> = { "1m": 6, "5m": 55, "15m": 55, "30m": 55, "1h": 700, "1d": 1800 }

function computeWindow(timeframe: string, anchorSec: number) {
  const tf = timeframeSeconds(timeframe)
  return {
    rangeStart: new Date((anchorSec - CONTEXT_BARS * tf) * 1000),
    rangeEnd: new Date((anchorSec + REPLAY_BARS * tf) * 1000),
    currentTime: new Date(anchorSec * 1000),
  }
}

// Picks a random replay-start anchor inside the provider's available history for
// this timeframe, leaving room for the forward replay span. Used by "Random
// Date" mode, where the anchor stays hidden from the trader.
function randomAnchorSec(timeframe: string): number {
  const tf = timeframeSeconds(timeframe)
  const nowSec = Math.floor(Date.now() / 1000)
  const lookback = (MAX_LOOKBACK_DAYS[timeframe] ?? 55) * 86400
  const earliest = nowSec - lookback + CONTEXT_BARS * tf
  const latest = nowSec - REPLAY_BARS * tf
  if (latest <= earliest) return latest
  return Math.floor(earliest + Math.random() * (latest - earliest))
}

export async function createBacktestSession(input: {
  symbol: string
  timeframe: string
  startingBalance: number
  name?: string
  provider?: string
  anchorDate?: string // ISO datetime for the replay start; ignored in random mode
  randomMode?: boolean
  accountId?: number | null
  simulatePropRules?: boolean
}): Promise<{ id: number }> {
  const userId = await getUserId()
  const timeframe = input.timeframe || "5m"

  const anchorSec = input.randomMode
    ? randomAnchorSec(timeframe)
    : input.anchorDate
      ? Math.floor(new Date(input.anchorDate).getTime() / 1000)
      : randomAnchorSec(timeframe)

  const { rangeStart, rangeEnd, currentTime } = computeWindow(timeframe, anchorSec)
  const balance = Number.isFinite(input.startingBalance) && input.startingBalance > 0 ? input.startingBalance : 50000

  const [row] = await db
    .insert(backtestSessions)
    .values({
      userId,
      name: input.name?.trim() || null,
      symbol: input.symbol,
      market: instrumentMarket(input.symbol),
      provider: input.provider || "yahoo",
      timeframe,
      executionTimeframe: timeframe,
      rangeStart,
      rangeEnd,
      currentTime,
      startingBalance: String(balance),
      currentBalance: String(balance),
      randomMode: input.randomMode ?? false,
      accountId: input.accountId ?? null,
      simulatePropRules: input.simulatePropRules ?? false,
    })
    .returning({ id: backtestSessions.id })

  revalidatePath("/backtest")
  return { id: row.id }
}

export async function getBacktestSessions(): Promise<BacktestSession[]> {
  const userId = await getUserId()
  return db.select().from(backtestSessions).where(eq(backtestSessions.userId, userId)).orderBy(desc(backtestSessions.createdAt))
}

export async function getBacktestSession(id: number): Promise<BacktestSession | null> {
  const userId = await getUserId()
  const [row] = await db.select().from(backtestSessions).where(and(eq(backtestSessions.id, id), eq(backtestSessions.userId, userId)))
  return row ?? null
}

// Persists the replay's working state — called (debounced) from the workspace
// as the trader plays, so a refresh resumes exactly where they left off.
export async function updateBacktestState(
  id: number,
  patch: Partial<{
    currentTime: string | Date
    currentBalance: number
    speed: number
    status: "active" | "paused" | "completed"
    openOrders: unknown[]
    openPosition: unknown
    settings: Record<string, unknown>
  }>,
): Promise<void> {
  const userId = await getUserId()
  const set: Partial<typeof backtestSessions.$inferInsert> = { updatedAt: new Date() }
  if (patch.currentTime != null) set.currentTime = new Date(patch.currentTime)
  if (patch.currentBalance != null) set.currentBalance = String(patch.currentBalance)
  if (patch.speed != null) set.speed = patch.speed
  if (patch.status != null) set.status = patch.status
  if (patch.openOrders != null) set.openOrders = patch.openOrders
  if (patch.openPosition !== undefined) set.openPosition = patch.openPosition
  if (patch.settings != null) set.settings = patch.settings
  await db.update(backtestSessions).set(set).where(and(eq(backtestSessions.id, id), eq(backtestSessions.userId, userId)))
}

export async function finishBacktest(id: number): Promise<void> {
  const userId = await getUserId()
  await db.update(backtestSessions).set({ status: "completed", updatedAt: new Date() }).where(and(eq(backtestSessions.id, id), eq(backtestSessions.userId, userId)))
  revalidatePath("/backtest")
}

export async function deleteBacktestSession(id: number): Promise<void> {
  const userId = await getUserId()
  // The closed trades stay in the journal (they're real records now); only the
  // ephemeral session is removed.
  await db.delete(backtestSessions).where(and(eq(backtestSessions.id, id), eq(backtestSessions.userId, userId)))
  revalidatePath("/backtest")
}

// A closed backtest position becomes a real trade — same table, same math, same
// journal/analytics as a live trade — tagged source="backtest" and linked to
// its session. accountId stays null so simulated fills never touch a real
// account's balance or live stats. Returns the new trade id so the workspace
// can open the existing journal editor on it.
export async function saveBacktestTrade(
  sessionId: number,
  input: {
    symbol: string
    market?: string
    side: "long" | "short"
    quantity: number
    entryPrice: number
    exitPrice: number
    stopLoss?: number | null
    takeProfit?: number | null
    fees?: number
    entryTime: string | Date
    exitTime: string | Date
  },
): Promise<{ id: number; pnl: number }> {
  const userId = await getUserId()
  const [session] = await db.select().from(backtestSessions).where(and(eq(backtestSessions.id, sessionId), eq(backtestSessions.userId, userId)))
  if (!session) throw new Error("Backtest session not found")

  const contractMultiplier = contractMultiplierForSymbol(input.symbol)
  const tradeInput = {
    side: input.side,
    quantity: input.quantity,
    entryPrice: input.entryPrice,
    exitPrice: input.exitPrice,
    stopLoss: input.stopLoss ?? null,
    fees: input.fees ?? 0,
    contractMultiplier,
  }
  const pnl = computePnl(tradeInput)
  const rMultiple = computeRMultiple(tradeInput)
  const exitTime = new Date(input.exitTime)

  const [row] = await db
    .insert(trades)
    .values({
      userId,
      accountId: null,
      symbol: input.symbol.toUpperCase(),
      market: input.market ?? session.market,
      side: input.side,
      status: "closed",
      quantity: String(input.quantity),
      entryPrice: String(input.entryPrice),
      exitPrice: String(input.exitPrice),
      stopLoss: input.stopLoss == null ? null : String(input.stopLoss),
      takeProfit: input.takeProfit == null ? null : String(input.takeProfit),
      fees: String(input.fees ?? 0),
      pnl: String(pnl),
      rMultiple: rMultiple == null ? null : String(rMultiple),
      contractMultiplier: String(contractMultiplier),
      entryTime: new Date(input.entryTime),
      exitTime,
      source: "backtest",
      backtestSessionId: sessionId,
    })
    .returning({ id: trades.id })

  // Keep the session balance and the day's journal in step, exactly as a live
  // sync would.
  await db
    .update(backtestSessions)
    .set({ currentBalance: String(Number(session.currentBalance) + pnl), updatedAt: new Date() })
    .where(eq(backtestSessions.id, sessionId))
  await regenerateJournalForDay(userId, exitTime.toISOString().slice(0, 10))

  revalidatePath("/backtest")
  return { id: row.id, pnl }
}

// The session's own trades, for its results view — analyzed with the existing
// analytics engine, not a duplicate.
export async function getBacktestTrades(sessionId: number) {
  const userId = await getUserId()
  return db
    .select()
    .from(trades)
    .where(and(eq(trades.userId, userId), eq(trades.backtestSessionId, sessionId)))
    .orderBy(trades.exitTime)
}
