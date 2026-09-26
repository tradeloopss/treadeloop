import { test } from "node:test"
import assert from "node:assert/strict"
import { openTradeMetrics, summarizeOpenTrades, liveTradeMetrics } from "@/lib/trade-manager"

test("long: risk and reward from entry, stop and target", () => {
  // ES long 2 @ 5000, stop 4990, target 5020, mult 50.
  const m = openTradeMetrics({ side: "long", quantity: 2, entryPrice: 5000, stopLoss: 4990, takeProfit: 5020, contractMultiplier: 50, fees: 0 })
  assert.equal(m.riskAmount, 1000) // 10 pts × 2 × 50
  assert.equal(m.rewardAmount, 2000) // 20 pts × 2 × 50
  assert.equal(m.riskReward, 2)
  assert.equal(m.notional, 500000)
  assert.equal(m.stopConsistent, true)
})

test("short: valid stop is above entry", () => {
  const m = openTradeMetrics({ side: "short", quantity: 1, entryPrice: 100, stopLoss: 105, takeProfit: 90, contractMultiplier: 1, fees: 0 })
  assert.equal(m.riskAmount, 5)
  assert.equal(m.rewardAmount, 10)
  assert.equal(m.riskReward, 2)
  assert.equal(m.stopConsistent, true)
})

test("a stop on the wrong side is flagged, not shown as risk", () => {
  // Long with stop ABOVE entry — that's a locked gain, not risk.
  const m = openTradeMetrics({ side: "long", quantity: 1, entryPrice: 100, stopLoss: 105, takeProfit: 120, contractMultiplier: 1, fees: 0 })
  assert.equal(m.stopConsistent, false)
})

test("no stop → null risk, never a fabricated number", () => {
  const m = openTradeMetrics({ side: "long", quantity: 1, entryPrice: 100, stopLoss: null, takeProfit: 120, contractMultiplier: 1, fees: 0 })
  assert.equal(m.riskAmount, null)
  assert.equal(m.riskReward, null)
  assert.equal(m.rewardAmount, 20)
})

test("fees widen risk and shrink reward", () => {
  const m = openTradeMetrics({ side: "long", quantity: 1, entryPrice: 100, stopLoss: 90, takeProfit: 120, contractMultiplier: 1, fees: 4 })
  assert.equal(m.riskAmount, 14) // 10 + 4
  assert.equal(m.rewardAmount, 16) // 20 − 4
})

test("liveTradeMetrics calibrates risk/reward from the broker's floating P&L", () => {
  // EURUSD long: open 1.1000, current 1.1010 (+10 pips) with +$100 floating.
  // → $10 per pip. Stop 1.0990 (−10) → risk $100; target 1.1030 (+30) → $300.
  const m = liveTradeMetrics({ side: "long", volume: 1, openPrice: 1.1, currentPrice: 1.101, profit: 100, stopLoss: 1.099, takeProfit: 1.103 })
  assert.equal(m.riskAmount, 100)
  assert.equal(m.rewardAmount, 300)
  assert.equal(m.riskReward, 3)
  assert.equal(m.stopConsistent, true)
})

test("liveTradeMetrics is null when the position hasn't moved (no calibration)", () => {
  const m = liveTradeMetrics({ side: "long", volume: 1, openPrice: 1.1, currentPrice: 1.1, profit: 0, stopLoss: 1.099, takeProfit: 1.103 })
  assert.equal(m.riskAmount, null)
  assert.equal(m.rewardAmount, null)
})

test("liveTradeMetrics flags a wrong-side stop for a short", () => {
  // Short: valid stop is ABOVE open. Here stop is below → inconsistent.
  const m = liveTradeMetrics({ side: "short", volume: 1, openPrice: 1.1, currentPrice: 1.099, profit: 100, stopLoss: 1.09, takeProfit: 1.08 })
  assert.equal(m.stopConsistent, false)
})

test("summary totals risk and counts the unprotected", () => {
  const s = summarizeOpenTrades([
    { side: "long", riskAmount: 1000 },
    { side: "short", riskAmount: null },
    { side: "long", riskAmount: 250 },
  ])
  assert.equal(s.count, 3)
  assert.equal(s.totalRisk, 1250)
  assert.equal(s.unprotected, 1)
  assert.equal(s.longs, 2)
  assert.equal(s.shorts, 1)
})
