// Background auto-sync — keeps every user's Rithmic-connected trades up to
// date without anyone having to click "Sync now". Runs as a plain
// setInterval inside the long-running Next.js server process (started once
// from instrumentation.ts on server boot), not a request-scoped job, so it
// can't use revalidatePath/headers/cookies — the DB rows it updates just get
// picked up fresh the next time any page fetches them.
//
// Each connection's sync opens its own Rithmic session; lib/rithmic-
// client.ts's session queue already serializes and spaces those out
// (Rithmic rejects a second login attempted too soon after a prior one), so
// firing all connections concurrently here is safe — they queue naturally.
// At meaningfully larger scale (many users × many connections) this would
// want staggering/batching instead of "sync everyone every 60s", but that's
// not a concern at current scale.
import { db } from "@/lib/db"
import { rithmicConnections } from "@/lib/db/schema"
import { syncRithmicConnection } from "@/lib/rithmic-sync"

const SYNC_INTERVAL_MS = 60_000
// A connection synced within this window is skipped. register() (and the
// runAllConnections it fires) runs on every server boot, so on a platform
// that spins up a fresh instance per request each cold start would otherwise
// re-sync every connection immediately — piling concurrent logins onto the
// same account (Rithmic allows only one session per login, so the extras are
// refused with "permission denied") and, worse, colliding with a user who's
// actively connecting that same login right then. Skipping the recently-synced
// keeps auto-sync to roughly its interval regardless of how often it's kicked.
const MIN_RESYNC_GAP_MS = 45_000

// Exponential backoff for a connection that keeps failing. Rithmic throttles
// connections from cloud IPs, and retrying a throttled account every 60s only
// feeds the throttle (and spams the sync log with identical timeouts). So each
// consecutive failure pushes the next attempt further out — 2, 4, 8… minutes,
// capped — which lets the throttle window clear and keeps a dead account from
// drowning out the healthy ones. A single success resets it to the normal
// cadence. State is in-memory, which is enough: it lives in the same long-
// running process as the interval, and a process restart just means one
// un-backed-off attempt, which is harmless.
const BACKOFF_BASE_MS = 120_000
const BACKOFF_MAX_MS = 30 * 60_000
const backoff = new Map<number, { failures: number; nextAttempt: number }>()

// Guards against starting more than one interval — instrumentation.ts's
// register() is documented to run once per server instance, but this is
// cheap insurance against dev-mode module re-evaluation stacking up timers.
let started = false

async function runAllConnections() {
  const connections = await db.select().from(rithmicConnections)
  const now = Date.now()
  const due = connections.filter((c) => {
    if (c.lastSyncedAt && now - c.lastSyncedAt.getTime() < MIN_RESYNC_GAP_MS) return false
    const b = backoff.get(c.id)
    return !b || now >= b.nextAttempt
  })
  // Drop backoff state for connections that no longer exist, so the map can't
  // grow without bound as connections come and go.
  const liveIds = new Set(connections.map((c) => c.id))
  for (const id of backoff.keys()) if (!liveIds.has(id)) backoff.delete(id)
  if (due.length === 0) return
  const results = await Promise.allSettled(
    due.map(async (connection) => {
      try {
        await syncRithmicConnection(connection)
        backoff.delete(connection.id)
      } catch (err) {
        const failures = (backoff.get(connection.id)?.failures ?? 0) + 1
        const delay = Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS)
        backoff.set(connection.id, { failures, nextAttempt: Date.now() + delay })
        console.error(`[rithmic-auto-sync] connection ${connection.id} (${connection.login}) failed (#${failures}, next try in ${Math.round(delay / 60_000)}m):`, err instanceof Error ? err.message : err)
        throw err
      }
    })
  )
  const failed = results.filter((r) => r.status === "rejected").length
  if (failed > 0) {
    console.log(`[rithmic-auto-sync] synced ${due.length - failed}/${due.length} due connections (${failed} failed)`)
  }
}

export function startRithmicAutoSync() {
  if (started) return
  started = true
  console.log("[rithmic-auto-sync] started — syncing every 60s")
  runAllConnections()
  setInterval(runAllConnections, SYNC_INTERVAL_MS)
}
