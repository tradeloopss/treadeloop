// POST { connectionId } — disconnect: stop syncing and delete the saved
// tokens. Accounts and trades stay.
import { disconnectTradovate } from "@/lib/tradovate/connections"
import { writeRequest } from "@/lib/tradovate/route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const r = await writeRequest(req)
  if (r instanceof Response) return r
  const result = await disconnectTradovate(r.userId, r.connectionId)
  return Response.json(result, { status: result.ok ? 200 : 404 })
}
