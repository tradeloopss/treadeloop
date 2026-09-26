import { ProviderError, type ProviderIdentity, type ProviderTokens } from "@/lib/providers/types"
import type { TradovateConfig } from "@/lib/tradovate/config"
import { tradovateRequest, type HttpDeps } from "@/lib/tradovate/http"
import type { TvMe } from "@/lib/tradovate/types"

// Tradovate OAuth (authorization-code flow):
//   1. send the user to <authorizeUrl>?response_type=code&client_id&redirect_uri&state
//   2. Tradovate redirects back with ?code&state
//   3. POST <tokenUrl> { grant_type: "authorization_code", code, redirect_uri, client_id, client_secret }
//      → { access_token, expires_in, refresh_token, refresh_token_expires_in }
// Renewal prefers GET /auth/renewaccesstoken (as Tradovate's conformance
// asks), falling back to the refresh token, then to asking the user to
// reconnect. The client secret is only ever sent server → Tradovate.

export function authorizeUrl(cfg: TradovateConfig, state: string): string {
  const { authorizeUrl: base, clientId, redirectUri, scope } = cfg.oauth
  if (!base || !clientId || !redirectUri) throw new ProviderError("config", "Tradovate sign-in isn't configured yet.")
  const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, state })
  if (scope) params.set("scope", scope)
  return `${base}?${params.toString()}`
}

interface OAuthTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  refresh_token_expires_in?: number
  error?: string
  error_description?: string
}

export function tokensFromOAuth(json: OAuthTokenResponse, now = new Date()): ProviderTokens {
  if (json.error || !json.access_token) {
    throw new ProviderError("auth", json.error_description ? `Tradovate declined the sign-in: ${json.error_description.slice(0, 160)}` : "Tradovate declined the sign-in.")
  }
  const expiresIn = typeof json.expires_in === "number" && json.expires_in > 0 ? json.expires_in : 3600
  return {
    accessToken: json.access_token,
    accessExpiresAt: new Date(now.getTime() + expiresIn * 1000),
    refreshToken: json.refresh_token ?? null,
    refreshExpiresAt: typeof json.refresh_token_expires_in === "number" ? new Date(now.getTime() + json.refresh_token_expires_in * 1000) : null,
  }
}

function tokenEndpoint(cfg: TradovateConfig): { base: string; path: string } {
  const url = cfg.oauth.tokenUrl
  if (!url) throw new ProviderError("config", "Tradovate sign-in isn't configured yet.")
  const u = new URL(url)
  return { base: `${u.protocol}//${u.host}`, path: u.pathname }
}

export async function exchangeCode(cfg: TradovateConfig, code: string, deps: HttpDeps = {}): Promise<ProviderTokens> {
  const { clientId, clientSecret, redirectUri } = cfg.oauth
  if (!clientId || !clientSecret || !redirectUri) throw new ProviderError("config", "Tradovate sign-in isn't configured yet.")
  const { base, path } = tokenEndpoint(cfg)
  const json = await tradovateRequest<OAuthTokenResponse>(base, { method: "POST", path, body: { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret } }, deps)
  return tokensFromOAuth(json)
}

export async function refreshWithToken(cfg: TradovateConfig, refreshToken: string, deps: HttpDeps = {}): Promise<ProviderTokens> {
  const { clientId, clientSecret } = cfg.oauth
  if (!clientId || !clientSecret) throw new ProviderError("config", "Tradovate sign-in isn't configured yet.")
  const { base, path } = tokenEndpoint(cfg)
  const json = await tradovateRequest<OAuthTokenResponse>(base, { method: "POST", path, body: { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret } }, deps)
  const tokens = tokensFromOAuth(json)
  // Some servers don't rotate the refresh token; keep the one we have.
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken }
}

// GET /auth/renewaccesstoken → { accessToken, expirationTime }.
export async function renewAccessToken(restUrl: string, tokens: ProviderTokens, deps: HttpDeps = {}): Promise<ProviderTokens> {
  const json = await tradovateRequest<{ accessToken?: string; expirationTime?: string; errorText?: string }>(restUrl, { path: "/auth/renewaccesstoken", token: tokens.accessToken }, deps)
  if (!json.accessToken) throw new ProviderError("auth", "Tradovate didn't renew the session.")
  const expires = json.expirationTime ? new Date(json.expirationTime) : new Date(Date.now() + 60 * 60 * 1000)
  return { ...tokens, accessToken: json.accessToken, accessExpiresAt: Number.isNaN(expires.getTime()) ? new Date(Date.now() + 60 * 60 * 1000) : expires }
}

export async function me(restUrl: string, tokens: ProviderTokens, deps: HttpDeps = {}): Promise<ProviderIdentity> {
  const json = await tradovateRequest<TvMe>(restUrl, { path: "/auth/me", token: tokens.accessToken }, deps)
  if (typeof json.userId !== "number") throw new ProviderError("invalid", "Tradovate didn't say which user signed in.")
  return { providerUserId: String(json.userId), name: json.fullName || json.name || null }
}

// Renew well before expiry (10 minutes of margin).
export const RENEW_MARGIN_MS = 10 * 60 * 1000
export function needsRenewal(tokens: ProviderTokens, now = Date.now()): boolean {
  return tokens.accessExpiresAt.getTime() - now < RENEW_MARGIN_MS
}

// Renew, else refresh, else give up (the user reconnects).
export async function freshTokens(cfg: TradovateConfig, restUrl: string, tokens: ProviderTokens, deps: HttpDeps = {}): Promise<ProviderTokens> {
  if (!needsRenewal(tokens)) return tokens
  if (tokens.accessExpiresAt.getTime() > Date.now()) {
    try {
      return await renewAccessToken(restUrl, tokens, deps)
    } catch (err) {
      if (!(err instanceof ProviderError) || (err.kind !== "auth" && err.kind !== "invalid")) throw err
    }
  }
  if (tokens.refreshToken && (!tokens.refreshExpiresAt || tokens.refreshExpiresAt.getTime() > Date.now())) {
    try {
      return await refreshWithToken(cfg, tokens.refreshToken, deps)
    } catch (err) {
      if (!(err instanceof ProviderError) || (err.kind !== "auth" && err.kind !== "invalid")) throw err
    }
  }
  throw new ProviderError("reauth", "Tradovate authorization expired. Please reconnect your account.")
}
