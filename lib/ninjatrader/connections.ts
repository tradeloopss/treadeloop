import { and, desc, eq, isNull, max, count } from "drizzle-orm"
import { db } from "@/lib/db"
import { providerAccounts, providerDeviceKeys, providerExecutions, tradingConnections } from "@/lib/db/schema"
import { newDeviceKey } from "@/lib/ninjatrader/keys"
import { brokerFor, ENVIRONMENT } from "@/lib/ninjatrader/payload"
import { PROVIDER, realtimeState } from "@/lib/ninjatrader/sync"

// What the Accounts page and the Add account window show for the NinjaTrader
// add-on: the installed add-ons (by key — never the key itself) and the
// accounts they've reported. Plus the few writes the UI needs.

export const MAX_ACTIVE_KEYS = 10

export interface NinjaTraderDeviceView {
  id: number
  label: string | null
  keyHint: string
  clientVersion: string | null
  createdAt: string
  lastSeenAt: string | null
  lastSyncAt: string | null
  lastStatus: string | null
  lastError: string | null
  online: boolean
}

export interface NinjaTraderAccountView {
  id: number // provider_accounts row
  name: string
  broker: string
  ntProvider: string | null
  connectionName: string | null
  enabled: boolean
  tradingAccountId: number | null
  planLimited: boolean // enabled, but no journal account: over the Essential allowance
  currency: string
  balance: number | null
  equity: number | null
  executions: number
  lastExecutionAt: string | null
}

export interface NinjaTraderView {
  connectionId: number | null
  online: boolean
  lastSeenAt: string | null
  devices: NinjaTraderDeviceView[]
  accounts: NinjaTraderAccountView[]
}

const iso = (d: Date | null) => (d ? d.toISOString() : null)

export async function ninjaTraderViewFor(userId: string): Promise<NinjaTraderView> {
  const devices = await db
    .select()
    .from(providerDeviceKeys)
    .where(and(eq(providerDeviceKeys.userId, userId), eq(providerDeviceKeys.provider, PROVIDER), isNull(providerDeviceKeys.revokedAt)))
    .orderBy(desc(providerDeviceKeys.createdAt))
  const [connection] = await db
    .select({ id: tradingConnections.id })
    .from(tradingConnections)
    .where(and(eq(tradingConnections.userId, userId), eq(tradingConnections.provider, PROVIDER), eq(tradingConnections.environment, ENVIRONMENT)))

  let accounts: NinjaTraderAccountView[] = []
  if (connection) {
    const rows = await db.select().from(providerAccounts).where(eq(providerAccounts.connectionId, connection.id)).orderBy(providerAccounts.accountName)
    const stats = await db
      .select({ account: providerExecutions.providerAccountId, n: count(), last: max(providerExecutions.timestamp) })
      .from(providerExecutions)
      .where(eq(providerExecutions.connectionId, connection.id))
      .groupBy(providerExecutions.providerAccountId)
    const byAccount = new Map(stats.map((s) => [s.account, s]))
    accounts = rows.map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>
      const s = byAccount.get(r.providerAccountId)
      const ntProvider = typeof meta.ntProvider === "string" ? meta.ntProvider : null
      return {
        id: r.id,
        name: r.accountName,
        broker: brokerFor(ntProvider),
        ntProvider,
        connectionName: typeof meta.connection === "string" ? meta.connection : null,
        enabled: r.enabled,
        tradingAccountId: r.tradingAccountId,
        planLimited: r.enabled && r.tradingAccountId == null,
        currency: r.currency,
        balance: r.balance == null ? null : Number(r.balance),
        equity: r.equity == null ? null : Number(r.equity),
        executions: s ? Number(s.n) : 0,
        lastExecutionAt: s?.last ? iso(new Date(s.last)) : null,
      }
    })
  }

  const lastSeen = devices.reduce<Date | null>((m, d) => (d.lastSeenAt && (!m || d.lastSeenAt > m) ? d.lastSeenAt : m), null)
  return {
    connectionId: connection?.id ?? null,
    online: realtimeState(lastSeen) === "live",
    lastSeenAt: iso(lastSeen),
    devices: devices.map((d) => ({
      id: d.id,
      label: d.label,
      keyHint: d.keyHint,
      clientVersion: d.clientVersion,
      createdAt: d.createdAt.toISOString(),
      lastSeenAt: iso(d.lastSeenAt),
      lastSyncAt: iso(d.lastSyncAt),
      lastStatus: d.lastStatus,
      lastError: d.lastError,
      online: realtimeState(d.lastSeenAt) === "live",
    })),
    accounts,
  }
}

// A key for one more add-on download. Beyond MAX_ACTIVE_KEYS the oldest
// unused-longest key is revoked, so old downloads can't pile up.
export async function createDeviceKey(userId: string): Promise<{ id: number; key: string }> {
  const { key, hash, hint } = newDeviceKey()
  const [row] = await db.insert(providerDeviceKeys).values({ userId, provider: PROVIDER, keyHash: hash, keyHint: hint }).returning({ id: providerDeviceKeys.id })
  const active = await db
    .select({ id: providerDeviceKeys.id, lastSeenAt: providerDeviceKeys.lastSeenAt, createdAt: providerDeviceKeys.createdAt })
    .from(providerDeviceKeys)
    .where(and(eq(providerDeviceKeys.userId, userId), eq(providerDeviceKeys.provider, PROVIDER), isNull(providerDeviceKeys.revokedAt)))
  if (active.length > MAX_ACTIVE_KEYS) {
    const stalest = active
      .filter((a) => a.id !== row.id)
      .sort((a, b) => (a.lastSeenAt ?? a.createdAt).getTime() - (b.lastSeenAt ?? b.createdAt).getTime())
      .slice(0, active.length - MAX_ACTIVE_KEYS)
    for (const s of stalest) await db.update(providerDeviceKeys).set({ revokedAt: new Date() }).where(eq(providerDeviceKeys.id, s.id))
  }
  return { id: row.id, key }
}

export async function revokeDevice(userId: string, id: number): Promise<boolean> {
  const done = await db
    .update(providerDeviceKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(providerDeviceKeys.id, id), eq(providerDeviceKeys.userId, userId), isNull(providerDeviceKeys.revokedAt)))
    .returning({ id: providerDeviceKeys.id })
  return done.length > 0
}

// "Disconnect" on one account: its fills stop turning into trades (the
// trades already imported stay). Every add-on key is revoked once no account
// is left syncing, so nothing keeps posting.
export async function setAccountEnabled(userId: string, rowId: number, enabled: boolean): Promise<boolean> {
  const [row] = await db
    .select({ id: providerAccounts.id, connectionId: providerAccounts.connectionId })
    .from(providerAccounts)
    .innerJoin(tradingConnections, eq(tradingConnections.id, providerAccounts.connectionId))
    .where(and(eq(providerAccounts.id, rowId), eq(tradingConnections.userId, userId), eq(tradingConnections.provider, PROVIDER)))
  if (!row) return false
  await db.update(providerAccounts).set({ enabled, updatedAt: new Date() }).where(eq(providerAccounts.id, row.id))
  if (!enabled) {
    const stillOn = await db
      .select({ id: providerAccounts.id })
      .from(providerAccounts)
      .where(and(eq(providerAccounts.connectionId, row.connectionId), eq(providerAccounts.enabled, true)))
    if (stillOn.length === 0) {
      await db
        .update(providerDeviceKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(providerDeviceKeys.userId, userId), eq(providerDeviceKeys.provider, PROVIDER), isNull(providerDeviceKeys.revokedAt)))
    }
  }
  return true
}
