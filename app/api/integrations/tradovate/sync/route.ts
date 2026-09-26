// POST { connectionId } — sync now (queued for the sync worker; throttled).
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
