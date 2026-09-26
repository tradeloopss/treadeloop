// Tradovate redirects here after the user signs in (OAuth). Validates the
// state against the encrypted cookie (same user, not expired, not tampered),
// exchanges the code for tokens server-side (the client secret never reaches
// the browser), identifies the Tradovate user, stores the tokens encrypted,
// and queues the first sync — the sync worker picks it up within seconds, so
// this request never waits on a large import. Reconnecting the same Tradovate
// login reuses its connection (and everything already imported).
import { cookies, headers } from "next/headers"
import { NextResponse, after } from "next/server"
import { and, eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { tradingConnections } from "@/lib/db/schema"
import { encrypt } from "@/lib/crypto"
import { ProviderError } from "@/lib/providers/types"
import { tradovateAvailability, tradovateConfig } from "@/lib/tradovate/config"
import { runInlineTradovateSync } from "@/lib/tradovate/connections"
import { tlog } from "@/lib/tradovate/log"
import { TradovateProvider } from "@/lib/tradovate/provider"
import { STATE_COOKIE, verifyOAuthState } from "@/lib/tradovate/state"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

function done(req: Request, query: string) {
  const res = NextResponse.redirect(new URL(`/accounts?${query}`, req.url), 303)
  res.cookies.set(STATE_COOKIE, "", { path: "/api/integrations/tradovate", maxAge: 0 })
  return res
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.redirect(new URL("/sign-in?next=/accounts", req.url), 303)
  const userId = session.user.id

  if (url.searchParams.get("error")) {
    tlog("oauth_denied", { userId, error: url.searchParams.get("error") })
    return done(req, "connect=tradovate&tradovate_error=denied")
  }
  const cookie = (await cookies()).get(STATE_COOKIE)?.value
  const check = verifyOAuthState(cookie, url.searchParams.get("state"), userId)
  if (!check.ok) {
    tlog("oauth_state_rejected", { userId, reason: check.reason }, "warn")
    return done(req, "connect=tradovate&tradovate_error=state")
  }
  const code = url.searchParams.get("code")
  if (!code || !tradovateAvailability().enabled) return done(req, "connect=tradovate&tradovate_error=unavailable")

  const config = tradovateConfig()
  const provider = new TradovateProvider({ config })
  try {
    const tokens = await provider.exchangeCode(code)
    const identity = await provider.identity(tokens)
    const environment = config.mode === "mock" ? "mock" : config.mode
    const values = {
      providerUserName: identity.name,
      status: "pending",
      statusMessage: null,
      accessTokenEnc: encrypt(tokens.accessToken),
      refreshTokenEnc: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
      tokenExpiresAt: tokens.accessExpiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt,
      errorCount: 0,
      lastSyncError: null,
      nextSyncAt: new Date(),
      leaseUntil: null,
      updatedAt: new Date(),
    }
    const [existing] = await db
      .select({ id: tradingConnections.id, lastSyncAt: tradingConnections.lastSyncAt })
      .from(tradingConnections)
      .where(and(eq(tradingConnections.userId, userId), eq(tradingConnections.provider, "tradovate"), eq(tradingConnections.environment, environment), eq(tradingConnections.providerUserId, identity.providerUserId)))
    let id: number
    if (existing) {
      id = existing.id
      // A login that has synced before resumes where it left off; its first-
      // sync progress doesn't replay.
      await db.update(tradingConnections).set({ ...values, syncStage: existing.lastSyncAt ? "complete" : "authenticated" }).where(eq(tradingConnections.id, id))
    } else {
      ;[{ id }] = await db
        .insert(tradingConnections)
        .values({ userId, provider: "tradovate", environment, providerUserId: identity.providerUserId, syncStage: "authenticated", ...values })
        .returning({ id: tradingConnections.id })
    }
    tlog("connected", { userId, connectionId: id, environment, reconnect: Boolean(existing) })
    if (environment === "mock") after(() => runInlineTradovateSync(id, "connect"))
    return done(req, `tradovate=${id}`)
  } catch (err) {
    const kind = err instanceof ProviderError ? err.kind : "server"
    tlog("oauth_failed", { userId, kind, message: err instanceof Error ? err.message : String(err) }, "warn")
    return done(req, `connect=tradovate&tradovate_error=${kind === "auth" ? "denied" : kind === "rate_limited" || kind === "captcha" ? "rate" : "exchange"}`)
  }
}
