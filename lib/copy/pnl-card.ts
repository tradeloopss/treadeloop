import { and, eq, gte, isNull, or } from "drizzle-orm"
import { db } from "@/lib/db"
import { copyGroupFollowers, copyGroups, trades, tradingAccounts, user } from "@/lib/db/schema"
import type { BrokerBreakdown } from "@/app/actions/daily-pnl-share"
import type { AllAccountsSummary, DailyAccountRow, PnlCertificateData } from "@/components/pnl-certificate-button"
import { computeAccountPnlInRange, type DailyAccountPnl } from "@/lib/daily-account-pnl"
import { resolvePnlPeriod } from "@/lib/pnl-period"
import { isPro } from "@/lib/subscription"
import { localDay } from "@/lib/timezone"

// The P&L card, asked for from the Cockpit: the same certificate as the
// dashboard's (components/pnl-certificate-button.tsx), for the accounts of the
// group in front of the trader.
//
// The accounts on offer are the trader's own accounts in that group: its
// Followers, and its Leader when that is theirs too. A strategy a friend
// shares is not the trader's account, and no card is made of it. "Every
// account combined" is every account of the trader's, as it is on the
// dashboard and on the public page the card links to (which works its figures
// out again from the same trades): a card and its link never disagree.
//
// Figures are closed trades from the journal, by the day they closed in the
// trader's time zone: today, and this week from Monday.

const sum = (accounts: { id: number; broker: string | null }[], by: Map<number, DailyAccountPnl>, currency: string): AllAccountsSummary => {
  const brokers = new Map<string, BrokerBreakdown>()
  let pnl = 0
  for (const a of accounts) {
    const own = by.get(a.id)?.pnl ?? 0
    pnl += own
    const key = a.broker?.trim() || "Other"
    const b = brokers.get(key) ?? { broker: key, pnl: 0, accounts: 0 }
    b.pnl += own
    b.accounts += 1
    brokers.set(key, b)
  }
  return { pnl, breakdown: [...brokers.values()].sort((x, y) => y.pnl - x.pnl), currency, accountCount: accounts.length }
}

export async function copyPnlCard(userId: string, groupId: number, timeZone: string): Promise<PnlCertificateData> {
  const [group] = await db.select({ leader: copyGroups.leaderAccountId }).from(copyGroups).where(and(eq(copyGroups.id, groupId), eq(copyGroups.userId, userId))).limit(1)
  if (!group) throw new Error("That group no longer exists.")
  const today = localDay(new Date(), timeZone)
  const week = resolvePnlPeriod("weekly", today)
  // a day's margin either side of the week for the time zone; the grouping below keeps to the days themselves
  const from = new Date(new Date(`${week.start}T00:00:00Z`).getTime() - 2 * 86_400_000)
  const [followers, accounts, rows, [me], pro] = await Promise.all([
    db.select({ accountId: copyGroupFollowers.accountId }).from(copyGroupFollowers).where(eq(copyGroupFollowers.groupId, groupId)).orderBy(copyGroupFollowers.position, copyGroupFollowers.id),
    db.select({ id: tradingAccounts.id, name: tradingAccounts.name, currency: tradingAccounts.currency, startingBalance: tradingAccounts.startingBalance, broker: tradingAccounts.broker, archived: tradingAccounts.archived }).from(tradingAccounts).where(eq(tradingAccounts.userId, userId)),
    db
      .select({ accountId: trades.accountId, status: trades.status, pnl: trades.pnl, exitTime: trades.exitTime, entryTime: trades.entryTime })
      .from(trades)
      .where(and(eq(trades.userId, userId), eq(trades.status, "closed"), or(gte(trades.exitTime, from), and(isNull(trades.exitTime), gte(trades.entryTime, from))))),
    db.select({ name: user.name, image: user.image }).from(user).where(eq(user.id, userId)).limit(1),
    isPro(userId),
  ])
  const daily = computeAccountPnlInRange(rows, today, today, timeZone)
  const weekly = computeAccountPnlInRange(rows, week.start, week.end, timeZone)

  // the group's accounts that are the trader's own, the Leader first
  const wanted = [group.leader, ...followers.map((f) => f.accountId)]
  const mine = wanted.flatMap((id) => accounts.filter((a) => a.id === id && !a.archived))
  const row = (by: Map<number, DailyAccountPnl>) => (a: (typeof accounts)[number]): DailyAccountRow => {
    const p = by.get(a.id)
    return { id: a.id, name: a.name, currency: a.currency, startingBalance: Number(a.startingBalance), pnl: p?.pnl ?? 0, trades: p?.trades ?? 0, wins: p?.wins ?? 0, losses: p?.losses ?? 0 }
  }
  const currency = accounts[0]?.currency ?? "USD"
  return {
    accounts: mine.map(row(daily)),
    weeklyAccounts: mine.map(row(weekly)),
    allAccounts: sum(accounts, daily, currency),
    allAccountsWeekly: sum(accounts, weekly, currency),
    date: today,
    traderName: me?.name ?? "Trader",
    traderImage: me?.image ?? null,
    isPro: pro,
  }
}
