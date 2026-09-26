import { test } from "node:test"
import assert from "node:assert/strict"
import { guardOrder } from "@/lib/order-execution/guard"
import { buildContext } from "@/lib/propmax/context"
import { evaluateAccount } from "@/lib/propmax/engine"
import type { EngineTrade, RuleSource } from "@/lib/propmax/types"
import type { OrderCommandInput } from "@/lib/order-execution/types"

const SOURCE: RuleSource = { name: "Test", type: "official_rules", confidence: "high" }
const trade = (date: string, pnl: number, qty = 1): EngineTrade => ({ entryTime: `${date}T14:00:00Z`, exitTime: `${date}T15:00:00Z`, pnl, symbol: "ES", side: "long", quantity: qty })
const NOW = new Date("2025-11-05T20:00:00Z")

function evalWith(rules: Parameters<typeof evaluateAccount>[1]["rules"], trades: EngineTrade[] = [trade("2025-11-05", 500)]) {
  const ctx = buildContext({ startingBalance: 50000, trades, now: NOW, lastSyncAt: NOW })
  return evaluateAccount(ctx, { source: SOURCE, rules })
}

const place = (extra: Partial<OrderCommandInput> = {}): OrderCommandInput => ({ accountId: 1, broker: "mt5", kind: "place", volume: 1, side: "long", symbol: "ES", ...extra })

test("closing / reducing is always allowed, even with no evaluation", () => {
  for (const kind of ["close", "partial_close", "cancel", "modify"] as const) {
    const d = guardOrder({ accountId: 1, broker: "mt5", kind }, null)
    assert.equal(d.allowed, true)
    assert.equal(d.severity, "ok")
  }
})

test("opening on an account with no rules is allowed but flagged unvetted", () => {
  const d = guardOrder(place(), null)
  assert.equal(d.allowed, true)
  assert.match(d.reasons[0], /not rule-checked/)
})

test("a breached account blocks new positions", () => {
  const evaln = evalWith([{ type: "max_daily_loss", unit: "currency", value: 100 }], [trade("2025-11-05", -500)])
  const d = guardOrder(place(), evaln)
  assert.equal(d.allowed, false)
  assert.equal(d.severity, "block")
  assert.match(d.reasons[0], /breached/)
})

test("an order over the max position size is blocked", () => {
  // live feed with 2 contracts open, limit 3; placing 2 more → 4 > 3.
  const ctx = buildContext({ startingBalance: 50000, trades: [trade("2025-11-05", 500)], openPositions: [{ symbol: "ES", side: "long", quantity: 2 }], livePositionsAvailable: true, now: NOW, lastSyncAt: NOW })
  const evaln = evaluateAccount(ctx, { source: SOURCE, rules: [{ type: "max_contracts", value: 3 }] })
  const d = guardOrder(place({ volume: 2 }), evaln)
  assert.equal(d.allowed, false)
  assert.equal(d.severity, "block")
  assert.match(d.reasons[0], /max position size/)
})

test("a small order within the size limit is allowed", () => {
  const ctx = buildContext({ startingBalance: 50000, trades: [trade("2025-11-05", 500)], openPositions: [{ symbol: "ES", side: "long", quantity: 1 }], livePositionsAvailable: true, now: NOW, lastSyncAt: NOW })
  const evaln = evaluateAccount(ctx, { source: SOURCE, rules: [{ type: "max_contracts", value: 5 }] })
  const d = guardOrder(place({ volume: 1 }), evaln)
  assert.equal(d.allowed, true)
})
