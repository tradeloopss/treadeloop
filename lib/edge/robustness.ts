import { MIN_PATTERN, measure, outcomes, type EdgeTrade, type Stats } from "./core"

// Edge Lab's analysis engine, part four: how much of a result is luck.
//
// Monte Carlo — the trader's own results, drawn again in a random order,
// thousands of times: what the good runs, the ordinary runs and the bad runs
// look like. It is a statistical simulation of the past, not a forecast.
//
// Walk-forward — the history cut into an earlier part and a later part: does
// what worked early still work later, or did it only fit the period it was
// found in?

// A small seeded generator, so the same inputs draw the same runs (and a test can check them).
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type MonteCarloInput = {
  // one result per trade, in R or in dollars
  outcomes: number[]
  simulations: number
  // trades per simulated run
  trades: number
  // the fall from the start that counts as ruin, in the same unit (20 = 20R, or $20)
  ruin?: number | null
  seed?: number
}

export type MonteCarloResult = {
  simulations: number
  trades: number
  // final result of a run, at these percentiles
  median: number
  p10: number
  p5: number
  p1: number
  p90: number
  // worst peak-to-trough fall within a run
  ddMedian: number
  dd95: number
  ddWorst: number
  // longest run of losing trades
  streakMedian: number
  streak95: number
  // share of runs that ended below where they started
  lossProbability: number
  // share of runs that fell `ruin` below the start at any point; null when no level was given
  ruinProbability: number | null
  // the path of the run at each percentile, for the chart
  bands: { i: number; p5: number; p25: number; p50: number; p75: number; p95: number }[]
  histogram: { from: number; to: number; n: number }[]
}

const pct = (sorted: number[] | Float64Array, p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))]

// Draws `simulations` runs of `trades` results, with replacement.
export function monteCarlo(input: MonteCarloInput): MonteCarloResult | null {
  const src = input.outcomes.filter((v) => Number.isFinite(v))
  if (src.length < MIN_PATTERN) return null
  const sims = Math.max(100, Math.min(50_000, Math.floor(input.simulations)))
  const len = Math.max(10, Math.min(2_000, Math.floor(input.trades)))
  const next = rng(input.seed ?? 1)
  const finals = new Float64Array(sims)
  const dds = new Float64Array(sims)
  const streaks = new Float64Array(sims)
  // the running total at ~60 checkpoints of every run, for the percentile bands
  const points = Math.min(60, len)
  const at = Array.from({ length: points }, (_, k) => Math.round(((k + 1) * len) / points) - 1)
  const paths = at.map(() => new Float64Array(sims))
  const ruin = input.ruin != null && input.ruin > 0 ? input.ruin : null
  let losing = 0
  let ruined = 0
  for (let s = 0; s < sims; s++) {
    let equity = 0
    let peak = 0
    let dd = 0
    let streak = 0
    let worst = 0
    let hitRuin = false
    let cp = 0
    for (let i = 0; i < len; i++) {
      const v = src[(next() * src.length) | 0]
      equity += v
      if (equity > peak) peak = equity
      if (peak - equity > dd) dd = peak - equity
      if (v < 0) {
        streak++
        if (streak > worst) worst = streak
      } else streak = 0
      if (ruin != null && equity <= -ruin) hitRuin = true
      if (i === at[cp]) paths[cp++][s] = equity
    }
    finals[s] = equity
    dds[s] = dd
    streaks[s] = worst
    if (equity < 0) losing++
    if (hitRuin) ruined++
  }
  const f = Float64Array.from(finals).sort()
  const d = Float64Array.from(dds).sort()
  const k = Float64Array.from(streaks).sort()
  const bands = paths.map((col, i) => {
    const c = col.sort()
    return { i: at[i] + 1, p5: pct(c, 0.05), p25: pct(c, 0.25), p50: pct(c, 0.5), p75: pct(c, 0.75), p95: pct(c, 0.95) }
  })
  const lo = f[0]
  const hi = f[f.length - 1]
  const bins = 24
  const width = (hi - lo) / bins || 1
  const histogram = Array.from({ length: bins }, (_, i) => ({ from: lo + i * width, to: lo + (i + 1) * width, n: 0 }))
  for (const v of f) histogram[Math.min(bins - 1, Math.floor((v - lo) / width))].n++
  return {
    simulations: sims,
    trades: len,
    median: pct(f, 0.5),
    p10: pct(f, 0.1),
    p5: pct(f, 0.05),
    p1: pct(f, 0.01),
    p90: pct(f, 0.9),
    ddMedian: pct(d, 0.5),
    dd95: pct(d, 0.95),
    ddWorst: d[d.length - 1],
    streakMedian: pct(k, 0.5),
    streak95: pct(k, 0.95),
    lossProbability: losing / sims,
    ruinProbability: ruin != null ? ruined / sims : null,
    bands: [{ i: 0, p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 }, ...bands],
    histogram,
  }
}

// ------------------------------------------------------------------ walk-forward

export type Segment = { key: "training" | "validation" | "out_of_sample"; label: string; from: number | null; to: number | null; stats: Stats }
export type WalkForward = {
  segments: Segment[]
  unit: "R" | "$"
  // out-of-sample result per trade as a share of the training result, 0..100; null when it can't be said
  robustness: number | null
  verdict: "holds" | "weaker" | "broke" | "insufficient"
  summary: string
  // the history in equal slices, oldest first: is it getting better or worse?
  folds: { label: string; from: number; to: number; stats: Stats }[]
}

const value = (s: Stats, unit: "R" | "$") => (unit === "R" ? (s.expR ?? 0) : s.expectancy)

// The first 60% of the history is where the edge was "found", the next 20%
// checks it, the last 20% is the trades it had never seen.
export function walkForward(trades: EdgeTrade[], split: [number, number] = [0.6, 0.2], folds = 6): WalkForward {
  const n = trades.length
  const unit = outcomes(trades).unit
  const a = Math.floor(n * split[0])
  const b = Math.floor(n * (split[0] + split[1]))
  const cut = (list: EdgeTrade[], key: Segment["key"], label: string): Segment => ({ key, label, from: list[0]?.entry ?? null, to: list[list.length - 1]?.entry ?? null, stats: measure(list) })
  const segments = [cut(trades.slice(0, a), "training", "Training"), cut(trades.slice(a, b), "validation", "Validation"), cut(trades.slice(b), "out_of_sample", "Out of sample")]
  const size = Math.max(1, Math.floor(n / folds))
  const slices = n >= folds * 5 ? Array.from({ length: folds }, (_, i) => trades.slice(i * size, i === folds - 1 ? n : (i + 1) * size)) : []
  const foldRows = slices.map((list, i) => ({ label: `${i + 1}`, from: list[0].entry, to: list[list.length - 1].entry, stats: measure(list) }))

  const train = segments[0].stats
  const oos = segments[2].stats
  if (train.n < MIN_PATTERN || oos.n < 8) return { segments, unit, robustness: null, verdict: "insufficient", summary: `Not enough data yet: this needs about ${Math.ceil(MIN_PATTERN / split[0])} trades, and there are ${n}.`, folds: foldRows }
  const tv = value(train, unit)
  const ov = value(oos, unit)
  if (tv <= 0) return { segments, unit, robustness: null, verdict: "insufficient", summary: "The early part of the history wasn't profitable, so there is no edge here to test going forward.", folds: foldRows }
  const robustness = Math.round(Math.max(0, Math.min(1.2, ov / tv)) * 100)
  const verdict: WalkForward["verdict"] = ov <= 0 ? "broke" : robustness >= 70 ? "holds" : "weaker"
  const summary =
    verdict === "holds"
      ? "The later trades did about as well as the earlier ones: no sign that the result only fitted the period it was found in."
      : verdict === "weaker"
        ? "The later trades were still profitable, but clearly weaker than the earlier ones. Part of the earlier result may have been favourable conditions."
        : "The later trades lost money. What worked in the earlier period has not carried forward — a sign of over-fitting, or of a market that changed."
  return { segments, unit, robustness, verdict, summary, folds: foldRows }
}
