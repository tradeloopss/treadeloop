import { DIM_BY_ID, HOLD_ORDER, MIN_CELL, MIN_PATTERN, RR_ORDER, SESSION_ORDER, WEEKDAY_ORDER, conditionEntries, conditionKey, conditionName, confidenceOfDifference, confidenceVsZero, dimValues, fmtMoney, fmtPct, fmtR, measure, outcomes, scoreEdge, select, type Conditions, type DimId, type EdgeScore, type EdgeTrade, type Stats } from "./core"

// Edge Lab's analysis engine, part two: finding things. Which combination of
// conditions has made the most, which has cost the most, and what is worth a
// trader's attention — each with the numbers it rests on.

// ------------------------------------------------------------------ breakdown

export type Row = { value: string; stats: Stats }

const ORDER: Partial<Record<DimId, string[]>> = { session: SESSION_ORDER, weekday: WEEKDAY_ORDER, hold: HOLD_ORDER, rr: RR_ORDER }

// One dimension, every value: how each did.
export function breakdown(trades: EdgeTrade[], dim: DimId, min = 1): Row[] {
  const groups = new Map<string, EdgeTrade[]>()
  for (const t of trades) {
    const values = dim === "setup" ? t.setups : dim === "mistake" ? t.mistakes : t.dims[dim] != null ? [t.dims[dim]!] : []
    for (const v of values) {
      const list = groups.get(v)
      if (list) list.push(t)
      else groups.set(v, [t])
    }
  }
  const rows = [...groups.entries()].filter(([, list]) => list.length >= min).map(([value, list]) => ({ value, stats: measure(list) }))
  const order = ORDER[dim]
  return order ? rows.sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value)) : rows.sort((a, b) => b.stats.n - a.stats.n)
}

// The slice's result per trade on one scale, whatever it is measured in.
export const perTrade = (s: Stats) => (s.expR != null ? s.expR : s.avgLoss < 0 ? s.expectancy / -s.avgLoss : 0)

// ------------------------------------------------------------------ the matrix

export type CellState = "strong-positive" | "positive" | "neutral" | "negative" | "strong-negative" | "empty"
export type Cell = { n: number; pf: number | null; expR: number | null; expectancy: number; winRate: number; net: number; state: CellState; thin: boolean }
export type Matrix = { rowDim: DimId; colDim: DimId; rows: string[]; cols: string[]; cells: Record<string, Cell>; rowTotals: Record<string, Cell>; colTotals: Record<string, Cell> }

export function cellState(s: Stats): CellState {
  if (s.n < MIN_CELL) return "empty"
  const pf = s.pf ?? (s.net > 0 ? 99 : 0)
  if (s.net > 0 && pf >= 1.8) return "strong-positive"
  if (s.net > 0 && pf >= 1.15) return "positive"
  if (pf >= 0.87) return "neutral"
  if (pf >= 0.6) return "negative"
  return "strong-negative"
}
const toCell = (s: Stats): Cell => ({ n: s.n, pf: s.pf, expR: s.expR, expectancy: s.expectancy, winRate: s.winRate, net: s.net, state: cellState(s), thin: s.n >= MIN_CELL && s.n < MIN_PATTERN })

// Rows × columns ("markets × sessions"): where the trading has worked and where it hasn't.
export function matrix(trades: EdgeTrade[], rowDim: DimId, colDim: DimId, maxRows = 8): Matrix {
  const rows = dimValues(trades, rowDim).slice(0, maxRows).map((v) => v.value)
  const present = dimValues(trades, colDim).map((v) => v.value)
  const order = ORDER[colDim]
  const cols = order ? order.filter((c) => present.includes(c)) : present.slice(0, 8)
  const cells: Record<string, Cell> = {}
  const rowTotals: Record<string, Cell> = {}
  const colTotals: Record<string, Cell> = {}
  for (const r of rows) {
    const inRow = select(trades, { [rowDim]: r })
    rowTotals[r] = toCell(measure(inRow))
    for (const c of cols) cells[`${r}|${c}`] = toCell(measure(select(inRow, { [colDim]: c })))
  }
  for (const c of cols) colTotals[c] = toCell(measure(select(trades, { [colDim]: c })))
  return { rowDim, colDim, rows, cols, cells, rowTotals, colTotals }
}

// ------------------------------------------------------------------ combinations

export type Candidate = { conditions: Conditions; name: string; stats: Stats; score: EdgeScore; lift: number | null }

// The dimensions worth combining when looking for an edge. Anything that
// describes the *result* (the grade, the mistake tagged afterwards) is left
// out: "trades I graded 5★ did well" is not something to trade on.
export const SEARCH_DIMS: DimId[] = ["symbol", "session", "side", "weekday", "setup", "strategy", "hold", "trend", "volatility", "after", "plan", "emotion"]

type Agg = { n: number; net: number; wins: number; rN: number; rSum: number }

// Every combination of up to `depth` conditions that at least `min` trades
// share, with its totals. One pass over the trades.
export function combinations(trades: EdgeTrade[], dims: DimId[] = SEARCH_DIMS, depth = 3, min = MIN_PATTERN): Map<string, { conditions: Conditions; agg: Agg }> {
  // Past a point the work is quadratic in nothing useful: go one level shallower on a very large log.
  const maxDepth = trades.length > 20_000 ? Math.min(depth, 2) : depth
  const all = new Map<string, { conditions: Conditions; agg: Agg }>()
  for (const t of trades) {
    const facts: [DimId, string][] = []
    for (const d of dims) {
      if (d === "setup") for (const s of t.setups) facts.push([d, s])
      else if (d === "mistake") for (const m of t.mistakes) facts.push([d, m])
      else if (t.dims[d] != null) facts.push([d, t.dims[d]!])
    }
    const add = (picked: [DimId, string][]) => {
      const conditions = Object.fromEntries(picked) as Conditions
      const key = conditionKey(conditions)
      let entry = all.get(key)
      if (!entry) {
        entry = { conditions, agg: { n: 0, net: 0, wins: 0, rN: 0, rSum: 0 } }
        all.set(key, entry)
      }
      const a = entry.agg
      a.n++
      a.net += t.pnl
      if (t.pnl > 0) a.wins++
      if (t.r != null) {
        a.rN++
        a.rSum += t.r
      }
    }
    const walk = (start: number, picked: [DimId, string][]) => {
      for (let i = start; i < facts.length; i++) {
        // one value per dimension in a combination
        if (picked.some(([d]) => d === facts[i][0])) continue
        const next = [...picked, facts[i]]
        add(next)
        if (next.length < maxDepth) walk(i + 1, next)
      }
    }
    walk(0, [])
  }
  for (const [key, entry] of all) if (entry.agg.n < min) all.delete(key)
  return all
}

function toCandidate(trades: EdgeTrade[], conditions: Conditions, baseline: Stats): Candidate {
  const slice = select(trades, conditions)
  const stats = measure(slice)
  const base = perTrade(baseline)
  const mine = perTrade(stats)
  return { conditions, name: conditionName(conditions), stats, score: scoreEdge(slice, stats), lift: base > 0 ? mine / base - 1 : null }
}

// The dimensions a trader would name an edge by, in the order they'd say them.
const NAMING: DimId[] = ["symbol", "session", "setup", "side", "strategy", "weekday"]

// Several combinations can describe exactly the same trades ("EURUSD + London"
// and "EURUSD + Breakout" when every London EURUSD trade was a breakout). They
// are one finding: it keeps the description a trader would use — the most of
// the naming dimensions, the least of anything else.
function sameTrades(list: Candidate[]): Candidate[] {
  const best = new Map<string, Candidate>()
  const rank = (c: Candidate) => {
    const dims = conditionEntries(c.conditions).map(([d]) => d)
    const named = dims.filter((d) => NAMING.includes(d)).length
    return named * 10 - (dims.length - named) * 3
  }
  for (const c of list) {
    const key = `${c.stats.n}|${c.stats.wins}|${Math.round(c.stats.net * 100)}`
    const held = best.get(key)
    if (!held || rank(c) > rank(held)) best.set(key, c)
  }
  return list.filter((c) => best.get(`${c.stats.n}|${c.stats.wins}|${Math.round(c.stats.net * 100)}`) === c)
}

// A more specific slice only earns its place if it isn't just a smaller copy of
// a broader one already listed.
function distinct(list: Candidate[], limit: number): Candidate[] {
  const out: Candidate[] = []
  for (const c of list) {
    const mine = conditionEntries(c.conditions)
    const dup = out.some((o) => {
      const theirs = conditionEntries(o.conditions)
      const shared = mine.filter(([d, v]) => o.conditions[d] === v).length
      return shared === Math.min(mine.length, theirs.length) && Math.min(c.stats.n, o.stats.n) / Math.max(c.stats.n, o.stats.n) > 0.8
    })
    if (!dup) out.push(c)
    if (out.length >= limit) break
  }
  return out
}

export type Search = { edges: Candidate[]; leaks: Candidate[]; examined: number }

// The strongest edges and the costliest leaks among every combination.
export function search(trades: EdgeTrade[], opts: { dims?: DimId[]; depth?: number; limit?: number } = {}): Search {
  const baseline = measure(trades)
  // four conditions deep on an ordinary log; shallower as it grows (the work grows much faster than the trades)
  const depth = opts.depth ?? (trades.length <= 6_000 ? 4 : 3)
  const combos = [...combinations(trades, opts.dims, depth).values()].filter((c) => c.agg.n < trades.length * 0.9)
  const limit = opts.limit ?? 12
  // Shortlist cheaply (total made / lost, tempered by how often it happened), then measure properly.
  const proxy = (c: { agg: Agg }) => c.agg.net * Math.min(1, Math.sqrt(c.agg.n / 60))
  const up = combos.filter((c) => c.agg.net > 0).sort((a, b) => proxy(b) - proxy(a)).slice(0, 120)
  const down = combos.filter((c) => c.agg.net < 0).sort((a, b) => proxy(a) - proxy(b)).slice(0, 80)
  const edges = up
    .map((c) => toCandidate(trades, c.conditions, baseline))
    .filter((c) => c.score.score != null && c.stats.expectancy > 0)
    // the best-scoring first; between equals, the one that makes more per trade
    .sort((a, b) => b.score.score! - a.score.score! || perTrade(b.stats) - perTrade(a.stats) || b.stats.n - a.stats.n)
  const leaks = down
    .map((c) => toCandidate(trades, c.conditions, baseline))
    // a leak has to be more than a bad run: the average loss has to be unlikely to be noise
    .filter((c) => c.stats.expectancy < 0 && (c.score.confidence ?? 1) <= 0.3)
    // the costliest first; between equals, the one that loses more per trade (the narrower description of the same loss)
    .sort((a, b) => a.stats.net - b.stats.net || perTrade(a.stats) - perTrade(b.stats))
  return { edges: distinct(sameTrades(edges), limit), leaks: distinct(sameTrades(leaks), limit), examined: combos.length }
}

// ------------------------------------------------------------------ discoveries

export type Discovery = {
  kind: "strong" | "leak" | "opportunity" | "consistency"
  title: string
  text: string
  // what it rests on
  n: number
  evidence: { label: string; value: string }[]
  // the slice to open
  conditions: Conditions
  action: "investigate" | "experiment" | "analysis"
  // how to read it
  basis: "Observed" | "Correlated" | "Statistically supported"
}

const moreThan = (a: number, b: number) => (b > 0 ? `${Math.round((a / b - 1) * 100)}%` : null)
const basisOf = (confidence: number | null | undefined, n: number): Discovery["basis"] => (confidence != null && confidence >= 0.95 && n >= 30 ? "Statistically supported" : confidence != null && confidence >= 0.8 ? "Correlated" : "Observed")

// What is worth the trader's attention, in plain sentences — each one computed
// from the trades, each one saying how many trades it rests on. Nothing is
// produced for a comparison without enough trades on both sides.
export function discoveries(trades: EdgeTrade[], limit = 8): Discovery[] {
  const out: Discovery[] = []
  const baseline = measure(trades)
  if (baseline.n < MIN_PATTERN) return out
  const unit = (s: Stats) => (s.expR != null ? fmtR(s.expR) : fmtMoney(s.expectancy))

  // Best against worst, for the dimensions a trader can actually choose.
  for (const dim of ["session", "side", "symbol", "setup", "hold", "trend", "volatility"] as DimId[]) {
    const rows = breakdown(trades, dim, MIN_PATTERN)
    if (rows.length < 2) continue
    const sorted = [...rows].sort((a, b) => perTrade(b.stats) - perTrade(a.stats))
    const best = sorted[0]
    const worst = sorted[sorted.length - 1]
    const label = DIM_BY_ID[dim].label.toLowerCase()
    const test = confidenceOfDifference(outcomes(select(trades, { [dim]: best.value })).values, outcomes(select(trades, { [dim]: worst.value })).values)
    if (perTrade(best.stats) > 0 && perTrade(best.stats) > perTrade(worst.stats) && test && test.confidence >= 0.75) {
      const pct = perTrade(worst.stats) > 0 ? moreThan(perTrade(best.stats), perTrade(worst.stats)) : null
      out.push({
        kind: "strong",
        title: "Strong pattern",
        text: pct ? `Your ${best.value} trades have a ${pct} higher expectancy than your ${worst.value} trades.` : `Your ${best.value} trades average ${unit(best.stats)} per trade; your ${worst.value} trades average ${unit(worst.stats)}.`,
        n: best.stats.n + worst.stats.n,
        evidence: [
          { label: best.value, value: `${unit(best.stats)} · n=${best.stats.n}` },
          { label: worst.value, value: `${unit(worst.stats)} · n=${worst.stats.n}` },
          { label: `Compared by ${label}`, value: `${Math.round(test.confidence * 100)}% confidence` },
        ],
        conditions: { [dim]: best.value },
        action: "investigate",
        basis: basisOf(test.confidence, Math.min(best.stats.n, worst.stats.n)),
      })
    }
  }

  // A day of the week that has lost money, recently and reliably.
  for (const row of breakdown(trades, "weekday", MIN_PATTERN)) {
    const slice = select(trades, { weekday: row.value })
    const sig = confidenceVsZero(outcomes(slice).values)
    if (row.stats.expectancy < 0 && sig && sig.direction < 0 && sig.confidence >= 0.8) {
      out.push({
        kind: "leak",
        title: "Performance leak",
        text: `${row.value} trades have produced negative expectancy over your last ${row.stats.n} ${row.value} trades.`,
        n: row.stats.n,
        evidence: [
          { label: "Expectancy", value: unit(row.stats) },
          { label: "Net result", value: fmtMoney(row.stats.net) },
          { label: "Win rate", value: fmtPct(row.stats.winRate) },
        ],
        conditions: { weekday: row.value },
        action: "investigate",
        basis: basisOf(sig.confidence, row.stats.n),
      })
    }
  }

  // Bigger planned targets against smaller ones.
  const rr = breakdown(trades, "rr", MIN_PATTERN)
  const small = rr.filter((r) => r.value === RR_ORDER[0] || r.value === RR_ORDER[1])
  const large = rr.filter((r) => r.value === RR_ORDER[2] || r.value === RR_ORDER[3])
  if (small.length && large.length) {
    const a = select(trades, {}).filter((t) => t.dims.rr === RR_ORDER[2] || t.dims.rr === RR_ORDER[3])
    const b = trades.filter((t) => t.dims.rr === RR_ORDER[0] || t.dims.rr === RR_ORDER[1])
    const sa = measure(a)
    const sb = measure(b)
    const test = confidenceOfDifference(outcomes(a).values, outcomes(b).values)
    if (sa.n >= MIN_PATTERN && sb.n >= MIN_PATTERN && perTrade(sa) > perTrade(sb) && test && test.confidence >= 0.7) {
      out.push({
        kind: "opportunity",
        title: "Opportunity",
        text: "Trades planned for 2R or more have produced higher expectancy than your trades planned for less.",
        n: sa.n + sb.n,
        evidence: [
          { label: "Planned 2R or more", value: `${unit(sa)} · n=${sa.n}` },
          { label: "Planned under 2R", value: `${unit(sb)} · n=${sb.n}` },
        ],
        // the larger-target bucket with the most trades, to open as an experiment
        conditions: { rr: [...large].sort((x, y) => y.stats.n - x.stats.n)[0].value },
        action: "experiment",
        basis: basisOf(test.confidence, Math.min(sa.n, sb.n)),
      })
    }
  }

  // Something that has been profitable month after month.
  for (const dim of ["weekday", "session", "symbol", "setup"] as DimId[]) {
    for (const row of breakdown(trades, dim, MIN_PATTERN)) {
      const months = new Map<string, number>()
      for (const t of select(trades, { [dim]: row.value })) months.set(t.month, (months.get(t.month) ?? 0) + t.pnl)
      const ordered = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      let run = 0
      for (let i = ordered.length - 1; i >= 0 && ordered[i][1] > 0; i--) run++
      if (run >= 4) {
        out.push({
          kind: "consistency",
          title: "Consistency",
          text: `Your ${row.value} performance has stayed positive across ${run} consecutive months.`,
          n: row.stats.n,
          evidence: [
            { label: "Expectancy", value: unit(row.stats) },
            { label: "Profitable months", value: `${row.stats.posMonths} of ${row.stats.months}` },
          ],
          conditions: { [dim]: row.value },
          action: "analysis",
          basis: "Observed",
        })
      }
    }
  }

  // What the trade before did.
  const afterLoss = select(trades, { after: "After a loss" })
  const others = trades.filter((t) => t.dims.after !== "After a loss")
  const sAfter = measure(afterLoss)
  const sOthers = measure(others)
  const seq = confidenceOfDifference(outcomes(afterLoss).values, outcomes(others).values)
  if (sAfter.n >= MIN_PATTERN && sOthers.n >= MIN_PATTERN && perTrade(sAfter) < perTrade(sOthers) && seq && seq.confidence >= 0.8) {
    out.push({
      kind: "leak",
      title: "Performance leak",
      text: `Trades taken straight after a loss on the same day average ${unit(sAfter)}, against ${unit(sOthers)} for the rest.`,
      n: sAfter.n,
      evidence: [
        { label: "After a loss", value: `${unit(sAfter)} · n=${sAfter.n}` },
        { label: "All other trades", value: `${unit(sOthers)} · n=${sOthers.n}` },
      ],
      conditions: { after: "After a loss" },
      action: "investigate",
      basis: basisOf(seq.confidence, Math.min(sAfter.n, sOthers.n)),
    })
  }

  // The strongest first within each kind, then a mix.
  const weight = { "Statistically supported": 3, Correlated: 2, Observed: 1 }
  const ranked = out.sort((a, b) => weight[b.basis] - weight[a.basis] || b.n - a.n)
  const seen = new Set<string>()
  const picked: Discovery[] = []
  for (const d of ranked) {
    const key = `${d.kind}:${conditionKey(d.conditions)}`
    if (seen.has(key)) continue
    seen.add(key)
    // no more than three of one kind, so the feed isn't four versions of the same thing
    if (picked.filter((p) => p.kind === d.kind).length >= 3) continue
    picked.push(d)
    if (picked.length >= limit) break
  }
  return picked
}

// ------------------------------------------------------------------ decomposition

export type TreeNode = { label: string; dim: DimId | null; conditions: Conditions; net: number; n: number; winRate: number; children: TreeNode[] }

// Where the profit comes from: the total, split by one dimension, then the next.
export function decompose(trades: EdgeTrade[], dims: DimId[], conditions: Conditions = {}, maxChildren = 6): TreeNode[] {
  if (!dims.length) return []
  const [dim, ...rest] = dims
  const rows = breakdown(trades, dim)
    .filter((r) => r.stats.n >= 1)
    .sort((a, b) => Math.abs(b.stats.net) - Math.abs(a.stats.net))
  const shown = rows.slice(0, maxChildren)
  const nodes: TreeNode[] = shown.map((r) => {
    const next = { ...conditions, [dim]: r.value }
    const inside = select(trades, { [dim]: r.value })
    return { label: r.value, dim, conditions: next, net: r.stats.net, n: r.stats.n, winRate: r.stats.winRate, children: r.stats.n >= MIN_CELL ? decompose(inside, rest, next, maxChildren) : [] }
  })
  const hidden = rows.slice(maxChildren)
  if (hidden.length) nodes.push({ label: `${hidden.length} more`, dim: null, conditions, net: hidden.reduce((s, r) => s + r.stats.net, 0), n: hidden.reduce((s, r) => s + r.stats.n, 0), winRate: 0, children: [] })
  return nodes
}

// ------------------------------------------------------------------ one slice, in full

export type Curve = { i: number; t: number; value: number }[]
export type Bucket = { label: string; n: number; value: number }

export function equityCurve(trades: EdgeTrade[], maxPoints = 240): Curve {
  const useR = outcomes(trades).unit === "R"
  let sum = 0
  const all = trades.map((t, i) => ({ i: i + 1, t: t.exit, value: (sum += useR ? (t.r ?? 0) : t.pnl) }))
  if (all.length <= maxPoints) return all
  const step = all.length / maxPoints
  const out: Curve = []
  for (let k = 0; k < maxPoints; k++) out.push(all[Math.min(all.length - 1, Math.round((k + 1) * step) - 1)])
  return out
}

const R_BUCKETS: [string, (r: number) => boolean][] = [
  ["Below −2R", (r) => r < -2],
  ["−2 to −1R", (r) => r >= -2 && r < -1],
  ["−1 to 0R", (r) => r >= -1 && r < 0],
  ["0 to 1R", (r) => r >= 0 && r < 1],
  ["1 to 2R", (r) => r >= 1 && r < 2],
  ["2 to 3R", (r) => r >= 2 && r < 3],
  ["Over 3R", (r) => r >= 3],
]
export function rDistribution(trades: EdgeTrade[]): Bucket[] {
  const rs = trades.map((t) => t.r).filter((r): r is number => r != null)
  return R_BUCKETS.map(([label, test]) => ({ label, n: rs.filter(test).length, value: rs.filter(test).length }))
}

// The best and the worst places a slice has been traded, across the other dimensions.
export function conditionsFor(trades: EdgeTrade[], exclude: DimId[] = [], min = 8): { best: { dim: DimId; value: string; stats: Stats }[]; worst: { dim: DimId; value: string; stats: Stats }[] } {
  const rows: { dim: DimId; value: string; stats: Stats }[] = []
  for (const dim of ["session", "weekday", "side", "symbol", "hold", "trend", "volatility", "after", "plan", "emotion", "setup"] as DimId[]) {
    if (exclude.includes(dim)) continue
    const values = breakdown(trades, dim, min)
    // a dimension where every trade has the same value says nothing
    if (values.length < 2) continue
    for (const r of values) rows.push({ dim, value: r.value, stats: r.stats })
  }
  const sorted = rows.sort((a, b) => perTrade(b.stats) - perTrade(a.stats))
  return { best: sorted.filter((r) => r.stats.expectancy > 0).slice(0, 5), worst: sorted.filter((r) => r.stats.expectancy < 0).slice(-5).reverse() }
}

export type Detail = {
  conditions: Conditions
  name: string
  stats: Stats
  score: EdgeScore
  baseline: Stats
  curve: Curve
  unit: "R" | "$"
  best: { dim: DimId; value: string; stats: Stats }[]
  worst: { dim: DimId; value: string; stats: Stats }[]
  rDist: Bucket[]
  byWeekday: Row[]
  bySession: Row[]
  byHour: Row[]
  byHold: Row[]
  // how the slice does in each state of mind, when the trader has checked in
  psychology: { dim: DimId; rows: Row[] }[]
  recent: { id: number; symbol: string; side: string; pnl: number; r: number | null; exit: number }[]
  excursion: { n: number; avgMaeR: number; medMaeR: number; avgMfeR: number; medMfeR: number; winnersMaeR: number | null } | null
}

const med = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export function excursionSummary(trades: EdgeTrade[]): Detail["excursion"] {
  const withData = trades.filter((t) => t.maeR != null && t.mfeR != null)
  if (withData.length < MIN_CELL) return null
  const winners = withData.filter((t) => t.pnl > 0)
  return {
    n: withData.length,
    avgMaeR: avg(withData.map((t) => t.maeR!)),
    medMaeR: med(withData.map((t) => t.maeR!)),
    avgMfeR: avg(withData.map((t) => t.mfeR!)),
    medMfeR: med(withData.map((t) => t.mfeR!)),
    winnersMaeR: winners.length >= MIN_CELL ? med(winners.map((t) => t.maeR!)) : null,
  }
}

// Everything about one slice — what the drawer and the Setup page show.
export function detail(trades: EdgeTrade[], conditions: Conditions): Detail {
  const slice = select(trades, conditions)
  const stats = measure(slice)
  const used = conditionEntries(conditions).map(([d]) => d)
  const { best, worst } = conditionsFor(slice, used)
  return {
    conditions,
    name: conditionName(conditions),
    stats,
    score: scoreEdge(slice, stats),
    baseline: measure(trades),
    curve: equityCurve(slice),
    unit: outcomes(slice).unit,
    best,
    worst,
    rDist: rDistribution(slice),
    byWeekday: breakdown(slice, "weekday"),
    bySession: breakdown(slice, "session"),
    byHour: breakdown(slice, "hour").sort((a, b) => a.value.localeCompare(b.value)),
    byHold: breakdown(slice, "hold"),
    psychology: (["emotion", "confidence", "stress", "plan"] as DimId[]).map((dim) => ({ dim, rows: breakdown(slice, dim, MIN_CELL) })).filter((p) => p.rows.length >= 2),
    recent: slice.slice(-12).reverse().map((t) => ({ id: t.id, symbol: t.symbol, side: t.dims.side ?? "", pnl: t.pnl, r: t.r, exit: t.exit })),
    excursion: excursionSummary(slice),
  }
}
