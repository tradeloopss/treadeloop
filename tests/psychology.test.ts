import { test } from "node:test"
import assert from "node:assert/strict"
import { prepareTrades, type RawPsych, type RawTrade } from "@/lib/edge/core"
import { detail } from "@/lib/edge/discover"
import { NOT_MEASURABLE, behaviours, challengeProgress, coachNotes, dailyBrief, emotionPerformance, patterns, profile, scores, tiltRisk, timeline, triggers, weekStart, weeklyReport } from "@/lib/psych/engine"
import { CHALLENGES, checkinEmpty, cleanAnswers, cleanCheckin, cleanReview, emotionLabel, reasonLabel } from "@/lib/psych/rules"

// Psychology's engine: behaviour read from the trade log, and what the trader
// said in check-ins and reviews. It reports what was observed and how results
// differed — with the sample it rests on — and says "can't tell" when it can't.

const DAY = 86_400_000
const START = Date.UTC(2026, 0, 5) // a Monday
let id = 1
const psych = new Map<number, RawPsych>()

type Spec = { day: number; at: number; r: number; minutes?: number; risk?: number; tp?: number | null; stop?: boolean; mistakes?: string[]; tags?: string[]; say?: Partial<RawPsych> }
// One closed trade. `at` is minutes after 09:00 UTC on `day`; `risk` in dollars (100 is this trader's usual).
function raw(s: Spec): RawTrade {
  const entry = new Date(START + s.day * DAY + 9 * 3_600_000 + s.at * 60_000)
  const risk = s.risk ?? 100
  const t: RawTrade = {
    id: id++,
    symbol: "EURUSD",
    market: "forex",
    side: "long",
    status: "closed",
    pnl: s.r * risk,
    rMultiple: s.stop === false ? null : s.r,
    quantity: risk,
    entryPrice: 100,
    exitPrice: 100 + s.r,
    stopLoss: s.stop === false ? null : 99,
    takeProfit: s.tp === undefined ? null : s.tp,
    contractMultiplier: 1,
    entryTime: entry,
    exitTime: new Date(entry.getTime() + (s.minutes ?? 20) * 60_000),
    accountId: 1,
    playbookId: null,
    tags: s.tags ?? [],
    mistakes: s.mistakes ?? [],
    rating: null,
    source: "manual",
  }
  if (s.say) psych.set(t.id, { emotionBefore: null, confidenceBefore: null, focusBefore: null, stressBefore: null, reason: null, planBefore: null, emotionAfter: null, planFollowed: null, interference: [], ...s.say })
  return t
}
const prep = (rows: RawTrade[]) => prepareTrades(rows, { timeZone: "UTC", psych })
const day = (n: number) => new Date(START + n * DAY).toISOString().slice(0, 10)

test("check-ins and reviews: only the offered answers are kept", () => {
  assert.deepEqual(cleanCheckin({ emotion: "calm", confidence: 8, focus: 7, stress: 3, reason: "valid_setup", planFollowing: true }), { emotion: "calm", confidence: 8, focus: 7, stress: 3, reason: "valid_setup", planFollowing: true })
  // anything else is dropped, not guessed
  assert.deepEqual(cleanCheckin({ emotion: "ecstatic", confidence: 11, focus: 0, stress: "5", reason: "<script>", planFollowing: "yes" }), { emotion: null, confidence: null, focus: null, stress: 5, reason: null, planFollowing: null })
  assert.ok(checkinEmpty(cleanCheckin(null)) && checkinEmpty(cleanCheckin("x")))
  assert.ok(!checkinEmpty(cleanCheckin({ stress: 4 })))
  assert.deepEqual(cleanReview({ emotionAfter: "frustrated", planFollowed: false, interference: ["moved_sl", "moved_sl", "hacked", 7], notes: "  cut it short  " }), { emotionAfter: "frustrated", planFollowed: false, interference: ["moved_sl"], notes: "cut it short" })
  assert.equal(cleanReview({ notes: "x".repeat(5000) }).notes!.length, 1000)
  assert.deepEqual(cleanAnswers({ best: "Waited for the retest", extra: "no", change: "" }), { best: "Waited for the retest" })
  assert.deepEqual([emotionLabel("fomo"), emotionLabel("calm"), emotionLabel(null), reasonLabel("making_back_losses")], ["FOMO", "Calm", "—", "Making back losses"])
  assert.equal(CHALLENGES.length, 6)
})

test("behaviour, trade by trade: what came before it, on the same day", () => {
  id = 1
  psych.clear()
  const trades = prep([
    raw({ day: 0, at: 0, r: -1 }),
    raw({ day: 0, at: 24, r: -1, risk: 200 }), // 4 minutes after the loss closed, double the risk
    raw({ day: 0, at: 120, r: 2 }),
    raw({ day: 1, at: 0, r: 1, tp: 103 }), // planned 3R, took 1R
    raw({ day: 1, at: 60, r: 3, tp: 103 }),
    raw({ day: 2, at: 0, r: 1, stop: false }),
  ])
  const b = behaviours(trades)
  const of = (i: number) => b.get(trades[i].id)!
  assert.deepEqual([of(0).reentryMin, of(0).lossStreak, of(0).ofDay, of(0).dayPnlBefore], [null, 0, 1, 0])
  assert.deepEqual([of(1).reentryMin, of(1).lossStreak, of(1).ofDay, of(1).dayPnlBefore, of(1).riskRatio], [4, 1, 2, -100, 2])
  assert.deepEqual([of(2).reentryMin, of(2).lossStreak, of(2).ofDay, of(2).dayPnlBefore], [76, 2, 3, -300])
  // a new day: losses don't carry over, the win streak does
  assert.deepEqual([of(3).reentryMin, of(3).lossStreak, of(3).winStreak, of(3).earlyExit], [null, 0, 1, true])
  assert.deepEqual([of(4).winStreak, of(4).earlyExit], [2, false])
  // no stop: no risk to compare, no target to fall short of
  assert.deepEqual([of(5).riskRatio, of(5).earlyExit, of(5).winStreak], [null, null, 3])
})

// A trader who is fine in the morning and takes a quick trade after every loss, which mostly loses.
function revengeBook() {
  id = 1
  psych.clear()
  const rows: RawTrade[] = []
  for (let d = 0; d < 60; d++) {
    const win = d % 2 === 0
    rows.push(raw({ day: d, at: 0, r: win ? 1.5 : -1 }))
    if (!win) rows.push(raw({ day: d, at: 25, r: d % 10 === 1 ? 1 : -1, risk: 150 }))
  }
  return prep(rows)
}

test("patterns: revenge trading is found in the log, with what it has cost", () => {
  const found = patterns(revengeBook())
  const revenge = found.find((p) => p.key === "revenge")!
  assert.equal(revenge.state, "detected")
  assert.equal(revenge.n, 30)
  assert.match(revenge.summary, /within 10 minutes of a loss/)
  assert.ok(revenge.impact! < 0, "it cost money against the trader's ordinary trades")
  assert.ok(revenge.rule!.includes("wait at least 10 minutes"))
  assert.deepEqual(revenge.metrics.map((m) => m.label).slice(0, 4), ["Normal expectancy", "These trades", "Win rate", "Sample"])
  assert.equal(revenge.metrics.find((m) => m.label === "With a bigger risk than usual")!.value, "30 of 30")
  // found first: the detected ones lead
  assert.equal(found[0].state, "detected")
  // nothing was checked in, so what the trader would have had to report is "can't tell", not "clear"
  assert.equal(found.find((p) => p.key === "fomo")!.state, "unknown")
  // too little history: no patterns at all
  assert.deepEqual(patterns(revengeBook().slice(0, 12)), [])
  // and the things a trade log cannot show are named as such
  assert.ok(NOT_MEASURABLE.some((n) => n.title === "Hesitation and skipped setups"))
})

test("patterns: a clean record reads as clear, and missing data as unknown", () => {
  id = 1
  psych.clear()
  const calm = prep(Array.from({ length: 40 }, (_, d) => raw({ day: d, at: 0, r: d % 5 < 3 ? 1.5 : -1, stop: false })))
  const found = patterns(calm)
  assert.equal(found.find((p) => p.key === "revenge")!.state, "clear")
  assert.match(found.find((p) => p.key === "revenge")!.summary, /No trade was opened within 10 minutes of a loss/)
  assert.equal(found.find((p) => p.key === "after_losses")!.state, "clear")
  // without stops, risk can't be measured — said plainly
  assert.match(found.find((p) => p.key === "risk")!.summary, /needs a stop loss/)
  assert.equal(found.find((p) => p.key === "early_exit")!.state, "unknown")
  assert.ok(found.every((p) => p.rule == null))
})

test("patterns: winners closed before the target", () => {
  id = 1
  psych.clear()
  // every winner was planned for 3R; four in ten were taken at 1R
  const rows = Array.from({ length: 40 }, (_, d) => raw({ day: d, at: 0, r: d % 4 === 3 ? -1 : d % 10 < 4 ? 1 : 3, tp: 103 }))
  const early = patterns(prep(rows)).find((p) => p.key === "early_exit")!
  assert.equal(early.state, "detected")
  assert.match(early.summary, /% of your winning trades with a target were closed before reaching it/)
  assert.equal(early.metrics[0].value, "30")
  assert.ok(early.rule)
})

test("scores: each part says what it rests on, and is missing rather than made up", () => {
  const s = scores(revengeBook())
  // from the log alone: risk, trade count, clean execution
  assert.equal(s.components.find((c) => c.key === "risk")!.value, 100)
  assert.equal(s.components.find((c) => c.key === "plan")!.value, null)
  assert.match(s.components.find((c) => c.key === "plan")!.note, /Needs 5 reviewed trades/)
  assert.equal(s.components.find((c) => c.key === "mistakes")!.value, 100)
  assert.ok(s.discipline != null && s.discipline >= 90)
  // every loss was followed by an immediate trade
  assert.equal(s.emotionalControl, 0)
  // nothing was checked in: no confidence, focus or stress figure
  assert.deepEqual([s.confidence, s.focus, s.stress, s.checkins, s.reviews], [null, null, null, 0, 0])
  assert.ok(s.psychology != null && s.psychology < s.discipline)
  // nothing at all to go on
  const none = scores([])
  assert.deepEqual([none.psychology, none.discipline, none.emotionalControl], [null, null, null])
})

// A trader who checks in: calm and following the plan most days, FOMO and stressed on others.
function checkedBook() {
  id = 1
  psych.clear()
  const rows: RawTrade[] = []
  for (let d = 0; d < 50; d++) {
    const fomo = d % 5 === 4
    rows.push(
      raw({
        day: d,
        at: 0,
        r: fomo ? -1 : d % 3 === 0 ? -1 : 1.5,
        risk: d % 10 === 9 ? 150 : 100,
        mistakes: fomo ? ["FOMO entry"] : [],
        say: fomo ? { emotionBefore: "fomo", confidenceBefore: 10, stressBefore: 8, focusBefore: 4, reason: "fomo", planFollowed: false, interference: ["moved_sl"] } : { emotionBefore: "calm", confidenceBefore: 8, stressBefore: 2, focusBefore: 8, reason: "valid_setup", planFollowed: true, interference: [] },
      })
    )
  }
  return prep(rows)
}

test("state of mind against results: only states with enough trades are shown", () => {
  const trades = checkedBook()
  const rows = emotionPerformance(trades)
  assert.deepEqual(rows.map((r) => [r.value, r.stats.n]), [["Calm", 40], ["Fomo", 10]])
  assert.ok(rows[0].stats.expR! > 0 && rows[1].stats.expR === -1)
  // a state with three trades doesn't appear
  assert.deepEqual(emotionPerformance(trades.slice(0, 14)).map((r) => r.value), ["Calm"])
  // the same split is there on any edge: this is what links Psychology to Edge Lab
  const edge = detail(trades, { symbol: "EURUSD" })
  assert.deepEqual(edge.psychology.map((p) => p.dim), ["emotion", "confidence", "stress", "plan"])
  assert.deepEqual(edge.psychology.find((p) => p.dim === "plan")!.rows.map((r) => [r.value, r.stats.n]), [["Followed the plan", 40], ["Broke the plan", 10]])
})

test("scores from check-ins, the triggers, and the profile", () => {
  const trades = checkedBook()
  const s = scores(trades, [{ day: day(1), kind: "morning", confidence: 6, focus: 7, stress: 4, emotion: "neutral" }])
  assert.equal(s.components.find((c) => c.key === "plan")!.value, 80)
  assert.equal(s.components.find((c) => c.key === "stop")!.value, 80)
  assert.equal(s.components.find((c) => c.key === "mistakes")!.value, 80)
  assert.deepEqual([s.reviews, s.checkins], [50, 51])
  assert.ok(s.confidence! > 80 && s.stress! > 3 && s.stress! < 4 && s.focus! > 70)
  assert.equal(s.emotionalControl, 80) // 10 of 50 checked-in trades taken in a state named as a bad one

  const t = triggers(trades)
  assert.deepEqual(t.map((x) => x.key), ["fomo", "revenge", "fear", "greed", "boredom", "fatigue", "stress", "overconfidence"])
  const fomo = t.find((x) => x.key === "fomo")!
  assert.deepEqual([fomo.n, fomo.stats!.winRate, fomo.basis], [10, 0, "Self-reported"])
  assert.ok(fomo.impact! < 0)
  assert.ok(fomo.contexts.includes("EURUSD"))
  assert.deepEqual([t.find((x) => x.key === "greed")!.n, t.find((x) => x.key === "greed")!.stats], [0, null])
  assert.equal(t.find((x) => x.key === "stress")!.n, 10)
  assert.equal(t.find((x) => x.key === "overconfidence")!.n, 10)

  const p = profile(trades)
  assert.deepEqual(p.map((x) => x.key), ["discipline", "patience", "confidence", "stability", "risk", "fomo"])
  assert.equal(p.find((x) => x.key === "fomo")!.value, 80)
  assert.ok(p.every((x) => x.value == null || (x.value >= 0 && x.value <= 100)))
  // from the log alone there is nothing to say about FOMO
  assert.equal(profile(revengeBook()).find((x) => x.key === "fomo")!.value, null)
})

test("the coach speaks from figures, and marks a reason as a hypothesis", () => {
  const notes = coachNotes(checkedBook())
  const conf = notes.find((n) => n.key === "confidence")!
  assert.match(conf.observed[0], /^When confidence is 7–9: \+[\d.]+R expectancy \(n=40\)\.$/)
  assert.match(conf.observed[1], /^When confidence is 10: −1\.00R expectancy \(n=10\)\.$/)
  assert.equal(conf.correlation, "Maximum confidence has gone with lower expectancy.")
  assert.equal(conf.experiment!.trades, 20)
  const stress = notes.find((n) => n.key === "stress")!
  assert.match(stress.observed[1], /Stress 7–10/)
  assert.ok(notes.find((n) => n.key === "plan"))
  for (const n of notes) assert.ok(n.observed.length >= 2 && !/undefined|NaN/.test(JSON.stringify(n)))
  // no check-ins and too little history: nothing to say, so nothing is said
  assert.deepEqual(coachNotes(revengeBook().slice(0, 10)), [])
  // from the log alone it can still speak about the trade after a loss
  const logOnly = coachNotes(revengeBook())
  assert.deepEqual(logOnly.map((n) => n.key), ["reentry"])
  assert.match(logOnly[0].hypothesis!, /^These may be/)
})

test("the timeline and the week: day by day, and this week against last", () => {
  const trades = checkedBook()
  const days = timeline(trades, [{ day: day(49), kind: "evening", confidence: 5, focus: null, stress: 6, emotion: "neutral" }], 14)
  assert.equal(days.length, 14)
  const last = days[days.length - 1]
  assert.deepEqual([last.day, last.trades, last.emotion, last.clean], [day(49), 1, "fomo", 0])
  assert.equal(last.confidence, 7.5) // the trade's 10 and the evening's 5
  assert.equal(days[0].ids.length, 1)

  assert.equal(weekStart("2026-01-08"), "2026-01-05")
  assert.equal(weekStart("2026-01-11"), "2026-01-05") // Sunday belongs to the week that began on Monday
  assert.equal(weekStart("2026-01-12"), "2026-01-12")

  // week two (days 7–13) against week one (days 0–6)
  const w = weeklyReport(trades, [], day(9))
  assert.deepEqual([w.from, w.to, w.trades], [day(7), day(13), 7])
  const line = (key: string) => w.lines.find((l) => l.key === key)!
  assert.deepEqual([line("fomo").now, line("fomo").before], [1, 1])
  assert.deepEqual([line("breaks").now, line("breaks").before], [1, 1])
  assert.equal(w.improvement, null) // nothing fell
  assert.ok(w.problem)
  // a week with no trades has nothing to count
  assert.equal(weeklyReport(trades, [], day(200)).lines.find((l) => l.key === "fomo")!.now, null)
})

test("tilt: how today is going — and nothing when there is nothing today", () => {
  id = 1
  psych.clear()
  const history = Array.from({ length: 30 }, (_, d) => raw({ day: d, at: 0, r: d % 2 ? 1 : -1 }))
  // today: three losses in forty minutes, the last one at double the risk
  const today = [raw({ day: 40, at: 0, r: -1, minutes: 5 }), raw({ day: 40, at: 10, r: -1, minutes: 5 }), raw({ day: 40, at: 20, r: -1, risk: 200, minutes: 5, mistakes: ["Revenge"] })]
  const trades = prep([...history, ...today])
  const tilt = tiltRisk(trades, day(40), 8)!
  assert.equal(tilt.level, "high")
  assert.equal(tilt.trades, 3)
  assert.deepEqual(tilt.factors.map((f) => f.key), ["losses", "frequency", "risk", "rules", "stress"])
  assert.equal(tilt.factors[0].value, 100)
  assert.equal(tilt.factors[0].note, "3 in a row")
  // an ordinary day
  assert.equal(tiltRisk(prep([...history, raw({ day: 41, at: 0, r: 1 })]), day(41))!.level, "low")
  // no trades today: no reading
  assert.equal(tiltRisk(trades, day(45)), null)
})

test("challenges count clean trading days, and stop at the first that wasn't", () => {
  const trades = revengeBook() // a quick re-entry after every loss: on every odd day
  const clean = challengeProgress("no_revenge", day(0), trades, day(0))
  assert.deepEqual([clean.clean, clean.broken, clean.done], [1, null, false])
  const broken = challengeProgress("no_revenge", day(0), trades, day(10))
  assert.deepEqual([broken.clean, broken.broken!.day], [1, day(1)])
  assert.match(broken.broken!.why, /within 10 minutes of a loss/)
  // seven clean trading days completes it
  id = 500
  const good = prep(Array.from({ length: 10 }, (_, d) => raw({ day: d, at: 0, r: 1 })))
  const done = challengeProgress("no_revenge", day(0), good, day(9))
  assert.deepEqual([done.clean, done.done, done.days], [7, true, 7])
  // one that depends on reviews can't be judged when there are none
  assert.equal(challengeProgress("never_move_stop", day(0), good, day(9)).measurable, false)
  assert.equal(challengeProgress("respect_risk", day(0), good, day(9)).measurable, true)
})

test("the morning brief: yesterday, and which of your own patterns to watch", () => {
  const trades = revengeBook()
  const brief = dailyBrief(trades, day(60))
  assert.deepEqual([brief.yesterday!.day, brief.yesterday!.trades], [day(59), 2])
  assert.ok(brief.reminders.includes("Watch for revenge trading after your first loss."))
  assert.ok(brief.reminders.length <= 3)
  // a new account: no yesterday, no reminders
  assert.deepEqual(dailyBrief([], day(0)), { yesterday: null, reminders: [] })
})
