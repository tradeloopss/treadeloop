"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { assertFeature } from "@/lib/features/server"
import { loadTrades, parseFilters, type Filters } from "@/lib/insights/data"
import { resolveTimeZone } from "@/lib/timezone"
import { cleanConditions, isDimId, outcomes, select, type Conditions, type DimId } from "@/lib/edge/core"
import { decompose, detail, matrix, search, type Candidate, type Detail, type Matrix, type TreeNode } from "@/lib/edge/discover"
import { compare, testHypothesis, type Comparison, type HypothesisResult } from "@/lib/edge/hypothesis"
import { walkForward, type WalkForward } from "@/lib/edge/robustness"
import { createMonitor, createRule, deleteHypothesis, deleteMonitor, deleteRule, markAlertsRead, promoteToPlaybook, saveHypothesis, setMonitorNotify, setRuleActive } from "@/lib/edge/server"
import { refreshMarketData, type MarketRefresh } from "@/lib/edge/market-server"

// Everything Edge Lab does on the server after the page has loaded: opening a
// slice, testing an idea, saving what the trader wants kept. The trader is
// always the one the session resolved, and the feature's release stage is
// checked on every call (lib/features) — a page that was open when access was
// withdrawn can't keep working.
//
// Answers come back as { ok, ... } rather than as thrown errors: a thrown
// server action reaches the browser in production as an opaque message.

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string }

const fail = (err: unknown): { ok: false; error: string } => {
  const message = err instanceof Error ? err.message : ""
  // a database error is not something to show a trader
  return { ok: false, error: !message || message.startsWith("Failed query") ? "Something went wrong. Try again." : message }
}

// `query` is the page's own query string: the filters are read from it here,
// the same way the page read them.
async function context(query: string) {
  const { userId } = await assertFeature("edge_lab")
  const filters: Filters = parseFilters(Object.fromEntries(new URLSearchParams(query)))
  const loaded = await loadTrades(userId, filters, resolveTimeZone(await headers()))
  return { userId, filters, loaded, trades: loaded.trades }
}

const dims = (list: unknown, fallback: DimId[], max = 4): DimId[] => {
  const clean = Array.isArray(list) ? [...new Set(list.filter(isDimId))].slice(0, max) : []
  return clean.length ? clean : fallback
}

export async function getEdgeDetail(conditions: Conditions, query: string): Promise<Result<{ detail: Detail }>> {
  try {
    const { trades } = await context(query)
    return { ok: true, detail: detail(trades, cleanConditions(conditions)) }
  } catch (err) {
    return fail(err)
  }
}

export async function getMatrix(rowDim: string, colDim: string, query: string): Promise<Result<{ matrix: Matrix }>> {
  try {
    const { trades } = await context(query)
    const [r, c] = dims([rowDim, colDim], ["symbol", "session"], 2)
    return { ok: true, matrix: matrix(trades, r, c && c !== r ? c : r === "session" ? "symbol" : "session") }
  } catch (err) {
    return fail(err)
  }
}

export async function getDecomposition(order: string[], query: string): Promise<Result<{ tree: TreeNode[]; total: number; n: number }>> {
  try {
    const { trades } = await context(query)
    return { ok: true, tree: decompose(trades, dims(order, ["symbol", "session", "side"], 3)), total: trades.reduce((s, t) => s + t.pnl, 0), n: trades.length }
  } catch (err) {
    return fail(err)
  }
}

// The discovery engine: every combination of the chosen dimensions, within the conditions already set.
export async function discoverEdges(input: { dims: string[]; conditions: Conditions; depth?: number }, query: string): Promise<Result<{ edges: Candidate[]; leaks: Candidate[]; examined: number; n: number }>> {
  try {
    const { trades } = await context(query)
    const base = cleanConditions(input.conditions)
    const slice = select(trades, base)
    const chosen = dims(input.dims, ["symbol", "session", "side", "setup"], 8).filter((d) => base[d] == null)
    const found = search(slice, { dims: chosen, depth: Math.max(1, Math.min(4, Math.round(input.depth ?? 3))), limit: 20 })
    // what was already fixed is part of every result's description
    const withBase = (c: Candidate): Candidate => ({ ...c, conditions: { ...base, ...c.conditions }, name: [...Object.values(base), c.name].join(" + ") })
    return { ok: true, edges: found.edges.map(withBase), leaks: found.leaks.map(withBase), examined: found.examined, n: slice.length }
  } catch (err) {
    return fail(err)
  }
}

export async function runHypothesis(conditions: Conditions, query: string): Promise<Result<{ result: HypothesisResult }>> {
  try {
    const { trades } = await context(query)
    const clean = cleanConditions(conditions)
    if (!Object.keys(clean).length) throw new Error("Add at least one condition.")
    return { ok: true, result: testHypothesis(trades, clean) }
  } catch (err) {
    return fail(err)
  }
}

// Saved with the result the SERVER computes for it — never one the browser sends.
export async function saveHypothesisAction(input: { id?: number | null; name: string; statement?: string | null; conditions: Conditions }, query: string): Promise<Result<{ id: number }>> {
  try {
    const { userId, trades } = await context(query)
    const conditions = cleanConditions(input.conditions)
    const id = await saveHypothesis(userId, { id: input.id ?? null, name: String(input.name ?? ""), statement: input.statement ?? null, conditions, result: testHypothesis(trades, conditions) })
    revalidatePath("/edge-lab/hypotheses")
    return { ok: true, id }
  } catch (err) {
    return fail(err)
  }
}

export async function deleteHypothesisAction(id: number): Promise<Result<object>> {
  try {
    const { userId } = await assertFeature("edge_lab")
    await deleteHypothesis(userId, Number(id))
    revalidatePath("/edge-lab/hypotheses")
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

export async function runComparison(a: Conditions, b: Conditions, query: string): Promise<Result<{ comparison: Comparison }>> {
  try {
    const { trades } = await context(query)
    const ca = cleanConditions(a)
    const cb = cleanConditions(b)
    if (!Object.keys(ca).length || !Object.keys(cb).length) throw new Error("Give both sides at least one condition.")
    return { ok: true, comparison: compare(trades, ca, cb) }
  } catch (err) {
    return fail(err)
  }
}

// The results to simulate from (Monte Carlo runs in the browser) and the walk-forward split.
export async function getRobustness(conditions: Conditions, query: string): Promise<Result<{ outcomes: number[]; unit: "R" | "$"; n: number; walk: WalkForward }>> {
  try {
    const { trades } = await context(query)
    const slice = select(trades, cleanConditions(conditions))
    const o = outcomes(slice)
    return { ok: true, outcomes: o.values.map((v) => Math.round(v * 1000) / 1000), unit: o.unit, n: slice.length, walk: walkForward(slice) }
  } catch (err) {
    return fail(err)
  }
}

export async function watchEdge(input: { conditions: Conditions; name?: string | null }, query: string): Promise<Result<{ id: number }>> {
  try {
    // a watched edge is judged on the whole history, not on the page's date range
    const { userId, loaded } = await context(query)
    const id = await createMonitor(userId, loaded.all, { conditions: input.conditions, name: input.name ?? null })
    revalidatePath("/edge-lab/monitor")
    return { ok: true, id }
  } catch (err) {
    return fail(err)
  }
}

export async function unwatchEdge(id: number): Promise<Result<object>> {
  try {
    const { userId } = await assertFeature("edge_lab")
    await deleteMonitor(userId, Number(id))
    revalidatePath("/edge-lab/monitor")
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

export async function setEdgeNotify(id: number, input: { inApp?: boolean; email?: boolean }): Promise<Result<object>> {
  try {
    const { userId } = await assertFeature("edge_lab")
    await setMonitorNotify(userId, Number(id), { inApp: typeof input.inApp === "boolean" ? input.inApp : undefined, email: typeof input.email === "boolean" ? input.email : undefined })
    revalidatePath("/edge-lab/monitor")
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

export async function readEdgeAlerts(): Promise<Result<object>> {
  try {
    const { userId } = await assertFeature("edge_lab")
    await markAlertsRead(userId)
    revalidatePath("/edge-lab/monitor")
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

export async function promoteEdge(input: { conditions: Conditions; name?: string | null }, query: string): Promise<Result<{ playbookId: number }>> {
  try {
    const { userId, loaded } = await context(query)
    const { playbookId } = await promoteToPlaybook(userId, loaded.all, { conditions: input.conditions, name: input.name ?? null })
    revalidatePath("/playbooks")
    revalidatePath("/edge-lab/monitor")
    return { ok: true, playbookId }
  } catch (err) {
    return fail(err)
  }
}

// A rule from a leak or a pattern. Edge Lab and Psychology share the list, so
// either feature being released is enough to add to it.
async function ruleUser(): Promise<string> {
  try {
    return (await assertFeature("edge_lab")).userId
  } catch {
    return (await assertFeature("psychology")).userId
  }
}

export async function addRule(input: { text: string; source?: string; conditions?: Conditions | null }): Promise<Result<{ id: number }>> {
  try {
    const id = await createRule(await ruleUser(), { text: String(input.text ?? ""), source: input.source, conditions: input.conditions ?? null })
    revalidatePath("/psychology")
    revalidatePath("/edge-lab")
    return { ok: true, id }
  } catch (err) {
    return fail(err)
  }
}

export async function toggleRule(id: number, active: boolean): Promise<Result<object>> {
  try {
    await setRuleActive(await ruleUser(), Number(id), active === true)
    revalidatePath("/psychology")
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

export async function removeRule(id: number): Promise<Result<object>> {
  try {
    await deleteRule(await ruleUser(), Number(id))
    revalidatePath("/psychology")
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// Price history for the trader's instruments: the daily regime of each market,
// and how far each trade went for and against. Asked for by the trader, in
// steps — never on a page load.
export async function analyseMarketData(): Promise<Result<{ refresh: MarketRefresh }>> {
  try {
    const { userId } = await assertFeature("edge_lab")
    const refresh = await refreshMarketData(userId)
    revalidatePath("/edge-lab", "layout")
    return { ok: true, refresh }
  } catch (err) {
    return fail(err)
  }
}
