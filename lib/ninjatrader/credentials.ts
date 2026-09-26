import { and, desc, eq, count } from "drizzle-orm"
import { db } from "@/lib/db"
import { ninjatraderConnections, providerAccounts, providerExecutions, tradingConnections } from "@/lib/db/schema"
import { encrypt } from "@/lib/crypto"
import { accountLimitError } from "@/lib/plan-limits"
import { connectionOnline } from "@/lib/ninjatrader/relay"
import { ENVIRONMENT } from "@/lib/ninjatrader/payload"
import { PROVIDER } from "@/lib/ninjatrader/sync"

// The Tradovate logins a user entered to sync through NinjaTrader on the VPS.
// The password is encrypted at rest and only ever decrypted on the VPS to log
// the account in through NinjaTrader; it is never returned to the browser.

// Prop firms whose Tradovate accounts connect through NinjaTrader. `kind` is
// the NinjaTrader connection profile the VPS provisions the login under.
export const TRADOVATE_CONNECTION_KINDS = [
  { kind: "Tradovate", label: "Tradovate (direct)" },
  { kind: "Apex", label: "Apex Trader Funding" },
  { kind: "Tradeify", label: "Tradeify" },
  { kind: "MyFundedFutures", label: "My Funded Futures" },
  { kind: "TakeProfitTrader", label: "Take Profit Trader" },
  { kind: "BluSky", label: "BluSky Trading" },
] as const

const KNOWN_KINDS = new Set(TRADOVATE_CONNECTION_KINDS.map((k) => k.kind.toLowerCase()))

export interface NinjaCredentialView {
  id: number
  username: string
  connectionKind: string
  ntConnectionName: string
  status: string
  statusMessage: string | null
  online: boolean
  lastSeenAt: string | null
  lastFillAt: string | null
  accounts: number
  fills: number
  createdAt: string
}

export type ConnectResult = { ok: true; id: number } | { ok: false; error: string }

function normalizeKind(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  const match = TRADOVATE_CONNECTION_KINDS.find((k) => k.kind.toLowerCase() === v.toLowerCase())
  return match ? match.kind : KNOWN_KINDS.has(v.toLowerCase()) ? v : v.slice(0, 40)
}

// Stores a Tradovate login for VPS syncing. Reconnecting the same username +
// kind updates the password in place rather than adding a duplicate.
export async function connectCredentials(userId: string, input: { username: string; password: string; connectionKind: string }): Promise<ConnectResult> {
  const username = input.username.trim()
  const password = input.password
  const kind = normalizeKind(input.connectionKind)
  if (!username || username.length > 128) return { ok: false, error: "Enter your Tradovate username." }
  if (!password || password.length > 256) return { ok: false, error: "Enter your Tradovate password." }
  if (!kind) return { ok: false, error: "Pick which Tradovate connection this login is for." }

  const [existing] = await db
    .select()
    .from(ninjatraderConnections)
    .where(and(eq(ninjatraderConnections.userId, userId), eq(ninjatraderConnections.username, username), eq(ninjatraderConnections.connectionKind, kind)))
  if (existing) {
    await db
      .update(ninjatraderConnections)
      .set({ passwordEnc: encrypt(password), status: "pending", statusMessage: null, errorCount: 0, nextSyncAt: new Date(), leaseUntil: null, updatedAt: new Date() })
      .where(eq(ninjatraderConnections.id, existing.id))
    return { ok: true, id: existing.id }
  }

  // A new login is one more account slot, so hold it to the plan.
  if (await accountLimitError(userId, 1)) return { ok: false, error: "You're at your plan's account limit. Upgrade to Pro to add more." }

  const [row] = await db
    .insert(ninjatraderConnections)
    .values({ userId, username, passwordEnc: encrypt(password), connectionKind: kind, ntConnectionName: "pending", status: "pending", nextSyncAt: new Date() })
    .returning({ id: ninjatraderConnections.id })
  // The connection name the VPS provisions this login under, and the relay
  // attributes its accounts by. Unique per row, unguessable is not required
  // (it lives only on the VPS and in this table).
  await db.update(ninjatraderConnections).set({ ntConnectionName: `tl-${row.id}` }).where(eq(ninjatraderConnections.id, row.id))
  return { ok: true, id: row.id }
}

export async function listCredentials(userId: string): Promise<NinjaCredentialView[]> {
  const rows = await db
    .select()
    .from(ninjatraderConnections)
    .where(eq(ninjatraderConnections.userId, userId))
    .orderBy(desc(ninjatraderConnections.createdAt))
  if (rows.length === 0) return []

  // Account + fill counts come from the user's shared ninjatrader connection,
  // which every login's accounts land under; per-login numbers aren't split
  // out here (the Accounts page shows each account separately).
  const [conn] = await db
    .select({ id: tradingConnections.id })
    .from(tradingConnections)
    .where(and(eq(tradingConnections.userId, userId), eq(tradingConnections.provider, PROVIDER), eq(tradingConnections.environment, ENVIRONMENT)))
  let accounts = 0
  let fills = 0
  if (conn) {
    const [a] = await db.select({ n: count() }).from(providerAccounts).where(eq(providerAccounts.connectionId, conn.id))
    const [f] = await db.select({ n: count() }).from(providerExecutions).where(eq(providerExecutions.connectionId, conn.id))
    accounts = Number(a?.n ?? 0)
    fills = Number(f?.n ?? 0)
  }
  const iso = (d: Date | null) => (d ? d.toISOString() : null)
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    connectionKind: r.connectionKind,
    ntConnectionName: r.ntConnectionName,
    status: r.status,
    statusMessage: r.statusMessage,
    online: connectionOnline(r.lastSeenAt),
    lastSeenAt: iso(r.lastSeenAt),
    lastFillAt: iso(r.lastFillAt),
    accounts: rows.length === 1 ? accounts : 0,
    fills: rows.length === 1 ? fills : 0,
    createdAt: r.createdAt.toISOString(),
  }))
}

// Disconnect a login: the VPS drops its NinjaTrader connection and stops
// relaying it. The accounts and trades already imported stay in the journal.
export async function disconnectCredentials(userId: string, id: number): Promise<boolean> {
  const done = await db
    .update(ninjatraderConnections)
    .set({ status: "disconnected", statusMessage: null, passwordEnc: "", nextSyncAt: null, leaseUntil: null, updatedAt: new Date() })
    .where(and(eq(ninjatraderConnections.id, id), eq(ninjatraderConnections.userId, userId)))
    .returning({ id: ninjatraderConnections.id })
  return done.length > 0
}