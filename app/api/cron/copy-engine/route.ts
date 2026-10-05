import { cronAuthorized } from "@/lib/cron-auth"
import { runBackground } from "@/lib/copy/background"

// One pass of the Copy Trading engine for every trader with a group switched
// on. Called every few seconds by the sync server (tradeloop-copy-engine), with
// the same secret as the other scheduled jobs. Safe to call as often as you
// like: the engine never copies the same leader order twice.

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(req: Request) {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 })
  try {
    return Response.json({ ok: true, at: new Date().toISOString(), ...(await runBackground()) })
  } catch (err) {
    console.error("[cron/copy-engine] pass failed:", err)
    return Response.json({ ok: false, error: "pass failed" }, { status: 500 })
  }
}
