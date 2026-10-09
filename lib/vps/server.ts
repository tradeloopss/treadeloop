import { and, desc, eq, isNull, lt, ne } from "drizzle-orm"
import { db } from "@/lib/db"
import { providerDeviceKeys, user, vpsAgentCommands, vpsInstances } from "@/lib/db/schema"
import { hashDeviceKey, newDeviceKey } from "@/lib/ninjatrader/keys"
import { reconcileNinjaTrader } from "@/lib/ninjatrader/reconcile"
import { getVpsProvider } from "./provider"
import { nextStep, statusForStep, statusFromBroker, STATUS_AFTER_PROVISIONING, PROVISION_STEPS, type ProvisionStep } from "./provisioning"
import { layeredHealth, overallHealth, type Health } from "./health"
import type { Layer, VpsStatus } from "./types"
import { tlog } from "@/lib/tradovate/log"

// The managed-VPS service: everything that reads/writes the database sits here
// so the state machine, provider abstraction and health logic stay pure and
// testable. Read-only toward the broker throughout — no order ever leaves
// TradeLoop, and no broker password is stored. See docs/managed-vps-architecture.md.

export const AGENT_PROVIDER = "vps_agent"
const PROVISIONING_STATUSES: VpsStatus[] = ["provisioning", "installing", "configuring"]
export const ALLOWED_COMMANDS = ["ping", "health", "sync_now", "reconcile", "reconnect", "collect_logs"] as const
export type AgentCommand = (typeof ALLOWED_COMMANDS)[number]
const COMMAND_TTL_MS = 5 * 60 * 1000

type InstanceRow = typeof vpsInstances.$inferSelect
const iso = (d: Date | null) => (d ? d.toISOString() : null)

function agentCloudUrl(): string {
  const base = (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "").trim().replace(/\/+$/, "")
  return `${/^https?:\/\//.test(base) ? base : "https://www.tradeloop.pro"}/api/vps/agent`
}

const layerOf = (s: string): boolean | null => (s === "online" ? true : s === "offline" ? false : null)

function healthOf(inst: InstanceRow, now = Date.now()): Health {
  return layeredHealth({
    status: inst.status as VpsStatus,
    agentLastHeartbeatAt: inst.lastHeartbeatAt,
    ninjaTraderRunning: layerOf(inst.ninjaTraderStatus),
    brokerConnected: layerOf(inst.brokerStatus),
    now,
  })
}

// ---------------------------------------------------------------- provisioning

// One managed VPS per user. Reuses an existing, not-destroyed instance rather
// than provisioning a second.
export async function createVpsInstance(userId: string): Promise<{ instanceId: number; status: VpsStatus; reused: boolean }> {
  const [existing] = await db.select().from(vpsInstances).where(and(eq(vpsInstances.userId, userId), ne(vpsInstances.status, "destroyed"))).orderBy(desc(vpsInstances.createdAt))
  if (existing) return { instanceId: existing.id, status: existing.status as VpsStatus, reused: true }
  const provider = getVpsProvider()
  const [row] = await db.insert(vpsInstances).values({ userId, provider: provider.id, status: "provisioning", provisioningStep: "create_server" }).returning()
  tlog("vps_instance_created", { userId, instanceId: row.id, provider: provider.id, real: provider.real })
  return { instanceId: row.id, status: "provisioning", reused: false }
}

// Mints the agent's device key. Only the SHA-256 hash is stored; the plaintext
// is returned once, to be baked into the VM's user-data at create time and
// never persisted or logged.
async function mintAgentKey(userId: string, vpsInstanceId: number): Promise<{ id: number; key: string }> {
  const { key, hash, hint } = newDeviceKey()
  const [row] = await db.insert(providerDeviceKeys).values({ userId, provider: AGENT_PROVIDER, keyHash: hash, keyHint: hint, vpsInstanceId, status: "pairing" }).returning({ id: providerDeviceKeys.id })
  return { id: row.id, key }
}

// Runs the current provisioning step through the provider, then advances. Only
// create_server does real provider work in this MVP; the in-VM install/config
// steps are a real-provider concern (documented, and a no-op transition under
// the mock provider — which never claims a real VM exists).
export async function advanceProvisioning(instanceId: number): Promise<InstanceRow> {
  const [inst] = await db.select().from(vpsInstances).where(eq(vpsInstances.id, instanceId))
  if (!inst) throw new Error("No such VPS instance.")
  const step = inst.provisioningStep as ProvisionStep | null
  if (!step || !PROVISIONING_STATUSES.includes(inst.status as VpsStatus)) return inst
  const provider = getVpsProvider()
  try {
    if (step === "create_server") {
      const agent = await mintAgentKey(inst.userId, inst.id)
      const info = await provider.createServer({ userId: inst.userId, instanceId: inst.id, agentKey: agent.key, cloudUrl: agentCloudUrl() })
      await db
        .update(vpsInstances)
        .set({ deviceKeyId: agent.id, providerServerId: info.providerServerId, hostname: info.hostname, publicIp: info.publicIp, region: info.region, operatingSystem: info.operatingSystem, updatedAt: new Date() })
        .where(eq(vpsInstances.id, inst.id))
    }
    const next = nextStep(step)
    if (next) {
      await db.update(vpsInstances).set({ provisioningStep: next, status: statusForStep(next), updatedAt: new Date() }).where(eq(vpsInstances.id, inst.id))
    } else {
      await db.update(vpsInstances).set({ provisioningStep: null, status: STATUS_AFTER_PROVISIONING, updatedAt: new Date() }).where(eq(vpsInstances.id, inst.id))
    }
  } catch (err) {
    await db.update(vpsInstances).set({ status: "error", lastError: (err instanceof Error ? err.message : String(err)).slice(0, 300), updatedAt: new Date() }).where(eq(vpsInstances.id, inst.id))
  }
  const [updated] = await db.select().from(vpsInstances).where(eq(vpsInstances.id, instanceId))
  return updated
}

// ---------------------------------------------------------------- views

export interface VpsInstanceView {
  id: number
  status: VpsStatus
  provider: string
  simulated: boolean // true when a mock/dev provider backs it — shown to the user, never hidden
  hostname: string | null
  publicIp: string | null
  region: string | null
  operatingSystem: string | null
  provisioningStep: string | null
  provisioningProgress: { done: number; total: number }
  health: Health
  overall: Layer
  addonVersion: string | null
  lastHeartbeatAt: string | null
  lastSyncAt: string | null
  lastError: string | null
  createdAt: string
}

function toView(inst: InstanceRow, simulated: boolean): VpsInstanceView {
  const step = inst.provisioningStep as ProvisionStep | null
  const done = step ? PROVISION_STEPS.indexOf(step) : PROVISION_STEPS.length
  const health = healthOf(inst)
  return {
    id: inst.id,
    status: inst.status as VpsStatus,
    provider: inst.provider,
    simulated,
    hostname: inst.hostname,
    publicIp: inst.publicIp,
    region: inst.region,
    operatingSystem: inst.operatingSystem,
    provisioningStep: inst.provisioningStep,
    provisioningProgress: { done: Math.max(0, done), total: PROVISION_STEPS.length },
    health,
    overall: overallHealth(health),
    addonVersion: inst.addonVersion,
    lastHeartbeatAt: iso(inst.lastHeartbeatAt),
    lastSyncAt: iso(inst.lastSyncAt),
    lastError: inst.lastError,
    createdAt: inst.createdAt.toISOString(),
  }
}

export async function vpsInstanceView(userId: string): Promise<VpsInstanceView | null> {
  const [inst] = await db.select().from(vpsInstances).where(and(eq(vpsInstances.userId, userId), ne(vpsInstances.status, "destroyed"))).orderBy(desc(vpsInstances.createdAt))
  if (!inst) return null
  let simulated = true
  try {
    simulated = !getVpsProvider().real
  } catch {
    simulated = true
  }
  return toView(inst, simulated)
}

// The status route calls this: for the mock provider it advances one step per
// poll so the simulated pipeline progresses; a real provider is driven by the
// provisioning worker / agent instead, never by client polls.
export async function viewAndMaybeAdvance(userId: string): Promise<VpsInstanceView | null> {
  const [inst] = await db.select().from(vpsInstances).where(and(eq(vpsInstances.userId, userId), ne(vpsInstances.status, "destroyed"))).orderBy(desc(vpsInstances.createdAt))
  if (!inst) return null
  let provider
  try {
    provider = getVpsProvider()
  } catch {
    return toView(inst, true)
  }
  if (!provider.real && PROVISIONING_STATUSES.includes(inst.status as VpsStatus) && inst.provisioningStep) {
    await advanceProvisioning(inst.id)
  }
  return vpsInstanceView(userId)
}

// ---------------------------------------------------------------- agent auth

export interface AgentContext {
  deviceId: number
  vpsInstanceId: number
  userId: string
}

export async function agentForKey(key: string | null): Promise<AgentContext | null> {
  if (!key) return null
  const [row] = await db
    .select({ id: providerDeviceKeys.id, userId: providerDeviceKeys.userId, vpsInstanceId: providerDeviceKeys.vpsInstanceId })
    .from(providerDeviceKeys)
    .where(and(eq(providerDeviceKeys.keyHash, hashDeviceKey(key)), eq(providerDeviceKeys.provider, AGENT_PROVIDER), isNull(providerDeviceKeys.revokedAt)))
  if (!row || row.vpsInstanceId == null) return null
  return { deviceId: row.id, vpsInstanceId: row.vpsInstanceId, userId: row.userId }
}

export interface AgentReport {
  agentUp?: boolean
  ninjaTraderRunning?: boolean | null
  brokerConnected?: boolean | null
  addonVersion?: string | null
  version?: string | null
}

export async function recordAgentHeartbeat(ctx: AgentContext, report: AgentReport): Promise<void> {
  const [inst] = await db.select().from(vpsInstances).where(eq(vpsInstances.id, ctx.vpsInstanceId))
  if (!inst) return
  const now = new Date()
  const nt = report.ninjaTraderRunning == null ? "unknown" : report.ninjaTraderRunning ? "online" : "offline"
  const broker = report.brokerConnected == null ? "unknown" : report.brokerConnected ? "online" : "offline"
  const status = statusFromBroker(inst.status as VpsStatus, report.brokerConnected === true)
  await db
    .update(vpsInstances)
    .set({
      lastHeartbeatAt: now,
      agentStatus: "online",
      ninjaTraderStatus: nt,
      brokerStatus: broker,
      status,
      ...(report.addonVersion ? { addonVersion: report.addonVersion } : {}),
      lastError: null,
      updatedAt: now,
    })
    .where(eq(vpsInstances.id, ctx.vpsInstanceId))
  await db.update(providerDeviceKeys).set({ lastSeenAt: now, lastHeartbeatAt: now, status: "connected", ...(report.version ? { clientVersion: report.version } : {}) }).where(eq(providerDeviceKeys.id, ctx.deviceId))
}

// ---------------------------------------------------------------- commands

export async function queueCommand(vpsInstanceId: number, userId: string, command: string, issuedBy: string): Promise<{ ok: boolean; error?: string }> {
  if (!(ALLOWED_COMMANDS as readonly string[]).includes(command)) return { ok: false, error: "That command isn't allowed." }
  await db.insert(vpsAgentCommands).values({ vpsInstanceId, userId, command, issuedBy, expiresAt: new Date(Date.now() + COMMAND_TTL_MS) })
  return { ok: true }
}

// The agent polls this. Expires stale commands, then claims the oldest pending
// one for THIS instance (delivered-once).
export async function nextCommandFor(vpsInstanceId: number): Promise<{ id: number; command: string } | null> {
  await db.update(vpsAgentCommands).set({ status: "expired" }).where(and(eq(vpsAgentCommands.vpsInstanceId, vpsInstanceId), eq(vpsAgentCommands.status, "pending"), lt(vpsAgentCommands.expiresAt, new Date())))
  const [row] = await db.select().from(vpsAgentCommands).where(and(eq(vpsAgentCommands.vpsInstanceId, vpsInstanceId), eq(vpsAgentCommands.status, "pending"))).orderBy(vpsAgentCommands.id).limit(1)
  if (!row) return null
  const claimed = await db.update(vpsAgentCommands).set({ status: "delivered", deliveredAt: new Date() }).where(and(eq(vpsAgentCommands.id, row.id), eq(vpsAgentCommands.status, "pending"))).returning({ id: vpsAgentCommands.id })
  if (claimed.length === 0) return null
  return { id: row.id, command: row.command }
}

export async function recordCommandResult(vpsInstanceId: number, commandId: number, ok: boolean, result: string | null): Promise<void> {
  await db
    .update(vpsAgentCommands)
    .set({ status: ok ? "done" : "failed", result: result?.slice(0, 500) ?? null, completedAt: new Date() })
    .where(and(eq(vpsAgentCommands.id, commandId), eq(vpsAgentCommands.vpsInstanceId, vpsInstanceId)))
}

// ---------------------------------------------------------------- user actions (ownership scoped)

async function ownInstance(userId: string, instanceId?: number): Promise<InstanceRow | null> {
  const where = instanceId != null ? and(eq(vpsInstances.userId, userId), eq(vpsInstances.id, instanceId)) : and(eq(vpsInstances.userId, userId), ne(vpsInstances.status, "destroyed"))
  const [inst] = await db.select().from(vpsInstances).where(where).orderBy(desc(vpsInstances.createdAt))
  return inst ?? null
}

export async function reconnectVps(userId: string): Promise<{ ok: boolean; error?: string }> {
  const inst = await ownInstance(userId)
  if (!inst) return { ok: false, error: "No managed VPS to reconnect." }
  return queueCommand(inst.id, userId, "reconnect", "user")
}

export async function reconcileVps(userId: string): Promise<{ ok: boolean; error?: string }> {
  const inst = await ownInstance(userId)
  if (!inst) return { ok: false, error: "No managed VPS to reconcile." }
  await reconcileNinjaTrader(userId).catch(() => {})
  return queueCommand(inst.id, userId, "reconcile", "user")
}

// ---------------------------------------------------------------- admin

export interface AdminVpsRow {
  id: number
  userId: string
  userEmail: string | null
  provider: string
  simulated: boolean
  region: string | null
  publicIp: string | null
  status: VpsStatus
  provisioningStep: string | null
  health: Health
  addonVersion: string | null
  lastHeartbeatAt: string | null
  lastSyncAt: string | null
  lastError: string | null
  createdAt: string
}

export async function adminVpsOverview(limit = 200): Promise<{ instances: AdminVpsRow[]; total: number; online: number }> {
  let simulated = true
  try {
    simulated = !getVpsProvider().real
  } catch {
    simulated = true
  }
  const rows = await db
    .select({ v: vpsInstances, email: user.email })
    .from(vpsInstances)
    .leftJoin(user, eq(user.id, vpsInstances.userId))
    .orderBy(desc(vpsInstances.updatedAt))
    .limit(limit)
  const instances: AdminVpsRow[] = rows.map(({ v, email }) => {
    const health = healthOf(v)
    return {
      id: v.id,
      userId: v.userId,
      userEmail: email ?? null,
      provider: v.provider,
      simulated,
      region: v.region,
      publicIp: v.publicIp,
      status: v.status as VpsStatus,
      provisioningStep: v.provisioningStep,
      health,
      addonVersion: v.addonVersion,
      lastHeartbeatAt: iso(v.lastHeartbeatAt),
      lastSyncAt: iso(v.lastSyncAt),
      lastError: v.lastError,
      createdAt: v.createdAt.toISOString(),
    }
  })
  return { instances, total: instances.length, online: instances.filter((i) => i.status === "connected").length }
}

export async function adminRebootVps(instanceId: number): Promise<boolean> {
  const [inst] = await db.select().from(vpsInstances).where(eq(vpsInstances.id, instanceId))
  if (!inst || !inst.providerServerId) return false
  try {
    await getVpsProvider().rebootServer(inst.providerServerId)
  } catch {
    return false
  }
  await db.update(vpsInstances).set({ status: "rebooting", updatedAt: new Date() }).where(eq(vpsInstances.id, instanceId))
  return true
}

export async function adminDestroyVps(instanceId: number): Promise<boolean> {
  const [inst] = await db.select().from(vpsInstances).where(eq(vpsInstances.id, instanceId))
  if (!inst) return false
  if (inst.providerServerId) {
    try {
      await getVpsProvider().destroyServer(inst.providerServerId)
    } catch {
      // still mark destroyed below; the provider row may already be gone
    }
  }
  await db.update(vpsInstances).set({ status: "destroyed", updatedAt: new Date() }).where(eq(vpsInstances.id, instanceId))
  if (inst.deviceKeyId) await db.update(providerDeviceKeys).set({ revokedAt: new Date(), status: "revoked" }).where(eq(providerDeviceKeys.id, inst.deviceKeyId))
  return true
}

export async function revokeVpsAgent(instanceId: number): Promise<boolean> {
  const [inst] = await db.select().from(vpsInstances).where(eq(vpsInstances.id, instanceId))
  if (!inst) return false
  if (inst.deviceKeyId) await db.update(providerDeviceKeys).set({ revokedAt: new Date(), status: "revoked" }).where(eq(providerDeviceKeys.id, inst.deviceKeyId))
  await db.update(vpsInstances).set({ status: "disconnected", agentStatus: "offline", updatedAt: new Date() }).where(eq(vpsInstances.id, instanceId))
  return true
}

export async function adminReconcileVps(instanceId: number): Promise<boolean> {
  const [inst] = await db.select().from(vpsInstances).where(eq(vpsInstances.id, instanceId))
  if (!inst) return false
  await reconcileNinjaTrader(inst.userId).catch(() => {})
  await queueCommand(instanceId, inst.userId, "reconcile", "admin")
  return true
}

export async function instanceOwner(instanceId: number): Promise<string | null> {
  const [row] = await db.select({ userId: vpsInstances.userId }).from(vpsInstances).where(eq(vpsInstances.id, instanceId))
  return row?.userId ?? null
}
