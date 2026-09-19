// Shared, plain (non-"use server") sync logic — used both by the
// session-gated server actions in app/actions/rithmic.ts (manual connect /
// "Sync now") and by lib/rithmic-auto-sync.ts's background job, which runs
// outside any request context and can't rely on a logged-in session.
import { db } from "@/lib/db"
import { rithmicConnections, trades, tradingAccounts } from "@/lib/db/schema"
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { decrypt } from "@/lib/crypto"
import { fetchAccountSnapshots, fetchRithmicFillsAndRms, type RithmicAccountRms, type RithmicAccountSnapshot } from "@/lib/rithmic-client"
import { brokerDrawdownFloor, inferStartingBalance } from "@/lib/broker-balance"
import { reconstructTrades, type ParsedFill } from "@/lib/fill-reconstruction"
import { computePnl, contractMultiplierForSymbol } from "@/lib/calc"
import { regenerateJournalForDay } from "@/app/actions/trades"
import { recordSyncRun, type SyncTrigger } from "@/lib/sync-runs"

export type RithmicConnectionRow = typeof rithmicConnections.$inferSelect

export async function importFillsForConnection(
  userId: string,
  connectionId: number,
  accountId: number,
  fills: ParsedFill[]
): Promise<number> {
  const imported = reconstructTrades(fills, "rithmic")

  const existingIds = imported.length
    ? await db
        .select({ externalId: trades.externalId })
        .from(trades)
        .where(
          and(
            eq(trades.userId, userId),
            isNotNull(trades.externalId),
            inArray(
              trades.externalId,
              imported.map((t) => t.externalId)
            )
          )
        )
    : []
  const seen = new Set(existingIds.map((r) => r.externalId))
  const toImport = imported.filter((t) => !seen.has(t.externalId))

  const affectedDays = new Set<string>()
  for (const t of toImport) {
    const contractMultiplier = contractMultiplierForSymbol(t.symbol)
    const pnl = t.pnl ?? computePnl({ side: t.side, quantity: t.quantity, entryPrice: t.entryPrice, exitPrice: t.exitPrice, fees: t.fees, contractMultiplier })
    await db.insert(trades).values({
      userId,
      accountId,
      symbol: t.symbol,
      market: "futures",
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
    await regenerateJournalForDay(userId, day)
  }

  const now = new Date()
  await db
    .update(rithmicConnections)
    .set({ lastSyncFrom: now, lastSyncedAt: now, lastSyncStatus: "ok", lastSyncError: null, lastSyncCount: toImport.length })
    .where(eq(rithmicConnections.id, connectionId))

  return toImport.length
}

// Writes the broker's own numbers onto the trading account: the balance as
// Rithmic sees it, the liquidation floor if it reports one, and — the first
// time a balance is seen for an account that was created without a size —
// the starting balance worked back from it.
export async function applyBrokerSnapshot(accountId: number, snapshot: RithmicAccountSnapshot, rms?: RithmicAccountRms): Promise<void> {
  const [account] = await db.select().from(tradingAccounts).where(eq(tradingAccounts.id, accountId))
  if (!account) return
  const [{ net }] = await db
    .select({ net: sql<string>`coalesce(sum(${trades.pnl}), 0)` })
    .from(trades)
    .where(and(eq(trades.accountId, accountId), eq(trades.status, "closed")))
  const balance = snapshot.accountBalance
  const patch: Partial<typeof tradingAccounts.$inferInsert> = {
    currentBalance: String(balance),
    balanceUpdatedAt: snapshot.at,
    brokerDrawdownFloor: (() => {
      const floor = brokerDrawdownFloor(balance, rms, snapshot)
      return floor == null ? null : String(floor)
    })(),
  }
  if (Number(account.startingBalance) <= 0 && balance > 0) {
    patch.startingBalance = String(inferStartingBalance(balance, Number(net)))
  }
  await db.update(tradingAccounts).set(patch).where(eq(tradingAccounts.id, accountId))
}

// Reads the current balance for a connection's account from Rithmic and
// records it. A failure here is logged, not thrown: the trades already
// synced, and a stale balance is better than a failed sync.
export async function refreshBrokerBalance(connection: RithmicConnectionRow, password: string, rms?: RithmicAccountRms): Promise<void> {
  if (connection.accountId == null) return
  try {
    const snapshots = await fetchAccountSnapshots(connection.login, password, connection.systemName, connection.gatewayUri, [
      { fcmId: connection.fcmId, ibId: connection.ibId, accountId: connection.rithmicAccountId },
    ])
    const snapshot = snapshots.get(connection.rithmicAccountId)
    if (snapshot) await applyBrokerSnapshot(connection.accountId, snapshot, rms)
  } catch (err) {
    console.warn(`[rithmic] balance refresh failed for connection ${connection.id}:`, err instanceof Error ? err.message : err)
  }
}

// Background syncs run every minute; the balance only needs to follow at a
// gentler pace than the fills, so each one costs Rithmic one login, not two.
const BALANCE_REFRESH_MS = 10 * 60_000

// Syncs one connection — no session/auth check, since the background
// auto-sync job calls this outside any request context. Callers that DO
// have a session (the manual "Sync now" button) are responsible for
// verifying the connection belongs to the caller before invoking this.
export async function syncRithmicConnection(connection: RithmicConnectionRow, trigger: SyncTrigger = "auto"): Promise<{ imported: number }> {
  const startedAt = Date.now()
  try {
    const password = decrypt(connection.passwordEnc)
    // Always re-pull full history rather than fetching since the last sync:
    // fill-based reconstruction pairs an entry fill with its closing fill, and
    // narrowing the window would drop the entry side of any position that was
    // still open at the last sync and only closed since. Already-imported
    // trades are filtered out below by externalId, so this is safe to repeat.
    const { fills, rms } = await fetchRithmicFillsAndRms(
      connection.login,
      password,
      connection.systemName,
      connection.gatewayUri,
      { fcmId: connection.fcmId, ibId: connection.ibId, accountId: connection.rithmicAccountId },
      new Date(0)
    )

    const imported = await importFillsForConnection(connection.userId, connection.id, connection.accountId!, fills)
    await recordSyncRun({ broker: "rithmic", connectionId: connection.id, userId: connection.userId, trigger, startedAt, imported })

    // A manual "Sync now" always refreshes the balance; the background job
    // only once it's gone stale.
    const [account] = await db.select({ balanceUpdatedAt: tradingAccounts.balanceUpdatedAt }).from(tradingAccounts).where(eq(tradingAccounts.id, connection.accountId!))
    const stale = !account?.balanceUpdatedAt || Date.now() - account.balanceUpdatedAt.getTime() > BALANCE_REFRESH_MS
    if (trigger !== "auto" || stale) await refreshBrokerBalance(connection, password, rms)
    return { imported }
  } catch (err) {
    await db
      .update(rithmicConnections)
      .set({ lastSyncStatus: "error", lastSyncError: err instanceof Error ? err.message : "Sync failed" })
      .where(eq(rithmicConnections.id, connection.id))
    await recordSyncRun({ broker: "rithmic", connectionId: connection.id, userId: connection.userId, trigger, startedAt, error: err })
    throw err
  }
}
