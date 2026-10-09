"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/admin/guard"
import { logAdminAction } from "@/lib/admin/audit"
import { adminPauseConnection, adminRetryConnection, setIntegrationKilled } from "@/lib/tradovate/admin"
import { adminRevokeDevice, deviceOwner } from "@/lib/ninjatrader/admin"
import { reconcileNinjaTrader } from "@/lib/ninjatrader/reconcile"

// Admin controls for the NinjaTrader (Tradovate OAuth) integration. Every one
// re-checks the admin's permission on the server (requireAdmin throws for
// anyone without it) and records an audit entry. They are read-only with
// respect to the broker: retry/pause only change when TradeLoop next reads the
// account — no order is ever placed, and nothing here can touch MT4/MT5 copy
// trading (those are a separate provider and path).

type Result = { ok: true } | { ok: false; error: string }

// The integration-wide kill switch. Turning it off stops new NinjaTrader
// connections and syncs; it does not affect any other provider.
export async function setNinjatraderKillSwitch(disabled: boolean): Promise<Result> {
  const admin = await requireAdmin({ brokers: ["sync"] })
  await setIntegrationKilled(disabled === true)
  await logAdminAction(admin, "ninjatrader.kill_switch", null, { disabled: disabled === true })
  revalidatePath("/admin/ninjatrader")
  return { ok: true }
}

export async function retryNinjatraderConnection(connectionId: number): Promise<Result> {
  const admin = await requireAdmin({ brokers: ["sync"] })
  if (!Number.isInteger(connectionId)) return { ok: false, error: "Bad connection id." }
  if (!(await adminRetryConnection(connectionId))) return { ok: false, error: "That isn't a NinjaTrader connection, or it can't be retried." }
  await logAdminAction(admin, "ninjatrader.retry", null, { connectionId })
  revalidatePath("/admin/ninjatrader")
  return { ok: true }
}

export async function pauseNinjatraderConnection(connectionId: number): Promise<Result> {
  const admin = await requireAdmin({ brokers: ["sync"] })
  if (!Number.isInteger(connectionId)) return { ok: false, error: "Bad connection id." }
  if (!(await adminPauseConnection(connectionId))) return { ok: false, error: "That isn't a NinjaTrader connection." }
  await logAdminAction(admin, "ninjatrader.pause", null, { connectionId })
  revalidatePath("/admin/ninjatrader")
  return { ok: true }
}

// Revoke one trader's add-on device. The add-on stops being accepted at once
// (its next post gets 401); the trader can download or pair a new one. No order
// is placed, and MT4/MT5 is untouched.
export async function revokeNinjatraderDevice(deviceId: number): Promise<Result> {
  const admin = await requireAdmin({ brokers: ["sync"] })
  if (!Number.isInteger(deviceId)) return { ok: false, error: "Bad device id." }
  const owner = await deviceOwner(deviceId)
  if (!(await adminRevokeDevice(deviceId))) return { ok: false, error: "That device was already revoked, or isn't a NinjaTrader add-on." }
  await logAdminAction(admin, "ninjatrader.device_revoke", owner, { deviceId })
  revalidatePath("/admin/ninjatrader")
  return { ok: true }
}

// Force a reconcile for the device's owner: rebuild their journal from the
// stored fills. Idempotent — never creates duplicates or deletes data.
export async function forceReconcileNinjatraderDevice(deviceId: number): Promise<Result> {
  const admin = await requireAdmin({ brokers: ["sync"] })
  if (!Number.isInteger(deviceId)) return { ok: false, error: "Bad device id." }
  const owner = await deviceOwner(deviceId)
  if (!owner) return { ok: false, error: "That isn't a NinjaTrader add-on." }
  const res = await reconcileNinjaTrader(owner)
  if (!res.ok) return { ok: false, error: "That user has no NinjaTrader connection to reconcile." }
  await logAdminAction(admin, "ninjatrader.force_reconcile", owner, { deviceId, ...res.summary })
  revalidatePath("/admin/ninjatrader")
  return { ok: true }
}
