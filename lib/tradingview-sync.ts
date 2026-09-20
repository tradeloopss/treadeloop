import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { trades, tradingAccounts, tradingviewConnections, tradingviewFills } from "@/lib/db/schema"
import { reconstructTrades, type ParsedFill } from "@/lib/fill-reconstruction"
import { computePnl, contractMultiplierForSymbol, type Market } from "@/lib/calc"
import { regenerateJournalForDay } from "@/app/actions/trades"
import type { TradingViewFill } from "@/lib/tradingview-webhook"

export type TradingViewConnectionRow = typeof tradingviewConnections.$inferSelect

// How far apart two otherwise identical round trips may be and still be
// taken for the same trade — the widest timezone offset either way, plus a
// little. See the dedupe in importTradingViewTrades below.
const TIMEZONE_SLACK_MS = 30 * 60 * 60 * 1000

// Futures are the only market where a contract stands for more than one
// unit, so the multiplier is only looked up for those.
function multiplierFor(market: string, symbol: string): number {
  return market === "futures" || market === "future_option" ? contractMultiplierForSymbol(symbol) : 1
}

// Records one fill and rebuilds this connection's trades from the whole fill
// stream. Rebuilding rather than appending is deliberate: a round trip only
// becomes a trade once the closing fill lands, and the entry it pairs with
// may have arrived days earlier. Trades already in the journal are filtered
// out by externalId, so replaying the stream never duplicates them — the
// same approach as a Rithmic re-sync.
//
// Returns how many new trades the fill completed (usually 0 or 1: an opening
// fill completes nothing, a closing fill completes the round trip).
export async function recordTradingViewFill(connection: TradingViewConnectionRow, fill: TradingViewFill): Promise<number> {
  await storeTradingViewFills(connection, [fill])
  return importTradingViewTrades(connection)
}

// Stores fills without rebuilding trades — for a batch (the extension posts
// every fill it hasn't been thanked for yet), which rebuilds once at the
// end. Returns how many were new. A fill seen before is not a second fill:
// TradingView retries webhook deliveries it thinks failed, and the extension
// re-sends anything it isn't sure landed.
export async function storeTradingViewFills(
  connection: TradingViewConnectionRow,
  fills: (TradingViewFill & { market?: Market })[],
): Promise<number> {
  if (fills.length === 0) return 0
  const inserted = await db
    .insert(tradingviewFills)
    .values(
      fills.map((fill) => ({
        connectionId: connection.id,
        eventId: fill.eventId,
        symbol: fill.symbol,
        action: fill.action,
        quantity: String(fill.quantity),
        price: String(fill.price),
        filledAt: fill.filledAt,
        market: fill.market ?? null,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: tradingviewFills.id })
  return inserted.length
}

export async function importTradingViewTrades(connection: TradingViewConnectionRow): Promise<number> {
  const [account] = await db.select().from(tradingAccounts).where(eq(tradingAccounts.id, connection.accountId))
  if (!account) return 0

  const stored = await db
    .select()
    .from(tradingviewFills)
    .where(eq(tradingviewFills.connectionId, connection.id))
    .orderBy(asc(tradingviewFills.filledAt))

  const parsed: ParsedFill[] = stored.map((row) => ({
    externalId: row.eventId,
    account: account.name,
    symbol: row.symbol,
    timestamp: row.filledAt.toISOString(),
    action: row.action === "Buy" ? "Buy" : "Sell",
    qty: Number(row.quantity),
    price: Number(row.price),
  }))
  // A fill that named its own market (extension fills do, from the exchange
  // prefix) decides the market of any trade it closes; the rest take the
  // connection's. One symbol trades on one market, so the last word wins.
  const marketBySymbol = new Map<string, Market>()
  for (const row of stored) if (row.market) marketBySymbol.set(row.symbol, row.market as Market)

  const imported = reconstructTrades(parsed, "tradingview")
  if (imported.length === 0) return 0

  const existing = await db
    .select({ externalId: trades.externalId })
    .from(trades)
    .where(
      and(
        eq(trades.userId, connection.userId),
        isNotNull(trades.externalId),
        inArray(
          trades.externalId,
          imported.map((t) => t.externalId),
        ),
      ),
    )
  const seen = new Set(existing.map((r) => r.externalId))
  const unseen = imported.filter((t) => !seen.has(t.externalId))
  if (unseen.length === 0) return 0

  // The same round trip may already be in this account under another id —
  // pasted from TradingView's History tab before the extension was paired,
  // say. Ids differ between routes, so the last guard is the trade itself:
  // same symbol, side, size and both prices, closed at about the same time.
  // "About" is generous on purpose: the History tab prints its times in the
  // chart's own timezone while the extension reports UTC, so one trade can
  // look most of a day apart depending on where the trader is. Two round
  // trips matching to six decimal places on both prices, the same size and
  // the same side, inside the same day, are the same trade.
  const alreadyJournaled = await db
    .select({ symbol: trades.symbol, side: trades.side, quantity: trades.quantity, entryPrice: trades.entryPrice, exitPrice: trades.exitPrice, exitTime: trades.exitTime })
    .from(trades)
    .where(
      and(
        eq(trades.accountId, connection.accountId),
        eq(trades.status, "closed"),
        inArray(trades.symbol, [...new Set(unseen.map((t) => t.symbol))]),
      ),
    )
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-6)
  const toImport = unseen.filter(
    (t) =>
      !alreadyJournaled.some(
        (j) =>
          j.symbol === t.symbol &&
          j.side === t.side &&
          near(Number(j.quantity), t.quantity) &&
          near(Number(j.entryPrice), t.entryPrice) &&
          near(Number(j.exitPrice ?? NaN), t.exitPrice) &&
          j.exitTime != null &&
          Math.abs(j.exitTime.getTime() - new Date(t.exitTime).getTime()) <= TIMEZONE_SLACK_MS,
      ),
  )
  if (toImport.length === 0) return 0

  const affectedDays = new Set<string>()
  for (const t of toImport) {
    const market = marketBySymbol.get(t.symbol) ?? (connection.market as Market)
    const contractMultiplier = multiplierFor(market, t.symbol)
    const pnl = t.pnl ?? computePnl({ side: t.side, quantity: t.quantity, entryPrice: t.entryPrice, exitPrice: t.exitPrice, fees: t.fees, contractMultiplier })
    await db.insert(trades).values({
      userId: connection.userId,
      accountId: connection.accountId,
      symbol: t.symbol,
      market,
      side: t.side,
      status: "closed",
      quantity: String(t.quantity),
      entryPrice: String(t.entryPrice),
      exitPrice: String(t.exitPrice),
      fees: String(t.fees),
      pnl: String(pnl),
      contractMultiplier: String(contractMultiplier),
      entryTime: new Date(t.entryTime),
      exitTime: new Date(t.exitTime),
      externalId: t.externalId,
    })
    affectedDays.add(t.exitTime.slice(0, 10))
  }

  for (const day of affectedDays) {
    await regenerateJournalForDay(connection.userId, day)
  }

  await db
    .update(tradingviewConnections)
    .set({ tradeCount: sql`${tradingviewConnections.tradeCount} + ${toImport.length}` })
    .where(eq(tradingviewConnections.id, connection.id))

  return toImport.length
}
