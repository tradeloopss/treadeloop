import { and, desc, eq, inArray, max, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { providerAccounts, tradingConnections } from "@/lib/db/schema"
import { getAppSetting, setAppSetting } from "@/lib/app-settings"
import { tradovateAvailability, type TradovateMode } from "@/lib/tradovate/config"

// Admin data layer for the NinjaTrader (Tradovate OAuth) integration: the kill
// switch, the enable/disable gate, and a monitoring overview across all users.
//
// SECURITY: nothing here reads or returns a token, a secret, or an encryption
// key — the overview selects only safe status columns, never the *Enc columns
// on trading_connections. Everything is scoped to provider = "tradovate", so it
// can never touch MT4/MT5 copy trading (those live in metatrader_connections /
// lib/copy and are a completely separate path).

// The kill switch. true = an admin has turned the NinjaTrader integration off.
// Stored in app_settings; independent of the env config and of every other
// provider. Default: not killed.
const KILL_SWITCH_KEY = "ninjatrader_integration_disabled"

export async function integrationKilled(): Promise<boolean> {
  try {
    return (await getAppSetting<boolean>(KILL_SWITCH_KEY)) === true
  } catch {
    // Setting unreadable (pre-migration / DB blip): fail safe to "not killed",
    // since the env gate (mode off) already keeps it dark until configured.
    return false
  }
}

export async function setIntegrationKilled(killed: boolean): Promise<void> {
  await setAppSetting(KILL_SWITCH_KEY, killed === true)
}

export type GateReason = "ok" | "unconfigured" | "killed"
export interface IntegrationGate {
  enabled: boolean
  reason: GateReason
  mode: TradovateMode
}

// Whether "Connect NinjaTrader" and syncing are on right now: the env config
// must be complete (tradovateAvailability) AND no admin kill switch. Checked on
// the server before every connect and every sync.
export async function ninjatraderGate(): Promise<IntegrationGate> {
  const avail = tradovateAvailability()
  if (await integrationKilled()) return { enabled: false, reason: "killed", mode: avail.mode }
  if (!avail.enabled) return { enabled: false, reason: "unconfigured", mode: avail.mode }
  return { enabled: true, reason: "ok", mode: avail.mode }
}

// What configuration is still missing to go live (names only, never values).
export function missingConfiguration(): string[] {
  return tradovateAvailability().missing
}

export interface NinjatraderAdminOverview {
  gate: IntegrationGate
  killSwitch: boolean
  connections: { total: number; connected: number; pending: number; reauth: number; error: number; disconnected: number }
  accounts: { total: number; demo: number; live: number }
  needsReauth: number
  syncFailures: number
  lastSuccessfulSyncAt: string | null
  // the connections currently in trouble, newest first — safe fields only, no tokens
  problems: { connectionId: number; userId: string; environment: string; status: string; syncStage: string | null; errorCount: number; lastSyncError: string | null; lastSyncAt: string | null; realtimeStatus: string }[]
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

// A monitoring snapshot across every user's NinjaTrader connections. Safe to
// show an admin: counts, health and the connections that need attention. No
// account balances, no tokens, no secrets.
export async function ninjatraderAdminOverview(problemLimit = 50): Promise<NinjatraderAdminOverview> {
  const where = eq(tradingConnections.provider, "tradovate")

  const [byStatus, acct, lastOk, problems, killSwitch, gate] = await Promise.all([
    db.select({ status: tradingConnections.status, n: sql<number>`count(*)::int` }).from(tradingConnections).where(where).groupBy(tradingConnections.status),
    db
      .select({ environment: providerAccounts.environment, n: sql<number>`count(*)::int` })
      .from(providerAccounts)
      .innerJoin(tradingConnections, eq(tradingConnections.id, providerAccounts.connectionId))
      .where(where)
      .groupBy(providerAccounts.environment),
    db.select({ at: max(tradingConnections.lastSyncAt) }).from(tradingConnections).where(where),
    db
      .select({
        connectionId: tradingConnections.id,
        userId: tradingConnections.userId,
        environment: tradingConnections.environment,
        status: tradingConnections.status,
        syncStage: tradingConnections.syncStage,
        errorCount: tradingConnections.errorCount,
        lastSyncError: tradingConnections.lastSyncError,
        lastSyncAt: tradingConnections.lastSyncAt,
        realtimeStatus: tradingConnections.realtimeStatus,
      })
      .from(tradingConnections)
      .where(and(where, inArray(tradingConnections.status, ["error", "reauth"])))
      .orderBy(desc(tradingConnections.updatedAt))
      .limit(Math.min(200, Math.max(1, problemLimit))),
    integrationKilled(),
    ninjatraderGate(),
  ])

  const n = (status: string) => byStatus.find((r) => r.status === status)?.n ?? 0
  const connections = {
    total: byStatus.reduce((s, r) => s + r.n, 0),
    connected: n("connected"),
    pending: n("pending"),
    reauth: n("reauth"),
    error: n("error"),
    disconnected: n("disconnected"),
  }
  const demo = acct.find((a) => a.environment === "demo")?.n ?? 0
  const live = acct.find((a) => a.environment === "live")?.n ?? 0

  return {
    gate,
    killSwitch,
    connections,
    accounts: { total: demo + live, demo, live },
    needsReauth: connections.reauth,
    syncFailures: connections.error,
    lastSuccessfulSyncAt: iso(lastOk[0]?.at ?? null),
    problems: problems.map((p) => ({ ...p, lastSyncAt: iso(p.lastSyncAt) })),
  }
}

// An admin "Retry" on one connection: make it due for a fresh sync now, and
// clear an error status so the worker picks it up. Idempotent (running it twice
// is the same as once) and never submits an order — this integration is
// read-only. Returns false if the id isn't a NinjaTrader connection.
export async function adminRetryConnection(connectionId: number): Promise<boolean> {
  const done = await db
    .update(tradingConnections)
    // clear a hard error count so the worker retries it
    .set({ nextSyncAt: new Date(), errorCount: 0, updatedAt: new Date() })
    .where(and(eq(tradingConnections.id, connectionId), eq(tradingConnections.provider, "tradovate"), inArray(tradingConnections.status, ["connected", "pending", "error"])))
    .returning({ id: tradingConnections.id })
  return done.length > 0
}

// An admin "Pause" on one connection: stop it syncing without disconnecting or
// touching its tokens (so Resume just makes it due again). Read-only; never
// closes a position or sends an order.
export async function adminPauseConnection(connectionId: number): Promise<boolean> {
  const done = await db
    .update(tradingConnections)
    .set({ nextSyncAt: null, leaseUntil: null, updatedAt: new Date() })
    .where(and(eq(tradingConnections.id, connectionId), eq(tradingConnections.provider, "tradovate")))
    .returning({ id: tradingConnections.id })
  return done.length > 0
}
