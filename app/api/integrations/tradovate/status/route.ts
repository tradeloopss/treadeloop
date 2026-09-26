// The signed-in user's Tradovate connections and their health: status,
// realtime (WebSocket) state, last event, last sync, last reconciliation,
// error count and last error. No tokens, ever.
import { tradovateAvailability } from "@/lib/tradovate/config"
import { tradovateConnectionsFor } from "@/lib/tradovate/connections"
import { sessionUserId } from "@/lib/tradovate/route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const userId = await sessionUserId()
  if (!userId) return Response.json({ error: "Sign in again." }, { status: 401 })
  const { enabled, mode } = tradovateAvailability()
  const connections = await tradovateConnectionsFor(userId)
  return Response.json({
    available: enabled,
    environment: mode,
    connected: connections.some((c) => c.status === "connected"),
    connections: connections.map((c) => ({
      id: c.id,
      environment: c.environment,
      status: c.status,
      message: c.statusMessage,
      syncStage: c.syncStage,
      websocket: c.realtimeStatus,
      lastEvent: c.lastRealtimeEventAt,
      lastSync: c.lastSyncAt,
      lastReconciliation: c.lastReconciledAt,
      reconciliation: c.lastReconcileSummary,
      errorCount: c.errorCount,
      lastError: c.lastSyncError,
      accounts: c.accounts.length,
    })),
  })
}
