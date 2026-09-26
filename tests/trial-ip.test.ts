import { test } from "node:test"
import assert from "node:assert/strict"
import { clientIp, hashIp, normalizeIp, trialIpHashFrom } from "@/lib/trial-ip"

process.env.BETTER_AUTH_SECRET ??= "test-secret-for-trial-ip"

test("clientIp reads the first x-forwarded-for entry, then x-real-ip", () => {
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9, 70.41.3.18, 150.172.238.178" })), "203.0.113.9")
  assert.equal(clientIp(new Headers({ "x-real-ip": "198.51.100.7" })), "198.51.100.7")
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "unknown", "x-real-ip": "198.51.100.7" })), "198.51.100.7")
  assert.equal(clientIp(new Headers()), null)
})

test("normalizeIp: IPv4 kept as-is, port and zone stripped", () => {
  assert.equal(normalizeIp("203.0.113.9"), "203.0.113.9")
  assert.equal(normalizeIp("203.0.113.9:54321"), "203.0.113.9")
  assert.equal(normalizeIp(" 203.0.113.9 "), "203.0.113.9")
})

test("normalizeIp: IPv6 collapses to its /64 prefix", () => {
  // full address → first 4 hextets
  assert.equal(normalizeIp("2001:0db8:85a3:1111:2222:3333:4444:5555"), "2001:db8:85a3:1111")
  // "::" compression expanded then truncated
  assert.equal(normalizeIp("2001:db8:85a3:1111::abcd"), "2001:db8:85a3:1111")
  assert.equal(normalizeIp("2001:db8::1"), "2001:db8:0:0")
  assert.equal(normalizeIp("::1"), "0:0:0:0")
  // bracketed with port, and a zone id
  assert.equal(normalizeIp("[2001:db8:85a3:1111::1]:443"), "2001:db8:85a3:1111")
  assert.equal(normalizeIp("fe80::1%eth0"), "fe80:0:0:0")
})

test("hashIp: deterministic, keyed, never the raw IP", () => {
  const a = hashIp("203.0.113.9")!
  assert.match(a, /^[0-9a-f]{64}$/)
  assert.equal(a, hashIp("203.0.113.9"))
  assert.ok(!a.includes("203"))
  assert.equal(hashIp(""), null)
  assert.equal(hashIp(null), null)
  assert.notEqual(hashIp("203.0.113.9"), hashIp("203.0.113.10"))
})

test("hashIp: two addresses in the same IPv6 /64 hash identically; different /64 does not", () => {
  const one = hashIp("2001:db8:85a3:1111:aaaa:bbbb:cccc:dddd")!
  const two = hashIp("2001:db8:85a3:1111:0:0:0:1")! // same /64, different suffix
  const other = hashIp("2001:db8:85a3:2222::1")! // different /64
  assert.equal(one, two)
  assert.notEqual(one, other)
})

test("trialIpHashFrom: end to end from headers, null when no IP", () => {
  assert.equal(trialIpHashFrom(new Headers({ "x-forwarded-for": "203.0.113.9" })), hashIp("203.0.113.9"))
  assert.equal(trialIpHashFrom(new Headers()), null)
})
