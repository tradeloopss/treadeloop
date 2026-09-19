"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { tradingviewConnections, tradingviewFills, tradingAccounts, trades } from "@/lib/db/schema"
import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { randomBytes } from "node:crypto"
import { requirePro } from "@/lib/subscription"
import { isPro } from "@/lib/subscription"
import { parseTradingViewCsv } from "@/lib/tradingview-csv"
import { reconstructTrades as reconstructFills } from "@/lib/fill-reconstruction"
import { TRADINGVIEW_DEFAULT_ACCOUNT } from "@/lib/trade-importer"
import { computePnl, contractMultiplierForSymbol, type Market } from "@/lib/calc"
import { regenerateJournalForDay } from "@/app/actions/trades"

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

export interface PasteImportResult {
  imported: number
  duplicates: number
  skippedRows: number
  accountName: string
}

// Imports the paper-trading history a trader copied out of TradingView.
//
// This is the route that works on a free TradingView plan, where every
// automatic one is shut: webhooks and strategy alerts are paid, and so is
// the Trading Panel's own Export data… button. What's left is the rows on
// screen, so they copy them (lib/tradingview-export-snippet.ts) and paste
// them here. Tab-separated from the clipboard or comma-separated from a paid
// export both parse the same way.
//
// Re-pasting an overlapping range is safe: fills rebuild into the same
// trades with the same ids, and ones already journaled are skipped.
export async function importTradingViewPaste(pasted: string, accountId: number | null): Promise<PasteImportResult> {
  const userId = await getUserId()

  const text = pasted.trim()
  if (text.length < 20) throw new Error("Paste the rows copied from TradingView's History tab first.")

  const account = accountId != null ? await ownedAccount(userId, accountId) : await defaultTradingViewAccount(userId)
  const parsed = parseTradingViewCsv(text, account.name)
  if (parsed.fills.length === 0) {
    throw new Error(
      "No filled trades in what was pasted — copy the History tab's Filled rows, with their column headings included.",
    )
  }

  const imported = reconstructFills(parsed.fills, "tradingview-csv")
  if (imported.length === 0) {
    throw new Error("Those rows only open positions — a trade is journaled once its closing fill is in the history too.")
  }

  const existing = await db
    .select({ externalId: trades.externalId })
    .from(trades)
    .where(
      and(
        eq(trades.userId, userId),
        isNotNull(trades.externalId),
        inArray(
          trades.externalId,
          imported.map((t) => t.externalId),
        ),
      ),
    )
  const seen = new Set(existing.map((r) => r.externalId))
  const toImport = imported.filter((t) => !seen.has(t.externalId))

  const market = (account.market ?? "stocks") as Market
  const affectedDays = new Set<string>()
  for (const t of toImport) {
    const contractMultiplier = market === "futures" || market === "future_option" ? contractMultiplierForSymbol(t.symbol) : 1
    const pnl = t.pnl ?? computePnl({ side: t.side, quantity: t.quantity, entryPrice: t.entryPrice, exitPrice: t.exitPrice, fees: t.fees, contractMultiplier })
    await db.insert(trades).values({
      userId,
      accountId: account.id,
      symbol: t.symbol,
      market,
      side: t.side,
      status: "closed",
      quantity: String(t.quantity),
      entryPrice: String(t.entryPrice),
      exitPrice: String(t.exitPrice),
      fees: String(t.fees),
      pnl: String(pnl),
      contractMultiplier: String(contractMultiplier),
      entryTime: new Date(t.entryTime),
      exitTime: new Date(t.exitTime),
      externalId: t.externalId,
    })
    affectedDays.add(t.exitTime.slice(0, 10))
  }

  for (const day of affectedDays) {
    await regenerateJournalForDay(userId, day)
  }

  revalidatePath("/add-trade")
  revalidatePath("/trades")
  revalidatePath("/dashboard")
  revalidatePath("/journal")

  return {
    imported: toImport.length,
    duplicates: imported.length - toImport.length,
    skippedRows: parsed.skippedRows,
    accountName: account.name,
  }
}

// The account pasted rows land in, and the market that decides their
// contract multiplier. A TradingView connection's own account is preferred
// so the webhook and the paste agree; otherwise the account an upload would
// have created.
async function defaultTradingViewAccount(userId: string): Promise<{ id: number; name: string; market: string | null }> {
  const [connected] = await db
    .select({ id: tradingAccounts.id, name: tradingAccounts.name, market: tradingviewConnections.market })
    .from(tradingviewConnections)
    .innerJoin(tradingAccounts, eq(tradingAccounts.id, tradingviewConnections.accountId))
    .where(eq(tradingviewConnections.userId, userId))
  if (connected) return connected

  const [existing] = await db
    .select({ id: tradingAccounts.id, name: tradingAccounts.name })
    .from(tradingAccounts)
    .where(and(eq(tradingAccounts.userId, userId), eq(tradingAccounts.name, TRADINGVIEW_DEFAULT_ACCOUNT)))
  if (existing) return { ...existing, market: null }

  if (!(await isPro(userId))) {
    const owned = await db.select({ id: tradingAccounts.id }).from(tradingAccounts).where(eq(tradingAccounts.userId, userId))
    if (owned.length >= 1) {
      throw new Error("You've reached the maximum number of accounts for your plan (1) — upgrade to Pro at /pricing to connect more.")
    }
  }

  const [created] = await db
    .insert(tradingAccounts)
    .values({ userId, name: TRADINGVIEW_DEFAULT_ACCOUNT, broker: "TradingView", currency: "USD" })
    .returning({ id: tradingAccounts.id, name: tradingAccounts.name })
  return { ...created, market: null }
}

async function ownedAccount(userId: string, accountId: number): Promise<{ id: number; name: string; market: string | null }> {
  const [account] = await db
    .select({ id: tradingAccounts.id, name: tradingAccounts.name })
    .from(tradingAccounts)
    .where(and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.userId, userId)))
  if (!account) throw new Error("Account not found")
  const [connection] = await db
    .select({ market: tradingviewConnections.market })
    .from(tradingviewConnections)
    .where(and(eq(tradingviewConnections.userId, userId), eq(tradingviewConnections.accountId, accountId)))
  return { ...account, market: connection?.market ?? null }
}
