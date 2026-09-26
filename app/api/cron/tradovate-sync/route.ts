// Called by the sync VPS's Tradovate worker right after it stores new
// executions, and every few minutes as a fallback: turns them into journal
// trades here, where the journal code lives. Idempotent, and a no-op for
// connections with nothing new (tradesDirtyAt unset).
import { cronAuthorized } from "@/lib/cron-auth"
import { buildDueTradovateTrades } from "@/lib/tradovate/trades"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function POST(req: Request) {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 })
  const startedAt = Date.now()
  try {
    const result = await buildDueTradovateTrades()
    return Response.json({ ok: true, ms: Date.now() - startedAt, ...result })
  } catch (err) {
    console.error("[cron/tradovate-sync] run failed:", err)
    return Response.json({ ok: false, ms: Date.now() - startedAt, error: err instanceof Error ? err.message : "run failed" }, { status: 500 })
  }
}
