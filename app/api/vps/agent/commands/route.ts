// GET — the VPS agent polls for one pending read-only command (Bearer: the
// agent's device key). Commands are bound to the agent's own instance, expire,
// and are delivered once. There is no order-entry command.
import { keyFromAuthorization } from "@/lib/ninjatrader/keys"
import { agentForKey, nextCommandFor } from "@/lib/vps/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const ctx = await agentForKey(keyFromAuthorization(req.headers.get("authorization")))
  if (!ctx) return Response.json({ ok: false, error: "Unknown or revoked agent key." }, { status: 401 })
  const cmd = await nextCommandFor(ctx.vpsInstanceId)
  return Response.json({ ok: true, id: cmd ? cmd.id : null, command: cmd ? cmd.command : null })
}
