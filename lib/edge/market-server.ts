import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { marketRegimes, tradeExcursions, trades } from "@/lib/db/schema"
import { getProvider } from "@/lib/market-data"
import type { Candle } from "@/lib/market-data/types"
import { instrumentOf } from "./core"
import { dailyRegimes, excursion, yahooSymbolFor } from "./market"

// Fetches price history for a trader's instruments and stores what Edge Lab
// derives from it: the daily regime of each market (shared by every trader of
// it) and each trade's excursions. Run when the trader asks for it, a batch at
// a time — the price feed is a free one with no guarantees, so a symbol that
// fails is reported and skipped, never guessed.

const DAY = 86_400
// How far back the feed keeps bars of each size.
const FIVE_MIN_DAYS = 58
const HOURLY_DAYS = 720
// Work per call, so one click can't run for minutes.
const MAX_SYMBOLS = 12
const MAX_TRADES = 400

export type MarketRefresh = {
  // instruments whose daily history was read
  symbols: number
  regimeDays: number
  // trades measured in this call
  excursions: number
  // trades still to do (press again)
  remaining: number
  // instruments the price feed doesn't carry
  unsupported: string[]
  failed: string[]
}

async function candles(symbol: string, timeframe: string, from: number, to: number): Promise<Candle[]> {
  return getProvider().getCandles({ symbol, timeframe, from, to })
}

export async function refreshMarketData(userId: string): Promise<MarketRefresh> {
  const now = Math.floor(Date.now() / 1000)
  const rows = await db
    .select({ id: trades.id, symbol: trades.symbol, market: trades.market, side: trades.side, entryPrice: trades.entryPrice, stopLoss: trades.stopLoss, entryTime: trades.entryTime, exitTime: trades.exitTime })
    .from(trades)
    .where(and(eq(trades.userId, userId), eq(trades.status, "closed"), or(isNull(trades.source), ne(trades.source, "backtest"))))
    .orderBy(desc(trades.entryTime))

  const unsupported = new Set<string>()
  const failed = new Set<string>()
  const bySymbol = new Map<string, typeof rows>()
  for (const t of rows) {
    const yahoo = yahooSymbolFor(t.symbol, t.market)
    if (!yahoo) {
      unsupported.add(instrumentOf(t.symbol, t.market))
      continue
    }
    bySymbol.set(yahoo, [...(bySymbol.get(yahoo) ?? []), t])
  }

  // --- regimes: one read of daily bars per instrument ---------------------------
  let symbols = 0
  let regimeDays = 0
  const today = new Date().toISOString().slice(0, 10)
  for (const [yahoo, list] of [...bySymbol.entries()].slice(0, MAX_SYMBOLS)) {
    const first = Math.min(...list.map((t) => t.entryTime.getTime())) / 1000
    const [have] = await db.select({ from: sql<string | null>`min(${marketRegimes.day})`, to: sql<string | null>`max(${marketRegimes.day})`, checked: sql<string | null>`max(${marketRegimes.computedAt})::text` }).from(marketRegimes).where(eq(marketRegimes.symbol, yahoo))
    const firstDay = new Date(first * 1000).toISOString().slice(0, 10)
    // already analysed today, back to this trader's first trade
    if (have?.checked?.slice(0, 10) === today && have.from && have.from <= firstDay) continue
    try {
      // enough bars before the first trade to classify its day
      const bars = await candles(yahoo, "1d", first - 260 * DAY, now)
      const regimes = dailyRegimes(bars)
      for (let i = 0; i < regimes.length; i += 400) {
        const chunk = regimes.slice(i, i + 400)
        await db
          .insert(marketRegimes)
          .values(chunk.map((r) => ({ symbol: yahoo, day: r.day, trend: r.trend, volatility: r.volatility, range: r.range })))
          .onConflictDoUpdate({ target: [marketRegimes.symbol, marketRegimes.day], set: { trend: sql`excluded.trend`, volatility: sql`excluded.volatility`, range: sql`excluded.range`, computedAt: new Date() } })
      }
      symbols++
      regimeDays += regimes.length
    } catch (e) {
      failed.add(yahoo)
      console.error("[edge-lab] daily bars failed for", yahoo, e instanceof Error ? e.message : e)
    }
  }

  // --- excursions: the trades not measured yet, newest first ---------------------
  const done = new Set((await db.select({ tradeId: tradeExcursions.tradeId }).from(tradeExcursions).where(eq(tradeExcursions.userId, userId))).map((r) => r.tradeId))
  const todo = rows.filter((t) => !done.has(t.id) && t.exitTime)
  const batch = todo.slice(0, MAX_TRADES)
  let measured = 0
  const save = async (values: (typeof tradeExcursions.$inferInsert)[]) => {
    for (let i = 0; i < values.length; i += 200) await db.insert(tradeExcursions).values(values.slice(i, i + 200)).onConflictDoNothing({ target: tradeExcursions.tradeId })
  }
  const groups = new Map<string | null, typeof batch>()
  for (const t of batch) {
    const yahoo = yahooSymbolFor(t.symbol, t.market)
    groups.set(yahoo, [...(groups.get(yahoo) ?? []), t])
  }
  for (const [yahoo, list] of groups) {
    if (!yahoo) {
      await save(list.map((t) => ({ tradeId: t.id, userId, status: "no_symbol" })))
      continue
    }
    // the finest bars the feed still has for each trade
    const tiers: [string, number, number][] = [
      ["5m", 300, now - FIVE_MIN_DAYS * DAY],
      ["1h", 3600, now - HOURLY_DAYS * DAY],
    ]
    let rest = list
    for (const [timeframe, seconds, oldest] of tiers) {
      const mine = rest.filter((t) => t.entryTime.getTime() / 1000 >= oldest)
      rest = rest.filter((t) => t.entryTime.getTime() / 1000 < oldest)
      if (!mine.length) continue
      try {
        const from = Math.max(oldest, Math.min(...mine.map((t) => t.entryTime.getTime())) / 1000 - seconds * 2)
        const to = Math.min(now, Math.max(...mine.map((t) => t.exitTime!.getTime())) / 1000 + seconds * 2)
        const bars = await candles(yahoo, timeframe, from, to)
        const values: (typeof tradeExcursions.$inferInsert)[] = []
        const coarse: typeof mine = []
        for (const t of mine) {
          const entryMs = t.entryTime.getTime()
          const exitMs = t.exitTime!.getTime()
          // shorter than one bar: a coarser bar can't describe it either
          if ((exitMs - entryMs) / 1000 < seconds) {
            values.push({ tradeId: t.id, userId, status: "too_short", timeframe })
            continue
          }
          const entryPrice = Number(t.entryPrice)
          const stop = t.stopLoss == null ? null : Number(t.stopLoss)
          const x = excursion(bars, { entryMs, exitMs, side: t.side === "short" ? "short" : "long", entryPrice, riskPerUnit: stop != null ? Math.abs(entryPrice - stop) : null }, seconds)
          if (!x) {
            // the 5-minute history may have a gap the hourly one covers
            if (timeframe === "5m") coarse.push(t)
            else values.push({ tradeId: t.id, userId, status: "no_data", timeframe })
            continue
          }
          values.push({ tradeId: t.id, userId, mae: String(x.mae), mfe: String(x.mfe), maeR: x.maeR == null ? null : String(Math.round(x.maeR * 1000) / 1000), mfeR: x.mfeR == null ? null : String(Math.round(x.mfeR * 1000) / 1000), timeframe, status: "ok" })
          measured++
        }
        await save(values)
        rest = [...rest, ...coarse]
      } catch (e) {
        failed.add(yahoo)
        console.error("[edge-lab] bars failed for", yahoo, timeframe, e instanceof Error ? e.message : e)
        // left unmeasured: it is tried again next time
        rest = rest.filter((t) => !mine.includes(t))
      }
    }
    // older than the feed's intraday history
    if (rest.length) await save(rest.filter((t) => t.entryTime.getTime() / 1000 < now - HOURLY_DAYS * DAY).map((t) => ({ tradeId: t.id, userId, status: "no_data" })))
  }

  return { symbols, regimeDays, excursions: measured, remaining: Math.max(0, todo.length - batch.length), unsupported: [...unsupported].slice(0, 12), failed: [...failed] }
}

// What has been analysed so far, for the page that offers the button.
export async function marketCoverage(userId: string): Promise<{ measured: number; attempted: number }> {
  const [row] = await db.select({ attempted: sql<number>`count(*)::int`, measured: sql<number>`count(*) filter (where ${tradeExcursions.status} = 'ok')::int` }).from(tradeExcursions).where(eq(tradeExcursions.userId, userId))
  return { measured: row?.measured ?? 0, attempted: row?.attempted ?? 0 }
}
