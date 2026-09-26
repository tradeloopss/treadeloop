import { eq, inArray } from "drizzle-orm"
import { db } from "@/lib/db"
import { ninjatraderConnections } from "@/lib/db/schema"
import { ingestForUser, type IngestResult } from "@/lib/ninjatrader/sync"
import type { NtParsed } from "@/lib/ninjatrader/payload"
import { splitByUser } from "@/lib/ninjatrader/relay-core"
import { tlog } from "@/lib/tradovate/log"

// The VPS relay. One NinjaTrader on the sync VPS holds every user's Tradovate
// login as its own named connection ("tl-<id>") and runs the TradeLoop add-on
// built with the shared relay secret. The add-on posts one mixed payload; the
// pure attribution lives in relay-core (unit-tested); this stores each user's
// slice through the same pipeline as the PC add-on and refreshes status.

export type NinjaTraderConnectionRow = typeof ninjatraderConnections.$inferSelect

// The secret check, attribution and staleness helpers are re-exported from the
// db-free core so callers keep importing them from here.
export { relaySecret, relayConfigured, checkRelaySecret, splitByUser, connectionOnline, CONNECTION_STALE_MS, type UserSlice } from "@/lib/ninjatrader/relay-core"

export interface RelayResult {
  users: number
  inserted: number
  updated: number
  matchedConnections: string[]
  unknownConnections: string[]
  tradesDirtyUserIds: string[]
}

const RESYNC_INTERVAL_MS = 5 * 60 * 1000

// Groups the payload by NinjaTrader connection name → the owning credential
// row → user, then stores each user's slice and refreshes each matched
// credential row's status.
export async function ingestRelayPayload(parsed: NtParsed): Promise<RelayResult> {
  const now = new Date()
  const connNames = [...new Set(parsed.accounts.map((a) => a.connection).filter((c): c is string => !!c))]
  const result: RelayResult = { users: 0, inserted: 0, updated: 0, matchedConnections: [], unknownConnections: [], tradesDirtyUserIds: [] }
  if (connNames.length === 0) return result

  const rows = await db
    .select()
    .from(ninjatraderConnections)
    .where(inArray(ninjatraderConnections.ntConnectionName, connNames))
  const byName = new Map(rows.filter((r) => r.status !== "disconnected").map((r) => [r.ntConnectionName.toLowerCase(), r]))

  const byId = new Map(rows.map((r) => [r.id, r]))
  const { slices, matchedRowIds, unknownConnections } = splitByUser(parsed, (name) => {
    const row = byName.get(name.toLowerCase())
    return row ? { userId: row.userId, rowId: row.id } : null
  })
  result.matchedConnections = matchedRowIds.map((id) => byId.get(id)!.ntConnectionName)
  result.unknownConnections = unknownConnections

  const rowsWithFills = new Set<number>()
  for (const slice of slices) {
    let ingest: IngestResult
    try {
      ingest = await ingestForUser(slice.userId, { client: parsed.client, accounts: slice.accounts, executions: slice.executions, rejected: [] })
    } catch (err) {
      tlog("relay_ingest_failed", { userId: slice.userId, message: err instanceof Error ? err.message : String(err) }, "error")
      continue
    }
    result.users++
    result.inserted += ingest.inserted
    result.updated += ingest.updated
    if (ingest.tradesDirty) {
      result.tradesDirtyUserIds.push(slice.userId)
      // A login carried fills if any of its accounts had an execution.
      const accountNames = new Set(slice.executions.map((e) => e.providerAccountId))
      for (const a of slice.accounts) {
        if (!accountNames.has(a.name) || !a.connection) continue
        const row = byName.get(a.connection.toLowerCase())
        if (row) rowsWithFills.add(row.id)
      }
    }
  }

  // Refresh every matched connection: connected + seen now; fill time only for
  // the ones that carried new fills.
  const matchedIds = matchedRowIds
  if (matchedIds.length > 0) {
    await db
      .update(ninjatraderConnections)
      .set({ status: "connected", statusMessage: null, errorCount: 0, lastSeenAt: now, nextSyncAt: new Date(now.getTime() + RESYNC_INTERVAL_MS), updatedAt: now })
      .where(inArray(ninjatraderConnections.id, matchedIds))
    if (rowsWithFills.size > 0) {
      await db.update(ninjatraderConnections).set({ lastFillAt: now }).where(inArray(ninjatraderConnections.id, [...rowsWithFills]))
    }
  }

  if (result.inserted + result.updated > 0 || result.unknownConnections.length > 0) {
    tlog("relay_ingest", { users: result.users, inserted: result.inserted, updated: result.updated, matched: result.matchedConnections.length, unknown: result.unknownConnections.length })
  }
  return result
}

// Marks a login connected/failed from what the worker sees on the VPS.
export async function setConnectionStatus(id: number, status: string, message: string | null) {
  await db
    .update(ninjatraderConnections)
    .set({ status, statusMessage: message, updatedAt: new Date() })
    .where(eq(ninjatraderConnections.id, id))
    .catch(() => {})
}