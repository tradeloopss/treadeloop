import { headers } from "next/headers"
import { after } from "next/server"
import { auth } from "@/lib/auth"
import { sameOrigin } from "@/lib/tradovate/connections"

// Shared by the /api/integrations/tradovate JSON routes: the signed-in user
// (401 otherwise), a same-origin check on writes, and a connectionId read
// from the JSON body.
export async function sessionUserId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user?.id ?? null
}

export async function writeRequest(req: Request): Promise<{ userId: string; connectionId: number } | Response> {
  if (!sameOrigin(req)) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 })
  const userId = await sessionUserId()
  if (!userId) return Response.json({ ok: false, error: "Sign in again." }, { status: 401 })
  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = null
  }
  const connectionId = Number((body as { connectionId?: unknown } | null)?.connectionId)
  if (!Number.isInteger(connectionId) || connectionId <= 0) return Response.json({ ok: false, error: "connectionId is required." }, { status: 400 })
  return { userId, connectionId }
}

export const runAfter = (fn: () => Promise<void>) => after(fn)
