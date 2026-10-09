// POST — queue a read-only "reconnect" command for the caller's own VPS agent.
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { sameOrigin } from "@/lib/tradovate/connections"
import { reconnectVps } from "@/lib/vps/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ ok: false, error: "Forbidden." }, { status: 403 })
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return Response.json({ ok: false, error: "Sign in again." }, { status: 401 })
  const res = await reconnectVps(session.user.id)
  return Response.json(res, { status: res.ok ? 200 : 400 })
}
