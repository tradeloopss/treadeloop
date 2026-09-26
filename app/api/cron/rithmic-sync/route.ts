// Rithmic auto-sync trigger, called every 60s by the sync VPS's systemd timer
// (sync.tradeloop.pro). Serverless instances go idle when traffic is quiet, so
// an in-process setInterval can't be relied on to keep firing; an external
// always-on clock hitting this endpoint can. The work itself runs here, where
// the database and credential key live, and its Rithmic sockets go out through
// the VPS relay (RITHMIC_RELAY), so Rithmic still sees one static IP. The VPS
// never overlaps two calls (it waits for this response before the next tick),
// and Vercel runs with RITHMIC_AUTOSYNC=off so there's exactly one sync loop.
import { cronAuthorized } from "@/lib/cron-auth"
import { runAllConnections } from "@/lib/rithmic-auto-sync"
import { runRithmicOrderCommands } from "@/lib/rithmic-sync"
import { normalizeDueConnections } from "@/lib/metatrader-sync"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// One trigger syncs every due connection, one Rithmic session at a time.
export const maxDuration = 300

export async function POST(req: Request) {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 })
  const startedAt = Date.now()
  try {
    // Orders are user-initiated and time-sensitive — send them before the sync
    // pass so they don't wait behind it (both share the serialized session queue).
    const orders = await runRithmicOrderCommands().catch((err) => {
      console.error("[cron/rithmic-sync] order commands failed:", err)
      return { processed: 0 }
    })
    const summary = await runAllConnections()
    // Fallback for MT5: the worker triggers /api/cron/metatrader-sync itself
    // when deals land, but if that call was lost this minute's tick catches it.
    const mt5 = await normalizeDueConnections().catch((err) => {
      console.error("[cron/rithmic-sync] MT5 normalize fallback failed:", err)
      return null
    })
    return Response.json({ ok: true, ms: Date.now() - startedAt, at: new Date().toISOString(), ...summary, orders: orders.processed, mt5 })
  } catch (err) {
    console.error("[cron/rithmic-sync] run failed:", err)
    return Response.json({ ok: false, ms: Date.now() - startedAt, error: err instanceof Error ? err.message : "run failed" }, { status: 500 })
  }
}
