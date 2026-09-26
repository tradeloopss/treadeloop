import { test } from "node:test"
import assert from "node:assert/strict"
import { reconstructTrades, type ParsedFill } from "@/lib/fill-reconstruction"
import { buildTradesFromExecutions, type StoredExecution } from "@/lib/tradovate/fills"
import { InstrumentCache } from "@/lib/tradovate/instruments"
import { mockTradovateApi } from "@/lib/tradovate/mock"
import { normalizeFills } from "@/lib/tradovate/normalize"
import { dedupeExecutions, executionKey } from "@/lib/providers/idempotency"
import type { TvFill, TvFillFee, TvOrder } from "@/lib/tradovate/types"

const fill = (id: string, action: "Buy" | "Sell", qty: number, price: number, minute: number, fee?: number): ParsedFill => ({
  externalId: id,
  account: "A",
  symbol: "ESZ5",
  timestamp: new Date(Date.UTC(2025, 10, 3, 14, minute)).toISOString(),
  action,
  qty,
  price,
  fee,
})

test("the spec's example: BUY 2 @ 6500, BUY 1 @ 6502, SELL 3 @ 6505 is one long trade", () => {
  const [t, ...rest] = reconstructTrades([fill("1", "Buy", 2, 6500, 0), fill("2", "Buy", 1, 6502, 1), fill("3", "Sell", 3, 6505, 10)], "tradovate")
  assert.equal(rest.length, 0)
  assert.equal(t.side, "long")
  assert.equal(t.quantity, 3)
  assert.ok(Math.abs(t.entryPrice - 19502 / 3) < 1e-9, "average entry 6500.67")
  assert.equal(t.exitPrice, 6505)
  // (6505 − 6500.667) × 3 × $50 = $650 gross
  assert.ok(Math.abs((t.exitPrice - t.entryPrice) * t.quantity * 50 - 650) < 1e-6)
})

test("fees follow their fills; a flip splits its fee by quantity", () => {
  const trades = reconstructTrades([fill("1", "Buy", 1, 6500, 0, 0.6), fill("2", "Sell", 2, 6490, 5, 1.2), fill("3", "Buy", 1, 6480, 10, 0.6)], "tradovate")
  assert.equal(trades.length, 2)
  assert.equal(trades[0].side, "long")
  assert.equal(trades[0].fees, 1.2) // 0.6 open + half of the flip's 1.2
  assert.equal(trades[1].side, "short")
  assert.equal(trades[1].fees, 1.2) // the other half + 0.6 close
})

test("feeds without per-fill fees are unchanged (fees 0)", () => {
  const [t] = reconstructTrades([fill("1", "Buy", 1, 6500, 0), fill("2", "Sell", 1, 6501, 1)], "rithmic")
  assert.equal(t.fees, 0)
})

// Mock Tradovate → normalize → store-shape → engine, as the sync does it.
async function storedFor(environment: "demo" | "live", extra: { fills?: TvFill[]; orders?: TvOrder[]; fees?: TvFillFee[] } = {}) {
  const api = mockTradovateApi(environment, extra)
  const [orders, fills] = await Promise.all([api.orders(), api.fills()])
  const specs = await new InstrumentCache().resolve(api, fills.map((f) => f.contractId))
  const fees = new Map((await api.fillFees(fills.map((f) => f.id))).map((f) => [f.id, f]))
  const { executions } = normalizeFills(environment, fills, new Map(orders.map((o) => [o.id, o.accountId])), specs, fees)
  const byAccount = new Map<string, StoredExecution[]>()
  for (const e of dedupeExecutions(executions)) {
    if (!e.active) continue // busted fills are stored inactive and never traded
    const row: StoredExecution = { providerExecutionId: e.providerExecutionId, idempotencyKey: executionKey(e), symbol: e.symbol, timestamp: e.timestamp, side: e.side, quantity: e.quantity, price: e.price, commission: e.commission, pointValue: e.pointValue }
    byAccount.set(e.providerAccountId, [...(byAccount.get(e.providerAccountId) ?? []), row])
  }
  return byAccount
}

test("mock sync end to end: trades, P&L and fees per account", async () => {
  const stored = await storedFor("demo")
  const apex = buildTradesFromExecutions("demo-5001", stored.get("5001")!)
  assert.deepEqual(
    apex.map((t) => [t.symbol, t.side, t.quantity, t.gross, t.fees, t.pnl, t.multiplier]),
    [
      ["ESZ5", "long", 3, 650, 12.3, 637.7, 50], // fees of fills 1001 + 1002 (once) + 1003: 4.10 + 2.05 + 6.15
      ["NQZ5", "short", 1, 400, 3.86, 396.14, 20], // busted fill 1099 ignored
    ],
  )
  const sim = buildTradesFromExecutions("demo-5002", stored.get("5002")!)
  assert.deepEqual(
    sim.map((t) => [t.side, t.quantity, t.gross, t.fees]),
    [
      ["long", 1, -50, 1.2],
      ["short", 1, 50, 1.2],
    ],
  )
  // Live account: one open position, no closed trade yet.
  assert.deepEqual(buildTradesFromExecutions("live-7001", (await storedFor("live")).get("7001")!), [])
})

test("rebuilding is idempotent: same executions, same externalIds", async () => {
  const a = buildTradesFromExecutions("demo-5001", (await storedFor("demo")).get("5001")!)
  const b = buildTradesFromExecutions("demo-5001", (await storedFor("demo")).get("5001")!)
  assert.deepEqual(a.map((t) => t.externalId), b.map((t) => t.externalId))
  assert.equal(new Set(a.map((t) => t.externalId)).size, a.length)
  assert.match(a[0].externalId, /^tradovate:demo-5001:ESZ5:1003$/)
})

test("reconciliation adds a trade placed after the first sync without touching the others", async () => {
  const before = buildTradesFromExecutions("demo-5001", (await storedFor("demo")).get("5001")!)
  const later = await storedFor("demo", {
    orders: [
      { id: 2101, accountId: 5001, contractId: 101, action: "Sell", ordStatus: "Filled", orderType: "Market", orderQty: 1, timestamp: "2025-11-06T15:00:00.000Z" },
      { id: 2102, accountId: 5001, contractId: 101, action: "Buy", ordStatus: "Filled", orderType: "Market", orderQty: 1, timestamp: "2025-11-06T15:10:00.000Z" },
    ],
    fills: [
      { id: 1101, orderId: 2101, contractId: 101, timestamp: "2025-11-06T15:00:00.000Z", action: "Sell", qty: 1, price: 6600, active: true },
      { id: 1102, orderId: 2102, contractId: 101, timestamp: "2025-11-06T15:10:00.000Z", action: "Buy", qty: 1, price: 6610, active: true },
    ],
  })
  const after = buildTradesFromExecutions("demo-5001", later.get("5001")!)
  assert.equal(after.length, before.length + 1)
  for (const t of before) assert.deepEqual(after.find((x) => x.externalId === t.externalId), t)
  const added = after.find((t) => t.externalId.endsWith(":1102"))!
  assert.deepEqual([added.side, added.gross, added.fees], ["short", -500, 0])
})
