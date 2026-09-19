"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { rithmicConnections, tradingAccounts, propFirmRules } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { encrypt } from "@/lib/crypto"
import { discoverAccountsAndFills, fetchAccountSnapshots, listRithmicSystems, type RithmicAccountSnapshot } from "@/lib/rithmic-client"
import { applyBrokerSnapshot, importFillsForConnection, syncRithmicConnection } from "@/lib/rithmic-sync"
import { recordSyncRun } from "@/lib/sync-runs"
import { requirePro } from "@/lib/subscription"
import { matchFirmFromSystemName, defaultPresetForFirm } from "@/lib/propfirm-auto-detect"
import { resolvePresetRules } from "@/lib/propfirm-presets"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

// Lets the connect form offer a "which system" picker for a given gateway,
// instead of assuming one — every prop firm/broker on Rithmic is provisioned
// onto its own gateway address (from that firm's own connection_params.txt)
// and can host more than one system on it.
export async function listAvailableRithmicSystems(gatewayUri: string): Promise<string[]> {
  await getUserId()
  return listRithmicSystems(gatewayUri)
}

// A user can connect multiple Rithmic accounts — every lookup here is scoped
// by the connection's own id, not just userId, so one connect/sync/disconnect
// never clobbers another.
export async function getRithmicConnections() {
  const userId = await getUserId()
  const rows = await db
    .select()
    .from(rithmicConnections)
    .where(eq(rithmicConnections.userId, userId))
    .orderBy(rithmicConnections.createdAt)
  return rows.map((row) => ({
    id: row.id,
    login: row.login,
    systemName: row.systemName,
    rithmicAccountId: row.rithmicAccountId,
    accountName: row.accountName,
    lastSyncedAt: row.lastSyncedAt,
    lastSyncStatus: row.lastSyncStatus,
    lastSyncError: row.lastSyncError,
    lastSyncCount: row.lastSyncCount,
  }))
}

export async function connectRithmic(formData: FormData) {
  const userId = await getUserId()
  await requirePro(userId, "Live broker & prop firm sync")
  const login = String(formData.get("login") ?? "").trim()
  const password = String(formData.get("password") ?? "").trim()
  const systemName = String(formData.get("systemName") ?? "").trim()
  const gatewayUri = String(formData.get("gatewayUri") ?? "").trim()

  if (!login || !password || !systemName || !gatewayUri) {
    throw new Error("Gateway, system, username, and password are required")
  }

  // One login pulls the account list AND the initial fill history together —
  // Rithmic rejects a second login attempted right after a prior one closes,
  // so account discovery and the first sync must share a single session.
  const since = new Date(0)
  const { accounts, fillsByAccountId, rmsByAccountId } = await discoverAccountsAndFills(login, password, systemName, gatewayUri, since)
  if (accounts.length === 0) {
    throw new Error("No Rithmic accounts found for that login")
  }
  // Balances live on a different Rithmic plant, so they're a second session.
  // Not fatal if it fails — the account still connects, just without a
  // starting size until the next sync gets one.
  const snapshots = await fetchAccountSnapshots(login, password, systemName, gatewayUri, accounts).catch((err) => {
    console.warn("[rithmic] could not read account balances on connect:", err instanceof Error ? err.message : err)
    return new Map<string, RithmicAccountSnapshot>()
  })

  const passwordEnc = encrypt(password)

  for (const account of accounts) {
    const accountName = `Rithmic ${account.accountName}`
    const existingTradingAccount = await db
      .select()
      .from(tradingAccounts)
      .where(and(eq(tradingAccounts.userId, userId), eq(tradingAccounts.name, accountName)))
    const accountId = existingTradingAccount.length
      ? existingTradingAccount[0].id
      : (
          await db
            .insert(tradingAccounts)
            .values({ userId, name: accountName, broker: "Rithmic" })
            .returning({ id: tradingAccounts.id })
        )[0].id

    // Import the fills first: the starting balance is worked back from the
    // broker's balance minus every realized trade, so the trades have to be
    // in before the snapshot is applied.
    const fills = fillsByAccountId.get(account.accountId) ?? []

    // Reconnecting the same login+account refreshes it instead of duplicating.
    const existingConnection = await db
      .select()
      .from(rithmicConnections)
      .where(
        and(
          eq(rithmicConnections.userId, userId),
          eq(rithmicConnections.login, login),
          eq(rithmicConnections.rithmicAccountId, account.accountId)
        )
      )

    let connectionId: number
    if (existingConnection.length) {
      connectionId = existingConnection[0].id
      await db
        .update(rithmicConnections)
        .set({
          accountId,
          systemName,
          gatewayUri,
          fcmId: account.fcmId,
          ibId: account.ibId,
          accountName: account.accountName,
          passwordEnc,
          lastSyncStatus: null,
          lastSyncError: null,
        })
        .where(eq(rithmicConnections.id, connectionId))
    } else {
      const [inserted] = await db
        .insert(rithmicConnections)
        .values({
          userId,
          accountId,
          systemName,
          gatewayUri,
          fcmId: account.fcmId,
          ibId: account.ibId,
          rithmicAccountId: account.accountId,
          accountName: account.accountName,
          login,
          passwordEnc,
        })
        .returning({ id: rithmicConnections.id })
      connectionId = inserted.id
    }

    const startedAt = Date.now()
    await importFillsForConnection(userId, connectionId, accountId, fills).then(
      (imported) => recordSyncRun({ broker: "rithmic", connectionId, userId, trigger: "connect", startedAt, imported }),
      (err) => {
        console.error("Rithmic initial import failed", err)
        return recordSyncRun({ broker: "rithmic", connectionId, userId, trigger: "connect", startedAt, error: err })
      }
    )

    const snapshot = snapshots.get(account.accountId)
    if (snapshot) await applyBrokerSnapshot(accountId, snapshot, rmsByAccountId.get(account.accountId))

    // Auto-attach prop firm rules from the Rithmic system name — only when
    // this account has no rules yet, so it never overwrites a user's own
    // manual setup on a reconnect/resync. Sized to the starting balance
    // just worked out above, since most firms' thresholds are per-size
    // dollar figures rather than a flat percentage.
    const [existingRules] = await db.select({ id: propFirmRules.id }).from(propFirmRules).where(eq(propFirmRules.accountId, accountId))
    if (!existingRules) {
      const matchedFirm = matchFirmFromSystemName(systemName)
      const preset = matchedFirm ? defaultPresetForFirm(matchedFirm) : null
      if (matchedFirm && preset) {
        const [sized] = await db.select({ startingBalance: tradingAccounts.startingBalance }).from(tradingAccounts).where(eq(tradingAccounts.id, accountId))
        const rules = resolvePresetRules(preset, Number(sized?.startingBalance ?? 0), "evaluation")
        await db.insert(propFirmRules).values({
          accountId,
          userId,
          firmName: matchedFirm,
          planType: preset.program,
          phase: "evaluation",
          profitTargetPct: rules.profitTargetPct != null ? String(rules.profitTargetPct) : null,
          maxDrawdownPct: String(rules.maxDrawdownPct),
          drawdownType: rules.drawdownType,
          dailyLossLimitPct: rules.dailyLossLimitPct != null ? String(rules.dailyLossLimitPct) : null,
          minTradingDays: rules.minTradingDays,
          profitTargetAmount: rules.profitTargetAmount != null ? String(rules.profitTargetAmount) : null,
          maxDrawdownAmount: String(rules.maxDrawdownAmount),
          dailyLossLimitAmount: rules.dailyLossLimitAmount != null ? String(rules.dailyLossLimitAmount) : null,
          consistencyPct: rules.consistencyPct != null ? String(rules.consistencyPct) : null,
          autoDetected: true,
        })
      }
    }
  }

  revalidatePath("/settings")
  revalidatePath("/add-trade")
  revalidatePath("/propfirm")
}

export async function disconnectRithmic(connectionId: number) {
  const userId = await getUserId()
  await db
    .delete(rithmicConnections)
    .where(and(eq(rithmicConnections.id, connectionId), eq(rithmicConnections.userId, userId)))
  revalidatePath("/settings")
  revalidatePath("/add-trade")
}

export async function syncRithmic(connectionId: number) {
  const userId = await getUserId()
  const [connection] = await db
    .select()
    .from(rithmicConnections)
    .where(and(eq(rithmicConnections.id, connectionId), eq(rithmicConnections.userId, userId)))
  if (!connection) throw new Error("Connection not found")

  const result = await syncRithmicConnection(connection, "manual")

  revalidatePath("/dashboard")
  revalidatePath("/trades")
  revalidatePath("/journal")
  revalidatePath("/calendar")
  revalidatePath("/reports")
  revalidatePath("/settings")
  revalidatePath("/add-trade")

  return result
}
