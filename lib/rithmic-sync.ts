// Shared, plain (non-"use server") sync logic — used both by the
// session-gated server actions in app/actions/rithmic.ts (manual connect /
// "Sync now") and by lib/rithmic-auto-sync.ts's background job, which runs
// outside any request context and can't rely on a logged-in session.
import { db } from "@/lib/db"
import { propFirmTransactions, rithmicConnections, trades, tradingAccounts } from "@/lib/db/schema"
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { decrypt } from "@/lib/crypto"
import { fetchAccountSnapshots, fetchRithmicFillsAndRms, type RithmicAccountRms, type RithmicAccountSnapshot } from "@/lib/rithmic-client"
import { brokerDrawdownFloor, inferStartingBalance } from "@/lib/broker-balance"
import { reconstructTrades, type ParsedFill } from "@/lib/fill-reconstruction"
import { computePnl, computeRMultiple, contractMultiplierForSymbol } from "@/lib/calc"
import { regenerateJournalForDay } from "@/app/actions/trades"
import { recordSyncRun, type SyncTrigger } from "@/lib/sync-runs"

export type RithmicConnectionRow = typeof rithmicConnections.$inferSelect

// Average round-turn commission per contract from the broker's own totals.
// filled contracts count both sides, so a round-turn is 2 contracts. Guarded to
// a sane futures range ($0.10–$50/round-turn) so a bad or missing value can
// never corrupt P&L — it simply leaves trades gross. This is the whole trick
// for matching the firm's net numbers, since Rithmic's fill feed carries no
// commission (only this account-level total does).
export function commissionRateFromSnapshot(snapshot: RithmicAccountSnapshot): number | null {
  const { commission, filledContracts } = snapshot
  if (commission == null || filledContracts == null || commission <= 0 || filledContracts <= 0) return null
  const roundTurns = filledContracts / 2
  if (roundTurns <= 0) return null
  const rate = commission / roundTurns
  if (rate < 0.1 || rate > 50) return null
  return Number(rate.toFixed(4))
}

// Re-prices every closed trade on the account so its P&L is net of commission:
// fees = ratePerContract × quantity, pnl = gross − fees. Gross is recomputed
// from the stored prices each time, so this is idempotent and safe to re-run.
async function repriceAccountTrades(accountId: number, ratePerContract: number): Promise<void> {
  const rows = await db.select().from(trades).where(and(eq(trades.accountId, accountId), eq(trades.status, "closed")))
  for (const tr of rows) {
    if (tr.exitPrice == null) continue
    const qty = Number(tr.quantity)
    const base = {
      side: tr.side as "long" | "short",
      quantity: qty,
      entryPrice: Number(tr.entryPrice),
      exitPrice: Number(tr.exitPrice),
      contractMultiplier: Number(tr.contractMultiplier),
    }
    const fees = Number((ratePerContract * qty).toFixed(2))
    const pnl = computePnl({ ...base, fees: 0 }) - fees
    const rMultiple = computeRMultiple({ ...base, stopLoss: tr.stopLoss != null ? Number(tr.stopLoss) : null, fees })
    await db.update(trades).set({ fees: String(fees), pnl: String(pnl), rMultiple: rMultiple == null ? null : String(rMultiple) }).where(eq(trades.id, tr.id))
  }
}

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
            // Scoped to this account so re-importing into a freshly created
            // account (e.g. after the old one was deleted) isn't blocked by
            // orphaned trades that carry the same broker fill ids.
            eq(trades.accountId, accountId),
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

  // Price new trades net of commission using the rate the broker's snapshot
  // already gave us (0 until the first snapshot lands, then applied on the next
  // refresh's reprice — see applyBrokerSnapshot).
  const [account] = await db.select({ commissionPerContract: tradingAccounts.commissionPerContract }).from(tradingAccounts).where(eq(tradingAccounts.id, accountId))
  const rate = account?.commissionPerContract != null ? Number(account.commissionPerContract) : 0

  const affectedDays = new Set<string>()
  for (const t of toImport) {
    const contractMultiplier = contractMultiplierForSymbol(t.symbol)
    const fees = Number((rate * t.quantity).toFixed(2))
    const gross = t.pnl ?? computePnl({ side: t.side, quantity: t.quantity, entryPrice: t.entryPrice, exitPrice: t.exitPrice, fees: 0, contractMultiplier })
    const pnl = gross - fees
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
      fees: String(fees),
      pnl: String(pnl),
      contractMultiplier: String(contractMultiplier),
      entryTime: new Date(t.entryTime),
      exitTime: new Date(t.exitTime),
      externalId: t.externalId,
      source: "rithmic",
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
// Rithmic sees it, the liquidation floor if it reports one, and — for an
// account that was created without a size, or whose size is still our own
// earlier guess — the starting balance worked back from it. Each refresh
// redoes that guess (more fills on file make it better) until the user
// types a size themselves.
export async function applyBrokerSnapshot(
  accountId: number,
  snapshot: RithmicAccountSnapshot,
  rms?: RithmicAccountRms,
  rithmicAccount?: { accountId: string; accountName: string },
): Promise<void> {
  const [account] = await db.select().from(tradingAccounts).where(eq(tradingAccounts.id, accountId))
  if (!account) return
  const balance = snapshot.accountBalance
  const patch: Partial<typeof tradingAccounts.$inferInsert> = {
    currentBalance: String(balance),
    balanceUpdatedAt: snapshot.at,
    brokerDrawdownFloor: (() => {
      const floor = brokerDrawdownFloor(balance, rms, snapshot)
      return floor == null ? null : String(floor)
    })(),
  }

  // Make the account's trade P&L net of commission using the broker's own
  // commission total. Only re-prices when the derived rate actually changes
  // (it stabilises quickly), so this isn't rewritten every refresh. Done before
  // the starting-balance inference below so that walks off net P&L, matching
  // the net balance.
  const rate = commissionRateFromSnapshot(snapshot)
  if (rate != null && (account.commissionPerContract == null || Math.abs(Number(account.commissionPerContract) - rate) > 0.0001)) {
    patch.commissionPerContract = String(rate)
    await repriceAccountTrades(accountId, rate)
  }

  if ((Number(account.startingBalance) <= 0 || account.startingBalanceInferred) && balance > 0) {
    const [{ net }] = await db
      .select({ net: sql<string>`coalesce(sum(${trades.pnl}), 0)` })
      .from(trades)
      .where(and(eq(trades.accountId, accountId), eq(trades.status, "closed")))
    const [{ payouts }] = await db
      .select({ payouts: sql<string>`coalesce(sum(${propFirmTransactions.amount}), 0)` })
      .from(propFirmTransactions)
      .where(and(eq(propFirmTransactions.accountId, accountId), eq(propFirmTransactions.type, "payout")))
    patch.startingBalance = String(
      inferStartingBalance(balance, Number(net), {
        payouts: Number(payouts),
        accountNames: [rithmicAccount?.accountId, rithmicAccount?.accountName, account.name],
      }),
    )
    patch.startingBalanceInferred = true
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
    if (snapshot) await applyBrokerSnapshot(connection.accountId, snapshot, rms, { accountId: connection.rithmicAccountId, accountName: connection.accountName })
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
