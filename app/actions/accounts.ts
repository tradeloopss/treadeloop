"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { tradingAccounts, trades, metatraderConnections, rithmicConnections, propFirmRules } from "@/lib/db/schema"
import { and, desc, eq } from "drizzle-orm"
import { headers, cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { isPro } from "@/lib/subscription"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

const ACTIVE_ACCOUNTS_COOKIE = "activeAccountIds"

// The account customizer persists its selection in a cookie so every page's
// data fetch (trades, journal, calendar, reports) can filter by it without
// threading the selection through props on every route. null/empty means
// "all accounts" — no filter applied.
export async function getActiveAccountIds(): Promise<number[] | null> {
  const store = await cookies()
  const raw = store.get(ACTIVE_ACCOUNTS_COOKIE)?.value
  if (!raw) return null
  const ids = raw
    .split(",")
    .map(Number)
    .filter((n) => Number.isFinite(n))
  return ids.length > 0 ? ids : null
}

export async function setActiveAccounts(accountIds: number[] | null) {
  await getUserId()
  const store = await cookies()
  if (!accountIds || accountIds.length === 0) {
    store.delete(ACTIVE_ACCOUNTS_COOKIE)
  } else {
    store.set(ACTIVE_ACCOUNTS_COOKIE, accountIds.join(","), { path: "/", maxAge: 60 * 60 * 24 * 365 })
  }
  revalidatePath("/dashboard")
  revalidatePath("/trades")
  revalidatePath("/journal")
  revalidatePath("/calendar")
  revalidatePath("/reports")
  revalidatePath("/playbooks")
}

export async function getAccounts() {
  const userId = await getUserId()
  const [rows, mtRows, rithmicRows] = await Promise.all([
    db.select().from(tradingAccounts).where(eq(tradingAccounts.userId, userId)).orderBy(desc(tradingAccounts.createdAt)),
    db
      .select({ accountId: metatraderConnections.accountId, lastSyncedAt: metatraderConnections.lastSyncedAt, lastSyncStatus: metatraderConnections.lastSyncStatus })
      .from(metatraderConnections)
      .where(eq(metatraderConnections.userId, userId)),
    db
      .select({ accountId: rithmicConnections.accountId, lastSyncedAt: rithmicConnections.lastSyncedAt, lastSyncStatus: rithmicConnections.lastSyncStatus })
      .from(rithmicConnections)
      .where(eq(rithmicConnections.userId, userId)),
  ])

  const syncByAccountId = new Map<number, { lastSyncedAt: Date | null; lastSyncStatus: string | null }>()
  for (const r of [...mtRows, ...rithmicRows]) {
    if (r.accountId != null) syncByAccountId.set(r.accountId, { lastSyncedAt: r.lastSyncedAt, lastSyncStatus: r.lastSyncStatus })
  }

  return rows.map((a) => {
    const sync = syncByAccountId.get(a.id)
    return {
      ...a,
      isLiveSynced: sync != null,
      lastSyncedAt: sync?.lastSyncedAt ?? null,
      lastSyncStatus: sync?.lastSyncStatus ?? null,
    }
  })
}

export async function getAccount(id: number) {
  const accounts = await getAccounts()
  return accounts.find((a) => a.id === id) ?? null
}

// Accounts whose trades have to come from the broker/prop firm itself —
// either a live-synced connection or an imported file — never hand-entered.
// A manual row on one of these silently diverges from the firm's own record
// and corrupts prop-firm pass/breach math, so manual entry is blocked in the
// UI and re-checked in createTrade (see app/actions/trades.ts).
export async function getManualEntryLockedAccountIds(): Promise<number[]> {
  const userId = await getUserId()
  const [rithmicRows, mtRows, ruleRows] = await Promise.all([
    db.select({ accountId: rithmicConnections.accountId }).from(rithmicConnections).where(eq(rithmicConnections.userId, userId)),
    db.select({ accountId: metatraderConnections.accountId }).from(metatraderConnections).where(eq(metatraderConnections.userId, userId)),
    db.select({ accountId: propFirmRules.accountId }).from(propFirmRules).where(eq(propFirmRules.userId, userId)),
  ])
  const ids = new Set<number>()
  for (const r of [...rithmicRows, ...mtRows]) if (r.accountId != null) ids.add(r.accountId)
  for (const r of ruleRows) ids.add(r.accountId)
  return [...ids]
}

export async function createAccount(formData: FormData) {
  const userId = await getUserId()

  // Essential is capped at 1 account; existing accounts beyond that (from
  // before this limit existed) are grandfathered in, only new ones are blocked.
  if (!(await isPro(userId))) {
    const existing = await db.select({ id: tradingAccounts.id }).from(tradingAccounts).where(eq(tradingAccounts.userId, userId))
    if (existing.length >= 1) {
      throw new Error("You've reached the maximum number of accounts for your plan (1) — upgrade to Pro at /pricing to connect more.")
    }
  }

  await db.insert(tradingAccounts).values({
    userId,
    name: String(formData.get("name") ?? "New Account"),
    broker: formData.get("broker") ? String(formData.get("broker")) : null,
    startingBalance: String(Number(formData.get("startingBalance") ?? 0)),
    currency: String(formData.get("currency") ?? "USD"),
  })
  revalidatePath("/dashboard")
  revalidatePath("/trades")
  revalidatePath("/settings")
}

export async function deleteAccount(id: number) {
  const userId = await getUserId()
  // Unlink instead of blocking the delete — trades stay, just without an account tag.
  await db
    .update(trades)
    .set({ accountId: null })
    .where(and(eq(trades.accountId, id), eq(trades.userId, userId)))
  await db.delete(tradingAccounts).where(and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, userId)))
  revalidatePath("/dashboard")
  revalidatePath("/trades")
  revalidatePath("/settings")
}
