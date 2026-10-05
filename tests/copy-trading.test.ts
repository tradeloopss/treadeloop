import { test } from "node:test"
import assert from "node:assert/strict"
import { listedContracts, pointValueAt, relatedSymbol, samePriceScale, searchContracts, specFor } from "@/lib/copy/contracts"
import { DEFAULT_FOLLOWER, DEFAULT_RULES, activationProblems, calculateFollowerOrder, calculateRisk, connectionHealth, followerOrderId, masterOrderId, normalizeQuantity, planLeaderEvents, proportionalClose, riskStatus, syncSummary, translatePrice, validateCopyRules, type AccountState, type FollowerConfig, type LeaderOrder, type LivePosition } from "@/lib/copy/engine"

// Copy Trading's engine. The promise these tests hold it to: the quantity a
// follower trades is worked out from that follower's own settings, limits and
// contract — never just the leader's number — and a trade that can't be sized
// safely is refused with the reason, not guessed.

const NOW = new Date(Date.UTC(2026, 1, 10, 15)) // Tuesday 10 Feb 2026, 15:00 UTC
const NQ = specFor("NQH6", NOW)
const MNQ = specFor("MNQH6", NOW)
const account = (over: Partial<AccountState> = {}): AccountState => ({ equity: 50_000, dayPnl: 0, openNotional: 0, openQuantity: 0, connected: true, ...over })
const config = (over: Partial<FollowerConfig> = {}): FollowerConfig => ({ ...DEFAULT_FOLLOWER, ...over })
const order = (over: Partial<LeaderOrder> = {}): LeaderOrder => ({ symbol: "NQH6", side: "long", quantity: 1, orderType: "market", entry: 24_800, stopLoss: 24_779, takeProfit: null, ...over })
const decide = (c: Partial<FollowerConfig>, o: Partial<LeaderOrder> = {}, a: Partial<AccountState> = {}, spec = NQ) => calculateFollowerOrder({ order: order(o), spec, config: config(c), leaderEquity: 100_000, account: account(a), now: NOW })

test("contracts carry their own specification: NQ is not MNQ", () => {
  assert.equal(NQ.pointValue, 20)
  assert.equal(NQ.tickValue, 5)
  assert.equal(MNQ.pointValue, 2)
  assert.equal(MNQ.tickValue, 0.5)
  assert.equal(specFor("ESM6", NOW).pointValue, 50)
  assert.equal(specFor("MESM6", NOW).root, "MES") // not mistaken for ES
  assert.equal(NQ.exchange, "CME")
  assert.equal(NQ.expiration, "2026-03")
  assert.equal(NQ.minimumQuantity, 1) // no fractional futures
  // spot: lots, in hundredths
  const eur = specFor("EURUSDm", NOW)
  assert.deepEqual([eur.root, eur.pointValue, eur.minimumQuantity, eur.quantityStep], ["EURUSD", 100_000, 0.01, 0.01])
  assert.equal(specFor("XAUUSD", NOW).pointValue, 100)
  // USD is the base: the value of a move depends on the price
  assert.equal(specFor("USDJPY", NOW).pointValue, null)
  assert.equal(pointValueAt(specFor("USDJPY", NOW), 150), 100_000 / 150)
  // a cross, and a symbol nobody knows: no value is invented
  assert.equal(pointValueAt(specFor("EURGBP", NOW), 0.85), null)
  assert.equal(specFor("US100.cash", NOW).type, "other")
  assert.equal(pointValueAt(specFor("US100.cash", NOW), 20_000), null)
})

test("contract search lists the coming expirations of a future", () => {
  assert.deepEqual(listedContracts("NQ", NOW).map((c) => c.symbol), ["NQH6", "NQM6", "NQU6", "NQZ6"])
  assert.deepEqual(listedContracts("GC", NOW, 3).map((c) => c.symbol), ["GCG6", "GCJ6", "GCM6"])
  const found = searchContracts("NQ", NOW).map((c) => c.symbol)
  for (const s of ["NQH6", "MNQH6", "NQM6", "MNQM6"]) assert.ok(found.includes(s), s)
  assert.equal(searchContracts("mnqh6", NOW)[0].symbol, "MNQH6")
  assert.ok(searchContracts("gold", NOW).some((c) => c.symbol === "XAUUSD"))
  // something unknown can still be imported, marked as not known
  const odd = searchContracts("US30", NOW)
  assert.deepEqual([odd[0].symbol, odd[0].known], ["US30", false])
  assert.deepEqual(relatedSymbol("NQH6"), { symbol: "MNQH6", ratio: 10 })
  assert.equal(samePriceScale("NQH6", "MNQH6"), true)
  assert.equal(samePriceScale("NQH6", "ESH6"), false)
})

test("same size, percentage, multiplier and fixed quantity", () => {
  assert.equal(decide({ sizingMode: "same" }, { quantity: 3 }).finalQuantity, 3)
  assert.equal(decide({ sizingMode: "percentage", percentage: 50 }, { quantity: 4 }).finalQuantity, 2)
  assert.equal(decide({ sizingMode: "multiplier", multiplier: 2 }, { quantity: 1 }).finalQuantity, 2)
  assert.equal(decide({ sizingMode: "fixed", fixedQuantity: 3 }, { quantity: 1 }).finalQuantity, 3)
  assert.equal(decide({ sizingMode: "fixed", fixedQuantity: 3 }, { quantity: 9 }).finalQuantity, 3)
  const half = decide({ sizingMode: "percentage", percentage: 50 }, { quantity: 4 })
  assert.equal(half.ratio, 0.5)
  assert.match(half.steps.find((s) => s.key === "sizing")!.value, /4 × 50% = 2/)
})

test("a fractional future is rounded by the follower's rule, and never traded as a fraction", () => {
  const half = (roundingRule: FollowerConfig["roundingRule"]) => decide({ sizingMode: "percentage", percentage: 50, roundingRule })
  assert.equal(half("down").finalQuantity, 0)
  assert.equal(half("down").allowed, false)
  assert.equal(half("down").blockedBy, "rounding")
  assert.match(half("down").reason, /below the minimum quantity/)
  assert.equal(half("up").finalQuantity, 1)
  assert.equal(half("nearest").finalQuantity, 1)
  assert.equal(half("min1").finalQuantity, 1)
  // a quarter: nearest gives nothing, "minimum 1" still trades one
  assert.equal(decide({ sizingMode: "percentage", percentage: 25, roundingRule: "nearest" }).finalQuantity, 0)
  assert.equal(decide({ sizingMode: "percentage", percentage: 25, roundingRule: "min1" }).finalQuantity, 1)
  // lots can be fractions, down to the instrument's own step
  const eur = specFor("EURUSD", NOW)
  assert.equal(calculateFollowerOrder({ order: order({ symbol: "EURUSD", quantity: 1, entry: 1.1, stopLoss: 1.098 }), spec: eur, config: config({ sizingMode: "percentage", percentage: 25 }), leaderEquity: 100_000, account: account(), now: NOW }).finalQuantity, 0.25)
  assert.equal(normalizeQuantity(0.3, eur, "down"), 0.3) // not 0.29
  assert.equal(normalizeQuantity(0.004, eur, "nearest"), 0)
  assert.equal(normalizeQuantity(0.004, eur, "min1"), 0.01)
})

test("risk % sizes from the follower's own equity, stop and contract", () => {
  // 21 points on NQ = $420 a contract; 1% of $50,000 = $500 -> 1.19 -> 1
  const d = decide({ sizingMode: "risk", riskPercentage: 1 }, { quantity: 4 })
  assert.equal(d.riskPerUnit, 420)
  assert.ok(Math.abs(d.calculatedQuantity! - 500 / 420) < 1e-6)
  assert.equal(d.finalQuantity, 1) // the leader's 4 plays no part
  assert.equal(d.riskAmount, 420)
  // the same trade on the micro: $42 a contract -> 11.9 -> 12
  assert.equal(decide({ sizingMode: "risk", riskPercentage: 1 }, {}, {}, MNQ).finalQuantity, 12)
  // a bigger account trades more; the leader's size is still not the input
  assert.equal(decide({ sizingMode: "risk", riskPercentage: 1 }, {}, { equity: 200_000 }).finalQuantity, 5)
  // no stop, or a contract of unknown size: refused, with the reason
  const noStop = decide({ sizingMode: "risk", riskPercentage: 1 }, { stopLoss: null })
  assert.deepEqual([noStop.allowed, noStop.blockedBy], [false, "sizing"])
  assert.match(noStop.reason, /no stop loss/)
  const unknown = calculateFollowerOrder({ order: order({ symbol: "US30" }), spec: specFor("US30", NOW), config: config({ sizingMode: "risk" }), leaderEquity: 100_000, account: account(), now: NOW })
  assert.equal(unknown.allowed, false)
  assert.match(unknown.reason, /isn't known/)
  assert.equal(calculateRisk({ entry: 24_800, stopLoss: 24_779, spec: MNQ }).riskPerUnit, 42)
})

test("custom sizing scales by account size", () => {
  // half the leader's equity -> half the size
  assert.equal(decide({ sizingMode: "custom", customFactor: 100 }, { quantity: 4 }).finalQuantity, 2)
  assert.equal(decide({ sizingMode: "custom", customFactor: 200 }, { quantity: 4 }).finalQuantity, 4)
  assert.equal(decide({ sizingMode: "custom" }, { quantity: 4 }, { equity: null }).allowed, false)
})

test("the maximum position size caps the copy, and says so", () => {
  const d = decide({ sizingMode: "multiplier", multiplier: 4, maxPositionSize: 2 })
  assert.deepEqual([d.calculatedQuantity, d.finalQuantity, d.allowed, d.limited], [4, 2, true, true])
  assert.equal(d.reason, "Position size capped by your maximum.")
  // what is already open counts
  assert.equal(decide({ sizingMode: "same", maxPositionSize: 2 }, { quantity: 2 }, { openQuantity: 1 }).finalQuantity, 1)
  const full = decide({ sizingMode: "same", maxPositionSize: 2 }, {}, { openQuantity: 2 })
  assert.deepEqual([full.allowed, full.blockedBy], [false, "position"])
})

test("the daily loss limit blocks a trade that could go past it", () => {
  // $1,000 limit, $750 lost, $250 left; one NQ risks $420
  const d = decide({ maxDailyLoss: 1000 }, {}, { dayPnl: -750 })
  assert.deepEqual([d.allowed, d.blockedBy], [false, "daily_loss"])
  assert.match(d.reason, /Only \$250 of daily risk remains/)
  assert.equal(decide({ maxDailyLoss: 1000 }, {}, { dayPnl: -500 }).allowed, true)
  assert.equal(decide({ maxDailyLoss: 1000 }, {}, { dayPnl: -1000 }).blockedBy, "daily_loss")
  // a winning day doesn't raise the limit
  assert.equal(decide({ maxDailyLoss: 400 }, {}, { dayPnl: 900 }).blockedBy, "daily_loss")
  assert.equal(riskStatus(config({ maxDailyLoss: 1000 }), account({ dayPnl: -160 })).status, "healthy")
  assert.equal(riskStatus(config({ maxDailyLoss: 1000 }), account({ dayPnl: -820 })).status, "limited")
  assert.equal(riskStatus(config({ maxDailyLoss: 1000 }), account({ dayPnl: -1000 })).status, "blocked")
})

test("maximum exposure and PropSync can each refuse a copy", () => {
  // one NQ at 24,800 is $496,000 of notional: 992% of a $50,000 account
  const over = decide({ maxExposure: 900 })
  assert.deepEqual([over.allowed, over.blockedBy], [false, "exposure"])
  assert.equal(decide({ maxExposure: 1000 }).allowed, true)
  assert.equal(decide({ maxExposure: 1000 }, {}, { openNotional: 100_000 }).blockedBy, "exposure")
  const base = { order: order(), spec: NQ, config: config(), leaderEquity: 100_000, account: account(), now: NOW }
  const stopped = calculateFollowerOrder({ ...base, propSync: { tracked: true, blocked: true, reason: "Maximum drawdown reached.", dailyLossRemaining: null } })
  assert.deepEqual([stopped.allowed, stopped.blockedBy, stopped.reason], [false, "propsync", "Maximum drawdown reached."])
  const tight = calculateFollowerOrder({ ...base, propSync: { tracked: true, blocked: false, reason: null, dailyLossRemaining: 300 } })
  assert.equal(tight.blockedBy, "propsync")
  assert.match(tight.reason, /exceed the account's daily loss limit/)
  assert.equal(calculateFollowerOrder({ ...base, propSync: { tracked: true, blocked: false, reason: null, dailyLossRemaining: 900 } }).allowed, true)
})

test("an account that is off or offline doesn't copy; the answer always explains itself", () => {
  assert.equal(decide({ enabled: false }).blockedBy, "disabled")
  assert.equal(decide({}, {}, { connected: false }).blockedBy, "connection")
  const d = decide({ sizingMode: "risk", riskPercentage: 1 })
  assert.deepEqual(d.steps.map((s) => s.key), ["leader", "sizing", "rounding", "final"])
  assert.match(d.steps[2].note!, /1\.19 becomes 1/)
  // a mapped symbol is part of the explanation
  const mapped = decide({ sizingMode: "multiplier", multiplier: 10 }, {}, {}, MNQ)
  assert.equal(mapped.steps[1].value, "NQH6 → MNQH6")
  assert.equal(mapped.finalQuantity, 10)
})

test("copy rules: order types, direction, days, hours and contracts", () => {
  const ctx = { imported: ["NQH6"], minutes: 10 * 60, weekday: 2 }
  const o = { side: "long" as const, orderType: "market" as const, symbol: "NQH6" }
  assert.equal(validateCopyRules(DEFAULT_RULES, "open", o, ctx).ok, true)
  assert.equal(validateCopyRules({ ...DEFAULT_RULES, marketOrders: false }, "open", o, ctx).ok, false)
  assert.equal(validateCopyRules({ ...DEFAULT_RULES, direction: "short" }, "open", o, ctx).ok, false)
  assert.equal(validateCopyRules(DEFAULT_RULES, "open", o, { ...ctx, weekday: 6 }).ok, false)
  assert.equal(validateCopyRules({ ...DEFAULT_RULES, hoursFrom: "09:30", hoursTo: "16:00" }, "open", o, { ...ctx, minutes: 9 * 60 }).ok, false)
  assert.equal(validateCopyRules({ ...DEFAULT_RULES, hoursFrom: "09:30", hoursTo: "16:00" }, "open", o, ctx).ok, true)
  assert.match(validateCopyRules(DEFAULT_RULES, "open", { ...o, symbol: "ESH6" }, ctx).reason, /isn't one of this group's contracts/)
  assert.equal(validateCopyRules({ ...DEFAULT_RULES, symbolScope: "all" }, "open", { ...o, symbol: "ESH6" }, ctx).ok, true)
  // closing is never held up by an entry filter
  assert.equal(validateCopyRules({ ...DEFAULT_RULES, direction: "short" }, "close", o, { ...ctx, weekday: 6 }).ok, true)
  assert.equal(validateCopyRules({ ...DEFAULT_RULES, partialClose: false }, "partial_close", o, ctx).ok, false)
  assert.equal(validateCopyRules({ ...DEFAULT_RULES, trailingStop: false }, "trailing_stop", o, ctx).ok, false)
  assert.equal(validateCopyRules({ ...DEFAULT_RULES, modifications: false }, "modify_sl", o, ctx).ok, false)
})

test("the leader's account is read as events: entry, add, partial close, stop, target, close", () => {
  const p = (over: Partial<LivePosition> = {}): LivePosition => ({ key: "t1", symbol: "MNQH6", side: "long", quantity: 4, entry: 24_800, stopLoss: 24_780, takeProfit: 24_860, price: 24_810, ...over })
  assert.deepEqual(planLeaderEvents([], [p()]).map((e) => e.action), ["open"])
  assert.deepEqual(planLeaderEvents([p()], [p()]), []) // nothing changed, nothing copied
  const added = planLeaderEvents([p()], [p({ quantity: 6 })])[0]
  assert.deepEqual([added.action, added.action === "increase" && added.added], ["increase", 2])
  const part = planLeaderEvents([p()], [p({ quantity: 2 })])[0]
  assert.deepEqual([part.action, part.action === "partial_close" && part.fraction], ["partial_close", 0.5])
  assert.deepEqual(planLeaderEvents([p()], [p({ stopLoss: 24_800 })]).map((e) => e.action), ["trailing_stop"]) // moved in favour
  assert.deepEqual(planLeaderEvents([p()], [p({ stopLoss: 24_770 })]).map((e) => e.action), ["modify_sl"])
  assert.deepEqual(planLeaderEvents([p({ stopLoss: null })], [p()]).map((e) => e.action), ["modify_sl"]) // a stop added
  assert.deepEqual(planLeaderEvents([p()], [p({ takeProfit: 24_900 })]).map((e) => e.action), ["modify_tp"])
  assert.deepEqual(planLeaderEvents([p()], []).map((e) => e.action), ["close"])
  // a short's stop trails downwards
  assert.deepEqual(planLeaderEvents([p({ side: "short", stopLoss: 24_820 })], [p({ side: "short", stopLoss: 24_805 })]).map((e) => e.action), ["trailing_stop"])
  // two things at once are two events
  assert.deepEqual(planLeaderEvents([p()], [p({ quantity: 2, stopLoss: 24_800 })]).map((e) => e.action), ["partial_close", "trailing_stop"])
})

test("followers close in proportion, and stops are carried across symbols", () => {
  // leader closes 2 of 4: a follower holding 2 closes 1
  assert.equal(proportionalClose(2, 0.5, MNQ), 1)
  assert.equal(proportionalClose(1, 0.5, MNQ), 1) // half a contract can't be closed: nearest is one
  assert.equal(proportionalClose(3, 0.25, MNQ), 1)
  assert.equal(proportionalClose(0.5, 0.5, specFor("EURUSD", NOW)), 0.25)
  // NQ -> MNQ trade at the same price: the stop is the same price
  assert.equal(translatePrice({ leaderPrice: 24_780, leaderEntry: 24_800, followerEntry: 24_801, leaderSymbol: "NQH6", followerSymbol: "MNQH6" }), 24_780)
  // different instruments: the same distance from the follower's own entry
  assert.equal(translatePrice({ leaderPrice: 2_390, leaderEntry: 2_400, followerEntry: 2_401.5, leaderSymbol: "XAUUSD", followerSymbol: "GOLD" }), 2_391.5)
  assert.equal(translatePrice({ leaderPrice: null, leaderEntry: 1, followerEntry: 1, leaderSymbol: "A", followerSymbol: "A" }), null)
})

test("every follower order is tied to the leader order it came from", () => {
  const master = masterOrderId(7, 83920, 3)
  assert.equal(master, "m7-p83920-v3")
  assert.deepEqual([1, 2, 3].map((id) => followerOrderId(master, id)), ["m7-p83920-v3-f1", "m7-p83920-v3-f2", "m7-p83920-v3-f3"])
  assert.notEqual(masterOrderId(7, 83920, 4), master) // the next change to the position is a new order
})

test("connection health and the group's sync count", () => {
  const now = Date.UTC(2026, 1, 10, 15)
  assert.equal(connectionHealth({ linked: false, status: null, lastSyncAt: null, now }), "disconnected")
  assert.equal(connectionHealth({ linked: true, status: "connected", lastSyncAt: now - 2_000, now }), "connected")
  assert.equal(connectionHealth({ linked: true, status: "ok", lastSyncAt: now - 45 * 60_000, now }), "warning")
  assert.equal(connectionHealth({ linked: true, status: "pending", lastSyncAt: null, now }), "syncing")
  assert.equal(connectionHealth({ linked: true, status: "error", lastSyncAt: now, message: "Invalid password", now }), "auth")
  assert.equal(connectionHealth({ linked: true, status: "error", lastSyncAt: now, message: "timeout", now }), "disconnected")
  const f = (enabled: boolean, health: "connected" | "disconnected", blocked = false) => ({ enabled, health, blocked })
  assert.deepEqual(syncSummary([f(true, "connected"), f(true, "connected")]), { synced: 2, total: 2, tone: "good" })
  assert.deepEqual(syncSummary([f(true, "connected"), f(false, "connected"), f(true, "disconnected"), f(true, "connected", true)]), { synced: 1, total: 4, tone: "warn" })
  assert.equal(syncSummary([f(false, "connected")]).tone, "bad")
})

test("a group can't be switched on until it is complete", () => {
  const ok = { hasLeader: true, leaderConnected: true, followers: [{ name: "Apex #01", config: config(), connected: true }], contracts: 1, symbolScope: "selected" as const }
  assert.deepEqual(activationProblems(ok), [])
  assert.equal(activationProblems({ ...ok, hasLeader: false }).length, 1)
  assert.equal(activationProblems({ ...ok, leaderConnected: false }).length, 1)
  assert.equal(activationProblems({ ...ok, followers: [] }).length, 1)
  assert.equal(activationProblems({ ...ok, contracts: 0 }).length, 1)
  assert.deepEqual(activationProblems({ ...ok, contracts: 0, symbolScope: "all" }), [])
  assert.match(activationProblems({ ...ok, followers: [{ name: "Apex #01", config: config({ sizingMode: "percentage", percentage: 0 }), connected: true }] })[0], /Apex #01/)
  assert.equal(activationProblems({ ...ok, followers: [{ name: "A", config: config(), connected: false }] }).length, 1)
})
