import { and, asc, eq, isNotNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { providerAccounts, providerExecutions, trades, tradingAccounts, tradingConnections } from "@/lib/db/schema"
import { inferStartingBalance } from "@/lib/broker-balance"
import { regenerateJournalForDay } from "@/app/actions/trades"
import { buildTradesFromExecutions } from "@/lib/tradovate/fills"
import { tlog } from "@/lib/tradovate/log"

// Stored Tradovate executions → journal trades, with the same engine every
// fill-based broker uses (lib/fill-reconstruction: one trade per position,
// flat to flat, average-cost entry and exit). Runs in the app because the
// journal lives here; the sync VPS's worker calls /api/cron/tradovate-sync
// after storing new executions.
//
// Idempotent: a trade's externalId comes from the fill that closed it, and
// trades are UNIQUE per (account, externalId). Rebuilding over the same
// executions changes nothing; an execution that arrives late (or a fee that
// does) updates the trade it belongs to; a trade whose fills were busted is
// removed.

export interface BuildResult {
  inserted: number
  updated: number
  removed: number
}

export async function buildTradovateTrades(connectionId: number): Promise<BuildResult> {
  const [connection] = await db.select().from(tradingConnections).where(eq(tradingConnections.id, connectionId))
  const result: BuildResult = { inserted: 0, updated: 0, removed: 0 }
  if (!connection) return result
  const dirtyAtStart = connection.tradesDirtyAt
  const showProgress = connection.syncStage === "building_trades"
  if (showProgress) await setStage(connectionId, "building_trades")

  const accounts = await db
    .select()
    .from(providerAccounts)
    .where(and(eq(providerAccounts.connectionId, connectionId), eq(providerAccounts.enabled, true), isNotNull(providerAccounts.tradingAccountId)))

  const affectedDays = new Set<string>()
  for (const account of accounts) {
    const journalAccountId = account.tradingAccountId!
    const rows = await db
      .select()
      .from(providerExecutions)
      .where(
        and(
          eq(providerExecutions.connectionId, connectionId),
          eq(providerExecutions.environment, account.environment),
          eq(providerExecutions.providerAccountId, account.providerAccountId),
          eq(providerExecutions.active, true),
        ),
      )
      .orderBy(asc(providerExecutions.timestamp), asc(providerExecutions.id))

    const built = buildTradesFromExecutions(`${account.environment}-${account.providerAccountId}`, rows)
    if (showProgress) await setStage(connectionId, "calculating_pnl")

    const existing = await db
      .select({ id: trades.id, externalId: trades.externalId, fees: trades.fees, pnl: trades.pnl, quantity: trades.quantity, entryPrice: trades.entryPrice, exitPrice: trades.exitPrice, exitTime: trades.exitTime })
      .from(trades)
      .where(and(eq(trades.accountId, journalAccountId), eq(trades.source, "tradovate")))
    const byExternal = new Map(existing.map((t) => [t.externalId, t]))
    const builtIds = new Set<string>()

    for (const t of built) {
      builtIds.add(t.externalId)
      const { multiplier, pnl, fees } = t
      const values = {
        quantity: String(t.quantity),
        entryPrice: String(t.entryPrice),
        exitPrice: String(t.exitPrice),
        fees: String(fees),
        pnl: String(pnl),
        contractMultiplier: String(multiplier),
        entryTime: new Date(t.entryTime),
        exitTime: new Date(t.exitTime),
      }
      const prior = byExternal.get(t.externalId)
      if (!prior) {
        await db
          .insert(trades)
          .values({ userId: connection.userId, accountId: journalAccountId, symbol: t.symbol, market: "futures", side: t.side, status: "closed", externalId: t.externalId, source: "tradovate", ...values })
          .onConflictDoNothing({ target: [trades.accountId, trades.externalId] })
        result.inserted++
        affectedDays.add(t.exitTime.slice(0, 10))
      } else if (
        Number(prior.fees) !== fees ||
        Number(prior.pnl) !== pnl ||
        Number(prior.quantity) !== t.quantity ||
        Math.abs(Number(prior.entryPrice) - t.entryPrice) > 1e-6 ||
        Math.abs(Number(prior.exitPrice ?? 0) - t.exitPrice) > 1e-6
      ) {
        await db.update(trades).set(values).where(eq(trades.id, prior.id))
        result.updated++
        affectedDays.add(t.exitTime.slice(0, 10))
      }
    }
    // Trades built from executions that were since busted/removed.
    for (const prior of existing) {
      if (prior.externalId && !builtIds.has(prior.externalId)) {
        await db.delete(trades).where(eq(trades.id, prior.id))
        result.removed++
        if (prior.exitTime) affectedDays.add(prior.exitTime.toISOString().slice(0, 10))
      }
    }

    await inferAccountSize(journalAccountId, account.accountName)
  }

  for (const day of affectedDays) await regenerateJournalForDay(connection.userId, day)

  const now = new Date()
  await db
    .update(tradingConnections)
    .set({
      tradesBuiltAt: now,
      ...(showProgress ? { syncStage: "complete" } : {}),
      updatedAt: now,
    })
    .where(eq(tradingConnections.id, connectionId))
  // Clear the dirty flag only if nothing new arrived while building.
  await db
    .update(tradingConnections)
    .set({ tradesDirtyAt: null })
    .where(and(eq(tradingConnections.id, connectionId), dirtyAtStart ? eq(tradingConnections.tradesDirtyAt, dirtyAtStart) : sql`${tradingConnections.tradesDirtyAt} is null`))
  if (result.inserted + result.updated + result.removed > 0) tlog("trades_built", { connectionId, ...result })
  return result
}

// Every connection with executions not yet turned into trades.
export async function buildDueTradovateTrades(): Promise<{ connections: number } & BuildResult> {
  const due = await db
    .select({ id: tradingConnections.id })
    .from(tradingConnections)
    .where(and(eq(tradingConnections.provider, "tradovate"), isNotNull(tradingConnections.tradesDirtyAt)))
  const total = { connections: due.length, inserted: 0, updated: 0, removed: 0 }
  for (const { id } of due) {
    try {
      const r = await buildTradovateTrades(id)
      total.inserted += r.inserted
      total.updated += r.updated
      total.removed += r.removed
    } catch (err) {
      tlog("trades_build_failed", { connectionId: id, message: err instanceof Error ? err.message : String(err) }, "error")
    }
  }
  return total
}

async function setStage(connectionId: number, stage: string) {
  await db.update(tradingConnections).set({ syncStage: stage, updatedAt: new Date() }).where(eq(tradingConnections.id, connectionId))
}

// The account's size, worked back from the broker balance and the net P&L on
// file — only while it's our own guess (never over a size the user typed).
async function inferAccountSize(accountId: number, providerAccountName: string) {
  const [account] = await db.select().from(tradingAccounts).where(eq(tradingAccounts.id, accountId))
  if (!account || !account.startingBalanceInferred || account.currentBalance == null) return
  const balance = Number(account.currentBalance)
  if (!(balance > 0)) return
  const [{ net }] = await db
    .select({ net: sql<string>`coalesce(sum(${trades.pnl}), 0)` })
    .from(trades)
    .where(and(eq(trades.accountId, accountId), eq(trades.status, "closed")))
  const size = inferStartingBalance(balance, Number(net), { accountNames: [providerAccountName, account.name] })
  if (String(size) !== String(Number(account.startingBalance))) {
    await db.update(tradingAccounts).set({ startingBalance: String(size) }).where(eq(tradingAccounts.id, accountId))
  }
}
