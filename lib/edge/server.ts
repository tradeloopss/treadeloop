import { and, desc, eq, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { edgeAlerts, edgeHypotheses, edgeMonitors, playbooks, tradingRules, user } from "@/lib/db/schema"
import { emailConfigured, sendEmail } from "@/lib/email"
import { appHref } from "@/lib/urls"
import { cached, filterKey, loadTrades, previousPeriod, type Filters, type Loaded } from "@/lib/insights/data"
import { MIN_PATTERN, MIN_TRADES, cleanConditions, conditionEntries, conditionName, dimLabel, fmtExpectancy, fmtPct, fmtPf, measure, scoreEdge, select, type Conditions, type EdgeScore, type EdgeTrade, type Stats } from "./core"
import { conditionsFor, discoveries, matrix, search, type Candidate, type Discovery, type Matrix } from "./discover"
import { testHypothesis, type HypothesisResult } from "./hypothesis"
import { STATUS_LABELS, alertFor, monitor, type MonitorStatus, type MonitorView } from "./monitor"

// Edge Lab's server side: the overview (computed once, kept until the trades
// change), and the things a trader saves — hypotheses, watched edges, rules.
// Every query is scoped by the user id the session resolved.

// ------------------------------------------------------------------ overview

export type Overview = {
  enough: boolean
  trades: number
  stats: Stats
  score: EdgeScore
  // the same figures for the period before, when the range has one
  previous: { stats: Stats; score: number | null } | null
  strongest: Candidate | null
  leak: Candidate | null
  edges: Candidate[]
  leaks: Candidate[]
  discoveries: Discovery[]
  matrix: Matrix
  examined: number
}

export function buildOverview(trades: EdgeTrade[], previous: EdgeTrade[] | null): Overview {
  const stats = measure(trades)
  const score = scoreEdge(trades, stats)
  const enough = stats.n >= MIN_TRADES
  const found = enough ? search(trades) : { edges: [], leaks: [], examined: 0 }
  const prevStats = previous && previous.length >= MIN_PATTERN ? measure(previous) : null
  return {
    enough,
    trades: stats.n,
    stats,
    score,
    previous: prevStats ? { stats: prevStats, score: scoreEdge(previous!, prevStats).score } : null,
    strongest: found.edges[0] ?? null,
    leak: found.leaks[0] ?? null,
    edges: found.edges,
    leaks: found.leaks,
    discoveries: enough ? discoveries(trades) : [],
    matrix: matrix(trades, "symbol", "session"),
    examined: found.examined,
  }
}

export async function overview(userId: string, filters: Filters, timeZone: string): Promise<{ data: Overview; loaded: Loaded }> {
  const loaded = await loadTrades(userId, filters, timeZone)
  const data = await cached(userId, `edge:overview:${filterKey(filters)}:${timeZone}`, loaded.fingerprint, () => buildOverview(loaded.trades, previousPeriod(loaded.all, filters)))
  return { data, loaded }
}

// ------------------------------------------------------------------ hypotheses

export async function listHypotheses(userId: string) {
  return db.select().from(edgeHypotheses).where(eq(edgeHypotheses.userId, userId)).orderBy(desc(edgeHypotheses.updatedAt)).limit(50)
}

export async function saveHypothesis(userId: string, input: { id?: number | null; name: string; statement?: string | null; conditions: Conditions; result: HypothesisResult }): Promise<number> {
  const conditions = cleanConditions(input.conditions)
  if (!conditionEntries(conditions).length) throw new Error("Add at least one condition to the hypothesis.")
  const name = input.name.trim().slice(0, 80) || conditionName(conditions)
  const statement = input.statement?.trim().slice(0, 300) || null
  // what is kept of the result: the verdict and the figures it rested on, not the whole analysis
  const r = input.result
  const result = { verdict: r.verdict, summary: r.summary, unit: r.unit, n: r.condition.n, expectancy: fmtExpectancy(r.condition), baseline: fmtExpectancy(r.baseline), confidence: r.confidence, testedAt: new Date().toISOString() }
  if (input.id) {
    const [row] = await db.update(edgeHypotheses).set({ name, statement, conditions, result, updatedAt: new Date() }).where(and(eq(edgeHypotheses.id, input.id), eq(edgeHypotheses.userId, userId))).returning({ id: edgeHypotheses.id })
    if (!row) throw new Error("That hypothesis no longer exists.")
    return row.id
  }
  const [row] = await db.insert(edgeHypotheses).values({ userId, name, statement, conditions, result }).returning({ id: edgeHypotheses.id })
  return row.id
}

export async function deleteHypothesis(userId: string, id: number): Promise<void> {
  await db.delete(edgeHypotheses).where(and(eq(edgeHypotheses.id, id), eq(edgeHypotheses.userId, userId)))
}

// ------------------------------------------------------------------ watched edges

const MAX_MONITORS = 20
const baselineOf = (s: Stats, score: EdgeScore) => ({ n: s.n, expectancy: fmtExpectancy(s), pf: fmtPf(s), winRate: fmtPct(s.winRate), score: score.score, savedAt: new Date().toISOString() })

export async function createMonitor(userId: string, trades: EdgeTrade[], input: { name?: string | null; conditions: Conditions; playbookId?: number | null }): Promise<number> {
  const conditions = cleanConditions(input.conditions)
  if (!conditionEntries(conditions).length) throw new Error("Choose the edge's conditions first.")
  const existing = await db.select({ id: edgeMonitors.id, conditions: edgeMonitors.conditions }).from(edgeMonitors).where(eq(edgeMonitors.userId, userId))
  const same = existing.find((m) => JSON.stringify(cleanConditions(m.conditions)) === JSON.stringify(conditions))
  if (same) {
    if (input.playbookId) await db.update(edgeMonitors).set({ playbookId: input.playbookId }).where(eq(edgeMonitors.id, same.id))
    return same.id
  }
  if (existing.length >= MAX_MONITORS) throw new Error(`You can watch up to ${MAX_MONITORS} edges. Remove one first.`)
  const slice = select(trades, conditions)
  const stats = measure(slice)
  const view = monitor(trades, conditions)
  const [row] = await db
    .insert(edgeMonitors)
    .values({ userId, name: (input.name?.trim() || conditionName(conditions)).slice(0, 80), conditions, baseline: baselineOf(stats, scoreEdge(slice, stats)), playbookId: input.playbookId ?? null, lastStatus: view.status, lastCheckedAt: new Date() })
    .returning({ id: edgeMonitors.id })
  return row.id
}

export async function deleteMonitor(userId: string, id: number): Promise<void> {
  await db.delete(edgeMonitors).where(and(eq(edgeMonitors.id, id), eq(edgeMonitors.userId, userId)))
}

export async function setMonitorNotify(userId: string, id: number, input: { inApp?: boolean; email?: boolean }): Promise<void> {
  await db
    .update(edgeMonitors)
    .set({ ...(input.inApp != null ? { notifyInApp: input.inApp } : {}), ...(input.email != null ? { notifyEmail: input.email } : {}) })
    .where(and(eq(edgeMonitors.id, id), eq(edgeMonitors.userId, userId)))
}

export type MonitorRow = { id: number; name: string; conditions: Conditions; baseline: Record<string, unknown> | null; playbookId: number | null; notifyInApp: boolean; notifyEmail: boolean; createdAt: Date; view: MonitorView }

// Every watched edge with where it stands now. A change of state since the last
// look raises an alert (once), and emails it when the trader asked for that.
export async function monitors(userId: string, trades: EdgeTrade[]): Promise<MonitorRow[]> {
  const rows = await db.select().from(edgeMonitors).where(eq(edgeMonitors.userId, userId)).orderBy(desc(edgeMonitors.createdAt))
  const out: MonitorRow[] = []
  for (const m of rows) {
    const conditions = cleanConditions(m.conditions)
    const view = monitor(trades, conditions)
    out.push({ id: m.id, name: m.name, conditions, baseline: m.baseline, playbookId: m.playbookId, notifyInApp: m.notifyInApp, notifyEmail: m.notifyEmail, createdAt: m.createdAt, view })
    if (view.status === m.lastStatus) continue
    const alert = alertFor(m.name, (m.lastStatus as MonitorStatus | null) ?? null, view)
    await db.update(edgeMonitors).set({ lastStatus: view.status, lastCheckedAt: new Date() }).where(eq(edgeMonitors.id, m.id))
    if (!alert || !m.notifyInApp) continue
    // one alert per edge per state per day, however many times the page is opened
    const dedupeKey = `m${m.id}:${alert.kind}:${new Date().toISOString().slice(0, 10)}`
    const [created] = await db.insert(edgeAlerts).values({ userId, monitorId: m.id, kind: alert.kind, title: alert.title, body: alert.body, href: "/edge-lab/monitor", dedupeKey }).onConflictDoNothing({ target: edgeAlerts.dedupeKey }).returning({ id: edgeAlerts.id })
    if (created && m.notifyEmail) await emailAlert(userId, created.id, alert.title, alert.body)
  }
  return out
}

async function emailAlert(userId: string, alertId: number, title: string, body: string): Promise<void> {
  try {
    if (!emailConfigured()) return
    const [u] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId))
    if (!u?.email) return
    await sendEmail({ to: u.email, subject: `Edge Lab: ${title}`, text: `${title}\n\n${body}\n\nOpen the Edge Monitor: ${appHref("/edge-lab/monitor")}\n\nHistorical performance does not guarantee future results.`, idempotencyKey: `edge_alert:${alertId}` })
    await db.update(edgeAlerts).set({ emailedAt: new Date() }).where(eq(edgeAlerts.id, alertId))
  } catch (e) {
    // an alert that couldn't be emailed is still shown in the app
    console.error("[edge-lab] couldn't email an alert:", e instanceof Error ? e.message : e)
  }
}

export async function alerts(userId: string, limit = 20) {
  return db.select().from(edgeAlerts).where(eq(edgeAlerts.userId, userId)).orderBy(desc(edgeAlerts.createdAt)).limit(limit)
}
export async function unreadAlerts(userId: string): Promise<number> {
  const rows = await db.select({ id: edgeAlerts.id }).from(edgeAlerts).where(and(eq(edgeAlerts.userId, userId), isNull(edgeAlerts.readAt))).limit(50)
  return rows.length
}
export async function markAlertsRead(userId: string): Promise<void> {
  await db.update(edgeAlerts).set({ readAt: new Date() }).where(and(eq(edgeAlerts.userId, userId), isNull(edgeAlerts.readAt)))
}

// ------------------------------------------------------------------ edge → playbook

// A playbook written from an edge: what it is, where it has worked, where it
// hasn't, and the figures it was promoted on. The edge is then watched, and the
// two are linked.
export async function promoteToPlaybook(userId: string, trades: EdgeTrade[], input: { conditions: Conditions; name?: string | null }): Promise<{ playbookId: number; monitorId: number }> {
  const conditions = cleanConditions(input.conditions)
  const entries = conditionEntries(conditions)
  if (!entries.length) throw new Error("Choose the edge's conditions first.")
  const slice = select(trades, conditions)
  const stats = measure(slice)
  if (stats.n < MIN_PATTERN) throw new Error(`This needs ${MIN_PATTERN} trades before it can become a playbook — it has ${stats.n}.`)
  const score = scoreEdge(slice, stats)
  const { best, worst } = conditionsFor(slice, entries.map(([d]) => d))
  const name = (input.name?.trim() || conditionName(conditions)).slice(0, 80)
  const rules = [
    ...entries.map(([d, v]) => `${dimLabel(d)}: ${v}`),
    ...best.slice(0, 3).map((b) => `Best when — ${dimLabel(b.dim)}: ${b.value} (${fmtExpectancy(b.stats)}, n=${b.stats.n})`),
    ...worst.slice(0, 3).map((w) => `Avoid — ${dimLabel(w.dim)}: ${w.value} (${fmtExpectancy(w.stats)}, n=${w.stats.n})`),
  ]
  const description = `Promoted from Edge Lab on ${new Date().toISOString().slice(0, 10)}. Historical figures at that time: ${stats.n} trades, win rate ${fmtPct(stats.winRate)}, profit factor ${fmtPf(stats)}, expectancy ${fmtExpectancy(stats)}, Edge Score ${score.score ?? "—"} (${score.band}). Historical performance does not guarantee future results.`
  const [pb] = await db.insert(playbooks).values({ userId, name, description, rules }).returning({ id: playbooks.id })
  const monitorId = await createMonitor(userId, trades, { name, conditions, playbookId: pb.id })
  return { playbookId: pb.id, monitorId }
}

// The watched edge a playbook came from, if any ("View Edge" on a playbook).
export async function edgeForPlaybooks(userId: string): Promise<Map<number, { id: number; conditions: Conditions }>> {
  const rows = await db.select({ id: edgeMonitors.id, playbookId: edgeMonitors.playbookId, conditions: edgeMonitors.conditions }).from(edgeMonitors).where(eq(edgeMonitors.userId, userId))
  return new Map(rows.filter((r) => r.playbookId != null).map((r) => [r.playbookId!, { id: r.id, conditions: cleanConditions(r.conditions) }]))
}

// ------------------------------------------------------------------ rules

const MAX_RULES = 40

export async function listRules(userId: string) {
  return db.select().from(tradingRules).where(eq(tradingRules.userId, userId)).orderBy(desc(tradingRules.createdAt))
}

export async function createRule(userId: string, input: { text: string; source?: string; conditions?: Conditions | null }): Promise<number> {
  const text = input.text.trim().slice(0, 240)
  if (text.length < 4) throw new Error("Write the rule first.")
  const existing = await listRules(userId)
  const same = existing.find((r) => r.text.toLowerCase() === text.toLowerCase())
  if (same) return same.id
  if (existing.length >= MAX_RULES) throw new Error(`You can keep up to ${MAX_RULES} rules. Remove one first.`)
  const conditions = input.conditions ? cleanConditions(input.conditions) : null
  const [row] = await db
    .insert(tradingRules)
    .values({ userId, text, source: ["edge_leak", "psych_pattern", "coach"].includes(input.source ?? "") ? input.source! : "manual", conditions: conditions && conditionEntries(conditions).length ? conditions : null })
    .returning({ id: tradingRules.id })
  return row.id
}

export async function setRuleActive(userId: string, id: number, active: boolean): Promise<void> {
  await db.update(tradingRules).set({ active }).where(and(eq(tradingRules.id, id), eq(tradingRules.userId, userId)))
}
export async function deleteRule(userId: string, id: number): Promise<void> {
  await db.delete(tradingRules).where(and(eq(tradingRules.id, id), eq(tradingRules.userId, userId)))
}

// How a rule with conditions ("avoid Friday") has been kept: the trades that broke it.
export function ruleBreaks(trades: EdgeTrade[], conditions: Conditions | null, since: number): { n: number; net: number } | null {
  if (!conditions || !conditionEntries(conditions).length) return null
  const broke = select(trades.filter((t) => t.entry >= since), conditions)
  return { n: broke.length, net: broke.reduce((s, t) => s + t.pnl, 0) }
}

export { STATUS_LABELS, testHypothesis }
