"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { metatraderConnections, tradingAccounts, trades } from "@/lib/db/schema"
import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { encrypt, decrypt } from "@/lib/crypto"
import { provisionAccount, fetchAccountSnapshot, searchServers, type MtPlatform, type BrokerServer } from "@/lib/metaapi-client"
import { computePnl } from "@/lib/calc"
import { regenerateJournalForDay } from "@/app/actions/trades"
import { requirePro } from "@/lib/subscription"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

export async function searchMetaTraderServers(query: string, platform: MtPlatform): Promise<BrokerServer[]> {
  await getUserId()
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const token = process.env.METAAPI_TOKEN
  if (!token) throw new Error("MetaTrader connections aren't configured on this server yet (missing METAAPI_TOKEN)")

  return searchServers(token, trimmed, platform)
}

// A user can connect multiple MetaTrader accounts (e.g. a live and a demo,
// or several prop-firm accounts) — every lookup here is scoped by the
// connection's own id, not just userId, so one connect/sync/disconnect never
// clobbers another.
export async function getMetaTraderConnections() {
  const userId = await getUserId()
  const rows = await db
    .select()
    .from(metatraderConnections)
    .where(eq(metatraderConnections.userId, userId))
    .orderBy(metatraderConnections.createdAt)
  return rows.map((row) => ({
    id: row.id,
    login: row.login,
    server: row.server,
    platform: row.platform,
    tokenExpiresAt: row.tokenExpiresAt,
    lastSyncedAt: row.lastSyncedAt,
    lastSyncStatus: row.lastSyncStatus,
    lastSyncError: row.lastSyncError,
    lastSyncCount: row.lastSyncCount,
  }))
}

export async function connectMetaTrader(formData: FormData) {
  const userId = await getUserId()
  await requirePro(userId, "Live broker & prop firm sync")
  const login = String(formData.get("login") ?? "").trim()
  const investorPassword = String(formData.get("investorPassword") ?? "").trim()
  const server = String(formData.get("server") ?? "").trim()
  const platform = (String(formData.get("platform") ?? "mt5") === "mt4" ? "mt4" : "mt5") as MtPlatform

  if (!login || !investorPassword || !server) {
    throw new Error("All fields are required")
  }

  // The MetaApi admin token lives server-side only — never asked for in the UI.
  const token = process.env.METAAPI_TOKEN
  if (!token) {
    throw new Error("MetaTrader connections aren't configured on this server yet (missing METAAPI_TOKEN)")
  }

  const accountName = `MetaTrader ${login}`
  // The token passed in only needs to be capable of creating the account;
  // provisionAccount immediately narrows it to a read-only token scoped to
  // just this account and hands that back — that's the only thing stored below.
  const { accountId: metaApiAccountId, readOnlyToken, tokenValidityHours } = await provisionAccount(token, {
    name: accountName,
    login,
    investorPassword,
    server,
    platform,
  })

  // Mirror as a trading_accounts row so trades link to something in this app.
  const existingAccount = await db
    .select()
    .from(tradingAccounts)
    .where(and(eq(tradingAccounts.userId, userId), eq(tradingAccounts.name, accountName)))
  const accountId = existingAccount.length
    ? existingAccount[0].id
    : (
        await db
          .insert(tradingAccounts)
          .values({ userId, name: accountName, broker: platform === "mt4" ? "MetaTrader 4" : "MetaTrader 5" })
          .returning({ id: tradingAccounts.id })
      )[0].id

  const tokenEnc = encrypt(readOnlyToken)
  const tokenExpiresAt = new Date(Date.now() + tokenValidityHours * 60 * 60 * 1000)

  // Reconnecting the same login+server refreshes that connection instead of
  // creating a duplicate; a different login/server always adds a new one.
  const existingConnection = await db
    .select()
    .from(metatraderConnections)
    .where(
      and(
        eq(metatraderConnections.userId, userId),
        eq(metatraderConnections.login, login),
        eq(metatraderConnections.server, server)
      )
    )

  let connectionId: number
  if (existingConnection.length) {
    connectionId = existingConnection[0].id
    await db
      .update(metatraderConnections)
      .set({ accountId, metaApiAccountId, tokenEnc, tokenExpiresAt, platform, lastSyncStatus: null, lastSyncError: null })
      .where(eq(metatraderConnections.id, connectionId))
  } else {
    const [inserted] = await db
      .insert(metatraderConnections)
      .values({ userId, accountId, metaApiAccountId, tokenEnc, tokenExpiresAt, login, server, platform })
      .returning({ id: metatraderConnections.id })
    connectionId = inserted.id
  }

  // Pull the account's current balance and trade history right away, rather
  // than leaving the account at its default $0 balance until a manual sync.
  await syncMetaTrader(connectionId).catch(() => {})

  revalidatePath("/settings")
}

export async function disconnectMetaTrader(connectionId: number) {
  const userId = await getUserId()
  await db
    .delete(metatraderConnections)
    .where(and(eq(metatraderConnections.id, connectionId), eq(metatraderConnections.userId, userId)))
  revalidatePath("/settings")
}

export async function syncMetaTrader(connectionId: number) {
  const userId = await getUserId()
  const [connection] = await db
    .select()
    .from(metatraderConnections)
    .where(and(eq(metatraderConnections.id, connectionId), eq(metatraderConnections.userId, userId)))
  if (!connection) throw new Error("Connection not found")
  if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() < Date.now()) {
    throw new Error("Your MetaTrader connection has expired — reconnect to keep syncing")
  }

  try {
    const token = decrypt(connection.tokenEnc)
    const from = connection.lastSyncFrom ?? new Date(0)
    const to = new Date()

    const snapshot = await fetchAccountSnapshot(token, connection.metaApiAccountId, connection.login, from, to)
    const imported = snapshot.trades

    if (connection.accountId) {
      await db
        .update(tradingAccounts)
        .set({ currentBalance: String(snapshot.balance), currency: snapshot.currency })
        .where(eq(tradingAccounts.id, connection.accountId))
    }

    const existingIds = imported.length
      ? await db
          .select({ externalId: trades.externalId })
          .from(trades)
          .where(
            and(
              eq(trades.userId, userId),
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

    const affectedDays = new Set<string>()
    for (const t of toImport) {
      const pnl = t.pnl ?? computePnl({ side: t.side, quantity: t.quantity, entryPrice: t.entryPrice, exitPrice: t.exitPrice, fees: t.fees, contractMultiplier: 1 })
      await db.insert(trades).values({
        userId,
        accountId: connection.accountId,
        symbol: t.symbol,
        market: "forex",
        side: t.side,
        status: "closed",
        quantity: String(t.quantity),
        entryPrice: String(t.entryPrice),
        exitPrice: String(t.exitPrice),
        fees: String(t.fees),
        pnl: String(pnl),
        contractMultiplier: "1",
        entryTime: new Date(t.entryTime),
        exitTime: new Date(t.exitTime),
        externalId: t.externalId,
      })
      affectedDays.add(t.exitTime.slice(0, 10))
    }

    for (const day of affectedDays) {
      await regenerateJournalForDay(userId, day)
    }

    await db
      .update(metatraderConnections)
      .set({ lastSyncFrom: to, lastSyncedAt: to, lastSyncStatus: "ok", lastSyncError: null, lastSyncCount: toImport.length })
      .where(eq(metatraderConnections.id, connectionId))

    revalidatePath("/dashboard")
    revalidatePath("/trades")
    revalidatePath("/journal")
    revalidatePath("/calendar")
    revalidatePath("/reports")
    revalidatePath("/settings")

    return { imported: toImport.length }
  } catch (err) {
    await db
      .update(metatraderConnections)
      .set({ lastSyncStatus: "error", lastSyncError: err instanceof Error ? err.message : "Sync failed" })
      .where(eq(metatraderConnections.id, connectionId))
    throw err
  }
}
