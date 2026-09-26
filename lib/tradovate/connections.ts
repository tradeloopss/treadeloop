import { and, desc, eq, inArray, max, count, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { providerAccounts, providerExecutions, providerPositions, tradingConnections } from "@/lib/db/schema"
import { tlog } from "@/lib/tradovate/log"
import { defaultSyncDeps, runTradovateSync } from "@/lib/tradovate/sync"
import { buildTradovateTrades } from "@/lib/tradovate/trades"

// The signed-in user's Tradovate connections, for the Accounts page, the
// connect window's progress view and the /api/integrations/tradovate routes.
// Views carry no tokens or secrets. Every lookup is scoped to the user, so a
// connection id from the browser can only ever reach its owner's data.

export interface TradovateAccountView {
  id: number
  environment: string
  providerAccountId: string
  accountName: string
  accountType: string | null
  currency: string
  balance: number | null
  equity: number | null
  enabled: boolean
  status: string
  tradingAccountId: number | null
  executions: number
  lastExecutionAt: string | null
  openPositions: number
}

export interface TradovateConnectionView {
  id: number
  environment: string
  providerUserName: string | null
  status: string
  statusMessage: string | null
  syncStage: string | null
  realtimeStatus: string
  lastSyncAt: string | null
  lastRealtimeEventAt: string | null
  lastReconciledAt: string | null
  lastReconcileSummary: Record<string, number> | null
  lastSyncError: string | null
  errorCount: number
  createdAt: string
  accounts: TradovateAccountView[]
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

export async function tradovateConnectionsFor(userId: string, connectionId?: number): Promise<TradovateConnectionView[]> {
  const rows = await db
    .select()
    .from(tradingConnections)
    .where(and(eq(tradingConnections.userId, userId), eq(tradingConnections.provider, "tradovate"), ...(connectionId != null ? [eq(tradingConnections.id, connectionId)] : [])))
    .orderBy(desc(tradingConnections.createdAt))
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const accounts = await db.select().from(providerAccounts).where(inArray(providerAccounts.connectionId, ids)).orderBy(providerAccounts.environment, providerAccounts.accountName)
  const execStats = await db
    .select({ connectionId: providerExecutions.connectionId, environment: providerExecutions.environment, account: providerExecutions.providerAccountId, n: count(), last: max(providerExecutions.timestamp) })
    .from(providerExecutions)
    .where(inArray(providerExecutions.connectionId, ids))
    .groupBy(providerExecutions.connectionId, providerExecutions.environment, providerExecutions.providerAccountId)
  const posStats = await db
    .select({ connectionId: providerPositions.connectionId, environment: providerPositions.environment, account: providerPositions.providerAccountId, n: count() })
    .from(providerPositions)
    .where(inArray(providerPositions.connectionId, ids))
    .groupBy(providerPositions.connectionId, providerPositions.environment, providerPositions.providerAccountId)
  const key = (c: number, e: string, a: string) => `${c}:${e}:${a}`
  const execBy = new Map(execStats.map((s) => [key(s.connectionId, s.environment, s.account), s]))
  const posBy = new Map(posStats.map((s) => [key(s.connectionId, s.environment, s.account), s.n]))

  return rows.map((r) => ({
    id: r.id,
    environment: r.environment,
    providerUserName: r.providerUserName,
    status: r.status,
    statusMessage: r.statusMessage,
    syncStage: r.syncStage,
    realtimeStatus: r.realtimeStatus,
    lastSyncAt: iso(r.lastSyncAt),
    lastRealtimeEventAt: iso(r.lastRealtimeEventAt),
    lastReconciledAt: iso(r.lastReconciledAt),
    lastReconcileSummary: r.lastReconcileSummary ?? null,
    lastSyncError: r.lastSyncError,
    errorCount: r.errorCount,
    createdAt: r.createdAt.toISOString(),
    accounts: accounts
      .filter((a) => a.connectionId === r.id)
      .map((a) => {
        const stats = execBy.get(key(r.id, a.environment, a.providerAccountId))
        return {
          id: a.id,
          environment: a.environment,
          providerAccountId: a.providerAccountId,
          accountName: a.accountName,
          accountType: a.accountType,
          currency: a.currency,
          balance: a.balance == null ? null : Number(a.balance),
          equity: a.equity == null ? null : Number(a.equity),
          enabled: a.enabled,
          status: a.status,
          tradingAccountId: a.tradingAccountId,
          executions: stats?.n ?? 0,
          lastExecutionAt: stats?.last ? new Date(stats.last).toISOString() : null,
          openPositions: posBy.get(key(r.id, a.environment, a.providerAccountId)) ?? 0,
        }
      }),
  }))
}

async function owned(userId: string, connectionId: number) {
  const [row] = await db
    .select()
    .from(tradingConnections)
    .where(and(eq(tradingConnections.id, connectionId), eq(tradingConnections.userId, userId), eq(tradingConnections.provider, "tradovate")))
  return row ?? null
}

export type ActionResult = { ok: true } | { ok: false; error: string }

const MANUAL_SYNC_GAP_MS = 20_000

// "Sync now" / "Reconcile": makes the connection due now; the sync worker
// picks it up within seconds (mock connections sync right here, after the
// response). Throttled per connection.
export async function requestTradovateSync(userId: string, connectionId: number, runInline: (fn: () => Promise<void>) => void): Promise<ActionResult> {
  const row = await owned(userId, connectionId)
  if (!row) return { ok: false, error: "Connection not found." }
  if (row.status === "disconnected") return { ok: false, error: "This Tradovate connection is disconnected — connect it again to sync." }
  if (row.status === "reauth") return { ok: false, error: "Tradovate authorization expired. Please reconnect your account." }
  if (row.lastManualSyncAt && Date.now() - row.lastManualSyncAt.getTime() < MANUAL_SYNC_GAP_MS) return { ok: true } // already on its way
  await db
    .update(tradingConnections)
    .set({ nextSyncAt: new Date(), lastManualSyncAt: new Date(), ...(row.status === "error" ? { status: "pending", errorCount: 0 } : {}), updatedAt: new Date() })
    .where(eq(tradingConnections.id, connectionId))
  if (row.environment === "mock") runInline(() => runInlineTradovateSync(connectionId, "manual"))
  tlog("sync_requested", { connectionId })
  return { ok: true }
}

// The whole pipeline in-process: REST sync, then trades. Used for mock
// connections (no worker in local development).
export async function runInlineTradovateSync(connectionId: number, trigger: "manual" | "connect"): Promise<void> {
  try {
    const { tradesDirty } = await runTradovateSync(connectionId, defaultSyncDeps(), trigger)
    if (tradesDirty) await buildTradovateTrades(connectionId)
  } catch (err) {
    tlog("inline_sync_failed", { connectionId, message: err instanceof Error ? err.message : String(err) }, "warn")
  }
}

// Disconnect: stops syncing and deletes the saved tokens. Accounts, trades and
// the raw history stay; connecting the same Tradovate login again resumes on
// the same rows without duplicating anything.
export async function disconnectTradovate(userId: string, connectionId: number): Promise<ActionResult> {
  const row = await owned(userId, connectionId)
  if (!row) return { ok: false, error: "Connection not found." }
  await db
    .update(tradingConnections)
    .set({ status: "disconnected", statusMessage: null, accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null, refreshExpiresAt: null, nextSyncAt: null, leaseUntil: null, realtimeStatus: "offline", updatedAt: new Date() })
    .where(eq(tradingConnections.id, connectionId))
  tlog("disconnected", { connectionId })
  return { ok: true }
}

// Disconnect (or reconnect) one account of a login: its trades stop (or
// resume) syncing. Disconnecting the last one disconnects the login.
export async function setTradovateAccountEnabled(userId: string, providerAccountRowId: number, enabled: boolean): Promise<ActionResult> {
  const [account] = await db
    .select({ id: providerAccounts.id, connectionId: providerAccounts.connectionId })
    .from(providerAccounts)
    .innerJoin(tradingConnections, eq(tradingConnections.id, providerAccounts.connectionId))
    .where(and(eq(providerAccounts.id, providerAccountRowId), eq(tradingConnections.userId, userId)))
  if (!account) return { ok: false, error: "Account not found." }
  await db.update(providerAccounts).set({ enabled, updatedAt: new Date() }).where(eq(providerAccounts.id, account.id))
  if (enabled) {
    await db.update(tradingConnections).set({ tradesDirtyAt: new Date(), nextSyncAt: new Date() }).where(eq(tradingConnections.id, account.connectionId))
  } else {
    const [{ remaining }] = await db
      .select({ remaining: sql<number>`count(*)::int` })
      .from(providerAccounts)
      .where(and(eq(providerAccounts.connectionId, account.connectionId), eq(providerAccounts.enabled, true)))
    if (remaining === 0) return disconnectTradovate(userId, account.connectionId)
  }
  return { ok: true }
}

// Same-origin guard for the JSON POST routes (server actions get this from
// Next itself).
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin")
  if (!origin) return false
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))
  } catch {
    return false
  }
}
