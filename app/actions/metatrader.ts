"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { metatraderConnections, metatraderDeals } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { encrypt } from "@/lib/crypto"
import { isPro } from "@/lib/subscription"

// MetaTrader accounts are synced by our own MT5 terminals on the sync VPS
// (worker/mt5): these actions only record what the user asked for — the
// worker picks a "pending" row up within seconds, logs in with the investor
// password, and reports back on the same row, which the UI polls.

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

export type MetaTraderConnectionView = {
  id: number
  login: string
  server: string
  platform: string
  status: string // pending | connected | error
  statusMessage: string | null
  brokerName: string | null
  currency: string | null
  balance: number | null
  equity: number | null
  openPositions: number | null
  accountId: number | null
  lastSyncedAt: Date | null
  lastSyncStatus: string | null
  lastSyncError: string | null
  lastSyncCount: number | null
}

function view(row: typeof metatraderConnections.$inferSelect): MetaTraderConnectionView {
  return {
    id: row.id,
    login: row.login,
    server: row.server,
    platform: row.platform,
    status: row.status,
    statusMessage: row.statusMessage,
    brokerName: row.brokerName,
    currency: row.currency,
    balance: row.balance == null ? null : Number(row.balance),
    equity: row.equity == null ? null : Number(row.equity),
    openPositions: row.openPositions,
    accountId: row.accountId,
    lastSyncedAt: row.lastSyncedAt,
    lastSyncStatus: row.lastSyncStatus,
    lastSyncError: row.lastSyncError,
    lastSyncCount: row.lastSyncCount,
  }
}

// A user can connect several MetaTrader accounts; every lookup is scoped by
// the connection's id and the user, so one never touches another.
export async function getMetaTraderConnections(): Promise<MetaTraderConnectionView[]> {
  const userId = await getUserId()
  const rows = await db
    .select()
    .from(metatraderConnections)
    .where(eq(metatraderConnections.userId, userId))
    .orderBy(metatraderConnections.createdAt)
  return rows.map(view)
}

export async function getMetaTraderConnection(connectionId: number): Promise<MetaTraderConnectionView | null> {
  const userId = await getUserId()
  const [row] = await db
    .select()
    .from(metatraderConnections)
    .where(and(eq(metatraderConnections.id, connectionId), eq(metatraderConnections.userId, userId)))
  return row ? view(row) : null
}

const HISTORY_DAYS: Record<string, number | null> = { "30d": 30, "90d": 90, "1y": 365, all: null }

export async function connectMetaTrader(formData: FormData): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const userId = await getUserId()
  if (!(await isPro(userId))) {
    return { ok: false, error: "Live broker & prop firm sync is a Pro feature — upgrade at /pricing to unlock it." }
  }
  const login = String(formData.get("login") ?? "").trim()
  const investorPassword = String(formData.get("investorPassword") ?? "")
  const server = String(formData.get("server") ?? "").trim()
  const platform = String(formData.get("platform") ?? "mt5") === "mt4" ? "mt4" : "mt5"
  const range = String(formData.get("history") ?? "all")

  if (platform === "mt4") return { ok: false, error: "MT4 auto-sync is coming soon — connect an MT5 account, or upload your MT4 statement for now." }
  if (!/^\d{3,15}$/.test(login)) return { ok: false, error: "Enter your MT5 account number (digits only)." }
  if (!investorPassword) return { ok: false, error: "Enter your investor (read-only) password." }
  if (!server) return { ok: false, error: "Enter your broker's server name, exactly as it appears in MT5." }

  const days = range in HISTORY_DAYS ? HISTORY_DAYS[range] : null
  const historyFrom = days == null ? null : new Date(Date.now() - days * 86_400_000)
  const passwordEnc = encrypt(investorPassword)
  const now = new Date()

  // Reconnecting the same login+server (a changed investor password, say)
  // updates that connection instead of adding a second one.
  const [existing] = await db
    .select({ id: metatraderConnections.id })
    .from(metatraderConnections)
    .where(and(eq(metatraderConnections.userId, userId), eq(metatraderConnections.login, login), eq(metatraderConnections.server, server)))

  let id: number
  const request = { passwordEnc, status: "pending", statusMessage: null, errorCount: 0, nextSyncAt: now, leaseUntil: null }
  if (existing) {
    id = existing.id
    await db.update(metatraderConnections).set(request).where(eq(metatraderConnections.id, id))
  } else {
    ;[{ id }] = await db
      .insert(metatraderConnections)
      .values({ ...request, userId, login, server, platform, historyFrom })
      .returning({ id: metatraderConnections.id })
  }
  revalidatePath("/add-trade")
  return { ok: true, id }
}

// "Sync now": makes the account due immediately; the worker picks it up
// within a couple of seconds and the card's polling shows the result.
export async function syncMetaTraderNow(connectionId: number): Promise<{ ok: boolean }> {
  const userId = await getUserId()
  await db
    .update(metatraderConnections)
    .set({ nextSyncAt: new Date() })
    .where(and(eq(metatraderConnections.id, connectionId), eq(metatraderConnections.userId, userId), eq(metatraderConnections.status, "connected")))
  return { ok: true }
}

// Stops syncing and forgets the password and raw deals. The trading account
// and its trades stay, like every other broker disconnect.
export async function disconnectMetaTrader(connectionId: number): Promise<{ ok: boolean }> {
  const userId = await getUserId()
  const [row] = await db
    .delete(metatraderConnections)
    .where(and(eq(metatraderConnections.id, connectionId), eq(metatraderConnections.userId, userId)))
    .returning({ id: metatraderConnections.id })
  if (row) await db.delete(metatraderDeals).where(eq(metatraderDeals.connectionId, row.id))
  revalidatePath("/add-trade")
  revalidatePath("/settings")
  return { ok: true }
}
