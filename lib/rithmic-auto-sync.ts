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

// Guards against starting more than one interval — instrumentation.ts's
// register() is documented to run once per server instance, but this is
// cheap insurance against dev-mode module re-evaluation stacking up timers.
let started = false

async function runAllConnections() {
  const connections = await db.select().from(rithmicConnections)
  if (connections.length === 0) return
  const results = await Promise.allSettled(
    connections.map((connection) =>
      syncRithmicConnection(connection).catch((err) => {
        console.error(`[rithmic-auto-sync] connection ${connection.id} (${connection.login}) failed:`, err instanceof Error ? err.message : err)
        throw err
      })
    )
  )
  const failed = results.filter((r) => r.status === "rejected").length
  if (failed > 0) {
    console.log(`[rithmic-auto-sync] synced ${connections.length - failed}/${connections.length} connections (${failed} failed)`)
  }
}

export function startRithmicAutoSync() {
  if (started) return
  started = true
  console.log("[rithmic-auto-sync] started — syncing every 60s")
  runAllConnections()
  setInterval(runAllConnections, SYNC_INTERVAL_MS)
}
