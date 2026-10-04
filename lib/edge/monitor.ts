import { MIN_CELL, MIN_PATTERN, conditionEntries, fmtMoney, measure, outcomes, select, type Conditions, type DimId, type EdgeTrade, type Stats } from "./core"
import { breakdown } from "./discover"

// Edge Lab's analysis engine, part five: is an edge still working? A saved edge
// is its conditions; its history is every trade that fits them. The most recent
// trades are held against the rest.

export type MonitorStatus = "healthy" | "stable" | "weakening" | "degraded" | "insufficient"
export const STATUS_LABELS: Record<MonitorStatus, string> = { healthy: "Healthy", stable: "Stable", weakening: "Weakening", degraded: "Degraded", insufficient: "Insufficient data" }

// How many of the latest trades count as "now".
export const RECENT_WINDOW = 50

export type MonitorView = {
  status: MonitorStatus
  unit: "R" | "$"
  // every matching trade before the recent ones
  historical: Stats
  recent: Stats
  // recent result per trade as a share of the historical one; null when it can't be said
  ratio: number | null
  explanation: string
}

const value = (s: Stats, unit: "R" | "$") => (unit === "R" ? (s.expR ?? 0) : s.expectancy)

export function monitor(trades: EdgeTrade[], conditions: Conditions, window = RECENT_WINDOW): MonitorView {
  const slice = select(trades, conditions)
  const unit = outcomes(slice).unit
  // "recent" is the latest `window` trades, but never more than half the history
  const size = Math.min(window, Math.floor(slice.length / 2))
  const recentTrades = size > 0 ? slice.slice(-size) : []
  const earlier = size > 0 ? slice.slice(0, -size) : slice
  const historical = measure(earlier)
  const recent = measure(recentTrades)
  if (recent.n < 10 || historical.n < MIN_PATTERN) {
    return { status: "insufficient", unit, historical, recent, ratio: null, explanation: `Not enough data yet: ${slice.length} matching trades. This needs ${MIN_PATTERN} earlier trades and 10 recent ones to judge.` }
  }
  const h = value(historical, unit)
  const r = value(recent, unit)
  const ratio = h > 0 ? r / h : null
  let status: MonitorStatus
  if (r <= 0 && recent.n >= MIN_PATTERN) status = "degraded"
  else if (r <= 0) status = "weakening"
  else if (ratio == null) status = "stable"
  else if (ratio < 0.5) status = "weakening"
  else if (ratio >= 0.9) status = "healthy"
  else status = "stable"

  let explanation: string
  if (status === "healthy") explanation = `The latest ${recent.n} trades are performing in line with the ${historical.n} before them.`
  else if (status === "stable") explanation = `The latest ${recent.n} trades are a little below the edge's history, within what is normal.`
  else explanation = decline(recentTrades, earlier, conditions) ?? `The latest ${recent.n} trades are well below the edge's history, with no single cause standing out.`
  return { status, unit, historical, recent, ratio, explanation }
}

// Which part of the recent trades the decline is coming from: the value, in
// some other dimension, that has lost the most lately — when the edge used to
// make money there, or hardly traded there.
function decline(recent: EdgeTrade[], earlier: EdgeTrade[], conditions: Conditions): string | null {
  const used = new Set(conditionEntries(conditions).map(([d]) => d))
  let worst: { value: string; net: number; n: number; before: Stats | null } | null = null
  for (const dim of ["session", "symbol", "weekday", "side", "hold", "setup", "after", "trend", "volatility"] as DimId[]) {
    if (used.has(dim)) continue
    const before = new Map(breakdown(earlier, dim).map((r) => [r.value, r.stats]))
    for (const row of breakdown(recent, dim, MIN_CELL)) {
      if (row.stats.net >= 0) continue
      if (!worst || row.stats.net < worst.net) worst = { value: row.value, net: row.stats.net, n: row.stats.n, before: before.get(row.value) ?? null }
    }
  }
  if (!worst) return null
  const was = worst.before && worst.before.n >= MIN_CELL ? (worst.before.net > 0 ? " — it used to be profitable there" : " — it was already losing there") : ""
  return `The decline is coming mostly from ${worst.value} trades: ${fmtMoney(worst.net)} over the latest ${worst.n}${was}.`
}

// What to tell the trader when a watched edge changes state.
export function alertFor(name: string, before: MonitorStatus | null, now: MonitorView): { kind: string; title: string; body: string } | null {
  if (now.status === before) return null
  if (now.status === "degraded") return { kind: "degraded", title: `${name} has stopped working`, body: now.explanation }
  if (now.status === "weakening") return { kind: "weakening", title: `${name} has dropped below its historical expectancy`, body: now.explanation }
  if ((before === "weakening" || before === "degraded") && (now.status === "healthy" || now.status === "stable")) return { kind: "recovered", title: `${name} is performing normally again`, body: now.explanation }
  return null
}
