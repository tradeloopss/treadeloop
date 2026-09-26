import { test } from "node:test"
import assert from "node:assert/strict"
import { openTradeMetrics, summarizeOpenTrades } from "@/lib/trade-manager"

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
