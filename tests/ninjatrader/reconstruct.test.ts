import { test } from "node:test"
import assert from "node:assert/strict"
import { buildTradesFromExecutions, type StoredExecution } from "@/lib/tradovate/fills"

// The journal trades the NinjaTrader add-on's fills become, through the shared
// reconstruction engine (lib/fill-reconstruction) under the "ninjatrader"
// prefix. These are the acceptance scenarios: scale-in, partial/full close and
// reversal must give the right net position and P&L. ES futures, $50/point.

let t = 0
const ex = (side: "buy" | "sell", qty: number, price: number): StoredExecution => {
  t += 1
  return { providerExecutionId: `E${t}`, idempotencyKey: `k${t}`, symbol: "ESZ5", timestamp: new Date(Date.UTC(2026, 0, 6, 15, t, 0)), side, quantity: qty, price, commission: 0, pointValue: 50, assetClass: "future" }
}
const build = (rows: StoredExecution[]) => buildTradesFromExecutions("APEX-1", rows, "ninjatrader")

test("BUY 2, SELL 1, SELL 1 → one long trade with the two exits merged", () => {
  const trades = build([ex("buy", 2, 6500), ex("sell", 1, 6510), ex("sell", 1, 6520)])
  assert.equal(trades.length, 1)
  assert.deepEqual([trades[0].side, trades[0].quantity, trades[0].entryPrice, trades[0].exitPrice, trades[0].gross], ["long", 2, 6500, 6515, 1500])
})

test("scale-in then exit: BUY 1 @6500, BUY 1 @6502, SELL 2 @6510 → one long trade, average entry", () => {
  const trades = build([ex("buy", 1, 6500), ex("buy", 1, 6502), ex("sell", 2, 6510)])
  assert.equal(trades.length, 1)
  assert.deepEqual([trades[0].side, trades[0].quantity, trades[0].entryPrice, trades[0].exitPrice, trades[0].gross], ["long", 2, 6501, 6510, 900])
})

test("reversal BUY 2 then SELL 3: the long closes (one trade); a short 1 is left open (not yet a trade)", () => {
  const trades = build([ex("buy", 2, 6500), ex("sell", 3, 6510)])
  assert.equal(trades.length, 1, "only the closed long is a trade; the open short appears when it closes")
  assert.deepEqual([trades[0].side, trades[0].quantity, trades[0].exitPrice, trades[0].gross], ["long", 2, 6510, 1000])
})

test("short side: SELL 2, BUY 1, BUY 1 → one short trade, average exit", () => {
  const trades = build([ex("sell", 2, 6510), ex("buy", 1, 6505), ex("buy", 1, 6500)])
  assert.equal(trades.length, 1)
  assert.deepEqual([trades[0].side, trades[0].quantity, trades[0].entryPrice, trades[0].exitPrice, trades[0].gross], ["short", 2, 6510, 6502.5, 750])
})
