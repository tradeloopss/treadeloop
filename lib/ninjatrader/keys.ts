import { createHash, randomBytes } from "node:crypto"

// The key a downloaded add-on posts with. Shown once (inside the add-on file)
// and stored only as a SHA-256 hash; the last 4 characters are kept as a hint
// so the trader can tell two installs apart.
export const KEY_PREFIX = "tlnt_"

export function newDeviceKey(): { key: string; hash: string; hint: string } {
  const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`
  return { key, hash: hashDeviceKey(key), hint: key.slice(-4) }
}

export function hashDeviceKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex")
}

// "Bearer tlnt_…" → the key, or null.
export function keyFromAuthorization(header: string | null): string | null {
  const m = header ? /^Bearer\s+(tlnt_[A-Za-z0-9_-]{20,})\s*$/.exec(header) : null
  return m ? m[1] : null
}
