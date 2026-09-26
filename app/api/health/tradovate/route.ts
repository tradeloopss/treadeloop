// Tradovate integration health: configuration readiness and aggregate
// connection health (counts and times only — no user data, no configuration
// values).
import { count, max } from "drizzle-orm"
import { db } from "@/lib/db"
import { tradingConnections } from "@/lib/db/schema"
import { tradovateAvailability } from "@/lib/tradovate/config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const availability = tradovateAvailability()
  try {
    const rows = await db
      .select({
        status: tradingConnections.status,
        websocket: tradingConnections.realtimeStatus,
        n: count(),
        lastEvent: max(tradingConnections.lastRealtimeEventAt),
        lastSync: max(tradingConnections.lastSyncAt),
        lastReconciliation: max(tradingConnections.lastReconciledAt),
      })
      .from(tradingConnections)
      .groupBy(tradingConnections.status, tradingConnections.realtimeStatus)
    const latest = (k: "lastEvent" | "lastSync" | "lastReconciliation") => {
      let best: Date | null = null
      for (const r of rows) {
        const v = r[k] ? new Date(r[k] as unknown as string) : null
        if (v && (!best || v > best)) best = v
      }
      return best?.toISOString() ?? null
    }
    return Response.json({
      ok: true,
      environment: availability.mode,
      configured: availability.enabled,
      missing: availability.missing,
      connections: rows.map((r) => ({ status: r.status, websocket: r.websocket, count: r.n })),
      lastEvent: latest("lastEvent"),
      lastSync: latest("lastSync"),
      lastReconciliation: latest("lastReconciliation"),
    })
  } catch {
    return Response.json({ ok: false, environment: availability.mode, configured: availability.enabled }, { status: 503 })
  }
}
