// Called by the sync VPS's MT5 worker right after it stores new raw deals (or
// logs a new account in for the first time): turns them into trades here,
// where the journal/account code lives. Idempotent — a call with nothing new
// to do is a couple of cheap queries.
import { cronAuthorized } from "@/lib/cron-auth"
import { normalizeDueConnections } from "@/lib/metatrader-sync"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// A first import can be a long history.
export const maxDuration = 300

export async function POST(req: Request) {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 })
  const startedAt = Date.now()
  try {
    const result = await normalizeDueConnections()
    return Response.json({ ok: true, ms: Date.now() - startedAt, ...result })
  } catch (err) {
    console.error("[cron/metatrader-sync] run failed:", err)
    return Response.json({ ok: false, ms: Date.now() - startedAt, error: err instanceof Error ? err.message : "run failed" }, { status: 500 })
  }
}
