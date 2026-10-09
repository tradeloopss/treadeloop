"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/admin/guard"
import { logAdminAction } from "@/lib/admin/audit"
import { adminDestroyVps, adminRebootVps, adminReconcileVps, instanceOwner, revokeVpsAgent } from "@/lib/vps/server"

// Admin controls for managed VPS instances. Each re-checks admin permission on
// the server and records an audit entry. All are read-only toward the broker —
// no order is ever placed — and none expose a key, token, password or secret.

type Result = { ok: true } | { ok: false; error: string }

export async function rebootVpsInstance(instanceId: number): Promise<Result> {
  const admin = await requireAdmin({ brokers: ["sync"] })
  if (!Number.isInteger(instanceId)) return { ok: false, error: "Bad instance id." }
  const owner = await instanceOwner(instanceId)
  if (!(await adminRebootVps(instanceId))) return { ok: false, error: "That VPS can't be rebooted (no provider server yet)." }
  await logAdminAction(admin, "vps.reboot", owner, { instanceId })
  revalidatePath("/admin/ninjatrader")
  return { ok: true }
}

export async function destroyVpsInstance(instanceId: number): Promise<Result> {
  const admin = await requireAdmin({ brokers: ["sync"] })
  if (!Number.isInteger(instanceId)) return { ok: false, error: "Bad instance id." }
  const owner = await instanceOwner(instanceId)
  if (!(await adminDestroyVps(instanceId))) return { ok: false, error: "No such VPS instance." }
  await logAdminAction(admin, "vps.destroy", owner, { instanceId })
  revalidatePath("/admin/ninjatrader")
  return { ok: true }
}

export async function revokeVpsInstanceAgent(instanceId: number): Promise<Result> {
  const admin = await requireAdmin({ brokers: ["sync"] })
  if (!Number.isInteger(instanceId)) return { ok: false, error: "Bad instance id." }
  const owner = await instanceOwner(instanceId)
  if (!(await revokeVpsAgent(instanceId))) return { ok: false, error: "No such VPS instance." }
  await logAdminAction(admin, "vps.revoke_agent", owner, { instanceId })
  revalidatePath("/admin/ninjatrader")
  return { ok: true }
}

export async function reconcileVpsInstance(instanceId: number): Promise<Result> {
  const admin = await requireAdmin({ brokers: ["sync"] })
  if (!Number.isInteger(instanceId)) return { ok: false, error: "Bad instance id." }
  const owner = await instanceOwner(instanceId)
  if (!(await adminReconcileVps(instanceId))) return { ok: false, error: "No such VPS instance." }
  await logAdminAction(admin, "vps.reconcile", owner, { instanceId })
  revalidatePath("/admin/ninjatrader")
  return { ok: true }
}
