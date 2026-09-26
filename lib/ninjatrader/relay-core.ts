import { createHash, timingSafeEqual } from "node:crypto"
import type { NtAccount, NtParsed } from "@/lib/ninjatrader/payload"

// The pure half of the VPS relay (no database), so it can be unit-tested:
// the shared-secret check and the connection-name → user attribution.

export function relaySecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env.NINJATRADER_RELAY_SECRET?.trim()
  return v && /^tlnt_[A-Za-z0-9_-]{20,}$/.test(v) ? v : null
}

export function relayConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return relaySecret(env) != null
}

// Constant-time check of the presented key against the configured secret.
export function checkRelaySecret(presented: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = relaySecret(env)
  if (!secret || !presented) return false
  const a = createHash("sha256").update(presented).digest()
  const b = createHash("sha256").update(secret).digest()
  return timingSafeEqual(a, b)
}

export interface UserSlice {
  userId: string
  accounts: NtAccount[]
  executions: NtParsed["executions"]
  rowIds: number[]
}

// Split one relay payload into per-user slices by NinjaTrader connection name.
// `resolve(connectionName)` returns the owning login (userId + row id), or null
// when no active credential row claims it — those accounts and their fills are
// dropped. Attribution is only ever by connection name, so two users'
// identically named accounts never cross.
export function splitByUser(
  parsed: Pick<NtParsed, "accounts" | "executions">,
  resolve: (connectionName: string) => { userId: string; rowId: number } | null,
): { slices: UserSlice[]; matchedRowIds: number[]; unknownConnections: string[] } {
  const accountToOwner = new Map<string, { userId: string; rowId: number }>()
  const matched = new Set<number>()
  const unknown = new Set<string>()
  for (const a of parsed.accounts) {
    if (!a.connection) continue
    const owner = resolve(a.connection)
    if (!owner) {
      unknown.add(a.connection)
      continue
    }
    accountToOwner.set(a.name, owner)
    matched.add(owner.rowId)
  }
  const byUser = new Map<string, UserSlice>()
  const slice = (userId: string) => {
    let s = byUser.get(userId)
    if (!s) byUser.set(userId, (s = { userId, accounts: [], executions: [], rowIds: [] }))
    return s
  }
  for (const a of parsed.accounts) {
    const owner = accountToOwner.get(a.name)
    if (!owner) continue
    const s = slice(owner.userId)
    s.accounts.push(a)
    if (!s.rowIds.includes(owner.rowId)) s.rowIds.push(owner.rowId)
  }
  for (const e of parsed.executions) {
    const owner = accountToOwner.get(e.providerAccountId)
    if (owner) slice(owner.userId).executions.push(e)
  }
  return { slices: [...byUser.values()], matchedRowIds: [...matched], unknownConnections: [...unknown] }
}

// A login is stale (its NinjaTrader connection dropped) if nothing has relayed
// for it recently.
export const CONNECTION_STALE_MS = 12 * 60 * 1000

export function connectionOnline(lastSeenAt: Date | null, now = Date.now()): boolean {
  return lastSeenAt != null && now - lastSeenAt.getTime() < CONNECTION_STALE_MS
}