// POST { connectionId } — reconcile now. Every REST sync compares Tradovate's
// lists with what's stored and repairs the difference, so this queues one
// immediately (the worker also reconciles on a schedule and after every
// realtime reconnect).
import { requestTradovateSync } from "@/lib/tradovate/connections"
import { runAfter, writeRequest } from "@/lib/tradovate/route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(req: Request) {
  const r = await writeRequest(req)
  if (r instanceof Response) return r
  const result = await requestTradovateSync(r.userId, r.connectionId, runAfter)
  return Response.json(result, { status: result.ok ? 202 : 409 })
}
