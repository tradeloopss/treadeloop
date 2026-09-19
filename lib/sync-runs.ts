import { lt } from "drizzle-orm"
import { db } from "@/lib/db"
import { syncRuns } from "@/lib/db/schema"

export type SyncTrigger = "auto" | "manual" | "admin" | "connect"

// Background sync writes a row per connection per minute, so old rows are
// pruned now and then (roughly every 200th write) rather than on a schedule.
const KEEP_DAYS = 14

// Never throws: failing to log a sync must not fail the sync.
export async function recordSyncRun(run: {
  broker: "rithmic" | "metatrader"
  connectionId: number
  userId: string
  trigger: SyncTrigger
  startedAt: number
  imported?: number
  error?: unknown
}) {
  try {
    await db.insert(syncRuns).values({
      broker: run.broker,
      connectionId: run.connectionId,
      userId: run.userId,
      trigger: run.trigger,
      status: run.error === undefined ? "ok" : "error",
      imported: run.imported ?? null,
      error: run.error === undefined ? null : (run.error instanceof Error ? run.error.message : String(run.error)).slice(0, 1000),
      durationMs: Date.now() - run.startedAt,
    })
    if (Math.random() < 1 / 200) {
      await db.delete(syncRuns).where(lt(syncRuns.createdAt, new Date(Date.now() - KEEP_DAYS * 86400_000)))
    }
  } catch (err) {
    console.error("[sync-runs] could not record run", err)
  }
}

// Errors that mean the broker is throttling us rather than a bad login etc.
export const RATE_LIMIT_PATTERN = /rate.?limit|throttl|too many|429|slow down/i
