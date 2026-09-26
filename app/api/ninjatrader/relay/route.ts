// POST — the TradeLoop add-on running inside NinjaTrader on the sync VPS posts
// the fills of every user's Tradovate login it holds, in one payload
// (Authorization: Bearer <NINJATRADER_RELAY_SECRET>). Each account is
// attributed to the user who owns its NinjaTrader connection name, and stored
// through the same pipeline as the user's own PC add-on. See
// docs/integrations/ninjatrader.md.
import { after } from "next/server"
import { keyFromAuthorization } from "@/lib/ninjatrader/keys"
import { parsePayload } from "@/lib/ninjatrader/payload"
import { checkRelaySecret, ingestRelayPayload, relayConfigured } from "@/lib/ninjatrader/relay"
import { buildDueTradovateTrades } from "@/lib/tradovate/trades"
import { tlog } from "@/lib/tradovate/log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const MAX_BODY = 5_000_000
const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status })

export async function POST(req: Request) {
  if (!relayConfigured()) return fail(404, "The NinjaTrader relay isn't enabled on this server.")
  if (!checkRelaySecret(keyFromAuthorization(req.headers.get("authorization")))) return fail(401, "Bad relay secret.")

  const text = await req.text()
  if (text.length > MAX_BODY) return fail(413, "Too much in one request.")
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return fail(400, "The request wasn't valid JSON.")
  }
  const parsed = parsePayload(body)
  if (!parsed.ok) return fail(400, parsed.error)

  try {
    const result = await ingestRelayPayload(parsed.value)
    if (result.tradesDirtyUserIds.length > 0) {
      // Rebuild trades for the ninjatrader connections that got new fills.
      after(async () => {
        try {
          await buildDueTradovateTrades("ninjatrader")
        } catch (err) {
          tlog("trades_build_failed", { provider: "ninjatrader", message: err instanceof Error ? err.message : String(err) }, "error")
        }
      })
    }
    return Response.json({ ok: true, users: result.users, inserted: result.inserted, updated: result.updated, matched: result.matchedConnections, unknown: result.unknownConnections })
  } catch (err) {
    tlog("relay_failed", { message: err instanceof Error ? err.message : String(err) }, "error")
    return fail(500, "The relay couldn't store these fills; the add-on will send them again.")
  }
}
