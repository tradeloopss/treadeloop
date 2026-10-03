import { createHmac } from "node:crypto"
import { CODE_DIGITS, isCode } from "./action-code-rules"

// Authenticator codes (RFC 6238), for the verification step on a payout.
// The same computation the sign-in two-factor uses (HMAC-SHA1, 30 seconds, six
// digits, one step either side for a clock that is slightly off) — done here
// rather than through the sign-in endpoint, which would log every payout as
// "turned on 2FA".

function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const mac = createHmac("sha1", Buffer.from(secret, "utf8")).update(msg).digest()
  const offset = mac[mac.length - 1] & 15
  const truncated = ((mac[offset] & 127) << 24) | ((mac[offset + 1] & 255) << 16) | ((mac[offset + 2] & 255) << 8) | (mac[offset + 3] & 255)
  return String(truncated % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, "0")
}

export function totpMatches(secret: string, code: string, nowMs: number, window = 1): boolean {
  if (!secret || !isCode(code)) return false
  const counter = Math.floor(nowMs / 30_000)
  let matched = false
  // every step is checked, match or not, so the time taken says nothing
  for (let i = -window; i <= window; i++) {
    if (counter + i < 0) continue
    const expected = hotp(secret, counter + i)
    let diff = 0
    for (let k = 0; k < CODE_DIGITS; k++) diff |= expected.charCodeAt(k) ^ code.charCodeAt(k)
    matched = diff === 0 || matched
  }
  return matched
}
