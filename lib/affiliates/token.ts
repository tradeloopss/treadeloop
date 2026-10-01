import { createHmac, timingSafeEqual } from "node:crypto"

// The attribution cookie. It carries who referred this visitor, signed with a
// server secret (HMAC-SHA256), so the browser can hold it but can't forge or
// alter it — an affiliate id is never taken from client input.

export const ATTRIBUTION_COOKIE = "tl_aff"
export const VISITOR_COOKIE = "tl_vid"

export type AttributionPayload = {
  a: number // affiliate id
  l: number | null // link id
  c: number | null // campaign id
  k: number | null // click id
  v: string // visitor id
  t: number // click time (ms)
}

// The link is clicked on the marketing site (tradeloop.pro) and the account is
// created on the app (app.tradeloop.pro), so the cookie has to be visible to
// both: AUTH_COOKIE_DOMAIN when it's set, otherwise the registrable domain of
// the request host. Localhost, IPs and *.vercel.app previews get a host-only
// cookie (null), which is all they can use.
export function attributionCookieDomain(host: string | null | undefined): string | null {
  const configured = process.env.AUTH_COOKIE_DOMAIN?.trim()
  if (configured) return configured
  const hostname = (host ?? "").toLowerCase().split(":")[0]
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".vercel.app") || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null
  const labels = hostname.split(".")
  return labels.length >= 2 ? `.${labels.slice(-2).join(".")}` : null
}

// Whether a signed-in user could still be attributed to the click in this
// cookie — the cheap check (no database) the app layout runs before asking
// the browser to make the claim.
export function claimable(token: string | null | undefined, userCreatedAt: Date | string | number, secret: string): boolean {
  const p = verifyAttribution(token, secret)
  return !!p && new Date(userCreatedAt).getTime() >= p.t - 5 * 60_000
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url")
const mac = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest("base64url")

export function attributionSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set")
  return `affiliate-attribution:${secret}`
}

export function signAttribution(payload: AttributionPayload, secret: string): string {
  const body = b64(JSON.stringify(payload))
  return `${body}.${mac(body, secret)}`
}

export function verifyAttribution(token: string | null | undefined, secret: string): AttributionPayload | null {
  if (!token) return null
  const dot = token.lastIndexOf(".")
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const got = Buffer.from(token.slice(dot + 1))
  const want = Buffer.from(mac(body, secret))
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AttributionPayload
    if (!Number.isInteger(p.a) || p.a <= 0 || typeof p.v !== "string" || !Number.isFinite(p.t)) return null
    return { a: p.a, l: p.l ?? null, c: p.c ?? null, k: p.k ?? null, v: p.v, t: p.t }
  } catch {
    return null
  }
}
