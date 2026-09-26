"use server"

import { headers } from "next/headers"
import { and, desc, eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { tradingAccounts, trades } from "@/lib/db/schema"
import { openTradeMetrics, type TradeManagerData, type OpenTradeView } from "@/lib/trade-manager"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

// The open/running positions across the user's (non-archived) accounts, with
// each one's risk/reward from its own levels. Reads the canonical `trades`
// table (status = "open") — the same open trades the journal and sync already
// maintain; nothing new is tracked here.
export async function getOpenTradesOverview(): Promise<TradeManagerData> {
  const userId = await getUserId()

  const accounts = await db
    .select({ id: tradingAccounts.id, name: tradingAccounts.name, currency: tradingAccounts.currency, archived: tradingAccounts.archived })
    .from(tradingAccounts)
    .where(eq(tradingAccounts.userId, userId))
  const active = accounts.filter((a) => !a.archived)
  const accountById = new Map(active.map((a) => [a.id, a]))

  const openRows = await db
    .select()
    .from(trades)
    .where(and(eq(trades.userId, userId), eq(trades.status, "open")))
    .orderBy(desc(trades.entryTime))

  const views: OpenTradeView[] = openRows
    .filter((t) => t.accountId == null || accountById.has(t.accountId)) // drop archived-account trades
    .map((t) => {
      const account = t.accountId != null ? accountById.get(t.accountId) : null
      const side = t.side === "short" ? "short" : "long"
      const quantity = Number(t.quantity)
      const entryPrice = Number(t.entryPrice)
      const stopLoss = t.stopLoss != null ? Number(t.stopLoss) : null
      const takeProfit = t.takeProfit != null ? Number(t.takeProfit) : null
      const contractMultiplier = Number(t.contractMultiplier) || 1
      const fees = Number(t.fees) || 0
      return {
        id: t.id,
        accountId: t.accountId,
        accountName: account?.name ?? "Unassigned",
        currency: account?.currency ?? "USD",
        symbol: t.symbol,
        market: t.market,
        side,
        quantity,
        entryPrice,
        stopLoss,
        takeProfit,
        entryTime: t.entryTime.toISOString(),
        contractMultiplier,
        source: t.source,
        notes: t.notes,
        metrics: openTradeMetrics({ side, quantity, entryPrice, stopLoss, takeProfit, contractMultiplier, fees }),
      }
    })

  return { accounts: active.map((a) => ({ id: a.id, name: a.name })), trades: views }
}
