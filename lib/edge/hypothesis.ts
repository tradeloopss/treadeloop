import { DIM_BY_ID, MIN_CELL, MIN_PATTERN, MIN_SUPPORTED, conditionEntries, confidenceOfDifference, dimValues, fmtPct, fmtPf, fmtR, fmtMoney, measure, outcomes, select, type Conditions, type DimId, type EdgeTrade, type Stats } from "./core"
import { perTrade } from "./discover"

// Edge Lab's analysis engine, part three: testing an idea. "EURUSD does better
// in London when I'm long" → the trades that fit against the ones that don't,
// how sure the difference is, whether it held up in the most recent trades,
// and what else could explain it. The verdict is deliberately hard to earn.

export type Verdict = "supported" | "not_supported" | "inconclusive"

export type HypothesisResult = {
  conditions: Conditions
  verdict: Verdict
  // why the verdict is what it is, in one sentence
  summary: string
  unit: "R" | "$"
  condition: Stats
  // every other trade
  baseline: Stats
  // (condition − baseline) / |baseline|, when the baseline isn't ~zero
  difference: number | null
  // 0..1: how sure the data is that the two really differ in the direction seen
  confidence: number | null
  // the latest 30% of the matching trades, on their own
  outOfSample: Stats | null
  evidenceFor: string[]
  evidenceAgainst: string[]
  confounders: string[]
}

const per = (s: Stats, unit: "R" | "$") => (unit === "R" ? fmtR(s.expR ?? 0) : fmtMoney(s.expectancy))

export function testHypothesis(trades: EdgeTrade[], conditions: Conditions): HypothesisResult {
  const inside = select(trades, conditions)
  const ids = new Set(inside.map((t) => t.id))
  const outside = trades.filter((t) => !ids.has(t.id))
  const a = measure(inside)
  const b = measure(outside)
  const oa = outcomes(inside)
  const ob = outcomes(outside)
  // compare like with like: R only when both sides have it
  const unit: "R" | "$" = oa.unit === "R" && ob.unit === "R" ? "R" : "$"
  const va = unit === "R" ? oa.values : inside.map((t) => t.pnl)
  const vb = unit === "R" ? ob.values : outside.map((t) => t.pnl)
  const test = confidenceOfDifference(va, vb)
  const ea = unit === "R" ? (a.expR ?? 0) : a.expectancy
  const eb = unit === "R" ? (b.expR ?? 0) : b.expectancy
  const better = ea > eb
  const cut = Math.floor(inside.length * 0.7)
  const oosTrades = inside.slice(cut)
  const oos = oosTrades.length >= 8 ? measure(oosTrades) : null
  const oosValue = oos ? (unit === "R" ? (oos.expR ?? oos.expectancy) : oos.expectancy) : null
  const confidence = test ? test.confidence : null

  let verdict: Verdict = "inconclusive"
  let summary: string
  if (a.n < MIN_PATTERN) summary = `Only ${a.n} trades match — ${MIN_PATTERN} are needed before this can be judged.`
  else if (b.n < MIN_PATTERN) summary = `Almost every trade matches these conditions, so there is nothing to compare them with.`
  else if (better && confidence != null && confidence >= 0.95 && a.n >= MIN_SUPPORTED && ea > 0 && (oosValue == null || oosValue > 0)) {
    verdict = "supported"
    summary = `The matching trades did better, the difference is unlikely to be chance (${Math.round(confidence * 100)}% confidence)${oos ? ", and it held up in the most recent trades" : ""}.`
  } else if (!better && confidence != null && confidence >= 0.8) {
    verdict = "not_supported"
    summary = `The matching trades did worse than the rest (${Math.round(confidence * 100)}% confidence).`
  } else if (!better) {
    verdict = "not_supported"
    summary = "The matching trades did no better than the rest."
  } else if (oosValue != null && oosValue <= 0) summary = "The matching trades did better overall, but lost money in the most recent ones — it may have stopped working."
  else if (ea <= 0) summary = "The matching trades did better than the rest, but still lost money on average."
  else summary = `The matching trades did better, but the difference could still be chance (${confidence != null ? Math.round(confidence * 100) : "—"}% confidence; 95% is needed).`

  const evidenceFor: string[] = []
  const evidenceAgainst: string[] = []
  if (a.n >= MIN_CELL) {
    if (better) evidenceFor.push(`Expectancy ${per(a, unit)} per trade, against ${per(b, unit)} for all other trades.`)
    else evidenceAgainst.push(`Expectancy ${per(a, unit)} per trade, against ${per(b, unit)} for all other trades.`)
    if (a.pf != null && b.pf != null) (a.pf > b.pf ? evidenceFor : evidenceAgainst).push(`Profit factor ${fmtPf(a)} against ${fmtPf(b)}.`)
    if (Math.abs(a.winRate - b.winRate) >= 0.03) (a.winRate > b.winRate ? evidenceFor : evidenceAgainst).push(`Win rate ${fmtPct(a.winRate)} against ${fmtPct(b.winRate)}.`)
    if (a.months >= 3) (a.posMonths / a.months >= 0.6 ? evidenceFor : evidenceAgainst).push(`Profitable in ${a.posMonths} of ${a.months} months.`)
    if (oos) (oosValue! > 0 ? evidenceFor : evidenceAgainst).push(`The latest ${oos.n} matching trades, on their own: ${per(oos, unit)} per trade.`)
    if (a.n < MIN_SUPPORTED) evidenceAgainst.push(`Only ${a.n} matching trades — a small sample.`)
    if (a.topWinShare >= 0.3 && a.wins >= 3) evidenceAgainst.push(`One trade made ${Math.round(a.topWinShare * 100)}% of the profit — the result leans on an outlier.`)
    if (confidence != null && confidence < 0.95 && better) evidenceAgainst.push(`${Math.round(confidence * 100)}% confidence that the difference is real; under the 95% used here.`)
  }

  return { conditions, verdict, summary, unit, condition: a, baseline: b, difference: Math.abs(eb) > 1e-9 ? (ea - eb) / Math.abs(eb) : null, confidence, outOfSample: oos, evidenceFor, evidenceAgainst, confounders: confounders(inside, outside, conditions) }
}

// Other things the matching trades have in common, which could be the real
// reason: "82% of them are EURUSD (31% of the rest) — and EURUSD does better anyway."
export function confounders(inside: EdgeTrade[], outside: EdgeTrade[], conditions: Conditions): string[] {
  if (inside.length < MIN_PATTERN || outside.length < MIN_PATTERN) return []
  const used = new Set(conditionEntries(conditions).map(([d]) => d))
  const found: { text: string; gap: number }[] = []
  const all = [...inside, ...outside]
  for (const dim of ["symbol", "session", "side", "weekday", "setup", "strategy", "hold", "trend", "volatility", "after"] as DimId[]) {
    if (used.has(dim)) continue
    const outsideShare = new Map(dimValues(outside, dim).map((v) => [v.value, v.n / outside.length]))
    for (const v of dimValues(inside, dim)) {
      const share = v.n / inside.length
      const other = outsideShare.get(v.value) ?? 0
      if (share < 0.5 || share - other < 0.25) continue
      const withIt = measure(select(all, { [dim]: v.value }))
      const without = measure(all.filter((t) => (dim === "setup" ? !t.setups.includes(v.value) : t.dims[dim] !== v.value)))
      const helps = withIt.n >= MIN_PATTERN && without.n >= MIN_PATTERN && perTrade(withIt) > perTrade(without)
      found.push({
        gap: share - other,
        text: `${Math.round(share * 100)}% of the matching trades are ${v.value} (${Math.round(other * 100)}% of the rest)${helps ? ` — and ${v.value} trades do better on their own, so part of the effect may come from ${DIM_BY_ID[dim].label.toLowerCase()}` : ""}.`,
      })
    }
  }
  return found.sort((a, b) => b.gap - a.gap).slice(0, 4).map((f) => f.text)
}

// ------------------------------------------------------------------ A against B

export type Comparison = {
  a: { conditions: Conditions; stats: Stats }
  b: { conditions: Conditions; stats: Stats }
  unit: "R" | "$"
  // null = no clear difference
  winner: "a" | "b" | null
  confidence: number | null
  summary: string
  // trades that are in both, and so compared with themselves
  overlap: number
}

// Two slices side by side ("planned 2R+" against "planned under 2R").
export function compare(trades: EdgeTrade[], condA: Conditions, condB: Conditions): Comparison {
  const ta = select(trades, condA)
  const tb = select(trades, condB)
  const idsA = new Set(ta.map((t) => t.id))
  const overlap = tb.filter((t) => idsA.has(t.id)).length
  const a = measure(ta)
  const b = measure(tb)
  const oa = outcomes(ta)
  const ob = outcomes(tb)
  const unit: "R" | "$" = oa.unit === "R" && ob.unit === "R" ? "R" : "$"
  const test = confidenceOfDifference(unit === "R" ? oa.values : ta.map((t) => t.pnl), unit === "R" ? ob.values : tb.map((t) => t.pnl))
  const confidence = test ? test.confidence : null
  let winner: Comparison["winner"] = null
  let summary: string
  if (a.n < MIN_PATTERN || b.n < MIN_PATTERN) summary = `Not enough data yet — each side needs ${MIN_PATTERN} trades (A has ${a.n}, B has ${b.n}).`
  else if (!test || confidence! < 0.8) summary = "No clear difference: the gap between the two could easily be chance."
  else {
    winner = test.direction > 0 ? "a" : "b"
    summary = `${winner === "a" ? "A" : "B"} appears stronger in historical data (${Math.round(confidence! * 100)}% confidence). That describes the past — it doesn't guarantee the same in future trades.`
  }
  return { a: { conditions: condA, stats: a }, b: { conditions: condB, stats: b }, unit, winner, confidence, summary, overlap }
}
