// Shared, plain (non-"use server") sync logic — used both by the
// session-gated server actions in app/actions/rithmic.ts (manual connect /
// "Sync now") and by lib/rithmic-auto-sync.ts's background job, which runs
// outside any request context and can't rely on a logged-in session.
import { db } from "@/lib/db"
import { propFirmTransactions, rithmicConnections, trades, tradingAccounts, orderCommands } from "@/lib/db/schema"
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { decrypt } from "@/lib/crypto"
import { fetchAccountSnapshots, fetchRithmicFillsAndRms, sendRithmicOrder, type RithmicAccountRms, type RithmicAccountSnapshot, type RithmicOrderInput } from "@/lib/rithmic-client"
import { brokerDrawdownFloor, inferStartingBalance } from "@/lib/broker-balance"
import { reconstructTrades, type ParsedFill } from "@/lib/fill-reconstruction"
import { computePnl, computeRMultiple, contractMultiplierForSymbol } from "@/lib/calc"
import { regenerateJournalForDay } from "@/app/actions/trades"
import { recordSyncRun, type SyncTrigger } from "@/lib/sync-runs"
import { repriceAccountTrades } from "@/lib/trade-commission"

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
// --- Order routing (write path) -------------------------------------------
// A Rithmic order carries a symbol AND an exchange; the app may pass either a
// bare symbol (with a known root → exchange) or "SYMBOL@EXCHANGE".
const ROOT_EXCHANGE: Record<string, string> = {
  ES: "CME", MES: "CME", NQ: "CME", MNQ: "CME", RTY: "CME", M2K: "CME", "6E": "CME", "6B": "CME", "6J": "CME", "6A": "CME", "6C": "CME",
  CL: "NYMEX", MCL: "NYMEX", NG: "NYMEX", GC: "COMEX", MGC: "COMEX", SI: "COMEX", HG: "COMEX",
  YM: "CBOT", ZN: "CBOT", ZB: "CBOT", ZF: "CBOT", ZT: "CBOT", ZC: "CBOT", ZS: "CBOT", ZW: "CBOT",
}
function symbolExchange(raw: string | null, fallback?: string | null): { symbol: string | null; exchange: string | null } {
  if (!raw) return { symbol: null, exchange: fallback ?? null }
  if (raw.includes("@")) {
    const [s, e] = raw.split("@")
    return { symbol: s, exchange: e || fallback || null }
  }
  const root = raw.replace(/[0-9]+$/, "").replace(/[FGHJKMNQUVXZ]$/, "") // strip month/year code
  return { symbol: raw, exchange: fallback ?? ROOT_EXCHANGE[root] ?? ROOT_EXCHANGE[raw] ?? null }
}

// Executes pending Rithmic order_commands (the Vercel side, where Rithmic
// connectivity + the credential key live — called from the rithmic-sync cron).
// The rule guard already ran at submit time; this only transmits.
//
// UNVERIFIED end to end — needs an order-routing-entitled Rithmic account to
// confirm before real use; a bad entitlement surfaces as a rejected request.
export async function runRithmicOrderCommands(): Promise<{ processed: number }> {
  const claimed = await db.execute<{ id: number }>(sql`
    update order_commands set "leaseUntil" = now() + interval '2 minutes', "updatedAt" = now()
    where id in (
      select id from order_commands
      where broker = 'rithmic' and status = 'pending' and ("leaseUntil" is null or "leaseUntil" < now())
      order by "createdAt" limit 10 for update skip locked
    ) returning id`)
  const ids = claimed.rows.map((r) => r.id)
  if (ids.length === 0) return { processed: 0 }
  const cmds = await db.select().from(orderCommands).where(inArray(orderCommands.id, ids))

  for (const cmd of cmds) {
    try {
      const [conn] = await db.select().from(rithmicConnections).where(eq(rithmicConnections.accountId, cmd.accountId))
      if (!conn) {
        await finishOrder(cmd.id, "failed", "No Rithmic connection for this account.")
        continue
      }
      if (cmd.kind === "modify") {
        await finishOrder(cmd.id, "unsupported", "Rithmic positions have no SL/TP to modify — place a protective stop/limit order instead.")
        continue
      }
      const { symbol, exchange } = symbolExchange(cmd.symbol)
      const input: RithmicOrderInput = {
        kind: cmd.kind as RithmicOrderInput["kind"],
        symbol,
        exchange,
        side: cmd.side === "short" ? "short" : cmd.side === "long" ? "long" : null,
        quantity: cmd.volume != null ? Number(cmd.volume) : null,
        price: cmd.price != null ? Number(cmd.price) : null,
        orderType: (cmd.orderType as RithmicOrderInput["orderType"]) ?? "market",
        basketId: cmd.orderRef,
      }
      const res = await sendRithmicOrder(
        conn.login,
        decrypt(conn.passwordEnc),
        conn.systemName,
        conn.gatewayUri,
        { fcmId: conn.fcmId, ibId: conn.ibId, accountId: conn.rithmicAccountId },
        input,
      )
      await finishOrder(cmd.id, res.status, res.message, res.brokerRef, res)
      console.log(`[rithmic] order ${cmd.id} (${cmd.kind} ${conn.rithmicAccountId}): ${res.status} — ${res.message}`)
    } catch (err) {
      const attempts = cmd.attempts + 1
      await db
        .update(orderCommands)
        .set({ status: attempts >= 3 ? "failed" : "pending", resultMessage: err instanceof Error ? err.message : String(err), attempts, leaseUntil: null, updatedAt: new Date() })
        .where(eq(orderCommands.id, cmd.id))
    }
  }
  return { processed: cmds.length }
}

async function finishOrder(id: number, status: string, message: string, brokerRef?: string | null, raw?: unknown) {
  await db
    .update(orderCommands)
    .set({ status, resultMessage: message, brokerRef: brokerRef ?? null, brokerResult: (raw ?? null) as never, leaseUntil: null, updatedAt: new Date() })
    .where(eq(orderCommands.id, id))
}

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
