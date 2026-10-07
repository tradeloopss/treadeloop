import { test } from "node:test"
import assert from "node:assert/strict"
import { classifyFailure } from "@/lib/copy/errors"
import { copyStats, copySummary, type AccountView, type CopyState, type GroupView, type OrderView, type PositionView } from "@/lib/copy/view"
import { DEFAULT_FOLLOWER, DEFAULT_RULES, NO_PROPSYNC } from "@/lib/copy/engine"

// A failed copy is told to the trader as a kind of failure with a next step,
// and the dashboard's numbers come from the orders themselves: what was sent,
// what went through, and how long it took. Nothing here is estimated.

test("a failure is sorted by what the broker said, and the trader is told what to do next", () => {
  const cases: [string, string][] = [
    ["No money", "margin"],
    ["Not enough money to open the position (retcode 10019)", "margin"],
    ["Market closed", "market_closed"],
    ["Invalid volume", "volume"],
    ["unknown symbol US100.std", "symbol"],
    ["MetaTrader rejected the login — check the account number, investor password and server name", "authentication"],
    ["Trade disabled", "account_disabled"],
    ["Rithmic accounts can't receive orders from TradeLoop yet.", "account_disabled"],
    ["MetaTrader login failed: IPC recv failed", "connection"],
    ["The order was not sent: its record is gone. Use Retry to send it again.", "connection"],
    ["The copy lane sent this order and stopped before the broker answered. Check the account: the position may or may not be open.", "timeout"],
    ["Requote", "broker_rejection"],
    ["Invalid stops", "broker_rejection"],
    ["FundingPips does not permit this copy direction: nothing may be copied into a FundingPips account from an account outside FundingPips.", "compliance"],
    ["TradeLoop places no orders on FundingPips accounts: FundingPips's rules don't allow it.", "compliance"],
    ["", "unknown"],
    ["something nobody has seen before", "unknown"],
  ]
  for (const [message, category] of cases) assert.equal(classifyFailure(message).category, category, message)
  assert.equal(classifyFailure(null).category, "unknown")
  // a timeout is never an invitation to send the order again blind
  assert.match(classifyFailure("timed out").action, /may already be open/)
  assert.match(classifyFailure("No money").action, /lower its copy size/)
  assert.equal(classifyFailure("No money").label, "Insufficient margin")
})

const order = (id: number, over: Partial<OrderView> = {}): OrderView =>
  ({ id, groupId: 1, correlationId: `c${id}`, masterOrderId: `m${id}`, masterAccountId: 1, followerAccountId: 2, action: "open", symbol: "XAUUSD", leaderSymbol: "XAUUSD", side: "long", quantity: 1, leaderQuantity: 1, requestedPrice: null, executionPrice: null, stopLoss: null, takeProfit: null, status: "filled", reason: null, slippage: null, latencyMs: null, tradeloopMs: null, simulated: false, createdAt: "2026-10-07T10:00:00.000Z", decision: null, ...over }) as OrderView

test("the copy numbers are counted from the orders: success, failures, and latency only where it was measured", () => {
  const dayOf = (iso: string) => iso.slice(0, 10)
  const s = copyStats(
    [
      order(1, { latencyMs: 120, createdAt: "2026-10-07T12:00:00.000Z" }),
      order(2, { latencyMs: 300, createdAt: "2026-10-07T11:00:00.000Z" }),
      order(3, { latencyMs: 180, createdAt: "2026-10-06T11:00:00.000Z" }),
      // a simulated fill is a copy, and took no time at a broker
      order(4, { simulated: true, latencyMs: null }),
      order(5, { status: "failed", reason: "No money" }),
      order(6, { status: "rejected" }),
      // not an outcome yet, and never asked: neither counts for or against
      order(7, { status: "sent" }),
      order(8, { status: "skipped" }),
    ],
    "2026-10-07",
    dayOf,
  )
  assert.deepEqual([s.total, s.filled, s.failed, s.today, s.todayFilled], [6, 4, 2, 7, 3])
  assert.equal(s.successRate, 4 / 6)
  // the newest measured order is the last latency; the average and the worst are over the measured ones only
  assert.deepEqual([s.lastLatencyMs, s.avgLatencyMs, s.maxLatencyMs], [120, 200, 300])
  const none = copyStats([order(1, { simulated: true })], "2026-10-07", dayOf)
  assert.deepEqual([none.lastLatencyMs, none.avgLatencyMs, none.maxLatencyMs, none.successRate], [null, null, null, 1])
})

const account = (id: number): AccountView => ({ id, name: `Account ${id}`, broker: null, platform: "MetaTrader 5", login: String(id), currency: "USD", balance: 10_000, equity: 10_000, openPositions: 0, linked: true, health: "connected", healthNote: null, lastSyncAt: null, latencyMs: null, heartbeatAt: null, preferredRole: "follower", role: "follower", groups: [], provider: null, connectedBy: "TradeLoop cloud", authentication: null, canExecute: true, executionNote: "", dayPnl: 0, openPnl: null, openNotional: 0, propSync: NO_PROPSYNC, symbols: [], lane: "standard", pingMs: null })
const group = (id: number, status: GroupView["status"], leader: number, followers: number[]): GroupView => ({ id, name: `G${id}`, status, leaderAccountId: leader, followers: followers.map((accountId, i) => ({ id: id * 10 + i, accountId, config: { ...DEFAULT_FOLLOWER }, mappings: [] })), contracts: [], rules: { ...DEFAULT_RULES }, limits: { defaultMode: "same", defaultRatio: 1, globalRiskPct: 1, respectPropSync: true }, compliance: [], createdAt: "2026-10-01T00:00:00.000Z" })
const pos = (accountId: number, over: Partial<PositionView> = {}): PositionView => ({ accountId, symbol: "XAUUSD", side: "long", quantity: 1, entry: 100, current: 101, openPnl: 10, stopLoss: null, takeProfit: null, simulated: false, groupId: null, ...over })

test("the dashboard counts Masters and Followers once each, and what is open on the followers", () => {
  const state = {
    accounts: [1, 2, 3, 4, 5].map(account),
    // account 1 leads two groups; account 3 follows both; a draft group is not counted as running
    groups: [group(1, "active", 1, [2, 3]), group(2, "paused", 1, [3, 4]), group(3, "draft", 5, [2])],
    positions: [pos(1), pos(2), pos(2, { symbol: "EURUSD" }), pos(3, { simulated: true, groupId: 1 }), pos(5)],
  } as unknown as CopyState
  assert.deepEqual(copySummary(state), { activeGroups: 1, groups: 3, masters: 2, followers: 3, openOnFollowers: 3 })
})
