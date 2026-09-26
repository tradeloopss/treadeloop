import { test } from "node:test"
import assert from "node:assert/strict"
import { detectAccount, detectAccountSize, type FirmCandidate } from "@/lib/propmax/detect"

const CATALOG: FirmCandidate[] = [
  {
    firmSlug: "apex-trader-funding",
    firmName: "Apex Trader Funding",
    programs: [
      { slug: "evaluation-intraday", name: "Evaluation — Intraday" },
      { slug: "evaluation-eod", name: "Evaluation — EOD" },
    ],
  },
  { firmSlug: "topstep", firmName: "Topstep", programs: [{ slug: "trading-combine", name: "Trading Combine" }] },
]

test("detectAccountSize snaps to a nearby standard size, else null", () => {
  assert.equal(detectAccountSize(50_000), 50_000)
  assert.equal(detectAccountSize(52_000), 50_000) // within 12%
  assert.equal(detectAccountSize(150_000), 150_000)
  assert.equal(detectAccountSize(7_000), null) // matches nothing standard
  assert.equal(detectAccountSize(0), null)
  assert.equal(detectAccountSize(null), null)
})

test("a single-program firm is auto-picked but still needs confirmation", () => {
  const d = detectAccount({ systemName: "Topstep", startingBalance: 50_000 }, CATALOG)
  assert.equal(d.firmSlug, "topstep")
  assert.equal(d.programSlug, "trading-combine")
  assert.equal(d.accountSize, 50_000)
  assert.equal(d.confidence, "medium")
  assert.equal(d.needsConfirmation, true)
})

test("a multi-program firm resolves the firm but not the program", () => {
  const d = detectAccount({ systemName: "Apex", startingBalance: 100_000 }, CATALOG)
  assert.equal(d.firmSlug, "apex-trader-funding")
  assert.equal(d.programSlug, null) // can't know which challenge from the system name
  assert.equal(d.confidence, "low")
  assert.equal(d.needsConfirmation, true)
})

test("no firm match is UNKNOWN, never a guess", () => {
  const d = detectAccount({ systemName: "SomeUnknownBroker", startingBalance: 50_000 }, CATALOG)
  assert.equal(d.firmSlug, null)
  assert.equal(d.confidence, "unknown")
  assert.equal(d.accountSize, 50_000) // size can still be inferred
  assert.equal(d.needsConfirmation, true)
})

test("detection never claims high confidence from signals alone", () => {
  for (const hint of ["Topstep", "Apex", "Nothing"]) {
    const d = detectAccount({ systemName: hint, startingBalance: 50_000 }, CATALOG)
    assert.notEqual(d.confidence, "high")
    assert.equal(d.needsConfirmation, true)
  }
})
