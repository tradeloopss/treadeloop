import { test } from "node:test"
import assert from "node:assert/strict"
import { PROP_FIRM_PRESETS, findPreset } from "@/lib/propfirm-presets"
import { buildContext } from "@/lib/propmax/context"
import { evaluateAccount } from "@/lib/propmax/engine"
import { buildCatalogSeed, presetToRuleSet, presetToRuleConfigs, slugify } from "@/lib/propmax/presets-bridge"
import { resolvePresetRules } from "@/lib/propfirm-presets"
import type { EngineTrade } from "@/lib/propmax/types"

test("slugify makes stable machine keys", () => {
  assert.equal(slugify("Funded Futures Family"), "funded-futures-family")
  assert.equal(slugify("Alpha Futures (TheTradingPit)"), "alpha-futures-thetradingpit")
  assert.equal(slugify("Evaluation — Intraday"), "evaluation-intraday")
})

test("presetToRuleConfigs: exact per-size dollars become currency rules, never guessed", () => {
  // FFF Prime $50K: profit target $3,000, drawdown $2,000, no daily loss.
  const fff = findPreset("Funded Futures Family", "Prime")!
  const rules = presetToRuleConfigs(resolvePresetRules(fff, 50_000, "evaluation"))
  const drawdown = rules.find((r) => r.type === "max_drawdown")!
  const target = rules.find((r) => r.type === "profit_target")!
  assert.equal(drawdown.unit, "currency")
  assert.equal(drawdown.value, 2000)
  assert.equal(drawdown.model, "trailing")
  assert.equal(target.value, 3000)
  // Prime has no daily loss limit → no such rule emitted (engine → not_applicable)
  assert.ok(!rules.some((r) => r.type === "max_daily_loss"))
})

test("presetToRuleSet carries a real source and confidence", () => {
  const fff = findPreset("Funded Futures Family", "Prime")!
  const rs = presetToRuleSet(fff, 50_000, "evaluation")
  assert.ok(rs.source)
  assert.equal(rs.source!.type, "official_rules")
  assert.equal(rs.source!.confidence, "high") // exact per-size figures
  assert.match(rs.versionLabel!, /Prime/)
})

test("a preset rule set evaluates end-to-end through the engine", () => {
  const apex = findPreset("Apex Trader Funding", "Evaluation — Intraday")!
  const rs = presetToRuleSet(apex, 50_000, "evaluation")
  // $50K Apex: 6% target = $3,000, 5% trailing drawdown = $2,500, no daily loss.
  const trade = (date: string, pnl: number): EngineTrade => ({
    entryTime: `${date}T14:00:00Z`,
    exitTime: `${date}T15:00:00Z`,
    pnl,
    symbol: "ES",
    side: "long",
    quantity: 1,
  })
  const now = new Date("2025-11-05T20:00:00Z")
  const ctx = buildContext({ startingBalance: 50_000, trades: [trade("2025-11-03", 1500)], now, lastSyncAt: now })
  const evaln = evaluateAccount(ctx, rs)
  const target = evaln.rules.find((r) => r.type === "profit_target")!
  assert.equal(target.limitValue, 3000)
  assert.equal(target.currentValue, 1500)
  const dd = evaln.rules.find((r) => r.type === "max_drawdown")!
  assert.equal(dd.limitValue, 2500)
  assert.equal(dd.currentValue, 0) // still above starting balance on a trailing floor
})

test("buildCatalogSeed produces one firm per firm, programs per preset, versions per size×phase", () => {
  const seed = buildCatalogSeed()
  const firmNames = new Set(PROP_FIRM_PRESETS.map((p) => p.firm))
  assert.equal(seed.firms.length, firmNames.size)
  assert.equal(seed.programs.length, PROP_FIRM_PRESETS.length)

  // Every version references a firm and program that exist in the seed.
  const firmSlugs = new Set(seed.firms.map((f) => f.slug))
  const programKeys = new Set(seed.programs.map((p) => `${p.firmSlug}/${p.slug}`))
  for (const v of seed.versions) {
    assert.ok(firmSlugs.has(v.firmSlug), `firm ${v.firmSlug} missing`)
    assert.ok(programKeys.has(`${v.firmSlug}/${v.programSlug}`), `program ${v.programSlug} missing`)
    assert.ok(v.rules.length > 0, "a version has no rules")
    assert.ok(v.sourceName.length > 0, "a version has no source")
    assert.ok(["high", "medium", "low"].includes(v.confidence))
  }
})

test("buildCatalogSeed: FFF Velocity gets a funded phase, Apex Intraday does not", () => {
  const seed = buildCatalogSeed()
  const velocity = seed.versions.filter((v) => v.programSlug === slugify("Velocity"))
  assert.ok(velocity.some((v) => v.phase === "funded"))
  const apex = seed.versions.filter((v) => v.programSlug === slugify("Evaluation — Intraday"))
  assert.ok(apex.length > 0)
  assert.ok(!apex.some((v) => v.phase === "funded")) // no funded rules defined
})

test("buildCatalogSeed: per-size firms seed their exact sizes; others get the defaults", () => {
  const seed = buildCatalogSeed()
  // FFF Prime lists 25/50/100/150k → exactly those, evaluation phase.
  const primeEval = seed.versions.filter((v) => v.programSlug === slugify("Prime") && v.phase === "evaluation")
  assert.deepEqual(primeEval.map((v) => v.accountSize).sort((a, b) => a - b), [25_000, 50_000, 100_000, 150_000])
  // Apex has no per-size table → default sizes.
  const apex = seed.versions.filter((v) => v.programSlug === slugify("Evaluation — Intraday"))
  assert.deepEqual(apex.map((v) => v.accountSize).sort((a, b) => a - b), [25_000, 50_000, 100_000, 150_000])
})
