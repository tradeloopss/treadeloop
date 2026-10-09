// POST — rebuild the caller's journal from stored fills and queue a read-only
// "reconcile" command for their own VPS agent. Idempotent; never duplicates.
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { sameOrigin } from "@/lib/tradovate/connections"
import { reconcileVps } from "@/lib/vps/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ ok: false, error: "Forbidden." }, { status: 403 })
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return Response.json({ ok: false, error: "Sign in again." }, { status: 401 })
  const res = await reconcileVps(session.user.id)
  return Response.json(res, { status: res.ok ? 200 : 400 })
}
