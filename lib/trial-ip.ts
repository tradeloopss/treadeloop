import { createHmac } from "node:crypto"

// One-free-trial-per-IP support. The raw IP is never stored — only an HMAC of
// it (keyed by a server secret, so the hash can't be brute-forced back to the
// address), kept on the subscription row that claimed a trial. A later signup
// from the same IP then matches and is offered no trial. This is one signal on
// top of the per-account/email check in lib/subscription.hasUsedTrial; IPs are
// shared (offices, mobile carriers) and change (VPNs, dynamic addresses), so
// it deters casual re-trials rather than being airtight.

// The visitor's IP from the proxy headers Vercel sets. x-forwarded-for is a
// comma list "client, proxy1, proxy2…"; the client is the first entry.
export function clientIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for")
  if (xff) {
    const first = xff.split(",")[0].trim()
    if (first && first.toLowerCase() !== "unknown") return first
  }
  const real = headers.get("x-real-ip")?.trim()
  return real && real.toLowerCase() !== "unknown" ? real : null
}

// A stable identity string for the address: IPv4 as-is; IPv6 collapsed to its
// /64 prefix (the block an ISP typically hands one customer), so a device
// rotating addresses within its allocation still reads as one identity.
export function normalizeIp(ip: string): string | null {
  let v = ip.trim().toLowerCase()
  if (!v) return null
  // strip a zone id ("fe80::1%eth0") and, for bracketed forms, a port
  v = v.replace(/%.*$/, "")
  const bracket = /^\[(.+)\](?::\d+)?$/.exec(v)
  if (bracket) v = bracket[1]

  // IPv4, optionally with a :port some proxies append — checked before IPv6
  // so "1.2.3.4:5678" isn't mistaken for a colon-separated v6 address.
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/.exec(v)
  if (v4) return v4[1]

  if (v.includes(":")) {
    const groups = expandIpv6(v)
    return groups ? groups.slice(0, 4).map(stripHextet).join(":") : v
  }
  return v
}

// "0db8" -> "db8", "0000" -> "0": normalize a hextet's leading zeros so the
// same address written different ways hashes the same.
const stripHextet = (h: string) => h.replace(/^0+(?=.)/, "")

// Expands "::" compression into 8 hextets; returns null if it doesn't parse.
function expandIpv6(v: string): string[] | null {
  if (v === "::") return ["0", "0", "0", "0", "0", "0", "0", "0"]
  const halves = v.split("::")
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(":") : []
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : []
  if (halves.length === 1) {
    return head.length === 8 && head.every(isHextet) ? head : null
  }
  const missing = 8 - head.length - tail.length
  if (missing < 0) return null
  const full = [...head, ...Array(missing).fill("0"), ...tail]
  return full.length === 8 && full.every(isHextet) ? full : null
}

const isHextet = (h: string) => /^[0-9a-f]{1,4}$/.test(h)

// HMAC of the normalized IP, keyed by a server secret so raw IPs aren't
// recoverable from the stored hash. Null when there's no usable IP (fail open
// — never block a checkout just because the address couldn't be read).
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  const norm = normalizeIp(ip)
  if (!norm) return null
  const secret = process.env.BETTER_AUTH_SECRET || process.env.BROKER_CREDENTIALS_KEY || "tradeloop-trial-ip"
  return createHmac("sha256", secret).update(`trial:${norm}`).digest("hex")
}

// Convenience: the hashed IP straight from a request's headers.
export function trialIpHashFrom(headers: Headers): string | null {
  return hashIp(clientIp(headers))
}
