"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { tradingAccounts, trades, metatraderConnections, rithmicConnections, propFirmRules } from "@/lib/db/schema"
import { and, desc, eq } from "drizzle-orm"
import { headers, cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { isPro } from "@/lib/subscription"
import { repriceAccountTrades } from "@/lib/trade-commission"

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

export async function getAccounts(includeArchived = false) {
  const userId = await getUserId()
  const [rows, mtRows, rithmicRows] = await Promise.all([
    db
      .select()
      .from(tradingAccounts)
      .where(includeArchived ? eq(tradingAccounts.userId, userId) : and(eq(tradingAccounts.userId, userId), eq(tradingAccounts.archived, false)))
      .orderBy(desc(tradingAccounts.createdAt)),
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
  const rithmicByAccount = new Set(rithmicRows.map((r) => r.accountId).filter((id): id is number => id != null))

  return rows.map((a) => {
    const sync = syncByAccountId.get(a.id)
    return {
      ...a,
      isLiveSynced: sync != null,
      canSync: rithmicByAccount.has(a.id),
      lastSyncedAt: sync?.lastSyncedAt ?? null,
      lastSyncStatus: sync?.lastSyncStatus ?? null,
    }
  })
}

// Edit an account's own details. Broker-linked accounts keep their trades
// from the broker, so only the label/size are editable here.
export async function updateAccount(
  id: number,
  data: { name?: string; broker?: string | null; startingBalance?: number; currency?: string; commissionPerContract?: number | null },
) {
  const userId = await getUserId()
  const patch: Partial<typeof tradingAccounts.$inferInsert> = {}
  if (data.name != null && data.name.trim() !== "") patch.name = data.name.trim()
  if (data.broker !== undefined) patch.broker = data.broker && data.broker.trim() !== "" ? data.broker.trim() : null
  if (data.currency != null && data.currency.trim() !== "") patch.currency = data.currency.trim().toUpperCase().slice(0, 3)
  if (data.startingBalance != null && Number.isFinite(data.startingBalance)) {
    // A hand-set size is authoritative — stop the inference from overwriting it.
    patch.startingBalance = String(data.startingBalance)
    patch.startingBalanceInferred = false
  }
  // A hand-set round-turn commission per contract re-prices every trade on the
  // account to net, so a broker whose commission Rithmic doesn't report (or a
  // CSV account) still matches the firm's numbers.
  let repriceRate: number | null = null
  if (data.commissionPerContract !== undefined) {
    if (data.commissionPerContract != null && Number.isFinite(data.commissionPerContract) && data.commissionPerContract >= 0) {
      patch.commissionPerContract = String(data.commissionPerContract)
      repriceRate = data.commissionPerContract
    } else {
      patch.commissionPerContract = null
      repriceRate = 0
    }
  }
  if (Object.keys(patch).length === 0) return
  await db.update(tradingAccounts).set(patch).where(and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, userId)))
  if (repriceRate != null) await repriceAccountTrades(id, repriceRate)
  revalidatePath("/settings")
  revalidatePath("/dashboard")
  revalidatePath("/trades")
  revalidatePath("/calendar")
  revalidatePath("/reports")
  revalidatePath("/add-trade")
  revalidatePath("/accounts")
}

// Hide an account from active views without losing it (or bring it back).
export async function setAccountArchived(id: number, archived: boolean) {
  const userId = await getUserId()
  await db.update(tradingAccounts).set({ archived }).where(and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, userId)))
  revalidatePath("/settings")
  revalidatePath("/dashboard")
  revalidatePath("/add-trade")
  revalidatePath("/accounts")
  revalidatePath("/trades")
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

  // A broker-linked account (Rithmic today) is a clean reset: its trades come
  // from the broker and can be re-synced, so drop the connection and those
  // trades so reconnecting rebuilds a fresh account with its full history,
  // rather than leaving a zombie connection and orphaned trades that block
  // the re-import. A manual/CSV account keeps its trades (they can't be
  // re-fetched) — they're just unlinked from the account tag.
  const [rithmic] = await db
    .select({ id: rithmicConnections.id })
    .from(rithmicConnections)
    .where(and(eq(rithmicConnections.accountId, id), eq(rithmicConnections.userId, userId)))

  if (rithmic) {
    await db.delete(rithmicConnections).where(and(eq(rithmicConnections.accountId, id), eq(rithmicConnections.userId, userId)))
    await db.delete(trades).where(and(eq(trades.accountId, id), eq(trades.userId, userId)))
  } else {
    await db
      .update(trades)
      .set({ accountId: null })
      .where(and(eq(trades.accountId, id), eq(trades.userId, userId)))
  }

  await db.delete(propFirmRules).where(and(eq(propFirmRules.accountId, id), eq(propFirmRules.userId, userId)))
  await db.delete(tradingAccounts).where(and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, userId)))
  revalidatePath("/dashboard")
  revalidatePath("/trades")
  revalidatePath("/settings")
  revalidatePath("/add-trade")
  revalidatePath("/accounts")
  revalidatePath("/propfirm")
}
