// POST — start (or re-attach to) the caller's managed Windows VPS. Session +
// same-origin + the managed_vps feature + Pro. Creates the instance record and
// begins provisioning; it never collects a broker password.
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { isPro } from "@/lib/subscription"
import { assertFeature } from "@/lib/features/server"
import { sameOrigin } from "@/lib/tradovate/connections"
import { createVpsInstance } from "@/lib/vps/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status })

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail(403, "Forbidden.")
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return fail(401, "Sign in again.")
  try {
    await assertFeature("managed_vps")
  } catch {
    return fail(403, "The managed VPS connection isn't available to your account yet.")
  }
  if (!(await isPro(session.user.id))) return fail(403, "A managed VPS is included with Pro. Upgrade in TradeLoop under Billing.")
  const res = await createVpsInstance(session.user.id)
  return Response.json({ ok: true, instanceId: res.instanceId, status: res.status, reused: res.reused })
}
