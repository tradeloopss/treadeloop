import { MIN_CELL, MIN_PATTERN, confidenceOfDifference, fmtMoney, fmtPct, fmtR, measure, outcomes, type Conditions, type EdgeTrade, type Stats } from "@/lib/edge/core"
import { breakdown, perTrade, type Row } from "@/lib/edge/discover"
import { CHALLENGES, type ChallengeKey } from "./rules"

// Psychology's analysis engine. It reads two things: what the trader DID (the
// trade log — a trade opened four minutes after a loss, a risk twice the usual
// after a winning streak) and what the trader SAID (check-ins and reviews).
// Pure — no database, no clock.
//
// It describes behaviour that was observed and how results differed around it.
// It never says why, and it is not a diagnosis of anything.

// A trade opened this soon after a losing one closed counts as a "quick re-entry".
export const REENTRY_MINUTES = 10
// Risk this much above the trader's usual counts as oversized.
export const OVERSIZE = 1.5

export type Basis = "Observed" | "Correlated" | "Statistically supported" | "Self-reported"

// ------------------------------------------------------------------ per-trade behaviour

export type Behaviour = {
  // minutes since the previous trade closed, when that trade lost and it was the same day
  reentryMin: number | null
  // consecutive losses / wins immediately before this trade (losses: the same day only)
  lossStreak: number
  winStreak: number
  ofDay: number
  // the day's running result before this trade was opened
  dayPnlBefore: number
  // this trade's risk against the trader's usual, when it had a stop
  riskRatio: number | null
  // a winner closed with under 80% of the reward it was planned for
  earlyExit: boolean | null
}

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))

export function behaviours(trades: EdgeTrade[]): Map<number, Behaviour> {
  const typical = median(trades.map((t) => t.risk).filter((r): r is number => r != null))
  const out = new Map<number, Behaviour>()
  let day = ""
  let ofDay = 0
  let dayPnl = 0
  let lossStreak = 0
  let winStreak = 0
  let prev: EdgeTrade | null = null
  for (const t of trades) {
    if (t.openDay !== day) {
      day = t.openDay
      ofDay = 0
      dayPnl = 0
      lossStreak = 0
      prev = null
    }
    ofDay++
    out.set(t.id, {
      reentryMin: prev && prev.pnl < 0 && t.entry >= prev.exit ? (t.entry - prev.exit) / 60_000 : null,
      lossStreak,
      winStreak,
      ofDay,
      dayPnlBefore: dayPnl,
      riskRatio: t.risk != null && typical > 0 ? t.risk / typical : null,
      earlyExit: t.rr != null && t.r != null && t.pnl > 0 ? t.r < t.rr * 0.8 : null,
    })
    dayPnl += t.pnl
    if (t.pnl < 0) {
      lossStreak++
      winStreak = 0
    } else if (t.pnl > 0) {
      winStreak++
      lossStreak = 0
    }
    prev = t
  }
  return out
}

// What the trader said, or tagged, about a trade.
const has = (t: EdgeTrade, re: RegExp) => t.mistakes.some((m) => re.test(m)) || t.tags.some((m) => re.test(m))
export const said = {
  fomo: (t: EdgeTrade) => t.psych?.emotionBefore === "fomo" || t.psych?.reason === "fomo" || has(t, /fomo|chas/i),
  revenge: (t: EdgeTrade) => t.psych?.reason === "revenge" || t.psych?.reason === "making_back_losses" || !!t.psych?.interference.includes("revenge") || has(t, /revenge/i),
  fear: (t: EdgeTrade) => t.psych?.emotionBefore === "fearful" || t.psych?.emotionBefore === "anxious" || has(t, /\bfear|hesitat/i),
  greed: (t: EdgeTrade) => t.psych?.emotionBefore === "greedy" || has(t, /greed/i),
  boredom: (t: EdgeTrade) => t.psych?.reason === "boredom" || has(t, /bored/i),
  fatigue: (t: EdgeTrade) => has(t, /tired|fatigue|exhaust/i),
  stress: (t: EdgeTrade) => (t.psych?.stressBefore ?? 0) >= 7,
  overconfidence: (t: EdgeTrade) => t.psych?.confidenceBefore === 10 || has(t, /overconfiden/i),
  movedStop: (t: EdgeTrade) => !!t.psych?.interference.includes("moved_sl") || has(t, /moved? (the )?(stop|sl)/i),
  movedTarget: (t: EdgeTrade) => !!t.psych?.interference.includes("moved_tp"),
  closedEarly: (t: EdgeTrade) => !!t.psych?.interference.includes("closed_early") || has(t, /early exit|closed? early|cut.*winner/i),
  planBroken: (t: EdgeTrade) => t.psych?.planFollowed === false || (t.psych?.planFollowed == null && t.psych?.planBefore === false),
}

// ------------------------------------------------------------------ comparing two groups

type Versus = { a: Stats; b: Stats; unit: "R" | "$"; confidence: number | null; worse: boolean; impact: number; basis: Basis }

// Group A (the behaviour) against group B (everything else), in the unit both have.
function versus(a: EdgeTrade[], b: EdgeTrade[]): Versus {
  const sa = measure(a)
  const sb = measure(b)
  const oa = outcomes(a)
  const ob = outcomes(b)
  const unit: "R" | "$" = oa.unit === "R" && ob.unit === "R" ? "R" : "$"
  const test = confidenceOfDifference(unit === "R" ? oa.values : a.map((t) => t.pnl), unit === "R" ? ob.values : b.map((t) => t.pnl))
  const va = unit === "R" ? (sa.expR ?? 0) : sa.expectancy
  const vb = unit === "R" ? (sb.expR ?? 0) : sb.expectancy
  const confidence = test ? test.confidence : null
  return {
    a: sa,
    b: sb,
    unit,
    confidence,
    worse: va < vb,
    // what those trades made, against what the same number of ordinary trades would have
    impact: sa.net - sa.n * sb.expectancy,
    basis: confidence != null && confidence >= 0.95 && sa.n >= 30 ? "Statistically supported" : confidence != null && confidence >= 0.8 ? "Correlated" : "Observed",
  }
}
const per = (s: Stats, unit: "R" | "$") => (unit === "R" ? fmtR(s.expR ?? 0) : fmtMoney(s.expectancy))

// ------------------------------------------------------------------ patterns

export type Pattern = {
  key: string
  title: string
  // detected = it is there and results are worse around it; clear = looked for, not hurting; unknown = can't be told from the data
  state: "detected" | "clear" | "unknown"
  basis: Basis
  summary: string
  metrics: { label: string; value: string }[]
  n: number
  // estimated dollars against the trader's ordinary trades (negative = it cost money); null when it can't be estimated
  impact: number | null
  // a rule the trader could set from it
  rule: string | null
  tradeIds: number[]
  // open these trades in Edge Lab, where there is a slice for them
  conditions: Conditions | null
}

function pattern(key: string, title: string, flagged: EdgeTrade[], rest: EdgeTrade[], words: { what: string; rule: string; none: string; conditions?: Conditions | null; basis?: Basis; extra?: { label: string; value: string }[] }): Pattern {
  const base = { key, title, tradeIds: flagged.slice(-40).map((t) => t.id), conditions: words.conditions ?? null }
  if (flagged.length < MIN_CELL) return { ...base, state: flagged.length === 0 ? "clear" : "unknown", basis: words.basis ?? "Observed", summary: flagged.length === 0 ? words.none : `Seen ${flagged.length} time${flagged.length === 1 ? "" : "s"} — too few to say what it does to your results.`, metrics: [{ label: "Occurrences", value: String(flagged.length) }], n: flagged.length, impact: null, rule: null }
  const v = versus(flagged, rest)
  const detected = v.worse && (v.a.expectancy < 0 || (v.confidence ?? 0) >= 0.8)
  return {
    ...base,
    state: detected ? "detected" : "clear",
    basis: words.basis ?? v.basis,
    summary: detected ? `${words.what}: these trades average ${per(v.a, v.unit)}, against ${per(v.b, v.unit)} for your other trades.` : `${words.what}: these trades average ${per(v.a, v.unit)} — no worse than your other trades (${per(v.b, v.unit)}).`,
    metrics: [
      { label: "Normal expectancy", value: per(v.b, v.unit) },
      { label: "These trades", value: per(v.a, v.unit) },
      { label: "Win rate", value: `${fmtPct(v.a.winRate, 0)} vs ${fmtPct(v.b.winRate, 0)}` },
      { label: "Sample", value: `${v.a.n} trades` },
      ...(words.extra ?? []),
    ],
    n: v.a.n,
    impact: detected && rest.length >= MIN_PATTERN ? v.impact : null,
    rule: detected ? words.rule : null,
  }
}

// Everything the trade log (and the reviews) can show about how the trader behaves.
export function patterns(trades: EdgeTrade[]): Pattern[] {
  if (trades.length < MIN_PATTERN) return []
  const b = behaviours(trades)
  const of = (t: EdgeTrade) => b.get(t.id)!
  const split = (test: (t: EdgeTrade) => boolean) => [trades.filter(test), trades.filter((t) => !test(t))] as const
  const out: Pattern[] = []

  // A trade opened minutes after a loss.
  const [quick, notQuick] = split((t) => (of(t).reentryMin ?? Infinity) <= REENTRY_MINUTES)
  const bigger = quick.filter((t) => (of(t).riskRatio ?? 0) > 1.2).length
  out.push(
    pattern("revenge", "Revenge trading", quick, notQuick, {
      what: `Trades opened within ${REENTRY_MINUTES} minutes of a loss`,
      rule: `After a losing trade, wait at least ${REENTRY_MINUTES} minutes before the next one.`,
      none: `No trade was opened within ${REENTRY_MINUTES} minutes of a loss.`,
      extra: bigger ? [{ label: "With a bigger risk than usual", value: `${bigger} of ${quick.length}` }] : [],
    })
  )

  // The trade after two losses in a row.
  const [afterTwo, notAfterTwo] = split((t) => of(t).lossStreak >= 2)
  out.push(pattern("after_losses", "Trading after two losses", afterTwo, notAfterTwo, { what: "Trades taken after 2 or more consecutive losses that day", rule: "Stop for the day after two consecutive losses.", none: "You haven't traded on after two losses in a row on the same day." }))

  // More trades in a day than is normal for this trader.
  const perDay = new Map<string, number>()
  for (const t of trades) perDay.set(t.openDay, (perDay.get(t.openDay) ?? 0) + 1)
  const counts = [...perDay.values()].sort((x, y) => x - y)
  const usual = Math.max(2, Math.ceil(counts[Math.floor(counts.length * 0.75)] ?? 2))
  const [extra, within] = split((t) => of(t).ofDay > usual)
  out.push(
    pattern("overtrading", "Overtrading", extra, within, {
      what: `Trades beyond your usual ${usual} a day`,
      rule: `Take no more than ${usual} trades in a day.`,
      none: `You haven't gone past ${usual} trades in a day.`,
      conditions: null,
      extra: [{ label: "Days over the usual", value: `${counts.filter((c) => c > usual).length} of ${counts.length}` }],
    })
  )

  // Bigger risk after a run of losses, and after a run of wins.
  const sized = trades.filter((t) => of(t).riskRatio != null)
  if (sized.length >= MIN_PATTERN) {
    const afterLosses = sized.filter((t) => of(t).lossStreak >= 2)
    const afterWins = sized.filter((t) => of(t).winStreak >= 3)
    const ratio = (list: EdgeTrade[]) => median(list.map((t) => of(t).riskRatio!))
    const risk = (key: string, title: string, list: EdgeTrade[], when: string, rule: string) => {
      const r = list.length >= MIN_CELL ? ratio(list) : null
      const others = trades.filter((t) => !list.includes(t))
      const p = pattern(key, title, r != null && r >= 1.2 ? list : [], others, { what: `Trades ${when}`, rule, none: list.length < MIN_CELL ? `Too few trades ${when} to tell.` : `Your risk ${when} stays at its usual size.` })
      if (r != null) p.metrics.unshift({ label: `Risk ${when}`, value: `${r.toFixed(2)}× your usual` })
      if (list.length < MIN_CELL) p.state = "unknown"
      return p
    }
    out.push(risk("risk_after_losses", "Increasing risk after losses", afterLosses, "after 2 or more losses", "Keep the same risk after losses — never size up to win it back."))
    out.push(risk("risk_after_wins", "Increasing risk after wins", afterWins, "after 3 or more wins", "Keep the same risk during a winning streak."))
  } else {
    out.push({ key: "risk", title: "Changing risk after wins or losses", state: "unknown", basis: "Observed", summary: "This needs a stop loss on your trades: the risk of a trade can't be measured without one.", metrics: [], n: 0, impact: null, rule: null, tradeIds: [], conditions: null })
  }

  // Winners closed before the planned target.
  const planned = trades.filter((t) => of(t).earlyExit != null)
  if (planned.length >= MIN_CELL) {
    const early = planned.filter((t) => of(t).earlyExit)
    const share = early.length / planned.length
    const left = avg(early.map((t) => t.rr! - t.r!))
    out.push({
      key: "early_exit",
      title: "Early exits",
      state: share >= 0.3 ? "detected" : "clear",
      basis: "Observed",
      summary: `${fmtPct(share, 0)} of your winning trades with a target were closed before reaching it${early.length ? `, leaving ${fmtR(left).replace("+", "")} of the planned reward on average` : ""}.`,
      metrics: [
        { label: "Winners with a target", value: String(planned.length) },
        { label: "Closed before the target", value: String(early.length) },
        { label: "Planned reward not taken", value: early.length ? fmtR(left).replace("+", "") : "—" },
      ],
      n: planned.length,
      impact: null,
      rule: share >= 0.3 ? "Let a winning trade reach its target, or move the stop to protect it — don't close it by hand." : null,
      tradeIds: early.slice(-40).map((t) => t.id),
      conditions: null,
    })
  } else {
    out.push({ key: "early_exit", title: "Early exits", state: "unknown", basis: "Observed", summary: "This needs a stop and a target on your trades, to compare what was planned with what was taken.", metrics: [], n: planned.length, impact: null, rule: null, tradeIds: [], conditions: null })
  }

  // What the trader reported or tagged.
  const reported: [string, string, (t: EdgeTrade) => boolean, string, string][] = [
    ["fomo", "FOMO entries", said.fomo, "Trades you marked as FOMO", "Only enter at your setup's trigger — if price has already gone, the trade is gone."],
    ["moved_stop", "Moving the stop", said.movedStop, "Trades where you moved the stop", "Once the trade is on, the stop only moves in the trade's favour."],
    ["plan_break", "Breaking the plan", said.planBroken, "Trades where you didn't follow your plan", "No trade without a setup from the plan."],
  ]
  for (const [key, title, test, what, rule] of reported) {
    const [yes, no] = split(test)
    const p = pattern(key, title, yes, no, { what, rule, none: `${what}: none recorded.`, basis: "Self-reported" })
    if (yes.length === 0 && !trades.some((t) => t.psych)) {
      p.state = "unknown"
      p.summary = "This comes from your check-ins and reviews — there aren't any yet."
    }
    out.push(p)
  }

  const order = { detected: 0, clear: 1, unknown: 2 }
  return out.sort((x, y) => order[x.state] - order[y.state] || (x.impact ?? 0) - (y.impact ?? 0))
}

// Things a trade log cannot show, said plainly rather than guessed at.
export const NOT_MEASURABLE = [
  { title: "Chasing price", why: "Needs the price path before your entry. It appears once price history has been analysed for your instruments." },
  { title: "Hesitation and skipped setups", why: "A trade you didn't take leaves no record. Mark it in a check-in to track it." },
  { title: "Trading outside planned hours", why: "Set your trading hours as a rule first; trades outside them are then counted." },
]

// ------------------------------------------------------------------ scores

export type Component = { key: string; label: string; value: number | null; note: string }
export type Scores = {
  psychology: number | null
  discipline: number | null
  emotionalControl: number | null
  focus: number | null
  confidence: number | null
  // 0..10, lower is better
  stress: number | null
  components: Component[]
  // what the scores rest on
  trades: number
  checkins: number
  reviews: number
}

export type DayCheckin = { day: string; kind: string; confidence: number | null; focus: number | null; stress: number | null; emotion: string | null }

const share = (list: EdgeTrade[], test: (t: EdgeTrade) => boolean) => (list.length ? list.filter(test).length / list.length : null)

export function scores(trades: EdgeTrade[], checkins: DayCheckin[] = []): Scores {
  const b = behaviours(trades)
  const of = (t: EdgeTrade) => b.get(t.id)!
  const reviewed = trades.filter((t) => t.psych && (t.psych.planFollowed != null || t.psych.emotionAfter != null || t.psych.interference.length > 0))
  const sized = trades.filter((t) => of(t).riskRatio != null)
  const planned = trades.filter((t) => of(t).earlyExit != null)
  const perDay = new Map<string, number>()
  for (const t of trades) perDay.set(t.openDay, (perDay.get(t.openDay) ?? 0) + 1)
  const counts = [...perDay.values()].sort((x, y) => x - y)
  const usual = Math.max(2, Math.ceil(counts[Math.floor(counts.length * 0.75)] ?? 2))
  const pct = (v: number | null) => (v == null ? null : Math.round(v * 100))
  const judged = reviewed.filter((t) => t.psych!.planFollowed != null)

  const components: Component[] = [
    { key: "risk", label: "Risk compliance", value: sized.length >= 10 ? pct(share(sized, (t) => of(t).riskRatio! <= OVERSIZE)) : null, note: sized.length >= 10 ? `${sized.length} trades with a stop: risk within ${OVERSIZE}× your usual` : "Needs 10 trades with a stop loss" },
    { key: "plan", label: "Plan adherence", value: judged.length >= MIN_CELL ? pct(share(judged, (t) => t.psych!.planFollowed === true)) : null, note: judged.length >= MIN_CELL ? `${judged.length} reviewed trades` : `Needs ${MIN_CELL} reviewed trades` },
    { key: "stop", label: "Stop compliance", value: reviewed.length >= MIN_CELL ? pct(share(reviewed, (t) => !said.movedStop(t))) : null, note: reviewed.length >= MIN_CELL ? `${reviewed.length} reviewed trades: stop left where it was` : `Needs ${MIN_CELL} reviewed trades` },
    { key: "overtrading", label: "Overtrading control", value: counts.length >= 5 ? pct(counts.filter((c) => c <= usual).length / counts.length) : null, note: counts.length >= 5 ? `${counts.length} trading days: within your usual ${usual} trades` : "Needs 5 trading days" },
    { key: "exits", label: "Letting winners run", value: planned.length >= MIN_CELL ? pct(share(planned, (t) => !of(t).earlyExit)) : null, note: planned.length >= MIN_CELL ? `${planned.length} winners with a target` : "Needs winners with a stop and a target" },
    { key: "mistakes", label: "Clean execution", value: trades.length >= 10 ? pct(share(trades, (t) => t.mistakes.length === 0)) : null, note: trades.length >= 10 ? `${trades.length} trades: none tagged with a mistake` : "Needs 10 trades" },
  ]
  const known = components.filter((c) => c.value != null)
  const discipline = known.length >= 2 ? Math.round(avg(known.map((c) => c.value!))) : null

  // Emotional control: how often a loss is followed by an immediate re-entry, and
  // how many checked-in trades were taken in a state the trader named as a bad one.
  const followed = trades.filter((t) => of(t).reentryMin != null)
  const calm = followed.length >= MIN_CELL ? 1 - followed.filter((t) => of(t).reentryMin! <= REENTRY_MINUTES).length / followed.length : null
  const checked = trades.filter((t) => t.psych?.emotionBefore)
  const steady = checked.length >= MIN_CELL ? 1 - checked.filter((t) => ["fomo", "frustrated", "fearful", "greedy", "anxious"].includes(t.psych!.emotionBefore!)).length / checked.length : null
  const control = [calm, steady].filter((v): v is number => v != null)
  const emotionalControl = control.length ? Math.round(avg(control) * 100) : null

  // The sliders: from the trades' own check-ins and the day's.
  const values = (pick: (c: { confidence: number | null; focus: number | null; stress: number | null }) => number | null) => [...trades.map((t) => (t.psych ? pick({ confidence: t.psych.confidenceBefore, focus: t.psych.focusBefore, stress: t.psych.stressBefore }) : null)), ...checkins.map(pick)].filter((v): v is number => v != null)
  const mean10 = (list: number[]) => (list.length >= 3 ? avg(list) : null)
  const conf = mean10(values((c) => c.confidence))
  const foc = mean10(values((c) => c.focus))
  const str = mean10(values((c) => c.stress))

  const parts: [number | null, number][] = [
    [discipline, 0.4],
    [emotionalControl, 0.3],
    [foc == null ? null : foc * 10, 0.1],
    [conf == null ? null : Math.min(conf, 9) * (100 / 9), 0.1],
    [str == null ? null : (10 - str) * 10, 0.1],
  ]
  const have = parts.filter((p): p is [number, number] => p[0] != null)
  const psychology = discipline != null || emotionalControl != null ? Math.round(have.reduce((s, [v, w]) => s + v * w, 0) / have.reduce((s, [, w]) => s + w, 0)) : null

  return { psychology, discipline, emotionalControl, focus: foc == null ? null : Math.round(foc * 10), confidence: conf == null ? null : Math.round(conf * 10), stress: str == null ? null : Math.round(str * 10) / 10, components, trades: trades.length, checkins: checked.length + checkins.length, reviews: reviewed.length }
}

// ------------------------------------------------------------------ state → result

// How each state of mind has gone, for the states with enough trades to say.
export function emotionPerformance(trades: EdgeTrade[], min = 8): Row[] {
  return breakdown(trades, "emotion", min).sort((a, b) => perTrade(b.stats) - perTrade(a.stats))
}

// ------------------------------------------------------------------ triggers

export type Trigger = { key: string; label: string; n: number; stats: Stats | null; impact: number | null; basis: Basis; contexts: string[]; tradeIds: number[] }
const TRIGGERS: [string, string, (t: EdgeTrade, b: Behaviour) => boolean, Basis][] = [
  ["fomo", "FOMO", (t) => said.fomo(t), "Self-reported"],
  ["revenge", "Revenge", (t, b) => said.revenge(t) || (b.reentryMin ?? Infinity) <= REENTRY_MINUTES, "Observed"],
  ["fear", "Fear", (t) => said.fear(t), "Self-reported"],
  ["greed", "Greed", (t) => said.greed(t), "Self-reported"],
  ["boredom", "Boredom", (t) => said.boredom(t), "Self-reported"],
  ["fatigue", "Fatigue", (t) => said.fatigue(t), "Self-reported"],
  ["stress", "Stress", (t) => said.stress(t), "Self-reported"],
  ["overconfidence", "Overconfidence", (t, b) => said.overconfidence(t) || (b.winStreak >= 3 && (b.riskRatio ?? 0) >= 1.3), "Observed"],
]

export function triggers(trades: EdgeTrade[]): Trigger[] {
  const b = behaviours(trades)
  const baseline = measure(trades)
  return TRIGGERS.map(([key, label, test, basis]) => {
    const hit = trades.filter((t) => test(t, b.get(t.id)!))
    const stats = hit.length >= MIN_CELL ? measure(hit) : null
    const top = (dim: "symbol" | "session" | "weekday") => {
      const rows = breakdown(hit, dim)
      return rows.length && rows[0].stats.n >= Math.max(3, hit.length * 0.4) ? rows[0].value : null
    }
    return {
      key,
      label,
      n: hit.length,
      stats,
      // against the trader's own average trade
      impact: stats && trades.length >= MIN_PATTERN ? stats.net - stats.n * baseline.expectancy : null,
      basis,
      contexts: hit.length >= MIN_CELL ? [top("symbol"), top("session"), top("weekday")].filter((v): v is string => !!v) : [],
      tradeIds: hit.slice(-40).map((t) => t.id),
    }
  })
}

// ------------------------------------------------------------------ profile

export type Trait = { key: string; label: string; value: number | null; note: string }

// How the trader trades, as observed — not a personality test.
export function profile(trades: EdgeTrade[], checkins: DayCheckin[] = []): Trait[] {
  const s = scores(trades, checkins)
  const b = behaviours(trades)
  const of = (t: EdgeTrade) => b.get(t.id)!
  const c = (key: string) => s.components.find((x) => x.key === key)?.value ?? null
  const followed = trades.filter((t) => of(t).reentryMin != null)
  const waits = followed.length >= MIN_CELL ? Math.round((1 - followed.filter((t) => of(t).reentryMin! <= REENTRY_MINUTES).length / followed.length) * 100) : null
  const patience = [waits, c("exits"), c("overtrading")].filter((v): v is number => v != null)
  const sized = trades.filter((t) => t.risk != null).map((t) => t.risk!)
  const m = avg(sized)
  const spread = sized.length >= 10 && m > 0 ? Math.sqrt(avg(sized.map((r) => (r - m) ** 2))) / m : null
  const riskParts = [c("risk"), spread == null ? null : Math.round(clamp(100 - spread * 100))].filter((v): v is number => v != null)
  const checked = trades.filter((t) => t.psych?.emotionBefore || t.psych?.reason)
  return [
    { key: "discipline", label: "Discipline", value: s.discipline, note: "Following your own rules: risk, plan, stops, trade count." },
    { key: "patience", label: "Patience", value: patience.length >= 2 ? Math.round(avg(patience)) : null, note: "Waiting after a loss, letting winners reach their target, keeping to your usual number of trades." },
    { key: "confidence", label: "Confidence", value: s.confidence, note: "From your check-ins." },
    { key: "stability", label: "Emotional stability", value: s.emotionalControl, note: "How rarely a loss is followed straight away by another trade, and how often you trade in a state you named as a bad one." },
    { key: "risk", label: "Risk control", value: riskParts.length ? Math.round(avg(riskParts)) : null, note: "Risk per trade staying close to your usual amount." },
    { key: "fomo", label: "FOMO resistance", value: checked.length >= 10 ? Math.round((1 - checked.filter(said.fomo).length / checked.length) * 100) : null, note: checked.length >= 10 ? `${checked.length} checked-in trades.` : "Needs 10 checked-in trades." },
  ]
}

// ------------------------------------------------------------------ timeline

export type TimelineDay = { day: string; trades: number; pnl: number; r: number | null; confidence: number | null; stress: number | null; emotion: string | null; clean: number | null; ids: number[] }

export function timeline(trades: EdgeTrade[], checkins: DayCheckin[] = [], days = 60): TimelineDay[] {
  const byDay = new Map<string, EdgeTrade[]>()
  for (const t of trades) byDay.set(t.day, [...(byDay.get(t.day) ?? []), t])
  const notes = new Map<string, DayCheckin[]>()
  for (const c of checkins) notes.set(c.day, [...(notes.get(c.day) ?? []), c])
  const all = [...new Set([...byDay.keys(), ...notes.keys()])].sort().slice(-days)
  return all.map((day) => {
    const list = byDay.get(day) ?? []
    const day_ = notes.get(day) ?? []
    const pick = (f: (x: { confidence: number | null; stress: number | null }) => number | null) => {
      const xs = [...list.map((t) => (t.psych ? f({ confidence: t.psych.confidenceBefore, stress: t.psych.stressBefore }) : null)), ...day_.map(f)].filter((v): v is number => v != null)
      return xs.length ? Math.round(avg(xs) * 10) / 10 : null
    }
    const moods = [...list.map((t) => t.psych?.emotionBefore), ...day_.map((c) => c.emotion)].filter((e): e is string => !!e)
    const counts = new Map<string, number>()
    for (const m of moods) counts.set(m, (counts.get(m) ?? 0) + 1)
    const rs = list.map((t) => t.r).filter((r): r is number => r != null)
    return {
      day,
      trades: list.length,
      pnl: list.reduce((s, t) => s + t.pnl, 0),
      r: rs.length && rs.length >= list.length * 0.6 ? rs.reduce((a, c) => a + c, 0) : null,
      confidence: pick((x) => x.confidence),
      stress: pick((x) => x.stress),
      emotion: [...counts.entries()].sort((a, c) => c[1] - a[1])[0]?.[0] ?? null,
      clean: list.length ? Math.round((list.filter((t) => t.mistakes.length === 0 && !said.planBroken(t)).length / list.length) * 100) : null,
      ids: list.map((t) => t.id),
    }
  })
}

// ------------------------------------------------------------------ this week against last week

const DAY = 86_400_000
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`)
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)
// The Monday of the week a day is in.
export const weekStart = (day: string) => {
  const ms = dayMs(day)
  return dayOf(ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY)
}

export type WeekLine = { key: string; label: string; now: number | null; before: number | null; unit: "score" | "count" | "/10"; better: "up" | "down" }
export type WeeklyReport = {
  from: string
  to: string
  trades: number
  lines: WeekLine[]
  improvement: { text: string; detail: string | null } | null
  problem: { text: string; detail: string | null } | null
}

export function weeklyReport(trades: EdgeTrade[], checkins: DayCheckin[], today: string): WeeklyReport {
  const start = weekStart(today)
  const prev = dayOf(dayMs(start) - 7 * DAY)
  const end = dayOf(dayMs(start) + 6 * DAY)
  const inWeek = (from: string) => (d: string) => d >= from && d < dayOf(dayMs(from) + 7 * DAY)
  const b = behaviours(trades)
  const week = (from: string) => {
    const mine = trades.filter((t) => inWeek(from)(t.openDay))
    const s = scores(mine, checkins.filter((c) => inWeek(from)(c.day)))
    const revenge = mine.filter((t) => said.revenge(t) || (b.get(t.id)!.reentryMin ?? Infinity) <= REENTRY_MINUTES)
    const early = mine.filter((t) => b.get(t.id)!.earlyExit != null)
    return { mine, s, fomo: mine.filter(said.fomo).length, revenge, early: early.length >= MIN_CELL ? early.filter((t) => b.get(t.id)!.earlyExit).length / early.length : null, breaks: mine.filter(said.planBroken).length }
  }
  const now = week(start)
  const before = week(prev)
  const lines: WeekLine[] = [
    { key: "psychology", label: "Psychology score", now: now.s.psychology, before: before.s.psychology, unit: "score", better: "up" },
    { key: "discipline", label: "Discipline", now: now.s.discipline, before: before.s.discipline, unit: "score", better: "up" },
    { key: "confidence", label: "Confidence", now: now.s.confidence, before: before.s.confidence, unit: "score", better: "up" },
    { key: "stress", label: "Stress", now: now.s.stress, before: before.s.stress, unit: "/10", better: "down" },
    { key: "fomo", label: "FOMO entries", now: now.mine.length ? now.fomo : null, before: before.mine.length ? before.fomo : null, unit: "count", better: "down" },
    { key: "revenge", label: "Revenge trades", now: now.mine.length ? now.revenge.length : null, before: before.mine.length ? before.revenge.length : null, unit: "count", better: "down" },
    { key: "breaks", label: "Plan breaks", now: now.mine.length ? now.breaks : null, before: before.mine.length ? before.breaks : null, unit: "count", better: "down" },
  ]

  // The count that fell the most, and what those trades had been costing.
  let improvement: WeeklyReport["improvement"] = null
  const falls = lines.filter((l) => l.unit === "count" && l.now != null && l.before != null && l.before - l.now > 0).sort((x, y) => y.before! - y.now! - (x.before! - x.now!))
  if (falls.length) {
    const l = falls[0]
    const cost = l.key === "revenge" && before.revenge.length ? measure(before.revenge).expectancy : null
    improvement = { text: `${l.label}: ${l.before} → ${l.now}`, detail: cost != null && cost < 0 ? `Estimated avoided loss: ${fmtMoney(-cost * (l.before! - l.now!))} (what those trades averaged last week).` : null }
  }
  // The worst thing this week.
  let problem: WeeklyReport["problem"] = null
  if (now.early != null && now.early >= 0.3) problem = { text: "Early exits", detail: `${fmtPct(now.early, 0)} of winning trades with a target were closed before reaching it.` }
  else {
    const rises = lines.filter((l) => l.unit === "count" && l.now != null && l.now > 0).sort((x, y) => y.now! - x.now!)
    if (rises.length) problem = { text: rises[0].label, detail: `${rises[0].now} this week${rises[0].before != null ? `, ${rises[0].before} last week` : ""}.` }
  }
  return { from: start, to: end, trades: now.mine.length, lines, improvement, problem }
}

// ------------------------------------------------------------------ tilt, right now

export type Tilt = { score: number; level: "low" | "elevated" | "high"; factors: { key: string; label: string; value: number; note: string }[]; trades: number } | null

// How today is going, from today's trades and the latest check-in. Advisory only.
export function tiltRisk(trades: EdgeTrade[], today: string, latestStress: number | null = null): Tilt {
  const mine = trades.filter((t) => t.openDay === today)
  if (!mine.length) return null
  const b = behaviours(trades)
  const perDay = new Map<string, number>()
  for (const t of trades) if (t.openDay !== today) perDay.set(t.openDay, (perDay.get(t.openDay) ?? 0) + 1)
  const usual = median([...perDay.values()]) || 2
  const last = mine[mine.length - 1]
  const lb = b.get(last.id)!
  // losses in a row, counting the last trade itself
  let streak = 0
  for (let i = mine.length - 1; i >= 0 && mine[i].pnl < 0; i--) streak++
  const ratio = lb.riskRatio
  const broken = mine.filter((t) => t.mistakes.length > 0 || said.planBroken(t)).length
  const factors = [
    { key: "losses", label: "Losses in a row", value: clamp(streak * 34), note: streak ? `${streak} in a row` : "none" },
    { key: "frequency", label: "Trade frequency", value: clamp(((mine.length / usual - 1) / 1.5) * 100), note: `${mine.length} today, usually ${Math.round(usual)}` },
    ...(ratio != null ? [{ key: "risk", label: "Risk increase", value: clamp(((ratio - 1) / 1) * 100), note: `${ratio.toFixed(2)}× your usual` }] : []),
    { key: "rules", label: "Rule violations", value: clamp((broken / mine.length) * 200), note: `${broken} of ${mine.length} trades` },
    ...(latestStress != null ? [{ key: "stress", label: "Stress", value: clamp(latestStress * 10), note: `${latestStress}/10 at your last check-in` }] : []),
  ]
  // the two strongest signals decide it: one loud signal is enough to matter
  const top = [...factors].sort((x, y) => y.value - x.value).slice(0, 2)
  const score = Math.round(avg(top.map((f) => f.value)) * 0.7 + avg(factors.map((f) => f.value)) * 0.3)
  return { score, level: score >= 65 ? "high" : score >= 35 ? "elevated" : "low", factors, trades: mine.length }
}

// ------------------------------------------------------------------ challenges

export type ChallengeView = { key: ChallengeKey; title: string; description: string; days: number; clean: number; broken: { day: string; why: string } | null; done: boolean; measurable: boolean }

// A challenge counts the trading days since it began that were clean, and stops
// at the first one that wasn't.
export function challengeProgress(key: ChallengeKey, startedDay: string, trades: EdgeTrade[], today: string): ChallengeView {
  const def = CHALLENGES.find((c) => c.key === key)!
  const b = behaviours(trades)
  const typical = median(trades.map((t) => t.risk).filter((r): r is number => r != null))
  const since = trades.filter((t) => t.openDay >= startedDay && t.openDay <= today)
  const tests: Record<ChallengeKey, [(t: EdgeTrade) => boolean, string, boolean]> = {
    no_revenge: [(t) => said.revenge(t) || (b.get(t.id)!.reentryMin ?? Infinity) <= REENTRY_MINUTES, `a trade within ${REENTRY_MINUTES} minutes of a loss`, true],
    no_fomo: [(t) => said.fomo(t), "a trade marked as FOMO", since.some((t) => t.psych) || trades.some((t) => t.psych)],
    never_move_stop: [(t) => said.movedStop(t), "a moved stop", trades.some((t) => t.psych)],
    follow_plan: [(t) => said.planBroken(t), "a trade off the plan", trades.some((t) => t.psych)],
    stop_after_daily_loss: [(t) => b.get(t.id)!.lossStreak >= 2, "a trade after two losses that day", true],
    respect_risk: [(t) => t.risk != null && typical > 0 && t.risk > typical * OVERSIZE, "a trade risking more than usual", typical > 0],
  }
  const [bad, why, measurable] = tests[key]
  const daysTraded = [...new Set(since.map((t) => t.openDay))].sort()
  let clean = 0
  let broken: ChallengeView["broken"] = null
  for (const day of daysTraded) {
    if (since.some((t) => t.openDay === day && bad(t))) {
      broken = { day, why }
      break
    }
    clean++
  }
  return { key, title: def.title, description: def.description, days: def.days, clean: Math.min(clean, def.days), broken, done: !broken && clean >= def.days, measurable }
}

// ------------------------------------------------------------------ the coach's facts

export type CoachNote = {
  key: string
  title: string
  // what the trades show — figures only
  observed: string[]
  // how two things moved together
  correlation: string | null
  // a possible explanation, marked as one
  hypothesis: string | null
  recommendation: string | null
  // something to try for a set number of trades
  experiment: { name: string; rule: string; trades: number } | null
  n: number
}

// What the data says about how state of mind and results move together — the
// material the coach speaks from. Every sentence is a figure from the trades;
// anything that would be a reason is marked as a hypothesis.
export function coachNotes(trades: EdgeTrade[]): CoachNote[] {
  const notes: CoachNote[] = []
  if (trades.length < MIN_PATTERN) return notes
  const b = behaviours(trades)
  const unit = (s: Stats) => (s.expR != null ? fmtR(s.expR) : fmtMoney(s.expectancy))

  // Confidence: the middle of the scale against the top of it.
  const conf = breakdown(trades, "confidence", 8)
  const high = conf.find((r) => r.value.startsWith("High"))
  const max = conf.find((r) => r.value.startsWith("Maximum"))
  if (high && max) {
    const riskOf = (label: string) => median(trades.filter((t) => t.dims.confidence === label && b.get(t.id)!.riskRatio != null).map((t) => b.get(t.id)!.riskRatio!))
    const rh = riskOf(high.value)
    const rm = riskOf(max.value)
    const more = rh > 0 && rm > 0 ? rm / rh - 1 : null
    const lower = perTrade(max.stats) < perTrade(high.stats)
    notes.push({
      key: "confidence",
      title: "Your results change with your confidence",
      observed: [`When confidence is 7–9: ${unit(high.stats)} expectancy (n=${high.stats.n}).`, `When confidence is 10: ${unit(max.stats)} expectancy (n=${max.stats.n}).`, ...(more != null && Math.abs(more) >= 0.1 ? [`Your risk is ${Math.round(Math.abs(more) * 100)}% ${more > 0 ? "larger" : "smaller"} when confidence is 10.`] : [])],
      correlation: lower ? "Maximum confidence has gone with lower expectancy." : "Maximum confidence has not gone with lower expectancy.",
      hypothesis: lower && more != null && more >= 0.1 ? "The larger risk at maximum confidence may be what lowers the result — not the confidence itself." : null,
      recommendation: lower ? "Keep your risk unchanged whatever your confidence." : null,
      experiment: lower ? { name: "Same risk at any confidence", rule: "Keep risk at your usual size during the next 20 trades, whatever the confidence.", trades: 20 } : null,
      n: high.stats.n + max.stats.n,
    })
  }

  // Stress.
  const stress = breakdown(trades, "stress", 8)
  const low = stress.find((r) => r.value.startsWith("Low"))
  const hi = stress.find((r) => r.value.startsWith("High"))
  if (low && hi) {
    const worse = perTrade(hi.stats) < perTrade(low.stats)
    notes.push({
      key: "stress",
      title: worse ? "High stress goes with weaker trades" : "Stress hasn't changed your results",
      observed: [`Stress 1–3: ${unit(low.stats)} expectancy (n=${low.stats.n}).`, `Stress 7–10: ${unit(hi.stats)} expectancy (n=${hi.stats.n}).`],
      correlation: worse ? "Higher stress before a trade has gone with a lower result." : null,
      hypothesis: null,
      recommendation: worse ? "When stress is 7 or more at check-in, halve your risk or skip the trade." : null,
      experiment: worse ? { name: "Half risk under stress", rule: "Halve your risk when stress is 7 or more, for the next 20 trades.", trades: 20 } : null,
      n: low.stats.n + hi.stats.n,
    })
  }

  // Following the plan.
  const plan = breakdown(trades, "plan", 8)
  const kept = plan.find((r) => r.value === "Followed the plan")
  const broke = plan.find((r) => r.value === "Broke the plan")
  if (kept && broke) {
    notes.push({
      key: "plan",
      title: "Following the plan, in numbers",
      observed: [`Followed the plan: ${unit(kept.stats)} expectancy (n=${kept.stats.n}).`, `Broke the plan: ${unit(broke.stats)} expectancy (n=${broke.stats.n}).`],
      correlation: perTrade(kept.stats) > perTrade(broke.stats) ? "Trades on the plan have done better than trades off it." : "Trades off the plan have not done worse — the plan itself may need reviewing.",
      hypothesis: null,
      recommendation: perTrade(kept.stats) > perTrade(broke.stats) ? "Take only trades that are on the plan." : null,
      experiment: null,
      n: kept.stats.n + broke.stats.n,
    })
  }

  // The trade after a loss.
  const quick = trades.filter((t) => (b.get(t.id)!.reentryMin ?? Infinity) <= REENTRY_MINUTES)
  const rest = trades.filter((t) => !quick.includes(t))
  if (quick.length >= 8 && rest.length >= MIN_PATTERN) {
    const v = versus(quick, rest)
    if (v.worse) {
      notes.push({
        key: "reentry",
        title: "The trade straight after a loss",
        observed: [`Trades opened within ${REENTRY_MINUTES} minutes of a loss: ${per(v.a, v.unit)} expectancy (n=${v.a.n}).`, `All your other trades: ${per(v.b, v.unit)} (n=${v.b.n}).`],
        correlation: "A quick re-entry after a loss has gone with a lower result.",
        hypothesis: "These may be trades taken to win the loss back rather than on a setup.",
        recommendation: `Wait ${REENTRY_MINUTES} minutes after a loss before the next trade.`,
        experiment: { name: "Cool-off after a loss", rule: `No new trade for ${REENTRY_MINUTES} minutes after a loss, for the next 20 trades.`, trades: 20 },
        n: v.a.n,
      })
    }
  }
  return notes
}

// ------------------------------------------------------------------ the day's brief

export type Brief = { yesterday: { day: string; trades: number; clean: number | null; pnl: number } | null; reminders: string[] }

// The morning check-in's reminders: what yesterday was like, and which of the
// trader's own patterns to watch for today.
export function dailyBrief(trades: EdgeTrade[], today: string): Brief {
  const earlier = [...new Set(trades.map((t) => t.day).filter((d) => d < today))].sort()
  const last = earlier[earlier.length - 1]
  const list = last ? trades.filter((t) => t.day === last) : []
  const reminders: string[] = []
  for (const p of patterns(trades)) {
    if (p.state !== "detected") continue
    if (p.key === "revenge") reminders.push("Watch for revenge trading after your first loss.")
    else if (p.key === "after_losses") reminders.push("Two losses in a row is your signal to stop for the day.")
    else if (p.key === "overtrading") reminders.push(p.rule ?? "Keep to your usual number of trades.")
    else if (p.key === "early_exit") reminders.push("Let winners reach their target.")
    else if (p.key === "risk_after_wins") reminders.push("Keep your risk the same if you start the day with wins.")
    else if (p.key === "risk_after_losses") reminders.push("Keep your risk the same after a loss.")
    else if (p.rule) reminders.push(p.rule)
    if (reminders.length >= 3) break
  }
  return { yesterday: last ? { day: last, trades: list.length, clean: list.length ? Math.round((list.filter((t) => t.mistakes.length === 0 && !said.planBroken(t)).length / list.length) * 100) : null, pnl: list.reduce((s, t) => s + t.pnl, 0) } : null, reminders }
}
