import { test } from "node:test"
import assert from "node:assert/strict"
import { assetClassFor, brokerFor, currencyCode, parsePayload, skipReason, symbolFor } from "@/lib/ninjatrader/payload"
import { hashDeviceKey, keyFromAuthorization, newDeviceKey } from "@/lib/ninjatrader/keys"
import { buildTradesFromExecutions } from "@/lib/tradovate/fills"
import { executionKey } from "@/lib/providers/idempotency"

const NOW = new Date("2025-11-03T20:00:00Z")
const fill = (over: Record<string, unknown> = {}) => ({
  account: "APEX-1",
  id: "E1",
  orderId: "O1",
  time: "2025-11-03T14:30:00.120Z",
  root: "ES",
  expiry: "2025-12",
  instrumentType: "Future",
  fullName: "ES 12-25",
  pointValue: 50,
  tickSize: 0.25,
  side: "buy",
  qty: 2,
  price: 6500,
  commission: 4.1,
  ...over,
})
const body = (executions: unknown[], accounts: unknown[] = [{ name: "APEX-1", provider: "NinjaTrader", currency: "UsDollar", cashValue: 50600.5 }]) => ({ v: 1, client: { version: "1.0.0", machine: "PC" }, accounts, executions })

test("futures symbols match Tradovate's own (ES 12-25 → ESZ5)", () => {
  assert.deepEqual(symbolFor("ES", "2025-12", "Future"), { symbol: "ESZ5", contractMonth: "2025-12" })
  assert.deepEqual(symbolFor("MNQ", "2026-03", "Future"), { symbol: "MNQH6", contractMonth: "2026-03" })
  assert.deepEqual(symbolFor("CL", "2030-01", "Future"), { symbol: "CLF0", contractMonth: "2030-01" })
  assert.deepEqual(symbolFor("AAPL", null, "Stock"), { symbol: "AAPL", contractMonth: null })
  assert.deepEqual(symbolFor("EURUSD", null, "Forex"), { symbol: "EURUSD", contractMonth: null })
  assert.deepEqual(symbolFor("ES", "garbage", "Future"), { symbol: "ES", contractMonth: null })
})

test("asset classes, currencies and broker labels", () => {
  assert.equal(assetClassFor("Future"), "future")
  assert.equal(assetClassFor("Stock"), "stock")
  assert.equal(assetClassFor("Forex"), "forex")
  assert.equal(assetClassFor("FutureOption"), "option")
  assert.equal(currencyCode("UsDollar"), "USD")
  assert.equal(currencyCode("Euro"), "EUR")
  assert.equal(currencyCode(undefined), "USD")
  assert.equal(brokerFor("NinjaTrader"), "Tradovate")
  assert.equal(brokerFor("Tradovate"), "Tradovate")
  assert.equal(brokerFor("Rithmic"), "Rithmic")
})

test("NinjaTrader's local simulation is skipped; prop accounts are not", () => {
  assert.equal(skipReason({ name: "Sim101", provider: "Simulator" }), "local_simulation")
  assert.equal(skipReason({ name: "Playback101", provider: null }), "local_simulation")
  assert.equal(skipReason({ name: "MySim", provider: "Simulator" }), "local_simulation")
  assert.equal(skipReason({ name: "APEX-123456-01", provider: "NinjaTrader" }), null)
})

test("parses a payload into normalized executions", () => {
  const r = parsePayload(body([fill()]), NOW)
  assert.ok(r.ok)
  const [e] = r.value.executions
  assert.deepEqual(
    { ...e, timestamp: e.timestamp.toISOString(), metadata: undefined },
    {
      provider: "ninjatrader",
      environment: "desktop",
      providerAccountId: "APEX-1",
      providerExecutionId: "APEX-1|E1",
      providerOrderId: "O1",
      symbol: "ESZ5",
      contractMonth: "2025-12",
      assetClass: "future",
      side: "buy",
      quantity: 2,
      price: 6500,
      pointValue: 50,
      timestamp: "2025-11-03T14:30:00.120Z",
      commission: 4.1,
      currency: "USD",
      active: true,
      metadata: undefined,
    },
  )
  assert.equal(executionKey(e), "ninjatrader:desktop:APEX-1|E1")
  assert.deepEqual(r.value.accounts[0], { name: "APEX-1", provider: "NinjaTrader", connection: null, status: null, currency: "USD", cashValue: 50600.5, netLiquidation: null, realizedPnl: null })
})

test("rejects bad executions one by one, and bad payloads whole", () => {
  const r = parsePayload(body([fill(), fill({ side: "long" }), fill({ qty: 0 }), fill({ time: "yesterday" }), fill({ time: "2031-01-01T00:00:00Z" }), fill({ id: "" }), fill({ price: "6500" })]), NOW)
  assert.ok(r.ok)
  assert.equal(r.value.executions.length, 1)
  assert.deepEqual(r.value.rejected.map((x) => x.index), [1, 2, 3, 4, 5, 6])
  assert.equal(parsePayload({ v: 2 }, NOW).ok, false)
  assert.equal(parsePayload([], NOW).ok, false)
  assert.equal(parsePayload({ v: 1, executions: new Array(5001).fill(fill()) }, NOW).ok, false)
})

test("the same fill sent twice has one key; two accounts' equal ids don't collide", () => {
  const r = parsePayload(body([fill(), fill(), fill({ account: "APEX-2" })]), NOW)
  assert.ok(r.ok)
  const keys = r.value.executions.map(executionKey)
  assert.equal(new Set(keys).size, 2)
})

test("NinjaTrader fills become trades through the shared engine", () => {
  const r = parsePayload(
    body([
      fill({ id: "E1", side: "buy", qty: 2, price: 6500, commission: 4.1 }),
      fill({ id: "E2", side: "buy", qty: 1, price: 6502, commission: 2.05, time: "2025-11-03T14:31:04.500Z" }),
      fill({ id: "E3", side: "sell", qty: 3, price: 6505, commission: 6.15, time: "2025-11-03T14:40:10.000Z" }),
    ]),
    NOW,
  )
  assert.ok(r.ok)
  const rows = r.value.executions.map((e) => ({ ...e, idempotencyKey: executionKey(e) }))
  const [t, ...rest] = buildTradesFromExecutions("desktop-APEX-1", rows, "ninjatrader")
  assert.equal(rest.length, 0)
  assert.deepEqual([t.symbol, t.side, t.quantity, t.gross, t.fees, t.pnl, t.market], ["ESZ5", "long", 3, 650, 12.3, 637.7, "futures"])
  assert.equal(t.externalId, "ninjatrader:desktop-APEX-1:ESZ5:APEX-1|E3")
})

test("device keys: random, hashed, parsed from the Authorization header", () => {
  const a = newDeviceKey()
  const b = newDeviceKey()
  assert.match(a.key, /^tlnt_[A-Za-z0-9_-]{43}$/)
  assert.notEqual(a.key, b.key)
  assert.equal(a.hash, hashDeviceKey(a.key))
  assert.equal(a.hash.length, 64)
  assert.equal(a.hint, a.key.slice(-4))
  assert.equal(keyFromAuthorization(`Bearer ${a.key}`), a.key)
  assert.equal(keyFromAuthorization(`Bearer tlnt_short`), null)
  assert.equal(keyFromAuthorization(null), null)
  assert.equal(keyFromAuthorization(`Basic ${a.key}`), null)
})
