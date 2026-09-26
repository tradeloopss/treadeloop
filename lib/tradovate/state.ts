import { randomBytes, timingSafeEqual } from "node:crypto"
import { decrypt, encrypt } from "@/lib/crypto"

// OAuth `state` for the Tradovate sign-in: a random nonce sent to Tradovate,
// and the same nonce — bound to the TradeLoop user and a 10-minute expiry —
// kept in an encrypted, httpOnly cookie. The callback accepts a code only if
// both match, the cookie hasn't expired, and the signed-in user is the one who
// started. Nothing about the flow is stored in the browser in the clear.

export const STATE_COOKIE = "tl_tradovate_oauth"
export const STATE_TTL_MS = 10 * 60 * 1000

interface StatePayload {
  n: string // nonce
  u: string // TradeLoop user id
  x: number // expires at (ms)
}

export function createOAuthState(userId: string, now = Date.now()): { state: string; cookie: string } {
  const nonce = randomBytes(24).toString("base64url")
  const payload: StatePayload = { n: nonce, u: userId, x: now + STATE_TTL_MS }
  return { state: nonce, cookie: encrypt(JSON.stringify(payload)) }
}

export type StateCheck = { ok: true } | { ok: false; reason: "missing" | "tampered" | "expired" | "mismatch" | "user" }

export function verifyOAuthState(cookie: string | undefined, state: string | null, userId: string, now = Date.now()): StateCheck {
  if (!cookie || !state) return { ok: false, reason: "missing" }
  let payload: StatePayload
  try {
    payload = JSON.parse(decrypt(cookie)) as StatePayload
  } catch {
    return { ok: false, reason: "tampered" }
  }
  if (typeof payload.n !== "string" || typeof payload.u !== "string" || typeof payload.x !== "number") return { ok: false, reason: "tampered" }
  if (payload.x < now) return { ok: false, reason: "expired" }
  const a = Buffer.from(payload.n)
  const b = Buffer.from(state)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "mismatch" }
  if (payload.u !== userId) return { ok: false, reason: "user" }
  return { ok: true }
}
