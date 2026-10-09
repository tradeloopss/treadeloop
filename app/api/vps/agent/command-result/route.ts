// POST — the VPS agent reports the result of a command it ran (Bearer: the
// agent's device key). Scoped to the agent's own instance.
import { keyFromAuthorization } from "@/lib/ninjatrader/keys"
import { agentForKey, recordCommandResult } from "@/lib/vps/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status })

export async function POST(req: Request) {
  const ctx = await agentForKey(keyFromAuthorization(req.headers.get("authorization")))
  if (!ctx) return fail(401, "Unknown or revoked agent key.")
  let body: Record<string, unknown>
  try {
    const text = await req.text()
    if (text.length > 100_000) return fail(413, "Too large.")
    body = JSON.parse(text || "{}") as Record<string, unknown>
  } catch {
    return fail(400, "Invalid JSON.")
  }
  const id = Number(body.id)
  if (!Number.isInteger(id)) return fail(400, "Bad command id.")
  await recordCommandResult(ctx.vpsInstanceId, id, body.ok === true, typeof body.result === "string" ? body.result : null)
  return Response.json({ ok: true })
}
