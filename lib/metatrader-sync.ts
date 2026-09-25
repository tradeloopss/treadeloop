// Turns the raw MT5 deals the sync VPS collects (metatrader_deals, written by
// worker/mt5) into journal trades. The worker only ever stores what the
// terminal reported; everything here is derived, so a fix to this file can be
// re-run over an account's whole history by clearing its normalizedAt.
//
// Runs inside the app (not on the VPS) so trades, accounts and journal days
// are written by the same code as every other import. Triggered by the worker
// right after it stores new deals (POST /api/cron/metatrader-sync), with the
// minute-by-minute cron as a fallback.
import { db } from "@/lib/db"
import { metatraderConnections, metatraderDeals, trades, tradingAccounts } from "@/lib/db/schema"
import { and, asc, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm"
import { computeRMultiple } from "@/lib/calc"
import { inferStartingBalance } from "@/lib/broker-balance"
import { buildPositionTrades, DEAL_BALANCE, marketForSymbol } from "@/lib/metatrader-trades"
import { regenerateJournalForDay } from "@/app/actions/trades"

type Connection = typeof metatraderConnections.$inferSelect
type Deal = typeof metatraderDeals.$inferSelect

// The trading account a connection's trades land in, created on first use:
// "<broker> - <login>", like Rithmic accounts.
async function ensureAccount(connection: Connection): Promise<number> {
  if (connection.accountId != null) return connection.accountId
  const broker = connection.brokerName ?? (connection.platform === "mt4" ? "MetaTrader 4" : "MetaTrader 5")
  const name = `${broker} - ${connection.login}`
  const [existing] = await db
    .select({ id: tradingAccounts.id })
    .from(tradingAccounts)
    .where(and(eq(tradingAccounts.userId, connection.userId), eq(tradingAccounts.name, name)))
  const accountId =
    existing?.id ??
    (
      await db
        .insert(tradingAccounts)
        .values({ userId: connection.userId, name, broker, currency: connection.currency ?? "USD" })
        .returning({ id: tradingAccounts.id })
    )[0].id
  await db.update(metatraderConnections).set({ accountId }).where(eq(metatraderConnections.id, connection.id))
  return accountId
}

// Brings one connection's trades up to date with its raw deals. Returns how
// many trades were added.
export async function normalizeConnection(connection: Connection): Promise<number> {
  const accountId = await ensureAccount(connection)
  // Progress is bookmarked with the worker's dealsChangedAt as read here (the
  // database's clock, same as the deals' createdAt), so deals stored while
  // this runs leave the connection due again rather than being skipped. The
  // 5-minute overlap covers inserts still committing at that moment; it only
  // re-checks positions that are compared and left alone.
  const bookmark = connection.dealsChangedAt ?? new Date(0)
  const since = connection.normalizedAt ? new Date(connection.normalizedAt.getTime() - 5 * 60_000) : null

  // Only positions with deals that arrived since the last run need rebuilding
  // (all of them the first time, or after the server time zone changed).
  const touched = await db
    .selectDistinct({ positionId: metatraderDeals.positionId })
    .from(metatraderDeals)
    .where(
      and(
        eq(metatraderDeals.connectionId, connection.id),
        isNotNull(metatraderDeals.positionId),
        ne(metatraderDeals.positionId, "0"),
        since ? gt(metatraderDeals.createdAt, since) : undefined,
      ),
    )
  const positionIds = touched.map((t) => t.positionId!).filter(Boolean)

  let added = 0
  const affectedDays = new Set<string>()
  for (let i = 0; i < positionIds.length; i += 500) {
    const chunk = positionIds.slice(i, i + 500)
    const deals = await db
      .select()
      .from(metatraderDeals)
      .where(and(eq(metatraderDeals.connectionId, connection.id), inArray(metatraderDeals.positionId, chunk)))
    const byPosition = new Map<string, Deal[]>()
    for (const d of deals) {
      const list = byPosition.get(d.positionId!) ?? []
      list.push(d)
      byPosition.set(d.positionId!, list)
    }
    const built = [...byPosition].flatMap(([positionId, list]) => buildPositionTrades(connection.login, positionId, list, connection.serverTimeZone))
    if (built.length === 0) continue

    const existing = await db
      .select({ id: trades.id, externalId: trades.externalId, entryTime: trades.entryTime, exitTime: trades.exitTime, pnl: trades.pnl })
      .from(trades)
      .where(and(eq(trades.accountId, accountId), inArray(trades.externalId, built.map((t) => t.externalId))))
    const byExternal = new Map(existing.map((e) => [e.externalId!, e]))

    for (const t of built) {
      const rMultiple = computeRMultiple({ side: t.side, quantity: t.quantity, entryPrice: t.entryPrice, exitPrice: t.exitPrice, fees: 0, contractMultiplier: 1, stopLoss: t.stopLoss })
      const values = {
        symbol: t.symbol,
        side: t.side,
        quantity: String(t.quantity),
        entryPrice: String(t.entryPrice),
        exitPrice: String(t.exitPrice),
        stopLoss: t.stopLoss == null ? null : String(t.stopLoss),
        takeProfit: t.takeProfit == null ? null : String(t.takeProfit),
        fees: String(t.fees),
        pnl: String(t.pnl),
        rMultiple: rMultiple == null || !Number.isFinite(rMultiple) ? null : String(Number(rMultiple.toFixed(2))),
        entryTime: t.entryTime,
        exitTime: t.exitTime,
      }
      const prior = byExternal.get(t.externalId)
      if (!prior) {
        await db.insert(trades).values({
          ...values,
          userId: connection.userId,
          accountId,
          market: marketForSymbol(t.symbol),
          status: "closed",
          contractMultiplier: "1",
          externalId: t.externalId,
          source: "mt5",
        })
        added++
        affectedDays.add(t.exitTime.toISOString().slice(0, 10))
      } else if (
        prior.entryTime.getTime() !== t.entryTime.getTime() ||
        prior.exitTime?.getTime() !== t.exitTime.getTime() ||
        Number(prior.pnl) !== t.pnl
      ) {
        // Re-derived differently (a corrected server time zone, say) — keep
        // the user's notes/tags, refresh the broker's numbers.
        await db.update(trades).set(values).where(eq(trades.id, prior.id))
        if (prior.exitTime) affectedDays.add(prior.exitTime.toISOString().slice(0, 10))
        affectedDays.add(t.exitTime.toISOString().slice(0, 10))
      }
    }
  }

  await applyAccountFigures(connection, accountId)
  for (const day of affectedDays) await regenerateJournalForDay(connection.userId, day)
  await db.update(metatraderConnections).set({ normalizedAt: bookmark }).where(eq(metatraderConnections.id, connection.id))
  return added
}

// The broker's balance on the account, and its real starting balance: the
// first deposit on file, or — when the imported window starts after it —
// worked back from the balance like Rithmic accounts.
async function applyAccountFigures(connection: Connection, accountId: number) {
  const [account] = await db.select().from(tradingAccounts).where(eq(tradingAccounts.id, accountId))
  if (!account) return
  const patch: Partial<typeof tradingAccounts.$inferInsert> = {}
  if (connection.balance != null) {
    patch.currentBalance = connection.balance
    patch.balanceUpdatedAt = connection.lastSyncedAt ?? new Date()
  }
  if (connection.currency) patch.currency = connection.currency
  if (Number(account.startingBalance) <= 0 || account.startingBalanceInferred) {
    const [firstDeposit] = await db
      .select({ profit: metatraderDeals.profit })
      .from(metatraderDeals)
      .where(and(eq(metatraderDeals.connectionId, connection.id), eq(metatraderDeals.type, DEAL_BALANCE), gt(metatraderDeals.profit, "0")))
      .orderBy(asc(metatraderDeals.time))
      .limit(1)
    if (firstDeposit) {
      patch.startingBalance = firstDeposit.profit
      patch.startingBalanceInferred = false
    } else if (connection.balance != null && Number(connection.balance) > 0) {
      const [{ net }] = await db
        .select({ net: sql<string>`coalesce(sum(${trades.pnl}), 0)` })
        .from(trades)
        .where(and(eq(trades.accountId, accountId), eq(trades.status, "closed")))
      patch.startingBalance = String(inferStartingBalance(Number(connection.balance), Number(net), { accountNames: [account.name] }))
      patch.startingBalanceInferred = true
    }
  }
  if (Object.keys(patch).length) await db.update(tradingAccounts).set(patch).where(eq(tradingAccounts.id, accountId))
}

// Every connected account with raw deals the app hasn't turned into trades
// yet (or no account row yet). Cheap when there's nothing to do.
export async function normalizeDueConnections(): Promise<{ connections: number; added: number }> {
  const due = await db
    .select()
    .from(metatraderConnections)
    .where(
      and(
        eq(metatraderConnections.status, "connected"),
        or(
          isNull(metatraderConnections.accountId),
          and(
            isNotNull(metatraderConnections.dealsChangedAt),
            or(isNull(metatraderConnections.normalizedAt), sql`${metatraderConnections.dealsChangedAt} > ${metatraderConnections.normalizedAt}`),
          ),
        ),
      ),
    )
  let added = 0
  for (const connection of due) {
    try {
      added += await normalizeConnection(connection)
    } catch (err) {
      console.error(`[metatrader-sync] normalizing connection ${connection.id} failed:`, err)
    }
  }
  return { connections: due.length, added }
}
