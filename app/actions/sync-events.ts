"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { rithmicConnections, metatraderConnections, propFirmRules } from "@/lib/db/schema"
import { and, eq, gt } from "drizzle-orm"
import { headers } from "next/headers"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

export interface SyncEvent {
  id: string
  source: string
  count: number
  syncedAt: string
}

// Surfaces a "N trades pulled from X" card on the dashboards right after an
// auto-sync (background job or manual "Sync now") actually imports
// something — recent + non-zero on purpose, so a routine sync that found
// nothing new doesn't celebrate an empty result.
const RECENT_WINDOW_MS = 10 * 60 * 1000

export async function getRecentSyncEvents(): Promise<SyncEvent[]> {
  const userId = await getUserId()
  const since = new Date(Date.now() - RECENT_WINDOW_MS)

  const [rithmicRows, mtRows, ruleRows] = await Promise.all([
    db
      .select({
        id: rithmicConnections.id,
        accountId: rithmicConnections.accountId,
        systemName: rithmicConnections.systemName,
        lastSyncedAt: rithmicConnections.lastSyncedAt,
        lastSyncCount: rithmicConnections.lastSyncCount,
      })
      .from(rithmicConnections)
      .where(and(eq(rithmicConnections.userId, userId), eq(rithmicConnections.lastSyncStatus, "ok"), gt(rithmicConnections.lastSyncedAt, since))),
    db
      .select({
        id: metatraderConnections.id,
        accountId: metatraderConnections.accountId,
        server: metatraderConnections.server,
        lastSyncedAt: metatraderConnections.lastSyncedAt,
        lastSyncCount: metatraderConnections.lastSyncCount,
      })
      .from(metatraderConnections)
      .where(and(eq(metatraderConnections.userId, userId), eq(metatraderConnections.lastSyncStatus, "ok"), gt(metatraderConnections.lastSyncedAt, since))),
    db.select({ accountId: propFirmRules.accountId, firmName: propFirmRules.firmName }).from(propFirmRules).where(eq(propFirmRules.userId, userId)),
  ])

  const firmNameByAccountId = new Map(ruleRows.filter((r) => r.firmName).map((r) => [r.accountId, r.firmName as string]))

  const events: SyncEvent[] = []

  for (const row of rithmicRows) {
    if (!row.lastSyncCount || row.lastSyncCount <= 0 || !row.lastSyncedAt) continue
    events.push({
      id: `rithmic-${row.id}`,
      source: (row.accountId != null ? firmNameByAccountId.get(row.accountId) : null) ?? row.systemName,
      count: row.lastSyncCount,
      syncedAt: row.lastSyncedAt.toISOString(),
    })
  }

  for (const row of mtRows) {
    if (!row.lastSyncCount || row.lastSyncCount <= 0 || !row.lastSyncedAt) continue
    events.push({
      id: `mt-${row.id}`,
      source: (row.accountId != null ? firmNameByAccountId.get(row.accountId) : null) ?? row.server,
      count: row.lastSyncCount,
      syncedAt: row.lastSyncedAt.toISOString(),
    })
  }

  return events.sort((a, b) => new Date(b.syncedAt).getTime() - new Date(a.syncedAt).getTime())
}
