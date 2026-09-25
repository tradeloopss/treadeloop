// Rithmic auto-sync trigger, called every 60s by the sync VPS's systemd timer
// (sync.tradeloop.pro). Serverless instances go idle when traffic is quiet, so
// an in-process setInterval can't be relied on to keep firing; an external
// always-on clock hitting this endpoint can. The work itself runs here, where
// the database and credential key live, and its Rithmic sockets go out through
// the VPS relay (RITHMIC_RELAY), so Rithmic still sees one static IP. The VPS
// never overlaps two calls (it waits for this response before the next tick),
// and Vercel runs with RITHMIC_AUTOSYNC=off so there's exactly one sync loop.
import { timingSafeEqual } from "node:crypto"
import { runAllConnections } from "@/lib/rithmic-auto-sync"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// One trigger syncs every due connection, one Rithmic session at a time.
export const maxDuration = 300

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const got = Buffer.from(req.headers.get("authorization") ?? "")
  const want = Buffer.from(`Bearer ${secret}`)
  return got.length === want.length && timingSafeEqual(got, want)
}

export async function POST(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 })
  const startedAt = Date.now()
  try {
    const summary = await runAllConnections()
    return Response.json({ ok: true, ms: Date.now() - startedAt, at: new Date().toISOString(), ...summary })
  } catch (err) {
    console.error("[cron/rithmic-sync] run failed:", err)
    return Response.json({ ok: false, ms: Date.now() - startedAt, error: err instanceof Error ? err.message : "run failed" }, { status: 500 })
  }
}
