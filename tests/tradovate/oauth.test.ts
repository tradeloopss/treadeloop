import { test } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { tradovateAvailability, tradovateConfig } from "@/lib/tradovate/config"
import { authorizeUrl, exchangeCode, freshTokens, me, needsRenewal, tokensFromOAuth } from "@/lib/tradovate/oauth"
import { createOAuthState, verifyOAuthState, STATE_TTL_MS } from "@/lib/tradovate/state"
import { redact } from "@/lib/tradovate/log"
import { ProviderError, type ProviderTokens } from "@/lib/providers/types"
import { scriptedFetch } from "./helpers"

process.env.BROKER_CREDENTIALS_KEY ??= randomBytes(32).toString("hex")

const ENV = {
  TRADOVATE_MODE: "staging",
  TRADOVATE_CLIENT_ID: "client-123",
  TRADOVATE_CLIENT_SECRET: "client-secret-xyz",
  TRADOVATE_OAUTH_AUTHORIZE_URL: "https://staging.example/oauth",
  APP_URL: "https://app.example",
} as unknown as NodeJS.ProcessEnv
const cfg = tradovateConfig(ENV)
const noSleep = { sleep: async () => {} }

test("config: staging hosts, redirect URI from APP_URL, token URL on the live REST host", () => {
  assert.equal(cfg.mode, "staging")
  assert.deepEqual(
    cfg.endpoints.map((e) => [e.environment, e.restUrl, e.wsUrl]),
    [
      ["demo", "https://demo-api.staging.ninjatrader.dev/v1", "wss://demo-api.staging.ninjatrader.dev/v1/websocket"],
      ["live", "https://live-api.staging.ninjatrader.dev/v1", "wss://live-api.staging.ninjatrader.dev/v1/websocket"],
    ],
  )
  assert.equal(cfg.oauth.redirectUri, "https://app.example/api/integrations/tradovate/callback")
  assert.equal(cfg.oauth.tokenUrl, "https://live-api.staging.ninjatrader.dev/v1/auth/oauthtoken")
})

test("availability: off by default, lists missing settings by name only, mock never in production", () => {
  assert.equal(tradovateAvailability({} as NodeJS.ProcessEnv).enabled, false)
  const missing = tradovateAvailability({ TRADOVATE_MODE: "production" } as unknown as NodeJS.ProcessEnv)
  assert.equal(missing.enabled, false)
  assert.ok(missing.missing.includes("TRADOVATE_CLIENT_ID") && missing.missing.includes("TRADOVATE_CLIENT_SECRET"))
  assert.equal(tradovateAvailability(ENV).enabled, true)
  assert.equal(tradovateAvailability({ TRADOVATE_MODE: "mock" } as unknown as NodeJS.ProcessEnv).enabled, true)
  assert.equal(tradovateAvailability({ TRADOVATE_MODE: "mock", VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv).enabled, false)
})

test("authorize URL carries code flow, client id, redirect and state — never the secret", () => {
  const url = new URL(authorizeUrl(cfg, "nonce-1"))
  assert.equal(url.origin + url.pathname, "https://staging.example/oauth")
  assert.equal(url.searchParams.get("response_type"), "code")
  assert.equal(url.searchParams.get("client_id"), "client-123")
  assert.equal(url.searchParams.get("redirect_uri"), "https://app.example/api/integrations/tradovate/callback")
  assert.equal(url.searchParams.get("state"), "nonce-1")
  assert.ok(!url.href.includes("client-secret-xyz"))
})

test("code exchange posts to the token endpoint and computes expiries", async () => {
  const f = scriptedFetch([{ json: { access_token: "A1", refresh_token: "R1", expires_in: 3600, refresh_token_expires_in: 1209600 } }])
  const before = Date.now()
  const tokens = await exchangeCode(cfg, "CODE", { fetch: f.fetch, ...noSleep })
  assert.equal(f.calls[0].url, "https://live-api.staging.ninjatrader.dev/v1/auth/oauthtoken")
  assert.deepEqual(f.calls[0].body, { grant_type: "authorization_code", code: "CODE", redirect_uri: cfg.oauth.redirectUri, client_id: "client-123", client_secret: "client-secret-xyz" })
  assert.equal(tokens.accessToken, "A1")
  assert.equal(tokens.refreshToken, "R1")
  assert.ok(Math.abs(tokens.accessExpiresAt.getTime() - (before + 3600_000)) < 5_000)
  assert.ok(Math.abs(tokens.refreshExpiresAt!.getTime() - (before + 1209600_000)) < 5_000)
})

test("a declined exchange is an auth error", () => {
  assert.throws(() => tokensFromOAuth({ error: "invalid_grant", error_description: "bad code" }), (e: unknown) => e instanceof ProviderError && e.kind === "auth")
})

function tokens(expiresInMs: number, refresh: string | null = "R1"): ProviderTokens {
  return { accessToken: "OLD", accessExpiresAt: new Date(Date.now() + expiresInMs), refreshToken: refresh, refreshExpiresAt: null }
}

test("fresh tokens: untouched when far from expiry", async () => {
  const f = scriptedFetch([])
  const t = tokens(50 * 60_000)
  assert.equal(needsRenewal(t), false)
  assert.equal(await freshTokens(cfg, cfg.endpoints[0].restUrl, t, { fetch: f.fetch }), t)
  assert.equal(f.calls.length, 0)
})

test("fresh tokens: renews with renewaccesstoken near expiry", async () => {
  const exp = new Date(Date.now() + 90 * 60_000).toISOString()
  const f = scriptedFetch([{ json: { accessToken: "NEW", expirationTime: exp } }])
  const out = await freshTokens(cfg, cfg.endpoints[0].restUrl, tokens(5 * 60_000), { fetch: f.fetch, ...noSleep })
  assert.equal(f.calls[0].url, `${cfg.endpoints[0].restUrl}/auth/renewaccesstoken`)
  assert.equal(f.calls[0].headers.Authorization, "Bearer OLD")
  assert.equal(out.accessToken, "NEW")
  assert.equal(out.refreshToken, "R1")
})

test("fresh tokens: falls back to the refresh token, then to reauth", async () => {
  const f = scriptedFetch([{ status: 401 }, { json: { access_token: "REFRESHED", expires_in: 3600 } }])
  const out = await freshTokens(cfg, cfg.endpoints[0].restUrl, tokens(5 * 60_000), { fetch: f.fetch, ...noSleep })
  assert.equal(out.accessToken, "REFRESHED")
  assert.equal(out.refreshToken, "R1", "keeps the refresh token when none is rotated in")
  assert.equal(f.calls[1].body?.grant_type, "refresh_token")

  const g = scriptedFetch([{ status: 401 }, { status: 401 }])
  await assert.rejects(freshTokens(cfg, cfg.endpoints[0].restUrl, tokens(5 * 60_000), { fetch: g.fetch, ...noSleep }), (e: unknown) => e instanceof ProviderError && e.kind === "reauth")
  // Already expired and nothing to refresh with: straight to reauth, no calls.
  const h = scriptedFetch([])
  await assert.rejects(freshTokens(cfg, cfg.endpoints[0].restUrl, tokens(-1000, null), { fetch: h.fetch }), (e: unknown) => e instanceof ProviderError && e.kind === "reauth")
  assert.equal(h.calls.length, 0)
})

test("fresh tokens: a Tradovate outage is not mistaken for an expired login", async () => {
  const f = scriptedFetch([{ status: 503 }, { status: 503 }])
  await assert.rejects(freshTokens(cfg, cfg.endpoints[0].restUrl, tokens(5 * 60_000), { fetch: f.fetch, maxRetries: 1, ...noSleep }), (e: unknown) => e instanceof ProviderError && e.kind === "server")
})

test("identity from /auth/me", async () => {
  const f = scriptedFetch([{ json: { userId: 900001, name: "trader1", fullName: "Test Trader" } }])
  assert.deepEqual(await me(cfg.endpoints[0].restUrl, tokens(3600_000), { fetch: f.fetch }), { providerUserId: "900001", name: "Test Trader" })
})

test("OAuth state: accepts the round trip, rejects tampering, expiry, a different state or user", () => {
  const now = Date.now()
  const { state, cookie } = createOAuthState("user-1", now)
  assert.deepEqual(verifyOAuthState(cookie, state, "user-1", now + 1000), { ok: true })
  assert.deepEqual(verifyOAuthState(undefined, state, "user-1", now), { ok: false, reason: "missing" })
  assert.deepEqual(verifyOAuthState(cookie, null, "user-1", now), { ok: false, reason: "missing" })
  const tampered = cookie.slice(0, -4) + (cookie.endsWith("AAAA") ? "BBBB" : "AAAA")
  assert.deepEqual(verifyOAuthState(tampered, state, "user-1", now), { ok: false, reason: "tampered" })
  assert.deepEqual(verifyOAuthState(cookie, state, "user-1", now + STATE_TTL_MS + 1), { ok: false, reason: "expired" })
  assert.deepEqual(verifyOAuthState(cookie, state + "x", "user-1", now), { ok: false, reason: "mismatch" })
  assert.deepEqual(verifyOAuthState(cookie, state, "user-2", now), { ok: false, reason: "user" })
  assert.ok(!cookie.includes("user-1"), "the cookie is encrypted")
})

test("log redaction drops tokens and secrets at any depth", () => {
  const out = JSON.stringify(redact({ accessToken: "a", nested: { refresh_token: "b", client_secret: "c", keep: 1 }, Authorization: "Bearer d", "p-ticket": "e" }))
  for (const secret of ['"a"', '"b"', '"c"', "Bearer d", '"e"']) assert.ok(!out.includes(secret), `${secret} leaked: ${out}`)
  assert.ok(out.includes('"keep":1'))
})
