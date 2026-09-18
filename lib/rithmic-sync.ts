// Shared, plain (non-"use server") sync logic — used both by the
// session-gated server actions in app/actions/rithmic.ts (manual connect /
// "Sync now") and by lib/rithmic-auto-sync.ts's background job, which runs
// outside any request context and can't rely on a logged-in session.
import { db } from "@/lib/db"
import { rithmicConnections, trades } from "@/lib/db/schema"
import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { decrypt } from "@/lib/crypto"
import { fetchRithmicFills } from "@/lib/rithmic-client"
import { reconstructTrades, type ParsedFill } from "@/lib/fill-reconstruction"
import { computePnl, contractMultiplierForSymbol } from "@/lib/calc"
import { regenerateJournalForDay } from "@/app/actions/trades"

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

// Syncs one connection — no session/auth check, since the background
// auto-sync job calls this outside any request context. Callers that DO
// have a session (the manual "Sync now" button) are responsible for
// verifying the connection belongs to the caller before invoking this.
export async function syncRithmicConnection(connection: RithmicConnectionRow): Promise<{ imported: number }> {
  try {
    const password = decrypt(connection.passwordEnc)
    // Always re-pull full history rather than fetching since the last sync:
    // fill-based reconstruction pairs an entry fill with its closing fill, and
    // narrowing the window would drop the entry side of any position that was
    // still open at the last sync and only closed since. Already-imported
    // trades are filtered out below by externalId, so this is safe to repeat.
    const fills = await fetchRithmicFills(
      connection.login,
      password,
      connection.systemName,
      connection.gatewayUri,
      { fcmId: connection.fcmId, ibId: connection.ibId, accountId: connection.rithmicAccountId },
      new Date(0)
    )

    const imported = await importFillsForConnection(connection.userId, connection.id, connection.accountId!, fills)
    return { imported }
  } catch (err) {
    await db
      .update(rithmicConnections)
      .set({ lastSyncStatus: "error", lastSyncError: err instanceof Error ? err.message : "Sync failed" })
      .where(eq(rithmicConnections.id, connection.id))
    throw err
  }
}
