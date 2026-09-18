"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { trades, tradingAccounts, dailyPnlShares, user } from "@/lib/db/schema"
import { and, eq, isNull } from "drizzle-orm"
import { headers } from "next/headers"
import { randomBytes } from "node:crypto"
import { computeAccountPnlInRange } from "@/lib/daily-account-pnl"
import { resolvePnlPeriod, type PnlPeriod } from "@/lib/pnl-period"
import { isPro } from "@/lib/subscription"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

// Turns on (or rotates) the public link for a trading day — either one
// specific account, or every account combined when accountId is null. One
// row per (user, account, date); re-sharing the same day just refreshes the
// token instead of piling up rows.
export async function shareDailyPnl(accountId: number | null, date: string, period: PnlPeriod = "daily"): Promise<string> {
  const userId = await getUserId()
  if (accountId != null) {
    const [account] = await db
      .select({ id: tradingAccounts.id })
      .from(tradingAccounts)
      .where(and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.userId, userId)))
    if (!account) throw new Error("Account not found")
  }

  // Store the period's first day, so a weekly link stays pinned to that week
  // however long after it's opened.
  const { start } = resolvePnlPeriod(period, date)

  const token = randomBytes(12).toString("hex")
  const accountMatch = accountId != null ? eq(dailyPnlShares.accountId, accountId) : isNull(dailyPnlShares.accountId)
  const [existing] = await db
    .select({ id: dailyPnlShares.id })
    .from(dailyPnlShares)
    .where(
      and(
        eq(dailyPnlShares.userId, userId),
        accountMatch,
        eq(dailyPnlShares.date, start),
        eq(dailyPnlShares.period, period)
      )
    )

  if (existing) {
    await db.update(dailyPnlShares).set({ token }).where(eq(dailyPnlShares.id, existing.id))
  } else {
    await db.insert(dailyPnlShares).values({ userId, accountId, date: start, period, token })
  }
  return token
}

export interface BrokerBreakdown {
  broker: string
  pnl: number
  accounts: number
}

export interface SharedDailyPnl {
  period: PnlPeriod
  periodLabel: string
  scope: "account" | "all"
  accountName: string | null
  accountCount: number
  breakdown: BrokerBreakdown[]
  currency: string
  date: string
  pnl: number
  trades: number
  wins: number
  losses: number
  createdAt: string
  traderName: string
  traderImage: string | null
  traderIsPro: boolean
}

// Public lookup by share token — recomputed live from trades at view time,
// not frozen at share time, so an edited/deleted trade after sharing is
// reflected immediately rather than showing a stale number.
export async function getSharedDailyPnl(token: string): Promise<SharedDailyPnl | null> {
  const [share] = await db.select().from(dailyPnlShares).where(eq(dailyPnlShares.token, token))
  if (!share) return null

  const [trader] = await db.select({ name: user.name, image: user.image }).from(user).where(eq(user.id, share.userId))
  if (!trader) return null
  const traderIsPro = await isPro(share.userId)
  const period: PnlPeriod = share.period === "weekly" ? "weekly" : "daily"
  const { start, end, label } = resolvePnlPeriod(period, share.date)

  if (share.accountId != null) {
    const [account] = await db
      .select({ name: tradingAccounts.name, currency: tradingAccounts.currency })
      .from(tradingAccounts)
      .where(eq(tradingAccounts.id, share.accountId))
    if (!account) return null

    const accountTrades = await db
      .select({ status: trades.status, pnl: trades.pnl, exitTime: trades.exitTime, entryTime: trades.entryTime })
      .from(trades)
      .where(eq(trades.accountId, share.accountId))

    const byAccount = computeAccountPnlInRange(
      accountTrades.map((t) => ({ accountId: share.accountId, ...t })),
      start,
      end
    )
    const day = byAccount.get(share.accountId) ?? { pnl: 0, trades: 0, wins: 0, losses: 0 }

    return {
      period,
      periodLabel: label,
      scope: "account",
      accountName: account.name,
      accountCount: 1,
      breakdown: [],
      currency: account.currency,
      date: share.date,
      pnl: day.pnl,
      trades: day.trades,
      wins: day.wins,
      losses: day.losses,
      createdAt: share.createdAt.toISOString(),
      traderName: trader.name,
      traderImage: trader.image,
      traderIsPro,
    }
  }

  // "All accounts" certificate — combine every one of the trader's accounts.
  const allAccounts = await db
    .select({ id: tradingAccounts.id, broker: tradingAccounts.broker, currency: tradingAccounts.currency })
    .from(tradingAccounts)
    .where(eq(tradingAccounts.userId, share.userId))
  if (allAccounts.length === 0) return null

  const allTrades = await db
    .select({ accountId: trades.accountId, status: trades.status, pnl: trades.pnl, exitTime: trades.exitTime, entryTime: trades.entryTime })
    .from(trades)
    .where(eq(trades.userId, share.userId))

  const byAccount = computeAccountPnlInRange(allTrades, start, end)

  const breakdownMap = new Map<string, BrokerBreakdown>()
  let totalPnl = 0
  let totalTrades = 0
  let totalWins = 0
  let totalLosses = 0
  for (const acc of allAccounts) {
    const day = byAccount.get(acc.id) ?? { pnl: 0, trades: 0, wins: 0, losses: 0 }
    totalPnl += day.pnl
    totalTrades += day.trades
    totalWins += day.wins
    totalLosses += day.losses
    const key = acc.broker?.trim() || "Other"
    const existing = breakdownMap.get(key) ?? { broker: key, pnl: 0, accounts: 0 }
    existing.pnl += day.pnl
    existing.accounts += 1
    breakdownMap.set(key, existing)
  }

  return {
    period,
    periodLabel: label,
    scope: "all",
    accountName: null,
    accountCount: allAccounts.length,
    breakdown: [...breakdownMap.values()].sort((a, b) => b.pnl - a.pnl),
    currency: allAccounts[0]?.currency ?? "USD",
    date: share.date,
    pnl: totalPnl,
    trades: totalTrades,
    wins: totalWins,
    losses: totalLosses,
    createdAt: share.createdAt.toISOString(),
    traderName: trader.name,
    traderImage: trader.image,
    traderIsPro,
  }
}
