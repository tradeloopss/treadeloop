import { and, eq, inArray, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { providerAccounts, providerDeviceKeys, providerExecutions, rithmicConnections, tradingAccounts, tradingConnections } from "@/lib/db/schema"
import { executionKey } from "@/lib/providers/idempotency"
import type { NormalizedExecution } from "@/lib/providers/types"
import { accountLimitError } from "@/lib/plan-limits"
import { hashDeviceKey } from "@/lib/ninjatrader/keys"
import { brokerFor, ENVIRONMENT, skipReason, type NtAccount, type NtParsed } from "@/lib/ninjatrader/payload"
import { tlog } from "@/lib/tradovate/log"

// Stores what the NinjaTrader add-on posts, in the provider-neutral tables
// (migration 0014): one "ninjatrader" trading_connection per TradeLoop user,
// one provider_account per NinjaTrader account, one provider_execution per
// fill — idempotent by NinjaTrader's execution id, so the add-on can resend
// its whole session (it does, every few minutes) without duplicates. Trades
// are then built by the same engine as every fill-based broker
// (lib/tradovate/trades.ts → buildProviderTrades).

export const PROVIDER = "ninjatrader"

export type DeviceKeyRow = typeof providerDeviceKeys.$inferSelect
export type TradingConnection = typeof tradingConnections.$inferSelect

export async function deviceForKey(key: string): Promise<DeviceKeyRow | null> {
  const [row] = await db
    .select()
    .from(providerDeviceKeys)
    .where(and(eq(providerDeviceKeys.keyHash, hashDeviceKey(key)), eq(providerDeviceKeys.provider, PROVIDER), isNull(providerDeviceKeys.revokedAt)))
  return row ?? null
}

export async function ensureConnection(userId: string): Promise<TradingConnection> {
  const [row] = await db
    .insert(tradingConnections)
    .values({ userId, provider: PROVIDER, environment: ENVIRONMENT, providerUserId: userId, providerUserName: "NinjaTrader", status: "connected", syncStage: "complete" })
    .onConflictDoUpdate({
      target: [tradingConnections.userId, tradingConnections.provider, tradingConnections.environment, tradingConnections.providerUserId],
      set: { status: "connected", statusMessage: null, updatedAt: new Date() },
    })
    .returning()
  return row
}

export interface IngestResult {
  connectionId: number
  accounts: number
  inserted: number
  updated: number
  skippedAccounts: { name: string; reason: string }[]
  tradesDirty: boolean
}

// A journal account of its own for each NinjaTrader account — never an
// existing one by name, so a CSV-imported account with the same trades can't
// end up holding them twice.
async function ensureJournalAccount(userId: string, row: typeof providerAccounts.$inferSelect, provider: string | null): Promise<number | "plan_limit"> {
  if (row.tradingAccountId != null) {
    const [exists] = await db.select({ id: tradingAccounts.id }).from(tradingAccounts).where(eq(tradingAccounts.id, row.tradingAccountId))
    if (exists) return exists.id
  }
  if (await accountLimitError(userId, 1)) return "plan_limit"
  const taken = new Set(
    (await db.select({ name: tradingAccounts.name }).from(tradingAccounts).where(eq(tradingAccounts.userId, userId))).map((a) => a.name),
  )
  let name = row.accountName
  if (taken.has(name)) name = `${row.accountName} (NinjaTrader)`
  for (let n = 2; taken.has(name); n++) name = `${row.accountName} (NinjaTrader ${n})`
  const [created] = await db
    .insert(tradingAccounts)
    .values({ userId, name, broker: brokerFor(provider), currency: row.currency, startingBalance: "0", startingBalanceInferred: true })
    .returning({ id: tradingAccounts.id })
  await db.update(providerAccounts).set({ tradingAccountId: created.id, updatedAt: new Date() }).where(eq(providerAccounts.id, row.id))
  return created.id
}

async function upsertAccount(connection: TradingConnection, a: NtAccount) {
  const money = (v: number | null) => (v == null ? null : String(Math.round(v * 100) / 100))
  const metadata = { ntProvider: a.provider, connection: a.connection, connectionStatus: a.status, realizedPnl: a.realizedPnl }
  const [row] = await db
    .insert(providerAccounts)
    .values({
      connectionId: connection.id,
      provider: PROVIDER,
      environment: ENVIRONMENT,
      providerAccountId: a.name,
      accountName: a.name,
      accountType: a.provider,
      currency: a.currency,
      balance: money(a.cashValue),
      equity: money(a.netLiquidation),
      metadata,
    })
    .onConflictDoUpdate({
      target: [providerAccounts.connectionId, providerAccounts.environment, providerAccounts.providerAccountId],
      set: {
        accountType: a.provider,
        currency: a.currency,
        ...(a.cashValue != null ? { balance: money(a.cashValue) } : {}),
        ...(a.netLiquidation != null ? { equity: money(a.netLiquidation) } : {}),
        metadata,
        status: "active",
        updatedAt: new Date(),
      },
    })
    .returning()
  return row
}

function executionRow(connectionId: number, e: NormalizedExecution) {
  return {
    connectionId,
    provider: PROVIDER,
    environment: e.environment,
    idempotencyKey: executionKey(e),
    providerExecutionId: e.providerExecutionId,
    providerOrderId: e.providerOrderId,
    providerAccountId: e.providerAccountId,
    symbol: e.symbol,
    contractMonth: e.contractMonth,
    assetClass: e.assetClass,
    side: e.side,
    quantity: String(e.quantity),
    price: String(e.price),
    pointValue: e.pointValue == null ? null : String(e.pointValue),
    timestamp: e.timestamp,
    commission: e.commission == null ? null : String(e.commission),
    currency: e.currency,
    active: e.active,
    rawData: e.metadata ?? null,
  }
}

// New fills are inserted; a fill NinjaTrader amended (price, quantity, time
// or commission) is updated. Everything else is a no-op, so resending is free.
async function storeExecutions(connectionId: number, executions: NormalizedExecution[]): Promise<{ inserted: number; updated: number }> {
  let inserted = 0
  let updated = 0
  for (let i = 0; i < executions.length; i += 250) {
    const rows = executions.slice(i, i + 250).map((e) => executionRow(connectionId, e))
    const added = await db.insert(providerExecutions).values(rows).onConflictDoNothing({ target: [providerExecutions.connectionId, providerExecutions.idempotencyKey] }).returning({ key: providerExecutions.idempotencyKey })
    inserted += added.length
    const addedKeys = new Set(added.map((a) => a.key))
    const rest = rows.filter((r) => !addedKeys.has(r.idempotencyKey))
    if (rest.length === 0) continue
    const stored = await db
      .select()
      .from(providerExecutions)
      .where(and(eq(providerExecutions.connectionId, connectionId), inArray(providerExecutions.idempotencyKey, rest.map((r) => r.idempotencyKey))))
    const byKey = new Map(stored.map((s) => [s.idempotencyKey, s]))
    for (const r of rest) {
      const s = byKey.get(r.idempotencyKey)
      if (!s) continue
      const changed =
        Number(s.quantity) !== Number(r.quantity) ||
        Math.abs(Number(s.price) - Number(r.price)) > 1e-9 ||
        s.timestamp.getTime() !== r.timestamp.getTime() ||
        s.side !== r.side ||
        (r.commission != null && Number(s.commission ?? NaN) !== Number(r.commission)) ||
        (r.pointValue != null && s.pointValue == null)
      if (!changed) continue
      await db
        .update(providerExecutions)
        .set({ quantity: r.quantity, price: r.price, timestamp: r.timestamp, side: r.side, ...(r.commission != null ? { commission: r.commission } : {}), ...(r.pointValue != null ? { pointValue: r.pointValue } : {}) })
        .where(eq(providerExecutions.id, s.id))
      updated++
    }
  }
  return { inserted, updated }
}

export async function ingestPayload(device: DeviceKeyRow, parsed: NtParsed): Promise<IngestResult> {
  const connection = await ensureConnection(device.userId)
  const now = new Date()

  // Accounts TradeLoop already syncs straight from Rithmic stay there.
  const rithmic = await db
    .select({ id: rithmicConnections.rithmicAccountId, name: rithmicConnections.accountName })
    .from(rithmicConnections)
    .where(eq(rithmicConnections.userId, device.userId))
  const viaRithmic = new Set(rithmic.flatMap((r) => [r.id.toLowerCase(), r.name.toLowerCase()]))

  // Every account the add-on listed, plus any only its fills name.
  const accounts = [...parsed.accounts]
  for (const e of parsed.executions) {
    if (!accounts.some((a) => a.name === e.providerAccountId)) {
      accounts.push({ name: e.providerAccountId, provider: null, connection: null, status: null, currency: e.currency, cashValue: null, netLiquidation: null, realizedPnl: null })
    }
  }

  const skippedAccounts: { name: string; reason: string }[] = []
  const accepted = new Set<string>()
  for (const a of accounts) {
    const skip = skipReason(a) ?? ((a.provider ?? "").toLowerCase() === "rithmic" && viaRithmic.has(a.name.toLowerCase()) ? "synced_by_rithmic" : null)
    if (skip) {
      skippedAccounts.push({ name: a.name, reason: skip })
      continue
    }
    const row = await upsertAccount(connection, a)
    accepted.add(a.name)
    if (!row.enabled) {
      skippedAccounts.push({ name: a.name, reason: "disconnected" })
      continue
    }
    const journal = await ensureJournalAccount(device.userId, row, a.provider)
    if (journal === "plan_limit") {
      skippedAccounts.push({ name: a.name, reason: "plan_limit" })
      continue
    }
    if (a.cashValue != null) {
      await db.update(tradingAccounts).set({ currentBalance: String(a.cashValue), balanceUpdatedAt: now }).where(eq(tradingAccounts.id, journal))
    }
  }

  // Fills of disconnected or plan-limited accounts are kept too (they're only
  // turned into trades for enabled, linked accounts), so re-enabling one
  // loses nothing; local simulation and Rithmic-synced accounts are dropped.
  const executions = parsed.executions.filter((e) => accepted.has(e.providerAccountId))
  const { inserted, updated } = await storeExecutions(connection.id, executions)
  const tradesDirty = inserted + updated > 0

  await db
    .update(tradingConnections)
    .set({
      status: "connected",
      statusMessage: null,
      lastSyncAt: now,
      lastSyncStatus: "ok",
      lastSyncError: null,
      errorCount: 0,
      lastRealtimeEventAt: now,
      realtimeStatus: "live",
      ...(tradesDirty ? { tradesDirtyAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(tradingConnections.id, connection.id))
  await db
    .update(providerDeviceKeys)
    .set({
      lastSeenAt: now,
      ...(tradesDirty ? { lastSyncAt: now } : {}),
      lastStatus: "ok",
      lastError: null,
      ...(parsed.client.machine ? { label: parsed.client.machine } : {}),
      ...(parsed.client.version ? { clientVersion: parsed.client.version } : {}),
    })
    .where(eq(providerDeviceKeys.id, device.id))

  if (tradesDirty) tlog("executions_received", { provider: PROVIDER, connectionId: connection.id, inserted, updated, accounts: accepted.size })
  return { connectionId: connection.id, accounts: accepted.size, inserted, updated, skippedAccounts, tradesDirty }
}

export async function recordDeviceError(device: DeviceKeyRow, message: string) {
  await db
    .update(providerDeviceKeys)
    .set({ lastSeenAt: new Date(), lastStatus: "error", lastError: message.slice(0, 300) })
    .where(eq(providerDeviceKeys.id, device.id))
    .catch(() => {})
}

// Marks the connection "offline" once no add-on has checked in for a while
// (the add-on checks in every 5 minutes while NinjaTrader is open).
export const OFFLINE_AFTER_MS = 15 * 60 * 1000

export function realtimeState(lastSeenAt: Date | null, now = Date.now()): "live" | "offline" {
  return lastSeenAt && now - lastSeenAt.getTime() < OFFLINE_AFTER_MS ? "live" : "offline"
}
