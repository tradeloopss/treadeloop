import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { providerAccounts, providerExecutions, providerOrders, providerPositions, trades, tradingConnections } from "@/lib/db/schema"
import { buildProviderTrades } from "@/lib/tradovate/trades"
import { PROVIDER } from "@/lib/ninjatrader/sync"
import { tlog } from "@/lib/tradovate/log"

// Explicit reconciliation for the NinjaTrader add-on path (Phase 5).
//
// The add-on is the source of truth for the live session and resends it in
// full every few minutes (QueueSessionOf), so anything the server missed
// during an outage arrives again and is stored idempotently — no lost and no
// duplicate executions. This pass is the server's half: rebuild the journal
// from everything stored (idempotent; a trade only changes if its fills did)
// and record a summary of what TradeLoop now holds. It never deletes
// trustworthy records.
//
// Run it on a manual "Reconcile", from the admin force-reconcile, and after a
// reconnect. Going-forward reconciliation is already automatic: the sync route
// rebuilds trades whenever new fills arrive.

// Index signature so it stores straight into the jsonb Record<string, number>
// column (lastReconcileSummary), shared with the Tradovate path.
export interface ReconcileSummary {
  [key: string]: number
  executions: number
  orders: number
  positions: number
  trades: number
  tradesInserted: number
  tradesUpdated: number
  tradesRemoved: number
}

export type ReconcileResult = { ok: true; connectionId: number; summary: ReconcileSummary } | { ok: false; reason: "not_connected" }

const countOf = async (table: typeof providerExecutions | typeof providerOrders | typeof providerPositions, connectionId: number): Promise<number> => {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.connectionId, connectionId))
  return Number(row?.n ?? 0)
}

export async function reconcileNinjaTrader(userId: string): Promise<ReconcileResult> {
  const [connection] = await db
    .select()
    .from(tradingConnections)
    .where(and(eq(tradingConnections.userId, userId), eq(tradingConnections.provider, PROVIDER)))
  if (!connection) return { ok: false, reason: "not_connected" }

  // Rebuild the journal from the stored fills. Idempotent by (account, externalId).
  const build = await buildProviderTrades(connection.id)

  const accts = await db.select({ id: providerAccounts.tradingAccountId }).from(providerAccounts).where(eq(providerAccounts.connectionId, connection.id))
  const journalIds = accts.map((a) => a.id).filter((id): id is number => id != null)
  let tradeCount = 0
  if (journalIds.length) {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(trades).where(inArray(trades.accountId, journalIds))
    tradeCount = Number(row?.n ?? 0)
  }

  const summary: ReconcileSummary = {
    executions: await countOf(providerExecutions, connection.id),
    orders: await countOf(providerOrders, connection.id),
    positions: await countOf(providerPositions, connection.id),
    trades: tradeCount,
    tradesInserted: build.inserted,
    tradesUpdated: build.updated,
    tradesRemoved: build.removed,
  }
  const now = new Date()
  await db.update(tradingConnections).set({ lastReconciledAt: now, lastReconcileSummary: summary, updatedAt: now }).where(eq(tradingConnections.id, connection.id))
  tlog("reconciled", { provider: PROVIDER, connectionId: connection.id, ...summary })
  return { ok: true, connectionId: connection.id, summary }
}
