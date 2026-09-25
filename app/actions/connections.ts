"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { and, eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { metatraderConnections, rithmicConnections } from "@/lib/db/schema"
import { syncRithmicConnection } from "@/lib/rithmic-sync"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

// Rithmic syncs run in this request, one login at a time (Rithmic allows one
// session per login), so they get a budget that fits the Accounts page's
// 60-second limit; anything left over is picked up by the minute-by-minute
// auto-sync anyway.
const RITHMIC_BUDGET_MS = 45_000

export type SyncAllResult = { synced: number; failed: number; imported: number; queued: number; skipped: number }

// "Sync all" on the Accounts page: MetaTrader accounts are made due now (the
// sync server picks them up within seconds), Rithmic accounts sync here.
// TradingView paper accounts sync through the browser extension on their own.
export async function syncAllConnections(): Promise<SyncAllResult> {
  const userId = await getUserId()
  const now = new Date()
  const queued = await db
    .update(metatraderConnections)
    .set({ nextSyncAt: now })
    .where(and(eq(metatraderConnections.userId, userId), eq(metatraderConnections.status, "connected")))
    .returning({ id: metatraderConnections.id })

  const connections = await db.select().from(rithmicConnections).where(eq(rithmicConnections.userId, userId))
  const deadline = Date.now() + RITHMIC_BUDGET_MS
  let synced = 0
  let failed = 0
  let imported = 0
  let skipped = 0
  for (const connection of connections) {
    if (Date.now() > deadline) {
      skipped++
      continue
    }
    try {
      const result = await syncRithmicConnection(connection, "manual")
      imported += result.imported
      synced++
    } catch {
      failed++
    }
  }

  for (const path of ["/accounts", "/dashboard", "/trades", "/journal", "/calendar", "/reports"]) revalidatePath(path)
  return { synced, failed, imported, queued: queued.length, skipped }
}
