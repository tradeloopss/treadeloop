import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { providerAccounts, providerExecutions, providerOrders, providerPositions, tradingAccounts, tradingConnections } from "@/lib/db/schema"
import { decrypt, encrypt } from "@/lib/crypto"
import { executionKey } from "@/lib/providers/idempotency"
import { ProviderError, type NormalizedExecution, type ProviderTokens, type RealtimeEvent } from "@/lib/providers/types"
import { recordSyncRun, type SyncTrigger } from "@/lib/sync-runs"
import { httpTradovateApi, type TradovateApi } from "@/lib/tradovate/api"
import { tradovateConfig, type TradovateConfig, type TradovateEndpoint } from "@/lib/tradovate/config"
import type { HttpDeps } from "@/lib/tradovate/http"
import { InstrumentCache } from "@/lib/tradovate/instruments"
import { tlog } from "@/lib/tradovate/log"
import { mockTokens, mockTradovateApi } from "@/lib/tradovate/mock"
import { normalizeAccount, normalizeFills, normalizeOrder, normalizePosition, reconcileIds, feeTotal } from "@/lib/tradovate/normalize"
import { freshTokens } from "@/lib/tradovate/oauth"
import type { TvCashBalance, TvFill, TvFillFee, TvOrder, TvPosition } from "@/lib/tradovate/types"

// The Tradovate sync engine. Shared by the sync VPS's worker (every real
// connection: REST sync + realtime events) and the app (mock connections in
// local development, and the manual "Sync now" fallback). It only stores what
// Tradovate reports — accounts, orders, executions, positions — idempotently;
// turning executions into journal trades happens in lib/tradovate/trades.ts,
// where the journal code lives (the worker asks the app to do it).
//
// Every REST sync is also a reconciliation: Tradovate's lists are compared
// with what's stored, missing executions are inserted, stale positions are
// replaced, and the counts are kept on the connection.

export type TradingConnection = typeof tradingConnections.$inferSelect

export interface SyncDeps {
  config: TradovateConfig
  apiFor: (connection: TradingConnection, endpoint: TradovateEndpoint, token: () => string) => TradovateApi
  instruments: InstrumentCache
  http?: HttpDeps
}

export function defaultSyncDeps(config: TradovateConfig = tradovateConfig(), http: HttpDeps = {}): SyncDeps {
  return {
    config,
    instruments: new InstrumentCache(),
    http,
    apiFor: (connection, endpoint, token) =>
      connection.environment === "mock" ? mockTradovateApi(endpoint.environment) : httpTradovateApi(endpoint.environment, endpoint.restUrl, token, { ...http, log: (event, fields) => tlog(event, { connectionId: connection.id, environment: endpoint.environment, ...fields }) }),
  }
}

export function endpointsFor(connection: TradingConnection, config: TradovateConfig): TradovateEndpoint[] {
  if (connection.environment === "mock") return [{ environment: "demo", restUrl: "mock://demo", wsUrl: "mock://demo" }, { environment: "live", restUrl: "mock://live", wsUrl: "mock://live" }]
  return config.endpoints.filter((e) => !e.restUrl.startsWith("mock://"))
}

// ---------------------------------------------------------------- tokens

export function tokensOf(connection: TradingConnection): ProviderTokens | null {
  if (connection.environment === "mock") return mockTokens()
  if (!connection.accessTokenEnc || !connection.tokenExpiresAt) return null
  return {
    accessToken: decrypt(connection.accessTokenEnc),
    accessExpiresAt: connection.tokenExpiresAt,
    refreshToken: connection.refreshTokenEnc ? decrypt(connection.refreshTokenEnc) : null,
    refreshExpiresAt: connection.refreshExpiresAt,
  }
}

export async function saveTokens(connectionId: number, tokens: ProviderTokens) {
  await db
    .update(tradingConnections)
    .set({
      accessTokenEnc: encrypt(tokens.accessToken),
      refreshTokenEnc: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
      tokenExpiresAt: tokens.accessExpiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt,
      updatedAt: new Date(),
    })
    .where(eq(tradingConnections.id, connectionId))
}

// A token good for the next few minutes, renewing or refreshing it (and
// saving the result) when it's close to expiry. On "reauth" the connection is
// marked so the user is asked to reconnect.
export async function ensureTokens(connection: TradingConnection, deps: SyncDeps): Promise<ProviderTokens> {
  const tokens = tokensOf(connection)
  if (!tokens) throw new ProviderError("reauth", "Tradovate authorization expired. Please reconnect your account.")
  if (connection.environment === "mock") return tokens
  const endpoint = endpointsFor(connection, deps.config)[0]
  if (!endpoint) throw new ProviderError("config", "Tradovate isn't configured on this server.")
  try {
    const fresh = await freshTokens(deps.config, endpoint.restUrl, tokens, deps.http)
    if (fresh.accessToken !== tokens.accessToken) {
      await saveTokens(connection.id, fresh)
      tlog("token_renewed", { connectionId: connection.id, expiresAt: fresh.accessExpiresAt.toISOString() })
    }
    return fresh
  } catch (err) {
    if (err instanceof ProviderError && err.kind === "reauth") {
      await db
        .update(tradingConnections)
        .set({ status: "reauth", statusMessage: err.message, nextSyncAt: null, realtimeStatus: "offline", updatedAt: new Date() })
        .where(eq(tradingConnections.id, connection.id))
      tlog("reauth_required", { connectionId: connection.id }, "warn")
    }
    throw err
  }
}

async function setStage(connectionId: number, stage: string) {
  await db.update(tradingConnections).set({ syncStage: stage, updatedAt: new Date() }).where(eq(tradingConnections.id, connectionId))
}

// ------------------------------------------------------------- accounts

// The journal account a Tradovate account's trades land in, created the first
// time it's seen ("Tradovate - APEX-50K-0001"). Its size is worked out from
// the broker balance once trades are in (lib/tradovate/trades.ts), never
// invented; prop-firm rules stay in the prop-firm tracker.
async function ensureJournalAccount(connection: TradingConnection, row: typeof providerAccounts.$inferSelect): Promise<number> {
  if (row.tradingAccountId != null) {
    const [exists] = await db.select({ id: tradingAccounts.id }).from(tradingAccounts).where(eq(tradingAccounts.id, row.tradingAccountId))
    if (exists) return exists.id
  }
  const name = `Tradovate - ${row.accountName}`
  const [existing] = await db
    .select({ id: tradingAccounts.id })
    .from(tradingAccounts)
    .where(and(eq(tradingAccounts.userId, connection.userId), eq(tradingAccounts.name, name)))
  const accountId =
    existing?.id ??
    (
      await db
        .insert(tradingAccounts)
        .values({ userId: connection.userId, name, broker: "Tradovate", currency: row.currency, startingBalance: "0", startingBalanceInferred: true })
        .returning({ id: tradingAccounts.id })
    )[0].id
  await db.update(providerAccounts).set({ tradingAccountId: accountId, updatedAt: new Date() }).where(eq(providerAccounts.id, row.id))
  return accountId
}

async function upsertAccount(connection: TradingConnection, environment: string, account: { id: number; name: string; nickname?: string | null; accountType?: string; active?: boolean; archived?: boolean; marginAccountType?: string; legalStatus?: string }, balance: TvCashBalance | null) {
  const n = normalizeAccount(environment, account, balance)
  const money = (v: number | null) => (v == null ? null : String(Math.round(v * 100) / 100))
  const [row] = await db
    .insert(providerAccounts)
    .values({
      connectionId: connection.id,
      provider: "tradovate",
      environment,
      providerAccountId: n.providerAccountId,
      accountName: n.name,
      accountType: n.accountType,
      currency: n.currency,
      balance: money(n.balance),
      equity: money(n.equity),
      availableMargin: money(n.availableMargin),
      status: n.active ? "active" : "inactive",
      metadata: n.metadata ?? null,
    })
    .onConflictDoUpdate({
      target: [providerAccounts.connectionId, providerAccounts.environment, providerAccounts.providerAccountId],
      set: {
        accountName: n.name,
        accountType: n.accountType,
        ...(n.balance != null ? { balance: money(n.balance) } : {}),
        ...(n.equity != null ? { equity: money(n.equity) } : {}),
        ...(n.availableMargin != null ? { availableMargin: money(n.availableMargin) } : {}),
        status: n.active ? "active" : "inactive",
        metadata: n.metadata ?? null,
        updatedAt: new Date(),
      },
    })
    .returning()
  if (row.enabled && row.status === "active") {
    const journalAccountId = await ensureJournalAccount(connection, row)
    if (n.balance != null) {
      await db.update(tradingAccounts).set({ currentBalance: String(n.balance), balanceUpdatedAt: new Date() }).where(eq(tradingAccounts.id, journalAccountId))
    }
  }
  return row
}

// --------------------------------------------------------------- orders

async function upsertOrders(connection: TradingConnection, environment: string, orders: TvOrder[], api: TradovateApi, deps: SyncDeps) {
  if (orders.length === 0) return
  const specs = await deps.instruments.resolve(api, orders.map((o) => o.contractId).filter((n): n is number => typeof n === "number"))
  for (let i = 0; i < orders.length; i += 200) {
    const rows = orders.slice(i, i + 200).map((o) => {
      const n = normalizeOrder(environment, o, specs)
      return {
        connectionId: connection.id,
        provider: "tradovate",
        environment,
        providerOrderId: n.providerOrderId,
        providerAccountId: n.providerAccountId,
        symbol: n.symbol,
        contractId: n.contractId,
        side: n.side,
        quantity: n.quantity == null ? null : String(n.quantity),
        orderType: n.orderType,
        limitPrice: n.limitPrice == null ? null : String(n.limitPrice),
        stopPrice: n.stopPrice == null ? null : String(n.stopPrice),
        status: n.status,
        submittedAt: n.submittedAt,
        rawData: n.raw,
      }
    })
    await db
      .insert(providerOrders)
      .values(rows)
      .onConflictDoUpdate({
        target: [providerOrders.connectionId, providerOrders.environment, providerOrders.providerOrderId],
        set: { status: sql`excluded."status"`, symbol: sql`coalesce(excluded."symbol", ${providerOrders.symbol})`, rawData: sql`excluded."rawData"`, updatedAt: new Date() },
      })
  }
}

// Order id → account id, from what's just arrived, what the realtime socket
// has seen, and what's stored.
async function orderAccountMap(connection: TradingConnection, environment: string, fresh: TvOrder[], orderIds: number[], known?: Map<number, number>): Promise<Map<number, number>> {
  const map = new Map<number, number>(known ?? [])
  for (const o of fresh) map.set(o.id, o.accountId)
  const unknown = [...new Set(orderIds)].filter((id) => !map.has(id))
  for (let i = 0; i < unknown.length; i += 500) {
    const chunk = unknown.slice(i, i + 500).map(String)
    const rows = await db
      .select({ providerOrderId: providerOrders.providerOrderId, providerAccountId: providerOrders.providerAccountId })
      .from(providerOrders)
      .where(and(eq(providerOrders.connectionId, connection.id), eq(providerOrders.environment, environment), inArray(providerOrders.providerOrderId, chunk)))
    for (const r of rows) map.set(Number(r.providerOrderId), Number(r.providerAccountId))
  }
  return map
}

// ------------------------------------------------------------ executions

function executionRow(connection: TradingConnection, e: NormalizedExecution) {
  return {
    connectionId: connection.id,
    provider: "tradovate",
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

// Stores executions; returns how many were new. An execution seen again only
// updates what can legitimately change later: its fees (Tradovate reports
// them separately) and whether it's still active (a busted fill).
async function storeExecutions(connection: TradingConnection, executions: NormalizedExecution[]): Promise<{ inserted: number; changed: number }> {
  let inserted = 0
  let changed = 0
  for (let i = 0; i < executions.length; i += 200) {
    const rows = executions.slice(i, i + 200).map((e) => executionRow(connection, e))
    const added = await db.insert(providerExecutions).values(rows).onConflictDoNothing({ target: [providerExecutions.connectionId, providerExecutions.idempotencyKey] }).returning({ key: providerExecutions.idempotencyKey })
    inserted += added.length
    const addedKeys = new Set(added.map((a) => a.key))
    for (const r of rows) {
      if (addedKeys.has(r.idempotencyKey)) continue
      const updated = await db
        .update(providerExecutions)
        .set({ ...(r.commission != null ? { commission: r.commission } : {}), active: r.active })
        .where(
          and(
            eq(providerExecutions.connectionId, connection.id),
            eq(providerExecutions.idempotencyKey, r.idempotencyKey),
            sql`(${providerExecutions.active} is distinct from ${r.active} or (${r.commission}::numeric is not null and ${providerExecutions.commission} is distinct from ${r.commission}::numeric))`,
          ),
        )
        .returning({ id: providerExecutions.id })
      changed += updated.length
    }
  }
  return { inserted, changed }
}

async function normalizeAndStoreFills(connection: TradingConnection, environment: string, fills: TvFill[], fees: TvFillFee[], freshOrders: TvOrder[], api: TradovateApi, deps: SyncDeps, knownOrders?: Map<number, number>) {
  const feeById = new Map(fees.map((f) => [f.id, f]))
  let orderAccount = await orderAccountMap(connection, environment, freshOrders, fills.map((f) => f.orderId), knownOrders)
  const specs = await deps.instruments.resolve(api, fills.map((f) => f.contractId))
  let normalized = normalizeFills(environment, fills, orderAccount, specs, feeById)
  // Orders we haven't seen (older than Tradovate's order list): look each up.
  if (normalized.unattributed.length > 0) {
    const lookedUp: TvOrder[] = []
    for (const orderId of [...new Set(normalized.unattributed.map((f) => f.orderId))].slice(0, 50)) {
      const o = await api.order(orderId)
      if (o) lookedUp.push(o)
    }
    if (lookedUp.length > 0) {
      await upsertOrders(connection, environment, lookedUp, api, deps)
      orderAccount = new Map([...orderAccount, ...lookedUp.map((o) => [o.id, o.accountId] as [number, number])])
      normalized = normalizeFills(environment, fills, orderAccount, specs, feeById)
    }
  }
  if (normalized.unattributed.length > 0 || normalized.unresolved.length > 0) {
    tlog("executions_skipped", { connectionId: connection.id, environment, unattributed: normalized.unattributed.length, unresolved: normalized.unresolved.length }, "warn")
  }
  const stored = await storeExecutions(connection, normalized.executions)
  return { ...stored, remoteKeys: normalized.executions.map((e) => executionKey(e)) }
}

// ------------------------------------------------------------- positions

async function replacePositions(connection: TradingConnection, environment: string, positions: TvPosition[], api: TradovateApi, deps: SyncDeps): Promise<number> {
  const specs = await deps.instruments.resolve(api, positions.map((p) => p.contractId))
  const open = positions.filter((p) => p.netPos !== 0)
  const before = await db.select({ id: providerPositions.id }).from(providerPositions).where(and(eq(providerPositions.connectionId, connection.id), eq(providerPositions.environment, environment)))
  await db.delete(providerPositions).where(and(eq(providerPositions.connectionId, connection.id), eq(providerPositions.environment, environment)))
  if (open.length > 0) {
    await db.insert(providerPositions).values(
      open.map((p) => {
        const n = normalizePosition(environment, p, specs)
        return { connectionId: connection.id, provider: "tradovate", environment, providerAccountId: n.providerAccountId, contractId: n.contractId, symbol: n.symbol, netQuantity: String(n.netQuantity), averagePrice: n.averagePrice == null ? null : String(n.averagePrice) }
      }),
    )
  }
  return Math.max(0, before.length - open.length) // positions no longer open (stale ones replaced)
}

// ------------------------------------------------------------- full sync

export interface EnvironmentResult {
  environment: string
  accounts: number
  orders: number
  newExecutions: number
  changedExecutions: number
  missingRepaired: number
  notInRemoteWindow: number
  openPositions: number
  closedPositions: number
}

async function syncEnvironment(connection: TradingConnection, endpoint: TradovateEndpoint, api: TradovateApi, deps: SyncDeps, firstSync: boolean): Promise<EnvironmentResult> {
  if (firstSync) await setStage(connection.id, "finding_accounts")
  const accounts = await api.accounts()
  for (const a of accounts) await upsertAccount(connection, endpoint.environment, a, await api.cashBalance(a.id))

  if (firstSync) await setStage(connection.id, "importing_orders")
  const orders = await api.orders()
  await upsertOrders(connection, endpoint.environment, orders, api, deps)

  if (firstSync) await setStage(connection.id, "importing_executions")
  const fills = await api.fills()
  const fees = fills.length > 0 ? await api.fillFees(fills.map((f) => f.id)) : []
  const localKeys = (
    await db
      .select({ key: providerExecutions.idempotencyKey })
      .from(providerExecutions)
      .where(and(eq(providerExecutions.connectionId, connection.id), eq(providerExecutions.environment, endpoint.environment)))
  ).map((r) => r.key)
  const stored = await normalizeAndStoreFills(connection, endpoint.environment, fills, fees, orders, api, deps)
  const recon = reconcileIds(localKeys, stored.remoteKeys)

  const positions = await api.positions()
  const closedPositions = await replacePositions(connection, endpoint.environment, positions, api, deps)

  return {
    environment: endpoint.environment,
    accounts: accounts.length,
    orders: orders.length,
    newExecutions: stored.inserted,
    changedExecutions: stored.changed,
    missingRepaired: recon.missing.length,
    notInRemoteWindow: recon.notInRemoteWindow,
    openPositions: positions.filter((p) => p.netPos !== 0).length,
    closedPositions,
  }
}

const RECONCILE_WITH_REALTIME_MS = 10 * 60 * 1000 // realtime covers the gaps between
const RECONCILE_WITHOUT_REALTIME_MS = 2 * 60 * 1000 // polling fallback

// One full REST sync (initial, incremental or reconciliation — the same
// idempotent pass). The caller holds the connection's lease.
export async function runTradovateSync(connectionId: number, deps: SyncDeps, trigger: SyncTrigger): Promise<{ results: EnvironmentResult[]; tradesDirty: boolean }> {
  const startedAt = Date.now()
  const [connection] = await db.select().from(tradingConnections).where(eq(tradingConnections.id, connectionId))
  if (!connection || connection.status === "disconnected" || connection.status === "reauth") return { results: [], tradesDirty: false }
  const firstSync = connection.lastSyncAt == null
  const results: EnvironmentResult[] = []
  try {
    const tokens = await ensureTokens(connection, deps)
    let current = tokens
    const endpoints = endpointsFor(connection, deps.config)
    if (endpoints.length === 0) throw new ProviderError("config", "Tradovate isn't configured on this server.")
    const envErrors: string[] = []
    for (const endpoint of endpoints) {
      const api = deps.apiFor(connection, endpoint, () => current.accessToken)
      try {
        results.push(await syncEnvironment(connection, endpoint, api, deps, firstSync))
      } catch (err) {
        // An environment this login has no access to (e.g. no live accounts)
        // shouldn't fail the other one.
        if (err instanceof ProviderError && (err.kind === "forbidden" || err.kind === "not_found")) {
          envErrors.push(`${endpoint.environment}: ${err.message}`)
          continue
        }
        if (err instanceof ProviderError && err.kind === "auth") {
          // Rejected mid-sync: renew once from the latest stored tokens, retry.
          const [latest] = await db.select().from(tradingConnections).where(eq(tradingConnections.id, connectionId))
          current = await ensureTokens({ ...(latest ?? connection), tokenExpiresAt: new Date(0) }, deps)
          results.push(await syncEnvironment(connection, endpoint, deps.apiFor(connection, endpoint, () => current.accessToken), deps, firstSync))
          continue
        }
        throw err
      }
    }
    if (results.length === 0 && envErrors.length > 0) throw new ProviderError("forbidden", "Tradovate didn't give access to any accounts for this login.")

    const newExecutions = results.reduce((n, r) => n + r.newExecutions + r.changedExecutions, 0)
    const summary: Record<string, number> = {
      accounts: results.reduce((n, r) => n + r.accounts, 0),
      orders: results.reduce((n, r) => n + r.orders, 0),
      newExecutions: results.reduce((n, r) => n + r.newExecutions, 0),
      updatedExecutions: results.reduce((n, r) => n + r.changedExecutions, 0),
      missingRepaired: results.reduce((n, r) => n + r.missingRepaired, 0),
      notInRemoteWindow: results.reduce((n, r) => n + r.notInRemoteWindow, 0),
      openPositions: results.reduce((n, r) => n + r.openPositions, 0),
      stalePositionsCleared: results.reduce((n, r) => n + r.closedPositions, 0),
    }
    const now = new Date()
    const [fresh] = await db.select({ realtimeStatus: tradingConnections.realtimeStatus }).from(tradingConnections).where(eq(tradingConnections.id, connectionId))
    const interval = fresh?.realtimeStatus === "live" ? RECONCILE_WITH_REALTIME_MS : RECONCILE_WITHOUT_REALTIME_MS
    await db
      .update(tradingConnections)
      .set({
        status: "connected",
        statusMessage: envErrors.length ? envErrors.join(" · ").slice(0, 300) : null,
        lastSyncAt: now,
        lastSyncStatus: "ok",
        lastSyncError: null,
        lastReconciledAt: now,
        lastReconcileSummary: summary,
        errorCount: 0,
        nextSyncAt: new Date(now.getTime() + interval),
        leaseUntil: null,
        // First sync: trades are always built once, even if there were none.
        ...(newExecutions > 0 || firstSync ? { tradesDirtyAt: now } : {}),
        ...(firstSync ? { syncStage: "building_trades" } : {}),
        updatedAt: now,
      })
      .where(eq(tradingConnections.id, connectionId))
    await recordSyncRun({ broker: "tradovate", connectionId, userId: connection.userId, trigger, startedAt, imported: summary.newExecutions })
    tlog("sync_complete", { connectionId, trigger, ms: Date.now() - startedAt, ...summary })
    return { results, tradesDirty: newExecutions > 0 || firstSync }
  } catch (err) {
    const e = err instanceof ProviderError ? err : new ProviderError("server", "Tradovate sync failed.")
    const errorCount = connection.errorCount + 1
    const retryIn = e.retryAfterMs ?? Math.min(60_000 * 2 ** Math.min(errorCount - 1, 5), 30 * 60_000)
    const permanent = e.kind === "reauth" || e.kind === "config"
    await db
      .update(tradingConnections)
      .set({
        ...(e.kind === "reauth" ? { status: "reauth" } : connection.status === "pending" && errorCount >= 5 ? { status: "error" } : {}),
        statusMessage: e.message,
        lastSyncStatus: "error",
        lastSyncError: e.message.slice(0, 500),
        errorCount,
        nextSyncAt: permanent ? null : new Date(Date.now() + retryIn),
        leaseUntil: null,
        ...(firstSync ? { syncStage: "error" } : {}),
        updatedAt: new Date(),
      })
      .where(eq(tradingConnections.id, connectionId))
    await recordSyncRun({ broker: "tradovate", connectionId, userId: connection.userId, trigger, startedAt, error: e })
    tlog("sync_failed", { connectionId, trigger, kind: e.kind, message: e.message, retryInMs: permanent ? null : retryIn }, "warn")
    throw e
  }
}

// ------------------------------------------------------------- realtime

export interface RealtimeCaches {
  orderAccount: Map<string, Map<number, number>> // environment → order id → account id
  fees: Map<string, Map<number, TvFillFee>> // environment → fill id → fees
}

export function newRealtimeCaches(): RealtimeCaches {
  return { orderAccount: new Map(), fees: new Map() }
}

function envMap<V>(m: Map<string, Map<number, V>>, environment: string): Map<number, V> {
  let inner = m.get(environment)
  if (!inner) m.set(environment, (inner = new Map()))
  return inner
}

// One realtime change from user/syncrequest. Returns whether trades need
// rebuilding. Everything is idempotent, so an event replayed after a
// reconnect (or also seen by the next REST reconciliation) is harmless.
export async function ingestRealtimeEvent(connection: TradingConnection, event: RealtimeEvent, api: TradovateApi, deps: SyncDeps, caches: RealtimeCaches): Promise<{ tradesDirty: boolean }> {
  const env = event.environment
  const e = event.entity
  switch (event.entityType) {
    case "order": {
      const o = e as unknown as TvOrder
      if (typeof o.id !== "number" || typeof o.accountId !== "number") return { tradesDirty: false }
      envMap(caches.orderAccount, env).set(o.id, o.accountId)
      await upsertOrders(connection, env, [o], api, deps)
      return { tradesDirty: false }
    }
    case "fill": {
      const f = e as unknown as TvFill
      if (typeof f.id !== "number" || typeof f.orderId !== "number") return { tradesDirty: false }
      const fee = envMap(caches.fees, env).get(f.id)
      const result = await normalizeAndStoreFills(connection, env, [f], fee ? [fee] : [], [], api, deps, envMap(caches.orderAccount, env))
      tlog("execution_received", { connectionId: connection.id, environment: env, providerExecutionId: String(f.id), eventType: event.eventType, stored: result.inserted > 0 })
      return { tradesDirty: result.inserted > 0 || result.changed > 0 }
    }
    case "fillFee": {
      const fee = e as unknown as TvFillFee
      if (typeof fee.id !== "number") return { tradesDirty: false }
      envMap(caches.fees, env).set(fee.id, fee)
      const total = feeTotal(fee)
      if (total == null) return { tradesDirty: false }
      const updated = await db
        .update(providerExecutions)
        .set({ commission: String(total) })
        .where(and(eq(providerExecutions.connectionId, connection.id), eq(providerExecutions.environment, env), eq(providerExecutions.providerExecutionId, String(fee.id)), sql`${providerExecutions.commission} is distinct from ${String(total)}::numeric`))
        .returning({ id: providerExecutions.id })
      return { tradesDirty: updated.length > 0 }
    }
    case "position": {
      const p = e as unknown as TvPosition
      if (typeof p.accountId !== "number" || typeof p.contractId !== "number") return { tradesDirty: false }
      const where = and(eq(providerPositions.connectionId, connection.id), eq(providerPositions.environment, env), eq(providerPositions.providerAccountId, String(p.accountId)), eq(providerPositions.contractId, String(p.contractId)))
      if (event.eventType === "Deleted" || p.netPos === 0) {
        await db.delete(providerPositions).where(where)
      } else {
        const specs = await deps.instruments.resolve(api, [p.contractId])
        const n = normalizePosition(env, p, specs)
        await db
          .insert(providerPositions)
          .values({ connectionId: connection.id, provider: "tradovate", environment: env, providerAccountId: n.providerAccountId, contractId: n.contractId, symbol: n.symbol, netQuantity: String(n.netQuantity), averagePrice: n.averagePrice == null ? null : String(n.averagePrice) })
          .onConflictDoUpdate({ target: [providerPositions.connectionId, providerPositions.environment, providerPositions.providerAccountId, providerPositions.contractId], set: { netQuantity: String(n.netQuantity), averagePrice: n.averagePrice == null ? null : String(n.averagePrice), updatedAt: new Date() } })
      }
      return { tradesDirty: false }
    }
    case "cashBalance": {
      const b = e as unknown as TvCashBalance
      if (typeof b.accountId !== "number") return { tradesDirty: false }
      const [row] = await db
        .select()
        .from(providerAccounts)
        .where(and(eq(providerAccounts.connectionId, connection.id), eq(providerAccounts.environment, env), eq(providerAccounts.providerAccountId, String(b.accountId))))
      if (row) await upsertAccount(connection, env, { id: b.accountId, name: row.accountName, accountType: row.accountType ?? undefined, active: row.status === "active" }, b)
      return { tradesDirty: false }
    }
    case "account": {
      const a = e as unknown as { id: number; name: string; active?: boolean; archived?: boolean; accountType?: string }
      if (typeof a.id !== "number" || typeof a.name !== "string") return { tradesDirty: false }
      await upsertAccount(connection, env, a, null)
      return { tradesDirty: false }
    }
    default:
      return { tradesDirty: false }
  }
}

// The initial payload of user/syncrequest (entity arrays), stored the same
// way — a free reconciliation every time a socket (re)connects.
export async function ingestSyncSnapshot(connection: TradingConnection, environment: string, entities: Record<string, unknown[]>, api: TradovateApi, deps: SyncDeps, caches: RealtimeCaches): Promise<{ tradesDirty: boolean }> {
  const orders = (entities.orders ?? []) as TvOrder[]
  for (const o of orders) if (typeof o.id === "number" && typeof o.accountId === "number") envMap(caches.orderAccount, environment).set(o.id, o.accountId)
  const fees = (entities.fillFees ?? []) as TvFillFee[]
  for (const f of fees) if (typeof f.id === "number") envMap(caches.fees, environment).set(f.id, f)
  await upsertOrders(connection, environment, orders.filter((o) => typeof o.id === "number"), api, deps)
  const fills = ((entities.fills ?? []) as TvFill[]).filter((f) => typeof f.id === "number")
  const stored = fills.length ? await normalizeAndStoreFills(connection, environment, fills, fees, orders, api, deps) : { inserted: 0, changed: 0 }
  return { tradesDirty: stored.inserted + stored.changed > 0 }
}

export async function markTradesDirty(connectionId: number) {
  await db.update(tradingConnections).set({ tradesDirtyAt: new Date(), updatedAt: new Date() }).where(eq(tradingConnections.id, connectionId))
}
