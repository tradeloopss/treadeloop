// "Connect Tradovate": starts the official OAuth sign-in. Creates the OAuth
// state (encrypted, httpOnly cookie bound to this user, 10 minutes) and sends
// the browser to Tradovate's own sign-in page — TradeLoop never sees the
// user's Tradovate password. In TRADOVATE_MODE=mock (local development) it
// goes straight to the callback with a mock code instead.
import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { isPro } from "@/lib/subscription"
import { tradovateAvailability, tradovateConfig } from "@/lib/tradovate/config"
import { sameOrigin } from "@/lib/tradovate/connections"
import { tlog } from "@/lib/tradovate/log"
import { TradovateProvider } from "@/lib/tradovate/provider"
import { STATE_COOKIE, STATE_TTL_MS, createOAuthState } from "@/lib/tradovate/state"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const back = (req: Request, error: string) => NextResponse.redirect(new URL(`/accounts?connect=tradovate&tradovate_error=${error}`, req.url), 303)

export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 })
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.redirect(new URL("/sign-in?next=/accounts", req.url), 303)

  const availability = tradovateAvailability()
  if (!availability.enabled) return back(req, "unavailable")
  // Live broker sync is a Pro feature (Essential's one live sync is MetaTrader).
  if (!(await isPro(session.user.id))) return back(req, "plan")

  const { state, cookie } = createOAuthState(session.user.id)
  const config = tradovateConfig()
  const target = config.mode === "mock" ? new URL(`/api/integrations/tradovate/callback?code=mock-code&state=${encodeURIComponent(state)}`, req.url).toString() : new TradovateProvider({ config }).authorizeUrl(state)
  tlog("oauth_started", { userId: session.user.id, mode: config.mode })

  const res = NextResponse.redirect(target, 303)
  res.cookies.set(STATE_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // sent on Tradovate's top-level redirect back to us
    path: "/api/integrations/tradovate",
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  })
  return res
}
