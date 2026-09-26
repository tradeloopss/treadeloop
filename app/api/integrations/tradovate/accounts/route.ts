// Every Tradovate account on the signed-in user's connections.
import { tradovateConnectionsFor } from "@/lib/tradovate/connections"
import { sessionUserId } from "@/lib/tradovate/route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const userId = await sessionUserId()
  if (!userId) return Response.json({ error: "Sign in again." }, { status: 401 })
  const connections = await tradovateConnectionsFor(userId)
  return Response.json({ accounts: connections.flatMap((c) => c.accounts.map((a) => ({ ...a, connectionId: c.id, connectionStatus: c.status }))) })
}
