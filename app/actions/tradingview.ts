"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { tradingviewConnections, tradingviewFills, tradingAccounts } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { randomBytes } from "node:crypto"
import { requirePro } from "@/lib/subscription"
import { isPro } from "@/lib/subscription"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

export interface TradingViewConnectionView {
  id: number
  name: string
  market: string
  accountId: number
  webhookUrl: string
  lastEventAt: Date | null
  lastStatus: string | null
  lastError: string | null
  eventCount: number
  tradeCount: number
}

// The origin TradingView should post to. In production this is the app's own
// URL; the preview/local fallbacks mirror app/p/[token]/page.tsx. A webhook
// on a preview deployment only reaches that deployment, which is the point —
// the URL is minted per environment.
function resolveBaseUrl(): string {
  return (
    process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000")
  )
}

function toView(row: typeof tradingviewConnections.$inferSelect): TradingViewConnectionView {
  return {
    id: row.id,
    name: row.name,
    market: row.market,
    accountId: row.accountId,
    webhookUrl: `${resolveBaseUrl()}/api/tradingview/${row.webhookToken}`,
    lastEventAt: row.lastEventAt,
    lastStatus: row.lastStatus,
    lastError: row.lastError,
    eventCount: row.eventCount,
    tradeCount: row.tradeCount,
  }
}

export async function getTradingViewConnections(): Promise<TradingViewConnectionView[]> {
  const userId = await getUserId()
  const rows = await db
    .select()
    .from(tradingviewConnections)
    .where(eq(tradingviewConnections.userId, userId))
    .orderBy(tradingviewConnections.createdAt)
  return rows.map(toView)
}

// Mints the webhook URL and the trading account its fills land in. Nothing
// is asked of TradingView here — the trader pastes the URL into an alert
// themselves, which is the only way into a paper account they have.
export async function connectTradingView(formData: FormData): Promise<void> {
  const userId = await getUserId()
  await requirePro(userId, "Live broker & prop firm sync")

  const nameRaw = String(formData.get("name") ?? "").trim()
  const name = nameRaw !== "" ? nameRaw : "TradingView Paper"
  const marketRaw = String(formData.get("market") ?? "stocks")
  const market = ["futures", "stocks", "options", "future_option", "forex", "crypto", "cfd"].includes(marketRaw) ? marketRaw : "stocks"
  const startingBalanceRaw = formData.get("startingBalance")
  const startingBalance = startingBalanceRaw != null && String(startingBalanceRaw).trim() !== "" ? Number(startingBalanceRaw) : 0

  // Same Essential-plan cap as createAccount — this creates a trading
  // account too, so it respects the same limit.
  if (!(await isPro(userId))) {
    const existing = await db.select({ id: tradingAccounts.id }).from(tradingAccounts).where(eq(tradingAccounts.userId, userId))
    if (existing.length >= 1) {
      throw new Error("You've reached the maximum number of accounts for your plan (1) — upgrade to Pro at /pricing to connect more.")
    }
  }

  // Reconnecting under a name already used here reuses that account rather
  // than splitting one paper account's history across two.
  const [existingAccount] = await db
    .select()
    .from(tradingAccounts)
    .where(and(eq(tradingAccounts.userId, userId), eq(tradingAccounts.name, name)))
  const accountId =
    existingAccount?.id ??
    (
      await db
        .insert(tradingAccounts)
        .values({
          userId,
          name,
          broker: "TradingView",
          startingBalance: String(Number.isFinite(startingBalance) && startingBalance > 0 ? startingBalance : 0),
          currency: "USD",
        })
        .returning({ id: tradingAccounts.id })
    )[0].id

  await db.insert(tradingviewConnections).values({
    userId,
    accountId,
    name,
    market,
    webhookToken: randomBytes(32).toString("hex"),
  })

  revalidatePath("/add-trade")
  revalidatePath("/settings")
}

// Rolls the URL without touching the account or its trades — for a webhook
// address that ended up somewhere it shouldn't have.
export async function regenerateTradingViewWebhook(connectionId: number): Promise<void> {
  const userId = await getUserId()
  await db
    .update(tradingviewConnections)
    .set({ webhookToken: randomBytes(32).toString("hex"), lastStatus: null, lastError: null })
    .where(and(eq(tradingviewConnections.id, connectionId), eq(tradingviewConnections.userId, userId)))
  revalidatePath("/add-trade")
}

// Stops the webhook and forgets the raw fills. Trades already journaled stay
// — they're the trader's record, not the connection's.
export async function disconnectTradingView(connectionId: number): Promise<void> {
  const userId = await getUserId()
  const [connection] = await db
    .select()
    .from(tradingviewConnections)
    .where(and(eq(tradingviewConnections.id, connectionId), eq(tradingviewConnections.userId, userId)))
  if (!connection) return
  await db.delete(tradingviewFills).where(eq(tradingviewFills.connectionId, connection.id))
  await db.delete(tradingviewConnections).where(eq(tradingviewConnections.id, connection.id))
  revalidatePath("/add-trade")
  revalidatePath("/settings")
}
