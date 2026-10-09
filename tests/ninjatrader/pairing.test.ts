import { test } from "node:test"
import assert from "node:assert/strict"
import { hashPairCode, newPairCode, normalizePairCode } from "@/lib/ninjatrader/pairing"

// Pairing codes are the "ABC-123" the dashboard shows. They must be easy to
// type (unambiguous, grouped), and matched whatever case or spacing is used.

test("codes are unambiguous and grouped, and matched regardless of case or dashes", () => {
  const { code, hash } = newPairCode()
  assert.match(code, /^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/)
  assert.doesNotMatch(code, /[01OIL]/) // none of the characters people confuse
  // the hash is of the normalized code, so lower-case / no dashes / spaces still match
  assert.equal(hashPairCode(code.toLowerCase()), hash)
  assert.equal(hashPairCode(code.replace(/-/g, " ")), hash)
  assert.equal(normalizePairCode(" aBc-1 2 3 "), "ABC123")
  // only its SHA-256 hash is ever stored
  assert.match(hash, /^[0-9a-f]{64}$/)
  assert.notEqual(newPairCode().hash, newPairCode().hash)
})
