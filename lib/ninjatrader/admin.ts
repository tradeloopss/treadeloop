import { and, desc, eq, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { ninjatraderConnections, providerDeviceKeys, user } from "@/lib/db/schema"
import { PROVIDER, deviceStatus, type DeviceStatus } from "@/lib/ninjatrader/sync"

// Admin monitoring for the device/VPS layer of NinjaTrader (Phase 7): the
// add-on devices (provider_device_keys) traders installed, and the VPS logins
// (ninjatrader_connections) for the operator-run server path. Read-only, and
// never a secret: only a key's last-4 hint and a connection's name are shown —
// no key, no token, no password, no balance.

const iso = (d: Date | null) => (d ? d.toISOString() : null)

export interface AdminDeviceRow {
  id: number
  userId: string
  userEmail: string | null
  label: string | null // hostname
  os: string | null
  keyHint: string
  clientVersion: string | null
  status: string // the stored lifecycle status
  layers: DeviceStatus // connector / NinjaTrader / broker
  lastSeenAt: string | null
  lastHeartbeatAt: string | null
  lastSyncAt: string | null
  lastError: string | null
  queueDepth: number | null
  errorCount: number
  createdAt: string
  revokedAt: string | null
}

export interface DevicesOverview {
  devices: AdminDeviceRow[]
  total: number
  online: number
  errored: number
}

export async function ninjatraderDevicesOverview(limit = 200): Promise<DevicesOverview> {
  const rows = await db
    .select({ d: providerDeviceKeys, email: user.email })
    .from(providerDeviceKeys)
    .leftJoin(user, eq(user.id, providerDeviceKeys.userId))
    .where(eq(providerDeviceKeys.provider, PROVIDER))
    .orderBy(desc(providerDeviceKeys.lastSeenAt), desc(providerDeviceKeys.createdAt))
    .limit(limit)
  const devices: AdminDeviceRow[] = rows.map(({ d, email }) => ({
    id: d.id,
    userId: d.userId,
    userEmail: email ?? null,
    label: d.label,
    os: d.os,
    keyHint: d.keyHint,
    clientVersion: d.clientVersion,
    status: d.status,
    layers: deviceStatus(d),
    lastSeenAt: iso(d.lastSeenAt),
    lastHeartbeatAt: iso(d.lastHeartbeatAt),
    lastSyncAt: iso(d.lastSyncAt),
    lastError: d.lastError,
    queueDepth: d.queueDepth,
    errorCount: d.errorCount,
    createdAt: d.createdAt.toISOString(),
    revokedAt: iso(d.revokedAt),
  }))
  return {
    devices,
    total: devices.length,
    online: devices.filter((x) => x.revokedAt == null && x.layers.connector === "online").length,
    errored: devices.filter((x) => x.revokedAt == null && x.errorCount > 0).length,
  }
}

export interface AdminVpsLoginRow {
  id: number
  userId: string
  userEmail: string | null
  ntConnectionName: string
  connectionKind: string | null
  status: string
  statusMessage: string | null
  lastSeenAt: string | null
  lastFillAt: string | null
  errorCount: number
  createdAt: string
}

export async function ninjatraderVpsLoginsOverview(limit = 200): Promise<{ logins: AdminVpsLoginRow[]; total: number }> {
  const rows = await db
    .select({ c: ninjatraderConnections, email: user.email })
    .from(ninjatraderConnections)
    .leftJoin(user, eq(user.id, ninjatraderConnections.userId))
    .orderBy(desc(ninjatraderConnections.createdAt))
    .limit(limit)
  const logins: AdminVpsLoginRow[] = rows.map(({ c, email }) => ({
    id: c.id,
    userId: c.userId,
    userEmail: email ?? null,
    ntConnectionName: c.ntConnectionName,
    connectionKind: c.connectionKind,
    status: c.status,
    statusMessage: c.statusMessage,
    lastSeenAt: iso(c.lastSeenAt),
    lastFillAt: iso(c.lastFillAt),
    errorCount: c.errorCount,
    createdAt: c.createdAt.toISOString(),
  }))
  return { logins, total: logins.length }
}

// Admin revoke of one add-on device, whoever owns it. Returns false if it was
// already revoked or isn't a NinjaTrader device.
export async function adminRevokeDevice(deviceId: number): Promise<boolean> {
  const done = await db
    .update(providerDeviceKeys)
    .set({ revokedAt: new Date(), status: "revoked" })
    .where(and(eq(providerDeviceKeys.id, deviceId), eq(providerDeviceKeys.provider, PROVIDER), isNull(providerDeviceKeys.revokedAt)))
    .returning({ userId: providerDeviceKeys.userId })
  return done.length > 0
}

// The user a device belongs to (for force-reconcile from the admin table).
export async function deviceOwner(deviceId: number): Promise<string | null> {
  const [row] = await db.select({ userId: providerDeviceKeys.userId }).from(providerDeviceKeys).where(and(eq(providerDeviceKeys.id, deviceId), eq(providerDeviceKeys.provider, PROVIDER)))
  return row?.userId ?? null
}
