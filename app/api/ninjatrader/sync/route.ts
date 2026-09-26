// POST — the TradeLoop add-on for NinjaTrader 8 posts the executions and
// account balances it reads in the trader's own NinjaTrader (Bearer: the
// add-on's sync key). Idempotent: the add-on resends its session every few
// minutes and only new or amended fills are stored; trades are rebuilt right
// after, with the same engine as every fill-based broker.
import { after } from "next/server"
import { isPro } from "@/lib/subscription"
import { keyFromAuthorization } from "@/lib/ninjatrader/keys"
import { parsePayload } from "@/lib/ninjatrader/payload"
import { deviceForKey, ingestPayload, recordDeviceError } from "@/lib/ninjatrader/sync"
import { buildProviderTrades } from "@/lib/tradovate/trades"
import { tlog } from "@/lib/tradovate/log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const MAX_BODY = 5_000_000

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status })

export async function POST(req: Request) {
  const key = keyFromAuthorization(req.headers.get("authorization"))
  if (!key) return fail(401, "Missing TradeLoop add-on key.")
  const device = await deviceForKey(key)
  if (!device) return fail(401, "This add-on key was removed. Download the add-on again from TradeLoop.")

  const text = await req.text()
  if (text.length > MAX_BODY) return fail(413, "Too much in one request.")
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return fail(400, "The request wasn't valid JSON.")
  }
  const parsed = parsePayload(body)
  if (!parsed.ok) {
    await recordDeviceError(device, parsed.error)
    return fail(400, parsed.error)
  }
  // Live broker sync is a Pro feature (Essential's one live sync is MetaTrader).
  if (!(await isPro(device.userId))) {
    const message = "Tradovate sync through NinjaTrader is included with Pro. Upgrade in TradeLoop under Billing."
    await recordDeviceError(device, message)
    return fail(403, message)
  }

  try {
    const result = await ingestPayload(device, parsed.value)
    if (result.tradesDirty) {
      after(async () => {
        try {
          await buildProviderTrades(result.connectionId)
        } catch (err) {
          tlog("trades_build_failed", { provider: "ninjatrader", connectionId: result.connectionId, message: err instanceof Error ? err.message : String(err) }, "error")
        }
      })
    }
    return Response.json({
      ok: true,
      accounts: result.accounts,
      inserted: result.inserted,
      updated: result.updated,
      rejected: parsed.value.rejected.length,
      skippedAccounts: result.skippedAccounts,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    tlog("ingest_failed", { provider: "ninjatrader", deviceId: device.id, message }, "error")
    await recordDeviceError(device, "TradeLoop couldn't store these fills; the add-on will send them again.")
    return fail(500, "TradeLoop couldn't store these fills; the add-on will send them again.")
  }
}
