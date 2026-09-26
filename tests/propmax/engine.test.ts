import { test } from "node:test"
import assert from "node:assert/strict"
import { buildContext } from "@/lib/propmax/context"
import { evaluateAccount, type RuleSet } from "@/lib/propmax/engine"
import { evaluateRule } from "@/lib/propmax/rules"
import type { EngineTrade, RuleConfig, RuleResult, RuleSource } from "@/lib/propmax/types"

const SOURCE: RuleSource = { name: "Test firm rules", type: "official_rules", confidence: "high", verifiedAt: "2026-09-26" }

const trade = (date: string, pnl: number, qty = 1): EngineTrade => ({
  entryTime: `${date}T14:00:00Z`,
  exitTime: `${date}T15:00:00Z`,
  pnl,
  symbol: "ES",
  side: pnl >= 0 ? "long" : "short",
  quantity: qty,
})

// +2000, +2000, -1500 → balance 52,500; HWM 54,000; worst day -1,500.
const TRADES = [trade("2025-11-03", 2000, 2), trade("2025-11-04", 2000, 3), trade("2025-11-05", -1500, 1)]
const NOW = new Date("2025-11-05T20:00:00Z") // Wednesday
const ctx = () => buildContext({ startingBalance: 50000, trades: TRADES, now: NOW, lastSyncAt: NOW })

const one = (config: RuleConfig, c = ctx()) => evaluateRule(config, c, SOURCE)
const byType = (rules: RuleResult[], t: RuleConfig["type"]) => rules.find((r) => r.type === t)!

test("context: realized walk gives balance, high-water mark and per-day P&L", () => {
  const c = ctx()
  assert.equal(c.balance, 52500)
  assert.equal(c.highWaterMark, 54000)
  assert.deepEqual(c.daily.map((d) => d.pnl), [2000, 2000, -1500])
  assert.equal(c.stale, false)
})

test("context: a payout lowers balance but not the drawdown floor (peak)", () => {
  const c = buildContext({ startingBalance: 50000, trades: TRADES, payouts: [{ at: "2025-11-04T20:00:00Z", amount: 1000 }], now: NOW, lastSyncAt: NOW })
  assert.equal(c.balance, 51500) // 52500 − 1000
  assert.equal(c.highWaterMark, 54000) // unchanged
})

test("max daily loss: usage ladder and currency vs percentage", () => {
  assert.equal(one({ type: "max_daily_loss", unit: "currency", value: 2500 }).status, "watch") // 1500/2500 = 60%
  assert.equal(one({ type: "max_daily_loss", unit: "currency", value: 1800 }).status, "warning") // 83%
  assert.equal(one({ type: "max_daily_loss", unit: "currency", value: 1400 }).status, "breached") // over
  // percentage of starting balance: 3% of 50k = 1500 → exactly the worst day
  assert.equal(one({ type: "max_daily_loss", unit: "percentage", value: 3 }).status, "breached")
  assert.equal(one({ type: "max_daily_loss", unit: "currency", value: 2500 }).remainingValue, 1000)
})

test("max daily loss: absent rule is not_applicable, never safe", () => {
  assert.equal(one({ type: "max_daily_loss", enabled: false }).status, "not_applicable")
})

test("max drawdown: trailing off the high-water mark, static off the start", () => {
  const trailing = one({ type: "max_drawdown", unit: "currency", value: 2500, model: "trailing" })
  assert.equal(trailing.currentValue, 1500) // 54000 − 52500
  assert.equal(trailing.status, "watch") // 60%
  const staticDd = one({ type: "max_drawdown", unit: "currency", value: 2500, model: "static" })
  assert.equal(staticDd.currentValue, 0) // balance 52500 > start 50000
  assert.equal(staticDd.status, "safe")
})

test("profit target is progress, never a breach", () => {
  const r = one({ type: "profit_target", unit: "currency", value: 3000 })
  assert.equal(r.currentValue, 2500)
  assert.equal(r.remainingValue, 500)
  assert.equal(r.severity, "info")
  assert.equal(r.status, "safe") // 83% toward target, not a warning
})

test("min trading days counts distinct active days", () => {
  const r = one({ type: "min_trading_days", value: 5 })
  assert.equal(r.currentValue, 3)
  assert.equal(r.remainingValue, 2)
})

test("consistency: best day as a share of total profit gates payout, not a breach", () => {
  // profit days +2000 and +2000 → total 4000, best 2000 → 50%
  assert.equal(one({ type: "consistency", unit: "percentage", value: 40 }).status, "warning") // over 40
  assert.equal(one({ type: "consistency", unit: "percentage", value: 60 }).status, "safe") // under 60
  assert.equal(one({ type: "consistency", unit: "percentage", value: 40 }).currentValue, 50)
})

test("consistency is UNKNOWN before there's any profit", () => {
  const losing = buildContext({ startingBalance: 50000, trades: [trade("2025-11-03", -500)], now: NOW, lastSyncAt: NOW })
  assert.equal(one({ type: "consistency", unit: "percentage", value: 40 }, losing).status, "unknown")
})

test("max contracts: live feed vs historical fallback", () => {
  // no live feed → largest traded size (3) of 5 → 60% watch
  assert.equal(one({ type: "max_contracts", value: 5 }).status, "watch")
  const live = buildContext({ startingBalance: 50000, trades: TRADES, openPositions: [{ symbol: "ES", side: "long", quantity: 4 }], livePositionsAvailable: true, now: NOW, lastSyncAt: NOW })
  assert.equal(one({ type: "max_contracts", value: 5 }, live).currentValue, 4) // live total
})

test("position-count rules are UNKNOWN without a live feed, computed with one", () => {
  assert.equal(one({ type: "max_open_positions", value: 3 }).status, "unknown")
  const live = buildContext({ startingBalance: 50000, trades: TRADES, openPositions: [{ symbol: "ES", side: "long", quantity: 1 }, { symbol: "NQ", side: "short", quantity: 1 }], livePositionsAvailable: true, now: NOW, lastSyncAt: NOW })
  const r = one({ type: "max_open_positions", value: 5 }, live)
  assert.equal(r.status, "safe") // 2 of 5 = 40%
  assert.equal(r.currentValue, 2)
})

test("inactivity measures days since the last trade", () => {
  const later = buildContext({ startingBalance: 50000, trades: TRADES, now: new Date("2025-11-12T20:00:00Z"), lastSyncAt: new Date("2025-11-12T20:00:00Z") })
  const r = one({ type: "inactivity", value: 30 }, later)
  assert.equal(r.currentValue, 7)
})

test("weekend holding: UNKNOWN without live positions; warns only in the window", () => {
  assert.equal(one({ type: "weekend_holding", enabled: true }).status, "unknown")
  const sat = buildContext({ startingBalance: 50000, trades: TRADES, openPositions: [{ symbol: "ES", side: "long", quantity: 1 }], livePositionsAvailable: true, now: new Date("2025-11-08T12:00:00Z"), lastSyncAt: new Date("2025-11-08T12:00:00Z") }) // Saturday
  assert.equal(one({ type: "weekend_holding", enabled: true }, sat).status, "warning")
  const wed = buildContext({ startingBalance: 50000, trades: TRADES, openPositions: [{ symbol: "ES", side: "long", quantity: 1 }], livePositionsAvailable: true, now: NOW, lastSyncAt: NOW })
  assert.equal(one({ type: "weekend_holding", enabled: true }, wed).status, "safe")
})

test("news restriction stays UNKNOWN until the calendar is connected", () => {
  assert.equal(one({ type: "news_restriction", enabled: true }).status, "unknown")
})

test("stale data never reads as safe", () => {
  const stale = buildContext({ startingBalance: 50000, trades: TRADES, now: NOW, lastSyncAt: new Date("2025-11-05T18:00:00Z") }) // 2h old
  assert.equal(stale.stale, true)
  assert.equal(one({ type: "max_daily_loss", unit: "currency", value: 2500 }, stale).status, "stale")
})

const RULESET: RuleSet = {
  source: SOURCE,
  rules: [
    { type: "max_daily_loss", unit: "currency", value: 2500 },
    { type: "max_drawdown", unit: "currency", value: 2500, model: "trailing" },
    { type: "profit_target", unit: "currency", value: 3000 },
    { type: "min_trading_days", value: 5 },
    { type: "consistency", unit: "percentage", value: 40 },
    { type: "max_open_positions", enabled: false }, // not applicable → filtered out
  ],
}

test("evaluateAccount: sorts by priority, summarizes, and judges payout", () => {
  const evaln = evaluateAccount(ctx(), RULESET)
  // not_applicable rule is dropped
  assert.ok(!evaln.rules.some((r) => r.type === "max_open_positions"))
  // consistency (warning) sorts ahead of the watches and safes
  assert.equal(evaln.rules[0].type, "consistency")
  assert.equal(evaln.risk.status, "warning")
  assert.equal(evaln.risk.counts.warning, 1)
  assert.equal(evaln.risk.counts.watch, 2) // daily loss + drawdown
  // closest-to-breach headline is a real risk rule, not the info target
  assert.ok(evaln.risk.closest && evaln.risk.closest.severity !== "info")
  // payout blocked with concrete reasons
  assert.equal(evaln.payout.eligible, false)
  assert.equal(evaln.payout.determinable, true)
  assert.ok(evaln.payout.reasons.some((r) => r.includes("trading days")))
})

test("evaluateAccount: a genuine breach makes the account breached and blocks payout", () => {
  const evaln = evaluateAccount(ctx(), { source: SOURCE, rules: [{ type: "max_daily_loss", unit: "currency", value: 1000 }] })
  assert.equal(evaln.rules[0].status, "breached")
  assert.equal(evaln.risk.status, "breached")
  assert.equal(evaln.payout.eligible, false)
})
