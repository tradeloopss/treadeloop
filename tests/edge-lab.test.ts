import { test } from "node:test"
import assert from "node:assert/strict"
import { MIN_PATTERN, cleanConditions, conditionName, confidenceOfDifference, confidenceVsZero, instrumentOf, measure, prepareTrades, scoreBand, scoreEdge, select, studentCdf, type EdgeTrade, type RawTrade } from "@/lib/edge/core"
import { breakdown, combinations, decompose, detail, discoveries, matrix, search } from "@/lib/edge/discover"
import { compare, testHypothesis } from "@/lib/edge/hypothesis"
import { monteCarlo, rng, walkForward } from "@/lib/edge/robustness"
import { alertFor, monitor } from "@/lib/edge/monitor"

// Edge Lab's engine. The point of these tests is the product's promise: every
// figure comes from the trades, a thin sample is never called an edge, and a
// difference is only "supported" when it is unlikely to be chance and has held
// up in the most recent trades.

const DAY = 86_400_000
const START = Date.UTC(2026, 0, 5, 0) // a Monday
let nextId = 1

type Spec = { symbol?: string; side?: "long" | "short"; hourUtc?: number; r: number; day: number; tags?: string[]; accountId?: number; minutes?: number; market?: string; stop?: boolean; tp?: number | null }
// One closed trade risking $100: `r` is its result in R, `day` the day it was taken (0 = the first Monday).
function raw(s: Spec): RawTrade {
  const entry = new Date(START + s.day * DAY + (s.hourUtc ?? 9) * 3_600_000 + (nextId % 50) * 60_000)
  const stop = s.stop === false ? null : 99
  return {
    id: nextId++,
    symbol: s.symbol ?? "EURUSD",
    market: s.market ?? "forex",
    side: s.side ?? "long",
    status: "closed",
    pnl: s.r * 100,
    rMultiple: stop == null ? null : s.r,
    quantity: 100,
    entryPrice: 100,
    exitPrice: 100 + s.r,
    stopLoss: stop,
    takeProfit: s.tp === undefined ? null : s.tp,
    contractMultiplier: 1,
    entryTime: entry,
    exitTime: new Date(entry.getTime() + (s.minutes ?? 20) * 60_000),
    accountId: s.accountId ?? 1,
    playbookId: null,
    tags: s.tags ?? [],
    mistakes: [],
    rating: null,
    source: "manual",
  }
}
const prep = (rows: RawTrade[]) => prepareTrades(rows, { timeZone: "UTC" })
// A deterministic win/loss pattern: `wins` in every `of` trades win `w` R, the rest lose 1R.
const series = (count: number, wins: number, of: number, w: number, extra: Partial<Spec> = {}, dayStep = 1) =>
  Array.from({ length: count }, (_, i) => raw({ r: i % of < wins ? w : -1, day: Math.floor(i * dayStep), ...extra }))

test("the instrument a trade is of, whatever contract month or broker suffix it carried", () => {
  assert.equal(instrumentOf("MNQZ5", "futures"), "MNQ")
  assert.equal(instrumentOf("ESH26", "futures"), "ES")
  assert.equal(instrumentOf("MESM6", "futures"), "MES") // not mistaken for ES
  assert.equal(instrumentOf("NQ", "futures"), "NQ")
  assert.equal(instrumentOf("FDAXM6", "futures"), "FDAX")
  assert.equal(instrumentOf("EURUSDm", "forex"), "EURUSD")
  assert.equal(instrumentOf("XAUUSD.r", "cfd"), "XAUUSD")
  assert.equal(instrumentOf("BTC-USD", "crypto"), "BTC-USD")
  assert.equal(instrumentOf("aapl", "stocks"), "AAPL")
})

test("preparing: closed trades only, oldest first, with every way a trade can be sliced", () => {
  const rows = [
    raw({ r: 1, day: 0, hourUtc: 9, tags: ["Breakout"], tp: 102 }),
    raw({ r: -1, day: 0, hourUtc: 14, side: "short", minutes: 200 }),
    raw({ r: 2, day: 1, hourUtc: 22, symbol: "XAUUSD" }),
    { ...raw({ r: 5, day: 2 }), status: "open" },
  ]
  const t = prep(rows)
  assert.equal(t.length, 3) // the open one isn't analysed
  assert.deepEqual([t[0].dims.symbol, t[0].dims.side, t[0].dims.session, t[0].dims.weekday, t[0].dims.hold, t[0].dims.rr], ["EURUSD", "Long", "London", "Monday", "5–30 min", "2–3R"])
  assert.deepEqual([t[1].dims.side, t[1].dims.session, t[1].dims.hold, t[1].dims.rr], ["Short", "NY AM", "2–8 h", undefined])
  assert.deepEqual([t[2].dims.session, t[2].dims.weekday, t[2].symbol], ["Asia", "Tuesday", "XAUUSD"])
  assert.deepEqual(t[0].setups, ["Breakout"])
  // what came before, on the same day
  assert.deepEqual(t.map((x) => [x.dims.ofday, x.dims.after]), [["1st of the day", "First trade of the day"], ["2nd of the day", "After a win"], ["1st of the day", "First trade of the day"]])
  assert.equal(t[0].r, 1)
  assert.equal(t[0].risk, 100)
  // the trader's own day, not UTC's: 22:00 UTC on Tuesday is already Wednesday in Tokyo
  const tokyo = prepareTrades(rows, { timeZone: "Asia/Tokyo" })
  assert.equal(tokyo[2].dims.weekday, "Wednesday")
  // without a stop there is no R — and it isn't made up
  assert.equal(prep([raw({ r: 1, day: 0, stop: false })])[0].r, null)
})

test("one decision copied to several accounts counts once", () => {
  const a = raw({ r: 2, day: 0, accountId: 1 })
  const copies = [a, { ...a, id: nextId++, accountId: 2 }, { ...a, id: nextId++, accountId: 3 }]
  const merged = prep(copies)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].pnl, 600) // the money is all there
  assert.equal(merged[0].r, 2) // the decision's result is 2R, not 6R
  assert.equal(merged[0].copies.length, 2)
  // the same trade twice in ONE account is two trades
  assert.equal(prep([a, { ...a, id: nextId++ }]).length, 2)
  // and merging can be switched off
  assert.equal(prepareTrades(copies, { timeZone: "UTC", mergeCopies: false }).length, 3)
})

test("measuring a slice: nothing is quoted that the trades don't support", () => {
  const s = measure(prep([raw({ r: 2, day: 0 }), raw({ r: -1, day: 1 }), raw({ r: 1, day: 2 }), raw({ r: -1, day: 40 }), raw({ r: 3, day: 41 })]))
  assert.deepEqual([s.n, s.wins, s.losses, s.net, s.winRate], [5, 3, 2, 400, 0.6])
  assert.deepEqual([s.avgWin, s.avgLoss, s.expectancy, s.pf, s.expR], [200, -100, 80, 3, 0.8])
  assert.equal(s.maxDd, 100)
  assert.deepEqual([s.months, s.posMonths], [2, 2])
  assert.equal(s.topWinShare, 0.5)
  // no losing trades: there is no profit factor to quote
  assert.equal(measure(prep([raw({ r: 1, day: 0 }), raw({ r: 2, day: 1 })])).pf, null)
  // R is only quoted when most of the slice has it
  const mixed = measure(prep([...series(10, 1, 2, 1, { stop: false }), raw({ r: 1, day: 30 })]))
  assert.equal(mixed.expR, null)
  assert.equal(measure([]).n, 0)
})

test("significance: the t-distribution, and what it says about a sample", () => {
  assert.equal(studentCdf(0, 10), 0.5)
  assert.ok(Math.abs(studentCdf(2.228, 10) - 0.975) < 0.001) // the textbook 95% two-sided value
  assert.ok(Math.abs(studentCdf(-2.228, 10) - 0.025) < 0.001)
  assert.ok(Math.abs(studentCdf(1.96, 1000) - 0.975) < 0.001)
  // too few to say anything
  assert.equal(confidenceVsZero([1, 2, 3]), null)
  // clearly positive, clearly negative, and noise
  const up = confidenceVsZero(Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? -1 : 1.2)))!
  assert.ok(up.direction === 1 && up.confidence > 0.95)
  const flat = confidenceVsZero(Array.from({ length: 60 }, (_, i) => (i % 2 ? 1 : -1)))!
  assert.ok(flat.confidence < 0.6)
  const diff = confidenceOfDifference(Array.from({ length: 40 }, (_, i) => (i % 4 === 0 ? -1 : 2)), Array.from({ length: 40 }, (_, i) => (i % 2 ? 1 : -1)))!
  assert.ok(diff.direction === 1 && diff.confidence > 0.95)
  assert.equal(confidenceOfDifference([1, 2], [1, 2, 3, 4, 5, 6]), null)
})

test("the score: a high win rate on a handful of trades is not an edge", () => {
  assert.deepEqual([scoreBand(null), scoreBand(30), scoreBand(31), scoreBand(50), scoreBand(70), scoreBand(85), scoreBand(86)], ["Insufficient data", "Weak", "Unproven", "Unproven", "Promising", "Strong", "Exceptional"])
  // 12 trades, every one a winner: no score at all
  const tiny = scoreEdge(prep(series(12, 1, 1, 2)))
  assert.deepEqual([tiny.score, tiny.band], [null, "Insufficient data"])
  assert.match(tiny.cap!, /Needs 20 trades/)
  // 30 trades at 90%: scored, but capped — it cannot be "Promising" yet
  const thin = scoreEdge(prep(series(30, 9, 10, 2)))
  assert.ok(thin.score! <= 50, `thin sample scored ${thin.score}`)
  assert.match(thin.cap!, /only 30 trades/)
  // 200 trades at a solid 60% with 1.5R winners: strong, and it says why
  const solid = scoreEdge(prep(series(200, 3, 5, 1.5)))
  assert.ok(solid.score! >= 71, `solid sample scored ${solid.score}`)
  assert.ok(solid.confidence! > 0.95)
  assert.equal(solid.parts.length, 7)
  assert.ok(Math.abs(solid.parts.reduce((s, p) => s + p.weight, 0) - 1) < 1e-9)
  // the bigger sample outranks the prettier one
  assert.ok(solid.score! > thin.score!)
  // a losing system can't score above "Weak", however many trades it has
  const losing = scoreEdge(prep(series(300, 1, 3, 1)))
  assert.ok(losing.score! <= 30)
  assert.equal(losing.cap, "It has lost money on average.")
  // profitable overall, but the latest trades on their own lost: held back
  const faded = scoreEdge(prep([...series(140, 3, 4, 1.5), ...series(60, 0, 1, 1).map((t, i) => ({ ...t, entryTime: new Date(START + (200 + i) * DAY), exitTime: new Date(START + (200 + i) * DAY + 600_000) }))]))
  assert.ok(faded.score! <= 60)
})

// A trader with one real edge and one real leak, hidden among ordinary trades.
function book(): EdgeTrade[] {
  nextId = 1000
  const rows: RawTrade[] = [
    // EURUSD, London, long: 3 of 4 win 1.5R
    ...series(80, 3, 4, 1.5, { symbol: "EURUSD", hourUtc: 9, side: "long", tags: ["Breakout"] }, 1.4),
    // XAUUSD, NY afternoon, short: 1 in 4 wins
    ...series(60, 1, 4, 1, { symbol: "XAUUSD", hourUtc: 18, side: "short", tags: ["Reversal"] }, 1.9),
    // everything else: a coin flip
    ...series(60, 1, 2, 1, { symbol: "GBPUSD", hourUtc: 14, side: "long" }, 1.9),
    ...series(40, 1, 2, 1, { symbol: "EURUSD", hourUtc: 14, side: "short" }, 2.8),
  ]
  return prep(rows)
}

test("searching: the planted edge and the planted leak are found, with their numbers", () => {
  const trades = book()
  const combos = combinations(trades)
  // nothing with fewer trades than a pattern needs
  assert.ok([...combos.values()].every((c) => c.agg.n >= MIN_PATTERN))
  const found = search(trades)
  assert.ok(found.examined > 10)
  const top = found.edges[0]
  // the 80 trades of the real edge, named the way a trader would name them — not the wider, weaker "EURUSD"
  assert.deepEqual(top.conditions, { symbol: "EURUSD", session: "London", setup: "Breakout", side: "Long" })
  assert.equal(top.name, "EURUSD + Long + London + Breakout")
  assert.equal(top.stats.n, 80)
  assert.ok(top.stats.expectancy > 0 && top.score.score! > 50)
  // the same 80 trades aren't listed again under another description
  assert.equal(found.edges.filter((e) => e.stats.n === 80 && e.stats.wins === top.stats.wins).length, 1)
  const leak = found.leaks[0]
  // the 60 losing gold shorts — not the wider "Short", which loses the same money over more trades
  assert.deepEqual(leak.conditions, { symbol: "XAUUSD", side: "Short", session: "NY PM", setup: "Reversal" })
  assert.equal(leak.stats.n, 60)
  assert.ok(leak.stats.expectancy < 0 && leak.stats.net < 0)
  // every figure is the slice's own
  assert.deepEqual(measure(select(trades, top.conditions)), top.stats)
  // a coin flip is neither an edge worth showing first nor a leak
  assert.ok(!found.leaks.some((l) => l.conditions.symbol === "GBPUSD"))
})

test("too little data: nothing is discovered, nothing is scored", () => {
  nextId = 5000
  const few = prep(series(12, 1, 1, 2))
  assert.deepEqual(discoveries(few), [])
  assert.deepEqual(search(few), { edges: [], leaks: [], examined: 0 })
  assert.equal(scoreEdge(few).score, null)
  assert.deepEqual(discoveries([]), [])
})

test("the matrix: markets by sessions, and a cell without enough trades stays empty", () => {
  const trades = book()
  const m = matrix(trades, "symbol", "session")
  assert.deepEqual(m.rows, ["EURUSD", "GBPUSD", "XAUUSD"])
  assert.deepEqual(m.cols, ["London", "NY AM", "NY PM"])
  assert.equal(m.cells["EURUSD|London"].state, "strong-positive")
  assert.equal(m.cells["EURUSD|London"].n, 80)
  assert.equal(m.cells["XAUUSD|NY PM"].state, "strong-negative")
  assert.equal(m.cells["GBPUSD|NY AM"].state, "neutral")
  assert.deepEqual([m.cells["XAUUSD|London"].state, m.cells["XAUUSD|London"].n], ["empty", 0])
  assert.equal(m.rowTotals.EURUSD.n, 120)
})

test("discoveries: sentences with the trades behind them", () => {
  const found = discoveries(book())
  assert.ok(found.length > 0)
  for (const d of found) {
    assert.ok(d.n >= MIN_PATTERN, d.text)
    assert.ok(d.evidence.length >= 2, d.text)
    assert.ok(["Observed", "Correlated", "Statistically supported"].includes(d.basis))
    assert.ok(!/undefined|NaN|Infinity/.test(d.text + JSON.stringify(d.evidence)), d.text)
  }
  const session = found.find((d) => d.kind === "strong" && d.conditions.session)
  assert.ok(session, "the session gap is reported")
  assert.equal(session!.conditions.session, "London")
  assert.match(session!.evidence[0].value, /n=80/)
  // no more than three of one kind
  for (const kind of ["strong", "leak", "opportunity", "consistency"]) assert.ok(found.filter((d) => d.kind === kind).length <= 3)
})

test("decomposition: the branches add up to the whole", () => {
  const trades = book()
  const tree = decompose(trades, ["symbol", "session", "side"])
  assert.equal(Math.round(tree.reduce((s, n) => s + n.net, 0)), Math.round(measure(trades).net))
  const eur = tree.find((n) => n.label === "EURUSD")!
  assert.equal(Math.round(eur.children.reduce((s, n) => s + n.net, 0)), Math.round(eur.net))
  assert.deepEqual(eur.children.map((c) => c.label).sort(), ["London", "NY AM"])
  assert.deepEqual(eur.children.find((c) => c.label === "London")!.conditions, { symbol: "EURUSD", session: "London" })
})

test("one slice in full: its numbers, its best and worst places, its recent trades", () => {
  const trades = book()
  const d = detail(trades, { symbol: "EURUSD" })
  assert.equal(d.name, "EURUSD")
  assert.equal(d.stats.n, 120)
  assert.equal(d.baseline.n, trades.length)
  assert.equal(d.unit, "R")
  assert.ok(d.best.some((b) => b.value === "London") && d.worst.length >= 0)
  assert.equal(d.curve[d.curve.length - 1].i, 120)
  assert.equal(d.rDist.reduce((s, b) => s + b.n, 0), 120)
  assert.equal(d.recent.length, 12)
  assert.equal(d.excursion, null) // price history hasn't been analysed: no excursion figures appear
  assert.equal(conditionName({}), "All trades")
  assert.deepEqual(cleanConditions({ symbol: "EURUSD", nonsense: "x", side: 7, session: "" }), { symbol: "EURUSD" })
})

test("hypotheses: supported only when the difference is real and recent", () => {
  const trades = book()
  const yes = testHypothesis(trades, { symbol: "EURUSD", session: "London" })
  assert.equal(yes.verdict, "supported")
  assert.equal(yes.condition.n, 80)
  assert.equal(yes.baseline.n, trades.length - 80)
  assert.ok(yes.confidence! >= 0.95 && yes.difference! > 0)
  assert.ok(yes.evidenceFor.length >= 2)
  assert.ok(yes.outOfSample && yes.outOfSample.n === 24)
  // the same trades all carry the Breakout tag: it is named as something else that could explain it
  assert.ok(yes.confounders.some((c) => c.includes("Breakout") || c.includes("Long")), JSON.stringify(yes.confounders))

  const no = testHypothesis(trades, { symbol: "XAUUSD" })
  assert.equal(no.verdict, "not_supported")
  assert.ok(no.evidenceAgainst.length >= 1)

  // a coin flip against the rest: not enough to call
  const maybe = testHypothesis(trades, { symbol: "GBPUSD" })
  assert.notEqual(maybe.verdict, "supported")

  // too few matching trades: never a verdict
  nextId = 9000
  const small = testHypothesis(prep([...series(15, 1, 1, 2, { symbol: "NAS100" }), ...series(60, 1, 2, 1)]), { symbol: "NAS100" })
  assert.equal(small.verdict, "inconclusive")
  assert.match(small.summary, /Only 15 trades match/)
})

test("A against B: a winner only when the gap is unlikely to be chance", () => {
  const trades = book()
  const c = compare(trades, { symbol: "EURUSD", session: "London" }, { symbol: "XAUUSD" })
  assert.equal(c.winner, "a")
  assert.match(c.summary, /appears stronger in historical data/)
  assert.match(c.summary, /doesn't guarantee/)
  const same = compare(trades, { symbol: "GBPUSD" }, { symbol: "EURUSD", session: "NY AM" })
  assert.equal(same.winner, null)
  const thin = compare(trades, { symbol: "EURUSD" }, { symbol: "NOPE" })
  assert.equal(thin.winner, null)
  assert.match(thin.summary, /Not enough data yet/)
  assert.equal(compare(trades, { symbol: "EURUSD" }, { session: "London" }).overlap, 80)
})

test("Monte Carlo: the same history gives the same simulation, and its figures are in order", () => {
  const draw = rng(42)
  const first = [draw(), draw(), draw()]
  const again = rng(42)
  assert.deepEqual([again(), again(), again()], first)
  assert.ok(first.every((v) => v >= 0 && v < 1))

  const outcomes = Array.from({ length: 100 }, (_, i) => (i % 5 < 3 ? 1.5 : -1)) // +0.5R a trade
  const a = monteCarlo({ outcomes, simulations: 2000, trades: 200, ruin: 20, seed: 7 })!
  const b = monteCarlo({ outcomes, simulations: 2000, trades: 200, ruin: 20, seed: 7 })!
  assert.deepEqual(a, b)
  assert.ok(a.p1 <= a.p5 && a.p5 <= a.p10 && a.p10 <= a.median && a.median <= a.p90)
  assert.ok(Math.abs(a.median - 100) < 15, `median ${a.median}`) // 200 trades at +0.5R
  assert.ok(a.ddMedian > 0 && a.ddMedian <= a.dd95 && a.dd95 <= a.ddWorst)
  assert.ok(a.streakMedian >= 2 && a.streak95 >= a.streakMedian)
  assert.ok(a.lossProbability < 0.01)
  assert.ok(a.ruinProbability! >= 0 && a.ruinProbability! < 0.05)
  assert.equal(a.bands[0].i, 0)
  assert.equal(a.bands[a.bands.length - 1].i, 200)
  assert.equal(a.histogram.reduce((s, h) => s + h.n, 0), 2000)
  // a losing history mostly ends down, and hits ruin often
  const bad = monteCarlo({ outcomes: Array.from({ length: 100 }, (_, i) => (i % 3 === 0 ? 1 : -1)), simulations: 1000, trades: 200, ruin: 20, seed: 3 })!
  assert.ok(bad.lossProbability > 0.99 && bad.ruinProbability! > 0.9)
  // no level given: no risk-of-ruin figure
  assert.equal(monteCarlo({ outcomes, simulations: 500, trades: 100 })!.ruinProbability, null)
  // too little history to simulate from
  assert.equal(monteCarlo({ outcomes: [1, -1, 2], simulations: 1000, trades: 100 }), null)
})

test("walk-forward: what held up, what faded, what broke", () => {
  nextId = 20_000
  const steady = walkForward(prep(series(200, 3, 5, 1.5)))
  assert.equal(steady.verdict, "holds")
  assert.deepEqual(steady.segments.map((s) => [s.key, s.stats.n]), [["training", 120], ["validation", 40], ["out_of_sample", 40]])
  assert.ok(steady.robustness! >= 70)
  assert.equal(steady.folds.length, 6)

  // good early, losing late: over-fitted, or the market changed
  const later = (rows: RawTrade[], from: number) => rows.map((t, i) => ({ ...t, entryTime: new Date(START + (from + i) * DAY), exitTime: new Date(START + (from + i) * DAY + 600_000) }))
  const broke = walkForward(prep([...series(150, 3, 4, 1.5), ...later(series(50, 1, 5, 1), 400)]))
  assert.equal(broke.verdict, "broke")
  assert.match(broke.summary, /over-fitting/)
  assert.equal(broke.robustness, 0)

  assert.equal(walkForward(prep(series(20, 1, 2, 1))).verdict, "insufficient")
  // nothing profitable to carry forward
  assert.equal(walkForward(prep(series(200, 1, 3, 1))).verdict, "insufficient")
})

test("monitoring: the latest trades against the edge's own history", () => {
  nextId = 30_000
  // the same trades, moved to later days (keeping the time of day they were taken)
  const later = (rows: RawTrade[], from: number) =>
    rows.map((t, i) => {
      const entry = START + (from + i) * DAY + ((t.entryTime.getTime() - START) % DAY)
      return { ...t, entryTime: new Date(entry), exitTime: new Date(entry + 600_000) }
    })
  const healthy = monitor(prep(series(160, 3, 5, 1.5)), {})
  assert.deepEqual([healthy.status, healthy.recent.n, healthy.historical.n], ["healthy", 50, 110])

  // the edge kept working in London and started losing in New York
  const mixed = prep([...series(120, 3, 5, 1.5, { hourUtc: 9 }), ...later([...series(20, 3, 5, 1.5, { hourUtc: 9 }), ...series(30, 0, 1, 1, { hourUtc: 15 })].sort(() => 0), 300)])
  const weak = monitor(mixed, {})
  assert.ok(weak.status === "degraded" || weak.status === "weakening", weak.status)
  assert.match(weak.explanation, /NY AM trades/)
  assert.ok(weak.recent.expectancy < weak.historical.expectancy)

  assert.equal(monitor(prep(series(25, 3, 5, 1.5)), {}).status, "insufficient")

  // an alert is raised when the state changes for the worse — or recovers — and not otherwise
  assert.equal(alertFor("London breakout", "healthy", healthy), null)
  assert.match(alertFor("London breakout", "healthy", weak)!.title, /London breakout/)
  assert.equal(alertFor("London breakout", weak.status, weak), null)
  assert.equal(alertFor("London breakout", "weakening", healthy)!.kind, "recovered")
  assert.equal(breakdown([], "symbol").length, 0)
})
