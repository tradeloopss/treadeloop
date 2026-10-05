import { test } from "node:test"
import assert from "node:assert/strict"
import { specFor } from "@/lib/copy/contracts"
import { DEFAULT_FOLLOWER, DEFAULT_RULES, NO_PROPSYNC, calculateFollowerOrder, type LivePosition } from "@/lib/copy/engine"
import { PLAN_TTL_MS, clock, closeAllowed, closeRef, decideEntry, entryRef, guardEntry, notionalOf, planIsGood, specOf, type EntryInput, type GuardView, type LanePlan } from "@/lib/copy/plan"
import { latencyParts } from "@/lib/copy/view"

// The copy lane sizes and sends a follower's order by itself, the instant the
// leader trades. What these hold it to: it decides with the very function the
// app's engine decides with; the same copy has the same name on both sides, so
// it can only ever be sent once; and a plan that has gone old is not acted on.

const NOW = new Date(Date.UTC(2026, 1, 10, 15)) // Tuesday 10 Feb 2026, 15:00 UTC
const gold: LivePosition = { key: "777", symbol: "XAUUSD.m", side: "short", quantity: 0.3, entry: 4157.96, stopLoss: 4170, takeProfit: 4120, price: 4158.36 }
const input = (over: Partial<EntryInput> = {}): EntryInput => ({
  rules: { ...DEFAULT_RULES, symbolScope: "all" },
  contracts: [],
  follower: { config: { ...DEFAULT_FOLLOWER, sizingMode: "percentage", percentage: 50 }, mappings: [], symbols: ["XAUUSDm", "BTCUSDm"] },
  position: gold,
  quantity: gold.quantity,
  leaderEquity: 100_000,
  account: { equity: 5_000, dayPnl: 0, openNotional: 0, connected: true, openQuantity: () => 0 },
  propSync: NO_PROPSYNC,
  minutes: 15 * 60,
  weekday: 2,
  now: NOW,
  ...over,
})

test("the lane and the engine decide an entry with one function: the follower's own symbol, size, stop and target", () => {
  const d = decideEntry(input())
  // the follower's broker calls gold XAUUSDm; half of 0.3 lots; the leader's stop and target, at the same prices
  assert.deepEqual([d.symbol, d.decision.allowed, d.decision.finalQuantity, d.stopLoss, d.takeProfit, d.entry], ["XAUUSDm", true, 0.15, 4170, 4120, 4158.36])
  // and it is calculateFollowerOrder's answer, not a second opinion
  const direct = calculateFollowerOrder({ order: { symbol: gold.symbol, side: gold.side, quantity: 0.3, orderType: "market", entry: 4158.36, stopLoss: 4170, takeProfit: 4120 }, spec: specFor("XAUUSDm"), config: input().follower.config, leaderEquity: 100_000, account: { equity: 5_000, dayPnl: 0, openNotional: 0, openQuantity: 0, connected: true }, propSync: NO_PROPSYNC, rules: { rules: input().rules, imported: [], minutes: 900, weekday: 2 }, now: NOW })
  assert.deepEqual(d.decision, direct)
})

test("what the follower already holds in that symbol and direction counts, under its own symbol's name", () => {
  const asked: [string, string][] = []
  const d = decideEntry(input({ follower: { config: { ...DEFAULT_FOLLOWER, maxPositionSize: 0.2 }, mappings: [], symbols: ["XAUUSDm"] }, account: { equity: 5_000, dayPnl: 0, openNotional: 0, connected: true, openQuantity: (symbol, side) => (asked.push([symbol, side]), 0.15) } }))
  assert.deepEqual(asked, [["XAUUSDm", "short"]])
  // 0.3 wanted, 0.15 already open, 0.2 allowed: 0.05 more
  assert.deepEqual([d.decision.allowed, d.decision.finalQuantity, d.decision.limited], [true, 0.05, true])
})

test("the group's rules apply on the lane as in the app: a stop that isn't copied, a side that isn't traded, a follower switched off", () => {
  assert.deepEqual([decideEntry(input({ rules: { ...DEFAULT_RULES, symbolScope: "all", stopLoss: false, takeProfit: false } })).stopLoss, decideEntry(input({ rules: { ...DEFAULT_RULES, symbolScope: "all", stopLoss: false, takeProfit: false } })).takeProfit], [null, null])
  const longOnly = decideEntry(input({ rules: { ...DEFAULT_RULES, symbolScope: "all", direction: "long" } }))
  assert.deepEqual([longOnly.decision.allowed, longOnly.decision.blockedBy], [false, "rules"])
  const off = decideEntry(input({ follower: { config: { ...DEFAULT_FOLLOWER, enabled: false }, mappings: [], symbols: [] } }))
  assert.deepEqual([off.decision.allowed, off.decision.blockedBy], [false, "disabled"])
  // a daily loss limit that is used up blocks it
  const spent = decideEntry(input({ follower: { config: { ...DEFAULT_FOLLOWER, maxDailyLoss: 100 }, mappings: [], symbols: ["XAUUSDm"] }, account: { equity: 5_000, dayPnl: -120, openNotional: 0, connected: true, openQuantity: () => 0 } }))
  assert.deepEqual([spent.decision.allowed, spent.decision.blockedBy], [false, "daily_loss"])
})

test("a leader's close goes through unless the group doesn't copy closes", () => {
  assert.equal(closeAllowed({ ...DEFAULT_RULES, symbolScope: "all" }, [], gold, { minutes: 900, weekday: 2 }).ok, true)
  assert.equal(closeAllowed({ ...DEFAULT_RULES, symbolScope: "all", fullClose: false }, [], gold, { minutes: 900, weekday: 2 }).ok, false)
})

test("each copy has one name, the same on the lane and in the app, and no two copies share one", () => {
  assert.equal(entryRef(12, "2504738037", 51), "e:12:2504738037:51")
  assert.equal(closeRef(12, "2504738037", 51), "c:12:2504738037:51")
  const all = [entryRef(12, "1", 51), closeRef(12, "1", 51), entryRef(12, "1", 52), entryRef(13, "1", 51), entryRef(12, "2", 51)]
  assert.equal(new Set(all).size, all.length)
})

test("a plan is acted on only while it is fresh", () => {
  const plan: LanePlan = { v: 1, userId: "u", at: 1_000, until: 1_000 + PLAN_TTL_MS, groups: [] }
  assert.equal(planIsGood(plan, 1_000 + PLAN_TTL_MS - 1), true)
  assert.equal(planIsGood(plan, 1_000 + PLAN_TTL_MS), false) // the engine has stopped rewriting it
  assert.equal(planIsGood(null, 0), false)
  assert.equal(planIsGood({ ...plan, v: 2 } as unknown as LanePlan, 1_001), false)
})

test("the prop-rule guard counts what the lane itself opened since the plan was written", () => {
  const guard: GuardView = { risk: { status: "ok" }, rules: [{ type: "max_contracts", name: "Max position size", status: "safe", severity: "hard_breach", currentValue: 1, limitValue: 2 }, { type: "max_open_positions", name: "Max open positions", status: "safe", severity: "hard_breach", currentValue: 2, limitValue: 4 }] }
  const order = { accountId: 51, symbol: "XAUUSDm", side: "long" as const, volume: 0.5, stopLoss: null, takeProfit: null }
  assert.equal(guardEntry(guard, order, { volume: 0, positions: 0 }).allowed, true)
  // 1 held + 0.6 the lane opened a second ago + 0.5 now is over 2
  assert.equal(guardEntry(guard, order, { volume: 0.6, positions: 1 }).allowed, false)
  // two more positions opened here: at the maximum of 4
  assert.equal(guardEntry(guard, order, { volume: 0, positions: 2 }).allowed, false)
  // a breached account opens nothing; an account with no prop rules is not held back
  assert.equal(guardEntry({ risk: { status: "breached" }, rules: [] }, order, { volume: 0, positions: 0 }).allowed, false)
  assert.equal(guardEntry(null, order, { volume: 0, positions: 0 }).allowed, true)
})

test("exposure, the trading clock and a group's own contracts", () => {
  // 0.1 lot of gold at 4,000 is 100 oz: $40,000; a position with no price adds nothing
  assert.equal(Math.round(notionalOf([{ symbol: "XAUUSDm", quantity: 0.1, price: 4000 }, { symbol: "XAUUSDm", quantity: 1, price: null }])), 40_000)
  assert.deepEqual(clock("UTC", NOW), { minutes: 900, weekday: 2 })
  assert.deepEqual(clock("Africa/Cairo", NOW), { minutes: 17 * 60, weekday: 2 })
  const imported = { ...specFor("NQH6", NOW), tickValue: 99 }
  assert.equal(specOf([imported], "nqh6").tickValue, 99)
  assert.equal(specOf([], "NQH6").symbol, "NQH6")
})

test("latency is shown whole, and split when the lane timed both halves", () => {
  assert.equal(latencyParts({ latencyMs: null, tradeloopMs: null }), null)
  assert.deepEqual(latencyParts({ latencyMs: 560, tradeloopMs: null }), { total: "560ms", split: null })
  assert.deepEqual(latencyParts({ latencyMs: 142, tradeloopMs: 5 }), { total: "142ms", split: "TradeLoop 5ms + broker 137ms" })
})
