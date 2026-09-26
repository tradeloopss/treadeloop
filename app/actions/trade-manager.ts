"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { and, desc, eq, gte } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { tradingAccounts, trades, providerAccounts, providerPositions, metatraderConnections } from "@/lib/db/schema"
import { contractMultiplierForSymbol, computePnl, computeRMultiple } from "@/lib/calc"
import { openTradeMetrics, liveTradeMetrics, computeStats, type TradeManagerData, type TradesManagerData, type ClosedTradeRow, type OpenTradeView } from "@/lib/trade-manager"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

// Every open position across the user's non-archived accounts, from BOTH
// sources the app keeps them in:
//  - the canonical `trades` table (status = "open") — manual open trades, and
//    any future sync that writes open rows; these carry stop/target.
//  - `provider_positions` — live broker positions (Tradovate). These carry an
//    average entry and net quantity but no stop/target, so their risk shows as
//    "no stop" rather than a fabricated number.
// (MT5/Rithmic sync only stores closed fills — MT5 keeps just an open-position
// COUNT, no per-position detail — so those can't appear here until the worker
// stores positions. Surfaced honestly rather than silently dropped.)
async function loadOpenPositions(userId: string, onlyAccountId?: number): Promise<{ accounts: { id: number; name: string }[]; trades: OpenTradeView[] }> {
  const accounts = await db
    .select({ id: tradingAccounts.id, name: tradingAccounts.name, currency: tradingAccounts.currency, archived: tradingAccounts.archived })
    .from(tradingAccounts)
    .where(eq(tradingAccounts.userId, userId))
  const active = accounts.filter((a) => !a.archived)
  const accountById = new Map(active.map((a) => [a.id, a]))

  const views: OpenTradeView[] = []

  // 1) Open trades.
  const openRows = await db
    .select()
    .from(trades)
    .where(and(eq(trades.userId, userId), eq(trades.status, "open")))
    .orderBy(desc(trades.entryTime))
  for (const t of openRows) {
    if (t.accountId != null && !accountById.has(t.accountId)) continue
    if (onlyAccountId != null && t.accountId !== onlyAccountId) continue
    const account = t.accountId != null ? accountById.get(t.accountId) : null
    const side = t.side === "short" ? "short" : "long"
    const quantity = Number(t.quantity)
    const entryPrice = Number(t.entryPrice)
    const stopLoss = t.stopLoss != null ? Number(t.stopLoss) : null
    const takeProfit = t.takeProfit != null ? Number(t.takeProfit) : null
    const contractMultiplier = Number(t.contractMultiplier) || 1
    const fees = Number(t.fees) || 0
    views.push({
      id: t.id,
      source: t.source ?? "manual",
      origin: "trade",
      positionRef: null,
      accountId: t.accountId,
      accountName: account?.name ?? "Unassigned",
      currency: account?.currency ?? "USD",
      symbol: t.symbol,
      market: t.market,
      side,
      quantity,
      entryPrice,
      currentPrice: null,
      unrealizedPnl: null,
      stopLoss,
      takeProfit,
      entryTime: t.entryTime.toISOString(),
      contractMultiplier,
      notes: t.notes,
      metrics: openTradeMetrics({ side, quantity, entryPrice, stopLoss, takeProfit, contractMultiplier, fees }),
    })
  }

  // 2) Live Tradovate positions (provider_positions), attributed to the
  //    journal account their provider account is linked to.
  const providerRows = await db
    .select({
      tradingAccountId: providerAccounts.tradingAccountId,
      symbol: providerPositions.symbol,
      contractId: providerPositions.contractId,
      netQuantity: providerPositions.netQuantity,
      averagePrice: providerPositions.averagePrice,
      updatedAt: providerPositions.updatedAt,
    })
    .from(providerPositions)
    .innerJoin(
      providerAccounts,
      and(
        eq(providerAccounts.connectionId, providerPositions.connectionId),
        eq(providerAccounts.environment, providerPositions.environment),
        eq(providerAccounts.providerAccountId, providerPositions.providerAccountId),
      ),
    )
    .where(eq(providerAccounts.enabled, true))
  for (const p of providerRows) {
    const netQuantity = Number(p.netQuantity)
    if (netQuantity === 0) continue
    const accId = p.tradingAccountId
    if (accId == null || !accountById.has(accId)) continue
    if (onlyAccountId != null && accId !== onlyAccountId) continue
    const account = accountById.get(accId)!
    const symbol = p.symbol ?? p.contractId
    const side = netQuantity > 0 ? "long" : "short"
    const quantity = Math.abs(netQuantity)
    const entryPrice = p.averagePrice != null ? Number(p.averagePrice) : 0
    const contractMultiplier = contractMultiplierForSymbol(symbol)
    views.push({
      id: -1 * (accId * 100000 + Math.abs(hashCode(symbol)) % 100000), // synthetic negative id (no `trades` row)
      source: "tradovate",
      origin: "provider",
      positionRef: null,
      accountId: accId,
      accountName: account.name,
      currency: account.currency,
      symbol,
      market: "futures",
      side,
      quantity,
      entryPrice,
      currentPrice: null,
      unrealizedPnl: null,
      stopLoss: null,
      takeProfit: null,
      entryTime: p.updatedAt.toISOString(),
      contractMultiplier,
      notes: null,
      metrics: openTradeMetrics({ side, quantity, entryPrice, stopLoss: null, takeProfit: null, contractMultiplier, fees: 0 }),
    })
  }

  // 3) Live MetaTrader positions — stored on the connection each sync, with
  //    real floating P&L, current price and SL/TP.
  const mtConns = await db
    .select({ accountId: metatraderConnections.accountId, positions: metatraderConnections.openPositionsData, updatedAt: metatraderConnections.lastSyncedAt, platform: metatraderConnections.platform })
    .from(metatraderConnections)
    .where(eq(metatraderConnections.userId, userId))
  for (const c of mtConns) {
    const accId = c.accountId
    if (accId == null || !accountById.has(accId)) continue
    if (onlyAccountId != null && accId !== onlyAccountId) continue
    const account = accountById.get(accId)!
    for (const pos of c.positions ?? []) {
      if (!(Math.abs(pos.volume) > 0)) continue
      views.push({
        id: -1 * (accId * 1_000_000 + (Math.abs(hashCode(pos.identifier || pos.symbol)) % 1_000_000)),
        source: c.platform === "mt4" ? "mt4" : "mt5",
        origin: "provider",
        positionRef: pos.identifier || null,
        accountId: accId,
        accountName: account.name,
        currency: account.currency,
        symbol: pos.symbol,
        market: "forex",
        side: pos.side,
        quantity: pos.volume,
        entryPrice: pos.openPrice,
        currentPrice: pos.currentPrice,
        unrealizedPnl: pos.profit,
        stopLoss: pos.stopLoss,
        takeProfit: pos.takeProfit,
        entryTime: (c.updatedAt ?? new Date()).toISOString(),
        contractMultiplier: 1,
        notes: null,
        metrics: liveTradeMetrics({ side: pos.side, volume: pos.volume, openPrice: pos.openPrice, currentPrice: pos.currentPrice, profit: pos.profit, stopLoss: pos.stopLoss, takeProfit: pos.takeProfit }),
      })
    }
  }

  views.sort((a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime())
  return { accounts: active.map((a) => ({ id: a.id, name: a.name })), trades: views }
}

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
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
    for (const id of accountIds) {
      const mt = mtByAccount.get(id)
      if (mt) execution[id] = { broker: mt.platform === "mt4" ? "mt4" : "mt5", supported: true, enabled: mt.hasTrading != null }
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
