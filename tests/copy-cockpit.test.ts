import { test } from "node:test"
import assert from "node:assert/strict"
import { specFor } from "@/lib/copy/contracts"
import { DEFAULT_FOLLOWER, DEFAULT_RULES, NO_PROPSYNC, type FollowerConfig } from "@/lib/copy/engine"
import { marketStatus } from "@/lib/copy/market"
import { cockpitContracts, copyStatus, groupCopies, groupScope, netPosition, orderBucket, orderSide, price, sizingSummary, symbolCounts, symbolScope, type AccountView, type GroupView, type OrderView, type PositionView } from "@/lib/copy/view"

// The Cockpit shows one contract at a time, and Flatten closes exactly what it
// shows. These hold the pieces to that: which positions a contract covers on
// each account, how they net out, and what the clock and the order tabs say.

const account = (id: number, over: Partial<AccountView> = {}): AccountView => ({ id, name: `Account ${id}`, broker: null, platform: "MetaTrader 5", login: String(1000 + id), currency: "USD", balance: 10_000, equity: 10_000, openPositions: 0, linked: true, health: "connected", healthNote: null, lastSyncAt: null, latencyMs: null, heartbeatAt: null, preferredRole: "follower", role: "follower", groups: [], shared: null, sharing: { ok: true }, provider: null, connectedBy: "TradeLoop cloud", authentication: "Investor + trading password", canExecute: true, executionNote: "", dayPnl: 0, openPnl: null, openNotional: 0, propSync: NO_PROPSYNC, symbols: [], lane: "standard", pingMs: null, ...over })
const follower = (id: number, accountId: number, config: Partial<FollowerConfig> = {}, mappings: { leaderSymbol: string; followerSymbol: string }[] = []) => ({ id, accountId, config: { ...DEFAULT_FOLLOWER, ...config }, mappings })
const group = (over: Partial<GroupView> = {}): GroupView => ({ id: 7, name: "Futures", status: "active", leaderAccountId: 1, followers: [follower(1, 2), follower(2, 3, {}, [{ leaderSymbol: "NQZ6", followerSymbol: "MNQZ6" }])], contracts: [specFor("NQZ6"), specFor("MNQZ6")], rules: { ...DEFAULT_RULES }, limits: { defaultMode: "same", defaultRatio: 1, globalRiskPct: 1, respectPropSync: true }, compliance: [], createdAt: "2026-10-01T00:00:00.000Z", ...over })
const pos = (accountId: number, symbol: string, quantity: number, over: Partial<PositionView> = {}): PositionView => ({ accountId, symbol, side: "long", quantity, entry: 100, current: 101, openPnl: 10, stopLoss: null, takeProfit: null, simulated: false, groupId: null, ...over })

test("a contract's scope is the Leader's positions in it and each follower's in its own name for it, and nothing else", () => {
  const accounts = [account(1), account(2), account(3)]
  const positions = [pos(1, "NQZ6", 2), pos(1, "ESZ6", 1), pos(2, "NQZ6", 2), pos(2, "MNQZ6", 9), pos(3, "MNQZ6", 4), pos(3, "NQZ6", 1), pos(99, "NQZ6", 5)]
  const scope = symbolScope(group(), accounts, positions, "NQZ6")
  // the Leader and the first follower in NQ; the second follower is mapped to the micro, so its micro
  assert.deepEqual(scope.map((r) => [r.accountId, r.leader, r.symbol, r.via, r.positions.map((p) => `${p.symbol}x${p.quantity}`)]), [
    [1, true, "NQZ6", "same", ["NQZ6x2"]],
    [2, false, "NQZ6", "same", ["NQZ6x2"]],
    [3, false, "MNQZ6", "mapping", ["MNQZ6x4"]],
  ])
  // the other tab: not the same positions, and no account outside the group ever
  const micro = symbolScope(group(), accounts, positions, "MNQZ6")
  assert.deepEqual(micro.map((r) => r.positions.map((p) => `${p.symbol}x${p.quantity}`)), [[], ["MNQZ6x9"], ["MNQZ6x4"]])
})

test("Flatten All's scope is everything the group's accounts hold, the Leader's included, in every symbol", () => {
  const positions = [pos(1, "XAUUSD.m", 0.1), pos(1, "US100.std", 1), pos(1, "US100.std", 1), pos(2, "XAUUSDm", 0.1), pos(2, "BTCUSDm", 1), pos(3, "MNQZ6", 4, { simulated: true, groupId: 7 }), pos(3, "MNQZ6", 9, { simulated: true, groupId: 8 }), pos(99, "NQZ6", 5)]
  const scope = groupScope(group(), positions)
  // every position of the Leader and of each follower, whatever the symbol; a simulated one only if it is this group's;
  // never an account that isn't in the group
  assert.deepEqual(scope.map((r) => [r.accountId, r.leader, r.positions.map((p) => `${p.symbol}x${p.quantity}`)]), [
    [1, true, ["XAUUSD.mx0.1", "US100.stdx1", "US100.stdx1"]],
    [2, false, ["XAUUSDmx0.1", "BTCUSDmx1"]],
    [3, false, ["MNQZ6x4"]],
  ])
  assert.equal(symbolCounts(scope[0].positions), "XAUUSD.m, US100.std ×2")
  // one contract's scope is a part of it, never more
  const gold = symbolScope(group({ contracts: [specFor("XAUUSD")] }), [account(1), account(2, { symbols: ["XAUUSDm"] }), account(3)], positions, "XAUUSD")
  assert.deepEqual(gold.map((r) => r.positions.length), [1, 1, 0])
})

test("a broker's own spelling of the instrument is the same contract; a simulated position belongs to its own group only", () => {
  const g = group({ followers: [follower(1, 2)], contracts: [specFor("XAUUSD")] })
  const accounts = [account(1), account(2, { symbols: ["XAUUSDm"] })]
  const positions = [pos(1, "XAUUSD.m", 0.1), pos(2, "XAUUSDm", 0.1, { simulated: true, groupId: 7 }), pos(2, "XAUUSDm", 0.3, { simulated: true, groupId: 8 })]
  const scope = symbolScope(g, accounts, positions, "XAUUSD")
  assert.deepEqual(scope.map((r) => [r.symbol, r.via, r.positions.map((p) => p.quantity)]), [["XAUUSD", "same", [0.1]], ["XAUUSDm", "auto", [0.1]]])
})

test("an account's tickets in a symbol read as one line", () => {
  assert.deepEqual(netPosition([]), { side: null, quantity: 0, avgPrice: null, current: null, openPnl: null, tickets: 0, simulated: false })
  const two = netPosition([pos(1, "MNQZ6", 1, { entry: 100, openPnl: 10 }), pos(1, "MNQZ6", 3, { entry: 104, openPnl: -4 })])
  assert.deepEqual([two.side, two.quantity, two.avgPrice, two.openPnl, two.tickets], ["long", 4, 103, 6, 2])
  // a hedged account: what is left is what it is
  const hedged = netPosition([pos(1, "XAUUSD", 0.3, { entry: 4000 }), pos(1, "XAUUSD", 0.1, { side: "short", entry: 4010 })])
  assert.deepEqual([hedged.side, hedged.quantity, hedged.avgPrice, hedged.tickets], ["long", 0.2, 4000, 2])
  assert.equal(netPosition([pos(2, "MNQZ6", 1, { simulated: true, groupId: 7 })]).simulated, true)
})

test("the Cockpit's tabs: the group's contracts, and whatever else the Leader holds", () => {
  const positions = [pos(1, "NQZ6", 1), pos(1, "XAUUSD.m", 0.1), pos(2, "BTCUSD", 1)]
  assert.deepEqual(cockpitContracts(group(), positions), [{ symbol: "NQZ6", imported: true }, { symbol: "MNQZ6", imported: true }, { symbol: "XAUUSD.m", imported: false }])
  assert.deepEqual(cockpitContracts(group({ contracts: [] }), []), [])
})

test("an order is in one tab, and trades the way it trades", () => {
  assert.deepEqual(["filled", "pending", "sent", "cancelled", "skipped", "rejected", "failed", "blocked", "unsupported", "partial"].map(orderBucket), ["filled", "open", "open", "canceled", "canceled", "failed", "failed", "failed", "failed", "failed"])
  // an entry goes with the position; a close, a stop or a target goes against it
  assert.deepEqual(
    [
      ["open", "long"],
      ["open", "short"],
      ["close", "long"],
      ["partial_close", "short"],
      ["modify_sl", "long"],
      ["modify_tp", "short"],
    ].map(([action, side]) => orderSide({ action, side: side as "long" | "short" })),
    ["buy", "sell", "sell", "buy", "sell", "buy"],
  )
})

test("a follower that is switched off was never asked: it is not counted against the copy", () => {
  const order = (id: number, followerAccountId: number, status: string): OrderView => ({ id, groupId: 7, correlationId: `m7-p1-v0-f${followerAccountId}`, masterOrderId: "m7-p1-v0", masterAccountId: 1, followerAccountId, action: "open", symbol: "NQZ6", leaderSymbol: "NQZ6", side: "long", quantity: 1, leaderQuantity: 1, requestedPrice: 100, executionPrice: 100, status, reason: null, slippage: null, latencyMs: null, tradeloopMs: null, simulated: false, createdAt: "2026-10-05T10:00:00.000Z", steps: [] })
  const [copy] = groupCopies([order(1, 2, "filled"), order(2, 3, "filled"), order(3, 4, "skipped")])
  assert.deepEqual([copy.filled, copy.total, copy.orders.length], [2, 2, 3])
})

test("what an account is doing, and how a group is sized, in a word", () => {
  const g = group()
  assert.equal(copyStatus(account(1), [g]).label, "Leading")
  assert.equal(copyStatus(account(2), [g]).label, "Copying")
  assert.equal(copyStatus(account(2, { health: "disconnected" }), [g]).label, "Offline")
  assert.equal(copyStatus(account(2), [group({ status: "paused" })]).label, "Paused")
  assert.equal(copyStatus(account(2), [group({ followers: [follower(1, 2, { enabled: false })] })]).label, "Paused")
  assert.equal(copyStatus(account(9), [g]).label, "Not copying")
  assert.equal(sizingSummary(g), "1.0x")
  assert.equal(sizingSummary(group({ followers: [follower(1, 2, { sizingMode: "percentage", percentage: 50 }), follower(2, 3, { sizingMode: "multiplier", multiplier: 0.5 })] })), "0.5x")
  assert.equal(sizingSummary(group({ followers: [follower(1, 2), follower(2, 3, { sizingMode: "multiplier", multiplier: 2 })] })), "Per account")
  assert.equal(sizingSummary(group({ followers: [] })), "No followers")
})

test("prices read as a terminal shows them", () => {
  assert.deepEqual([price(25338.5), price(4157.96), price(18425), price(1.08523), price(null)], ["25,338.50", "4,157.96", "18,425.00", "1.08523", "—"])
})

test("the market's regular hours, on the exchange's own clock", () => {
  const at = (iso: string) => new Date(iso)
  const nq = specFor("NQZ6")
  // Monday 08:55:15 in Chicago (CDT, UTC-5): open
  assert.deepEqual(marketStatus(nq, at("2026-10-05T13:55:15Z")), { state: "open", label: "Market Open", clock: "08:55:15", zone: "CT", note: null })
  // the daily break, 16:00 to 17:00 Central
  assert.deepEqual([marketStatus(nq, at("2026-10-05T21:30:00Z")).state, marketStatus(nq, at("2026-10-05T21:30:00Z")).note], ["closed", "Daily break: reopens 17:00 CT"])
  assert.equal(marketStatus(nq, at("2026-10-05T22:00:00Z")).state, "open")
  // Friday's close, the weekend, Sunday's open
  assert.equal(marketStatus(nq, at("2026-10-09T20:59:00Z")).state, "open")
  assert.equal(marketStatus(nq, at("2026-10-09T21:00:00Z")).state, "closed")
  assert.deepEqual([marketStatus(nq, at("2026-10-10T15:00:00Z")).state, marketStatus(nq, at("2026-10-10T15:00:00Z")).note], ["closed", "Reopens Sunday 17:00 CT"])
  assert.equal(marketStatus(nq, at("2026-10-11T21:59:00Z")).state, "closed")
  assert.equal(marketStatus(nq, at("2026-10-11T22:00:00Z")).state, "open")
  // winter time is the exchange's, not ours: 16:30 Central on a January Monday is 22:30 UTC
  assert.equal(marketStatus(nq, at("2026-01-12T22:30:00Z")).state, "closed")

  // currencies run through the week on New York's clock; gold takes an hour off
  const eur = specFor("EURUSD")
  const gold = specFor("XAUUSD")
  assert.deepEqual([marketStatus(eur, at("2026-10-05T21:30:00Z")).state, marketStatus(eur, at("2026-10-05T21:30:00Z")).zone], ["open", "ET"])
  assert.equal(marketStatus(gold, at("2026-10-05T21:30:00Z")).state, "closed")
  assert.equal(marketStatus(eur, at("2026-10-10T12:00:00Z")).state, "closed")
  // a symbol whose venue isn't known says so, and still shows a clock
  const other = marketStatus(specFor("SOMETHING"), at("2026-10-05T13:55:15Z"))
  assert.deepEqual([other.state, other.label, other.clock, other.zone], ["unknown", "Market hours unknown", "08:55:15", "CT"])
  assert.equal(marketStatus(null, at("2026-10-05T13:55:15Z")).state, "unknown")
})
