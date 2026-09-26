import { test } from "node:test"
import assert from "node:assert/strict"
import { InstrumentCache } from "@/lib/tradovate/instruments"
import { mockTradovateApi } from "@/lib/tradovate/mock"
import { feeTotal, normalizeAccount, normalizeFills, normalizeOrder, normalizePosition, reconcileIds } from "@/lib/tradovate/normalize"
import { dedupeExecutions, executionKey } from "@/lib/providers/idempotency"
import type { NormalizedExecution } from "@/lib/providers/types"

async function demoData() {
  const api = mockTradovateApi("demo")
  const [orders, fills] = await Promise.all([api.orders(), api.fills()])
  const specs = await new InstrumentCache().resolve(api, [...new Set(fills.map((f) => f.contractId))])
  const fees = new Map((await api.fillFees(fills.map((f) => f.id))).map((f) => [f.id, f]))
  const orderAccount = new Map(orders.map((o) => [o.id, o.accountId]))
  return { api, orders, fills, specs, fees, orderAccount }
}

test("instrument specs come from Tradovate's contract → maturity → product records", async () => {
  const api = mockTradovateApi("demo")
  const cache = new InstrumentCache()
  const specs = await cache.resolve(api, [101, 102, 103, 101])
  assert.deepEqual(specs.get(101), { contractId: 101, symbol: "ESZ5", product: "ES", contractMonth: "2025-12", pointValue: 50, tickSize: 0.25, assetClass: "future" })
  assert.equal(specs.get(102)?.pointValue, 20)
  assert.equal(specs.get(103)?.pointValue, 5)
  // Cached: a second resolve needs no API calls.
  const noCalls = { ...api, contracts: async () => assert.fail("not cached") }
  assert.equal((await cache.resolve(noCalls, [101])).get(101)?.symbol, "ESZ5")
})

test("fees: every fee component summed to the cent", () => {
  assert.equal(feeTotal({ id: 1, commission: 1.58, exchangeFee: 2.28, clearingFee: 0.2, nfaFee: 0.04 }), 4.1)
  assert.equal(feeTotal(undefined), null)
})

test("fills are attributed to accounts through their orders, across accounts", async () => {
  const { fills, specs, fees, orderAccount } = await demoData()
  const out = normalizeFills("demo", fills, orderAccount, specs, fees)
  assert.equal(out.unattributed.length, 0)
  assert.equal(out.unresolved.length, 0)
  const byAccount = new Map<string, number>()
  for (const e of out.executions) byAccount.set(e.providerAccountId, (byAccount.get(e.providerAccountId) ?? 0) + 1)
  assert.deepEqual(Object.fromEntries(byAccount), { "5001": 7, "5002": 3 }) // incl. the duplicate and the busted fill
  const first = out.executions.find((e) => e.providerExecutionId === "1001")!
  assert.equal(first.symbol, "ESZ5")
  assert.equal(first.side, "buy")
  assert.equal(first.pointValue, 50)
  assert.equal(first.commission, 4.1)
  assert.equal(first.contractMonth, "2025-12")
  assert.equal(out.executions.find((e) => e.providerExecutionId === "1099")!.active, false, "busted fill is kept but inactive")
})

test("a fill whose order is unknown is held back, not guessed", async () => {
  const { fills, specs, fees } = await demoData()
  const partial = new Map([[2001, 5001]])
  const out = normalizeFills("demo", fills, partial, specs, fees)
  assert.equal(out.executions.length, 1)
  assert.equal(out.unattributed.length, fills.length - 1)
})

test("a fill with an unknown contract is held back", async () => {
  const { fills, fees, orderAccount } = await demoData()
  const out = normalizeFills("demo", fills, orderAccount, new Map(), fees)
  assert.equal(out.executions.length, 0)
  assert.equal(out.unresolved.length, fills.length)
})

test("accounts, orders and positions normalize with balance, equity and margin", async () => {
  const live = mockTradovateApi("live")
  const [account] = await live.accounts()
  const a = normalizeAccount("live", account, await live.cashBalance(account.id))
  assert.equal(a.providerAccountId, "7001")
  assert.equal(a.balance, 25000)
  assert.equal(a.equity, 25012.5)
  assert.equal(a.currency, "USD")
  assert.equal(a.active, true)
  const specs = await new InstrumentCache().resolve(live, [101])
  const [p] = await live.positions()
  assert.deepEqual(
    { ...normalizePosition("live", p, specs), updatedAt: null },
    { provider: "tradovate", environment: "live", providerAccountId: "7001", contractId: "101", symbol: "ESZ5", netQuantity: 1, averagePrice: 6510, updatedAt: null },
  )
  const [o] = await live.orders()
  const order = normalizeOrder("live", o, specs)
  assert.equal(order.symbol, "ESZ5")
  assert.equal(order.side, "buy")
  assert.equal(order.status, "Filled")
})

test("idempotency: provider ids key executions; a duplicate delivery counts once", async () => {
  const { fills, specs, fees, orderAccount } = await demoData()
  const { executions } = normalizeFills("demo", fills, orderAccount, specs, fees)
  assert.equal(executionKey(executions[0]), "tradovate:demo:1001")
  const unique = dedupeExecutions(executions)
  assert.equal(unique.length, executions.length - 1)
  assert.equal(unique.filter((e) => e.providerExecutionId === "1002").length, 1)
  // Seen before (e.g. from REST, then realtime): skipped entirely.
  assert.equal(dedupeExecutions(executions, new Set(unique.map(executionKey))).length, 0)
})

test("idempotency: without a provider id, a stable hash of the fill's identity", () => {
  const base: NormalizedExecution = {
    provider: "tradovate", environment: "demo", providerAccountId: "1", providerExecutionId: null, providerOrderId: "9",
    symbol: "ESZ5", contractMonth: null, assetClass: "future", side: "buy", quantity: 1, price: 6500, pointValue: 50,
    timestamp: new Date("2025-11-03T14:30:00Z"), commission: null, currency: "USD", active: true, metadata: {},
  }
  const k = executionKey(base)
  assert.match(k, /^tradovate:demo:h:[0-9a-f]{40}$/)
  assert.equal(executionKey({ ...base }), k)
  // Same timestamp, different fill — must not collide.
  assert.notEqual(executionKey({ ...base, price: 6500.25 }), k)
  assert.notEqual(executionKey({ ...base, quantity: 2 }), k)
})

test("reconciliation: what's missing locally, and what aged out of the remote window", () => {
  assert.deepEqual(reconcileIds(["a", "b", "old"], ["a", "b", "c", "d"]), { missing: ["c", "d"], notInRemoteWindow: 1 })
  assert.deepEqual(reconcileIds([], []), { missing: [], notInRemoteWindow: 0 })
})
