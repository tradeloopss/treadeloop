// Tradovate configuration, all from the environment (see .env.example and
// docs/integrations/tradovate.md). Nothing here is secret-free by accident:
// client secrets are read only on the server and never leave it.
//
// TRADOVATE_MODE (TRADOVATE_ENV is accepted as an alias):
//   off        — the default: Tradovate shows as "coming soon"
//   mock       — fixture data, no network; local development only
//   staging    — NinjaTrader's staging infrastructure, with staging credentials
//   production — requires production credentials approved by Tradovate
//
// Tradovate runs two environments per stage: "demo" (simulation — evaluation
// and sim-funded prop accounts live here) and "live". Both are synced when
// configured; the official hosts are the defaults and every URL can be
// overridden.

export type TradovateMode = "off" | "mock" | "staging" | "production"
export type TradovateEnvironment = "demo" | "live"

export interface TradovateEndpoint {
  environment: TradovateEnvironment
  restUrl: string // …/v1
  wsUrl: string // …/v1/websocket
}

export interface TradovateConfig {
  mode: TradovateMode
  endpoints: TradovateEndpoint[]
  oauth: {
    authorizeUrl: string | null
    tokenUrl: string | null
    clientId: string | null
    clientSecret: string | null
    redirectUri: string | null
    scope: string | null
  }
  // Reserved for Tradovate's API-key flow (accesstokenrequest). The OAuth flow
  // above is what TradeLoop uses; these are read so a partner setup that is
  // issued API-key credentials can be wired without new configuration.
  appId: string | null
  appVersion: string | null
}

const DEFAULT_HOSTS: Record<"staging" | "production", Record<TradovateEnvironment, { rest: string; ws: string }>> = {
  staging: {
    demo: { rest: "https://demo-api.staging.ninjatrader.dev/v1", ws: "wss://demo-api.staging.ninjatrader.dev/v1/websocket" },
    live: { rest: "https://live-api.staging.ninjatrader.dev/v1", ws: "wss://live-api.staging.ninjatrader.dev/v1/websocket" },
  },
  production: {
    demo: { rest: "https://demo.tradovateapi.com/v1", ws: "wss://demo.tradovateapi.com/v1/websocket" },
    live: { rest: "https://live.tradovateapi.com/v1", ws: "wss://live.tradovateapi.com/v1/websocket" },
  },
}

// Tradovate's own sign-in page for OAuth. Staging has no published default —
// set TRADOVATE_OAUTH_AUTHORIZE_URL to the URL Tradovate gives you.
const DEFAULT_AUTHORIZE_URL: Record<"staging" | "production", string | null> = {
  staging: null,
  production: "https://trader.tradovate.com/oauth",
}

const clean = (v: string | undefined) => (v && v.trim() !== "" ? v.trim().replace(/\/+$/, "") : null)

export function tradovateMode(env: NodeJS.ProcessEnv = process.env): TradovateMode {
  const raw = (env.TRADOVATE_MODE ?? env.TRADOVATE_ENV ?? "off").trim().toLowerCase()
  return raw === "mock" || raw === "staging" || raw === "production" ? raw : "off"
}

export function tradovateConfig(env: NodeJS.ProcessEnv = process.env): TradovateConfig {
  const mode = tradovateMode(env)
  const hosts = mode === "staging" || mode === "production" ? DEFAULT_HOSTS[mode] : null

  // TRADOVATE_API_BASE_URL / TRADOVATE_WS_URL are the live environment;
  // TRADOVATE_DEMO_API_BASE_URL / TRADOVATE_DEMO_WS_URL the demo one.
  // TRADOVATE_ENVIRONMENTS limits which are synced (default: both).
  const wanted = new Set(
    (env.TRADOVATE_ENVIRONMENTS ?? "demo,live")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s): s is TradovateEnvironment => s === "demo" || s === "live"),
  )
  const endpoints: TradovateEndpoint[] = []
  const live = { rest: clean(env.TRADOVATE_API_BASE_URL) ?? hosts?.live.rest ?? null, ws: clean(env.TRADOVATE_WS_URL) ?? hosts?.live.ws ?? null }
  const demo = { rest: clean(env.TRADOVATE_DEMO_API_BASE_URL) ?? hosts?.demo.rest ?? null, ws: clean(env.TRADOVATE_DEMO_WS_URL) ?? hosts?.demo.ws ?? null }
  if (wanted.has("demo") && demo.rest && demo.ws) endpoints.push({ environment: "demo", restUrl: demo.rest, wsUrl: demo.ws })
  if (wanted.has("live") && live.rest && live.ws) endpoints.push({ environment: "live", restUrl: live.rest, wsUrl: live.ws })
  if (mode === "mock") {
    endpoints.push({ environment: "demo", restUrl: "mock://demo", wsUrl: "mock://demo" }, { environment: "live", restUrl: "mock://live", wsUrl: "mock://live" })
  }

  const appUrl = clean(env.APP_URL) ?? clean(env.BETTER_AUTH_URL)
  const tokenBase = live.rest ?? demo.rest
  return {
    mode,
    endpoints,
    oauth: {
      authorizeUrl: clean(env.TRADOVATE_OAUTH_AUTHORIZE_URL) ?? (mode === "staging" || mode === "production" ? DEFAULT_AUTHORIZE_URL[mode] : null),
      tokenUrl: clean(env.TRADOVATE_OAUTH_TOKEN_URL) ?? (tokenBase ? `${tokenBase}/auth/oauthtoken` : null),
      clientId: clean(env.TRADOVATE_CLIENT_ID),
      clientSecret: env.TRADOVATE_CLIENT_SECRET?.trim() || null,
      redirectUri: clean(env.TRADOVATE_REDIRECT_URI) ?? (appUrl ? `${appUrl}/api/integrations/tradovate/callback` : null),
      scope: env.TRADOVATE_OAUTH_SCOPE?.trim() || null,
    },
    appId: env.TRADOVATE_APP_ID?.trim() || null,
    appVersion: env.TRADOVATE_APP_VERSION?.trim() || null,
  }
}

export interface TradovateAvailability {
  enabled: boolean
  mode: TradovateMode
  missing: string[] // configuration still needed (names only — never values)
}

// Whether "Connect Tradovate" can be offered. Mock data is never offered on a
// production deployment, so fixture trades can't land in a real journal.
export function tradovateAvailability(env: NodeJS.ProcessEnv = process.env): TradovateAvailability {
  const cfg = tradovateConfig(env)
  if (cfg.mode === "off") return { enabled: false, mode: cfg.mode, missing: ["TRADOVATE_MODE"] }
  if (cfg.mode === "mock") {
    const production = env.NODE_ENV === "production" || env.VERCEL_ENV === "production"
    return { enabled: !production, mode: cfg.mode, missing: production ? ["TRADOVATE_MODE=mock is disabled in production"] : [] }
  }
  const missing: string[] = []
  if (!cfg.oauth.clientId) missing.push("TRADOVATE_CLIENT_ID")
  if (!cfg.oauth.clientSecret) missing.push("TRADOVATE_CLIENT_SECRET")
  if (!cfg.oauth.authorizeUrl) missing.push("TRADOVATE_OAUTH_AUTHORIZE_URL")
  if (!cfg.oauth.tokenUrl) missing.push("TRADOVATE_OAUTH_TOKEN_URL")
  if (!cfg.oauth.redirectUri) missing.push("TRADOVATE_REDIRECT_URI")
  if (cfg.endpoints.length === 0) missing.push("TRADOVATE_API_BASE_URL")
  return { enabled: missing.length === 0, mode: cfg.mode, missing }
}

// The realtime subscription's entity types (user/syncrequest requires them).
export const SYNC_ENTITY_TYPES = ["account", "cashBalance", "position", "order", "fill", "fillFee"]
