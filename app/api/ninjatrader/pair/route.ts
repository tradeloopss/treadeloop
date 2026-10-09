// POST — redeem a pairing code (the "ABC-123" from the TradeLoop dashboard) for
// the keyed NinjaTrader add-on, without signing in to TradeLoop here. The code
// is the only credential needed, is single-use and short-lived, and carries no
// broker login. Public by design; the dashboard that mints the code is Pro-gated
// and the code is checked against the owner's plan on redemption.
import { addonSource, ADDON_FILENAME } from "@/lib/ninjatrader/addon-source"
import { normalizePairCode, redeemPairCode } from "@/lib/ninjatrader/pairing"
import { isPro } from "@/lib/subscription"
import { tlog } from "@/lib/tradovate/log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BODY = 10_000
const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status })

// Where the add-on posts (the configured public URL, like the download route).
function syncUrl(req: Request): string {
  const configured = (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "").trim().replace(/\/+$/, "")
  const base = /^https?:\/\/[A-Za-z0-9.:-]+$/.test(configured) ? configured : new URL(req.url).origin
  return `${base}/api/ninjatrader/sync`
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    const text = await req.text()
    if (text.length > MAX_BODY) return fail(413, "Request too large.")
    body = JSON.parse(text || "{}") as Record<string, unknown>
  } catch {
    return fail(400, "Invalid JSON.")
  }
  const code = typeof body.code === "string" ? body.code : ""
  if (normalizePairCode(code).length < 6) return fail(400, "Enter the pairing code shown in TradeLoop.")

  const res = await redeemPairCode(code)
  if (!res.ok) {
    if (res.reason === "expired") return fail(410, "That code has expired. Generate a new one in TradeLoop.")
    if (res.reason === "used") return fail(410, "That code was already used. Generate a new one in TradeLoop.")
    return fail(404, "That code isn't valid. Check it and try again.")
  }
  if (!(await isPro(res.userId))) return fail(403, "NinjaTrader sync is included with Pro.")

  tlog("paired", { provider: "ninjatrader", userId: res.userId })
  // UTF-8 BOM so NinjaScript Editor reads the file's non-ASCII text correctly.
  const addon = "﻿" + addonSource({ key: res.key, syncUrl: syncUrl(req) })
  return Response.json({ ok: true, filename: ADDON_FILENAME, addon })
}
