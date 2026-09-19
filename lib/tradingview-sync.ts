import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { trades, tradingAccounts, tradingviewConnections, tradingviewFills } from "@/lib/db/schema"
import { reconstructTrades, type ParsedFill } from "@/lib/fill-reconstruction"
import { computePnl, contractMultiplierForSymbol, type Market } from "@/lib/calc"
import { regenerateJournalForDay } from "@/app/actions/trades"
import type { TradingViewFill } from "@/lib/tradingview-webhook"

export type TradingViewConnectionRow = typeof tradingviewConnections.$inferSelect

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
  await db
    .insert(tradingviewFills)
    .values({
      connectionId: connection.id,
      eventId: fill.eventId,
      symbol: fill.symbol,
      action: fill.action,
      quantity: String(fill.quantity),
      price: String(fill.price),
      filledAt: fill.filledAt,
    })
    // TradingView retries a delivery it thinks failed; the second copy of an
    // event is not a second fill.
    .onConflictDoNothing()

  return importTradingViewTrades(connection)
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
  const toImport = imported.filter((t) => !seen.has(t.externalId))
  if (toImport.length === 0) return 0

  const market = connection.market as Market
  const affectedDays = new Set<string>()
  for (const t of toImport) {
    const contractMultiplier = multiplierFor(connection.market, t.symbol)
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
