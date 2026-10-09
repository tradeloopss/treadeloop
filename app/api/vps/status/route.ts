// GET — the caller's managed VPS status (layered health). Session-scoped to the
// caller; under the mock provider it advances the simulated provisioning a step
// per poll so the UI progresses honestly (and is labelled simulated).
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { viewAndMaybeAdvance } from "@/lib/vps/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return Response.json({ ok: false, error: "Sign in again." }, { status: 401 })
  const instance = await viewAndMaybeAdvance(session.user.id)
  return Response.json({ ok: true, instance })
}
