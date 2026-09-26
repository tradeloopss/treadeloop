// POST (form) — "Download the TradeLoop add-on": a NinjaTrader 8 add-on with
// a new sync key of this user's written into it. The key is shown only here,
// inside the file; TradeLoop keeps a hash of it.
import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { isPro } from "@/lib/subscription"
import { sameOrigin } from "@/lib/tradovate/connections"
import { addonSource, ADDON_FILENAME } from "@/lib/ninjatrader/addon-source"
import { createDeviceKey } from "@/lib/ninjatrader/connections"
import { tlog } from "@/lib/tradovate/log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Where the add-on posts. The configured public URL, so a download from a
// redirecting host (tradeloop.pro → www) still points straight at the app.
function syncUrl(req: Request): string {
  const configured = (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "").trim().replace(/\/+$/, "")
  const base = /^https?:\/\/[A-Za-z0-9.:-]+$/.test(configured) ? configured : new URL(req.url).origin
  return `${base}/api/ninjatrader/sync`
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 })
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.redirect(new URL("/sign-in?next=/accounts", req.url), 303)
  if (!(await isPro(session.user.id))) return NextResponse.redirect(new URL("/accounts?connect=tradovate&tradovate_error=plan", req.url), 303)

  const { id, key } = await createDeviceKey(session.user.id)
  tlog("addon_downloaded", { provider: "ninjatrader", userId: session.user.id, deviceId: id })
  // UTF-8 with a BOM, so NinjaScript Editor reads the file's non-ASCII text right.
  const file = "﻿" + addonSource({ key, syncUrl: syncUrl(req) })
  return new Response(file, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${ADDON_FILENAME}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
