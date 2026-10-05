"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { and, desc, eq, gte } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { tradingAccounts, trades, providerAccounts, providerPositions, metatraderConnections, rithmicConnections } from "@/lib/db/schema"
import { contractMultiplierForSymbol, computePnl, computeRMultiple } from "@/lib/calc"
import { loadOpenPositions } from "@/lib/trade-manager-server"
import { openTradeMetrics, liveTradeMetrics, computeStats, type TradeManagerData, type TradesManagerData, type ClosedTradeRow, type OpenTradeView } from "@/lib/trade-manager"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

export async function getOpenTradesOverview(): Promise<TradeManagerData> {
  const userId = await getUserId()
  return loadOpenPositions(userId)
}

// Everything the Trades Manager page needs: real open positions, today's
// closed trades, and KPI stats — all from the user's own data.
export async function getTradesManagerData(): Promise<TradesManagerData> {
  const userId = await getUserId()
  const { accounts, trades: openTrades } = await loadOpenPositions(userId)
  const nameById = new Map(accounts.map((a) => [a.id, a.name]))
  const currencyByAccount = new Map<number, string>()
  const accRows = await db.select({ id: tradingAccounts.id, currency: tradingAccounts.currency }).from(tradingAccounts).where(eq(tradingAccounts.userId, userId))
  for (const a of accRows) currencyByAccount.set(a.id, a.currency)

  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const closedRows = await db
    .select({
      id: trades.id,
      accountId: trades.accountId,
      symbol: trades.symbol,
      side: trades.side,
      quantity: trades.quantity,
      entryPrice: trades.entryPrice,
      exitPrice: trades.exitPrice,
      pnl: trades.pnl,
      exitTime: trades.exitTime,
    })
    .from(trades)
    .where(and(eq(trades.userId, userId), eq(trades.status, "closed"), gte(trades.exitTime, startOfDay)))
    .orderBy(desc(trades.exitTime))

  const closedToday: ClosedTradeRow[] = closedRows
    .filter((t) => t.exitTime != null)
    .map((t) => ({
      id: t.id,
      accountId: t.accountId,
      accountName: t.accountId != null ? nameById.get(t.accountId) ?? "Account" : "Unassigned",
      currency: t.accountId != null ? currencyByAccount.get(t.accountId) ?? "USD" : "USD",
      symbol: t.symbol,
      side: t.side === "short" ? "short" : "long",
      quantity: Number(t.quantity),
      entryPrice: Number(t.entryPrice),
      exitPrice: t.exitPrice != null ? Number(t.exitPrice) : null,
      pnl: Number(t.pnl),
      exitTime: t.exitTime!.toISOString(),
    }))

  // Execution capability per account with an open trade.
  const execution: Record<number, import("@/lib/trade-manager").AccountExecution> = {}
  const accountIds = [...new Set(openTrades.map((t) => t.accountId).filter((a): a is number => a != null))]
  if (accountIds.length) {
    const mtRows = await db
      .select({ accountId: metatraderConnections.accountId, platform: metatraderConnections.platform, hasTrading: metatraderConnections.tradingPasswordEnc })
      .from(metatraderConnections)
      .where(eq(metatraderConnections.userId, userId))
    const mtByAccount = new Map(mtRows.filter((r) => r.accountId != null).map((r) => [r.accountId!, r]))
    const rithRows = await db.select({ accountId: rithmicConnections.accountId }).from(rithmicConnections).where(eq(rithmicConnections.userId, userId))
    const rithAccounts = new Set(rithRows.map((r) => r.accountId).filter((a): a is number => a != null))
    for (const id of accountIds) {
      const mt = mtByAccount.get(id)
      if (mt) execution[id] = { broker: mt.platform === "mt4" ? "mt4" : "mt5", supported: true, enabled: mt.hasTrading != null }
      // Rithmic uses the same login for trading, so execution is on as soon as
      // the account has order routing entitled (confirmed on the first order).
      else if (rithAccounts.has(id)) execution[id] = { broker: "rithmic", supported: true, enabled: true }
      else execution[id] = { broker: null, supported: false, enabled: false }
    }
  }

  return { accounts, openTrades, closedToday, stats: computeStats(openTrades, closedToday), execution }
}

// The open positions for one account (for the PropFirm Max account detail's
// Running Trades tab).
export async function getAccountOpenPositions(accountId: number): Promise<OpenTradeView[]> {
  const userId = await getUserId()
  const { trades } = await loadOpenPositions(userId, accountId)
  return trades
}

// Close a MANUAL open trade at a given exit price — the app can't send orders
// to a broker (it's a read-only tracker), so this only applies to a `trades`
// row the user is managing by hand, not a live Tradovate position. It records
// the exit and lets the P&L flow into the journal like any other closed trade.
export async function closeOpenTrade(id: number, exitPrice: number) {
  const userId = await getUserId()
  if (!Number.isFinite(exitPrice)) throw new Error("Enter a valid exit price.")

  const [t] = await db.select().from(trades).where(and(eq(trades.id, id), eq(trades.userId, userId)))
  if (!t) throw new Error("Trade not found.")
  if (t.status !== "open") throw new Error("That trade isn't open.")

  const side = t.side === "short" ? "short" : "long"
  const quantity = Number(t.quantity)
  const entryPrice = Number(t.entryPrice)
  const contractMultiplier = Number(t.contractMultiplier) || 1
  const fees = Number(t.fees) || 0
  const pnl = computePnl({ side, quantity, entryPrice, exitPrice, contractMultiplier, fees })
  const rMultiple = computeRMultiple({
    side,
    quantity,
    entryPrice,
    exitPrice,
    contractMultiplier,
    fees,
    stopLoss: t.stopLoss != null ? Number(t.stopLoss) : null,
  })

  await db
    .update(trades)
    .set({ status: "closed", exitPrice: String(exitPrice), exitTime: new Date(), pnl: String(pnl), rMultiple: rMultiple != null ? String(rMultiple) : null })
    .where(eq(trades.id, id))

  revalidatePath("/trade-manager")
  revalidatePath("/propfirm-max")
  revalidatePath(`/propfirm-max/${t.accountId}`)
  return { pnl }
}
