"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { payoutShares, propFirmTransactions, propFirmRules, tradingAccounts, user } from "@/lib/db/schema"
import { and, eq, gte, lte } from "drizzle-orm"
import { headers } from "next/headers"
import { randomBytes } from "node:crypto"
import { isPro } from "@/lib/subscription"
import { resolvePeriod, type PayoutLine, type PayoutPeriod, type PayoutSummary } from "@/lib/payout-period"
import { getLocale } from "@/lib/i18n/server"
import { intlLocale } from "@/lib/i18n"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

// Shared by the owner's page and the public share page. `anchor` is any day
// inside the window being reported on — resolvePeriod widens it to the full
// month or the right half-month, so a stored period start rebuilds the exact
// same window later.
async function buildPayoutSummary(userId: string, period: PayoutPeriod, anchor?: Date): Promise<PayoutSummary> {
  const { start, end, label } = resolvePeriod(period, anchor, intlLocale(await getLocale()))

  const [rows, accounts, ruleRows, trader] = await Promise.all([
    db
      .select({ accountId: propFirmTransactions.accountId, amount: propFirmTransactions.amount })
      .from(propFirmTransactions)
      .where(
        and(
          eq(propFirmTransactions.userId, userId),
          eq(propFirmTransactions.type, "payout"),
          gte(propFirmTransactions.occurredAt, start),
          lte(propFirmTransactions.occurredAt, end)
        )
      ),
    db.select({ id: tradingAccounts.id, name: tradingAccounts.name, currency: tradingAccounts.currency }).from(tradingAccounts).where(eq(tradingAccounts.userId, userId)),
    db.select({ accountId: propFirmRules.accountId, firmName: propFirmRules.firmName }).from(propFirmRules).where(eq(propFirmRules.userId, userId)),
    db.select({ name: user.name, image: user.image }).from(user).where(eq(user.id, userId)).then((r) => r[0] ?? null),
  ])

  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const firmByAccountId = new Map(ruleRows.map((r) => [r.accountId, r.firmName]))

  const byAccount = new Map<number, PayoutLine>()
  let total = 0
  for (const row of rows) {
    const amount = Number(row.amount)
    total += amount
    const existing = byAccount.get(row.accountId) ?? {
      accountId: row.accountId,
      accountName: accountById.get(row.accountId)?.name ?? "Unknown account",
      firmName: firmByAccountId.get(row.accountId) ?? null,
      amount: 0,
      count: 0,
    }
    existing.amount += amount
    existing.count += 1
    byAccount.set(row.accountId, existing)
  }

  return {
    period,
    periodLabel: label,
    start: start.toISOString(),
    end: end.toISOString(),
    total,
    currency: accounts[0]?.currency ?? "USD",
    accountCount: byAccount.size,
    lines: [...byAccount.values()].sort((a, b) => b.amount - a.amount),
    traderName: trader?.name ?? "Trader",
    traderImage: trader?.image ?? null,
  }
}

export async function getPayoutSummary(period: PayoutPeriod): Promise<PayoutSummary> {
  return buildPayoutSummary(await getUserId(), period)
}

// Turns on (or rotates) the public link for a payout window. Only called when
// the trader explicitly asks for a share link — a payout certificate isn't
// published just because the page rendered.
export async function sharePayout(period: PayoutPeriod): Promise<string> {
  const userId = await getUserId()
  const { start } = resolvePeriod(period)
  const periodStart = start.toISOString().slice(0, 10)

  const token = randomBytes(12).toString("hex")
  const [existing] = await db
    .select({ id: payoutShares.id })
    .from(payoutShares)
    .where(and(eq(payoutShares.userId, userId), eq(payoutShares.period, period), eq(payoutShares.periodStart, periodStart)))

  if (existing) {
    await db.update(payoutShares).set({ token }).where(eq(payoutShares.id, existing.id))
  } else {
    await db.insert(payoutShares).values({ userId, period, periodStart, token })
  }
  return token
}

export interface SharedPayout extends PayoutSummary {
  traderIsPro: boolean
}

// Public lookup by share token — recomputed live at view time, so a payout
// logged or corrected after sharing is reflected immediately.
export async function getSharedPayout(token: string): Promise<SharedPayout | null> {
  const [share] = await db.select().from(payoutShares).where(eq(payoutShares.token, token))
  if (!share) return null

  const period: PayoutPeriod = share.period === "biweekly" ? "biweekly" : "monthly"
  const anchor = new Date(`${share.periodStart}T12:00:00Z`)
  const [summary, traderIsPro] = await Promise.all([
    buildPayoutSummary(share.userId, period, anchor),
    isPro(share.userId),
  ])
  return { ...summary, traderIsPro }
}
