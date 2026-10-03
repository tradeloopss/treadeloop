// The admin command center's arithmetic, as pure functions: trends, the
// estimated revenue series, what counts as healthy, which notifications are
// unread. The queries (command-center.ts) load rows; these decide what they
// mean — and the tests check them without a database.

export type RangeKey = "7d" | "30d" | "90d"
export const RANGE_DAYS: Record<RangeKey, number> = { "7d": 7, "30d": 30, "90d": 90 }
export const RANGE_LABELS: Record<RangeKey, string> = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days" }
export const parseRange = (v: unknown): RangeKey => (v === "30d" || v === "90d" ? v : "7d")

// Change from one period to the one before it, as a fraction (0.12 = +12%).
// Null when there is nothing to compare with.
export function change(current: number, previous: number): number | null {
  if (!(previous > 0)) return null
  return (current - previous) / previous
}

// --- revenue ------------------------------------------------------------------

// A paid subscription, as far as the estimate needs: whose it is, when it
// started, when it ended (null = still running), and what it is worth a month
// at list price.
export type SubSpan = { userId: string; started: Date; ended: Date | null; monthly: number }
export type RevenuePoint = { day: string; mrr: number; paying: number }

const DAY = 86_400_000
export const dayKey = (d: Date) => d.toISOString().slice(0, 10)
const round2 = (v: number) => Math.round(v * 100) / 100

// A subscription that ended before its free trial would have: it was never charged.
export function neverCharged(span: { started: Date; ended: Date | null }, trialDays: number): boolean {
  return span.ended != null && span.ended.getTime() - span.started.getTime() < trialDays * DAY
}

// Estimated MRR, and how many people were paying, at the end of each of the
// last `days` days (UTC), from the subscriptions' start and end dates. Someone
// with two overlapping subscriptions (an upgrade) counts once, at the larger.
// An estimate: list prices, and a trial that converted counts from its first day.
export function revenueSeries(subs: SubSpan[], days: number, now: Date): RevenuePoint[] {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const out: RevenuePoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = end - i * DAY
    const dayEnd = dayStart + DAY
    const byUser = new Map<string, number>()
    for (const s of subs) {
      if (s.started.getTime() >= dayEnd || (s.ended && s.ended.getTime() < dayEnd)) continue
      byUser.set(s.userId, Math.max(byUser.get(s.userId) ?? 0, s.monthly))
    }
    let mrr = 0
    for (const v of byUser.values()) mrr += v
    out.push({ day: dayKey(new Date(dayStart)), mrr: round2(mrr), paying: byUser.size })
  }
  return out
}

// Monthly value of the subscriptions that started since `since` and are still running.
export function newMrr(subs: SubSpan[], since: Date): number {
  return round2(subs.filter((s) => s.started >= since && !s.ended).reduce((sum, s) => sum + s.monthly, 0))
}

// --- health -------------------------------------------------------------------

export type HealthStatus = "operational" | "degraded" | "down" | "unknown" | "unused"
export type HealthCheck = { key: string; label: string; status: HealthStatus; detail: string }
export const HEALTH_LABELS: Record<HealthStatus, string> = { operational: "Operational", degraded: "Degraded", down: "Unavailable", unknown: "Not checked yet", unused: "Not in use" }

const MIN = 60_000
const ago = (ms: number) => (ms < MIN ? "just now" : ms < 60 * MIN ? `${Math.round(ms / MIN)} min ago` : ms < 48 * 60 * MIN ? `${Math.round(ms / (60 * MIN))} h ago` : `${Math.round(ms / (24 * 60 * MIN))} days ago`)

export function databaseHealth(input: { latencyMs: number | null; connections: number; maxConnections: number }): HealthCheck {
  const base = { key: "database", label: "Database" }
  if (input.latencyMs == null) return { ...base, status: "down", detail: "Didn't answer" }
  const share = input.maxConnections > 0 ? input.connections / input.maxConnections : 0
  const detail = `${Math.round(input.latencyMs)} ms · ${input.connections}/${input.maxConnections} connections`
  return { ...base, status: input.latencyMs > 1000 || share > 0.9 ? "degraded" : "operational", detail }
}

// The app's own pages, from the sampled server timings of the last hour.
export function appHealth(input: { samples: number; p95: number | null }): HealthCheck {
  const base = { key: "app", label: "Web app" }
  if (!input.samples || input.p95 == null) return { ...base, status: "unknown", detail: "No requests sampled in the last hour" }
  const status: HealthStatus = input.p95 > 5000 ? "down" : input.p95 > 2000 ? "degraded" : "operational"
  return { ...base, status, detail: `p95 ${Math.round(input.p95)} ms · ${input.samples} samples` }
}

// Rithmic, synced by the sync clock on the sync server (a pass every minute):
// is the clock running, and are its syncs succeeding? `lastPass` is the clock's
// own heartbeat, or failing that the newest automatic sync on record.
export function rithmicHealth(input: { connections: number; lastPass: Date | null; lastPassOk: boolean | null; runs24h: number; failed24h: number }, now: Date): HealthCheck {
  const base = { key: "rithmic", label: "Rithmic sync" }
  if (!input.connections) return { ...base, status: "unused", detail: "No Rithmic accounts connected" }
  if (!input.lastPass) return { ...base, status: "down", detail: "The automatic sync has never run" }
  const age = now.getTime() - input.lastPass.getTime()
  const failRate = input.runs24h ? input.failed24h / input.runs24h : 0
  const status: HealthStatus = age > 30 * MIN ? "down" : age > 5 * MIN || input.lastPassOk === false || failRate >= 0.5 ? "degraded" : "operational"
  return { ...base, status, detail: `Last pass ${ago(age)} · ${input.failed24h} of ${input.runs24h} syncs failed in 24 h` }
}

// An account-by-account sync run by a worker on the sync server (MetaTrader,
// NinjaTrader): how fresh is the freshest account, and how many are failing?
export function workerSyncHealth(
  input: { key: string; label: string; noun: string; connections: number; freshest: Date | null; failing: number; staleMin: number; downMin: number },
  now: Date
): HealthCheck {
  const base = { key: input.key, label: input.label }
  if (!input.connections) return { ...base, status: "unused", detail: `No ${input.noun} accounts connected` }
  if (!input.freshest) return { ...base, status: "down", detail: "No account has synced yet" }
  const age = now.getTime() - input.freshest.getTime()
  const failShare = input.failing / input.connections
  const status: HealthStatus = age > input.downMin * MIN ? "down" : age > input.staleMin * MIN || failShare >= 0.5 ? "degraded" : "operational"
  return { ...base, status, detail: `Last sync ${ago(age)} · ${input.failing} of ${input.connections} accounts failing` }
}

// Transactional email, from the outbox's own record of the last 24 hours.
export function emailHealth(input: { configured: boolean; sent24h: number; failed24h: number; stuck: number }): HealthCheck {
  const base = { key: "email", label: "Email" }
  if (!input.configured) return { ...base, status: "down", detail: "No email provider key on this deployment" }
  const status: HealthStatus = input.failed24h > 0 && input.failed24h >= input.sent24h ? "down" : input.failed24h > 0 || input.stuck > 0 ? "degraded" : "operational"
  return { ...base, status, detail: `${input.sent24h} sent · ${input.failed24h} failed in 24 h${input.stuck ? ` · ${input.stuck} waiting to retry` : ""}` }
}

// The payout worker records each pass (lib/affiliates/jobs, every two minutes
// from the sync server): is it running, and did its last pass finish cleanly?
export function payoutWorkerHealth(input: { lastRun: Date | null; ok: boolean | null; failedSteps?: string | null }, now: Date): HealthCheck {
  const base = { key: "payouts", label: "Payout processing" }
  if (!input.lastRun) return { ...base, status: "unknown", detail: "No run recorded yet" }
  const age = now.getTime() - input.lastRun.getTime()
  const status: HealthStatus = age > 60 * MIN ? "down" : age > 10 * MIN || input.ok === false ? "degraded" : "operational"
  return { ...base, status, detail: `Last pass ${ago(age)}${input.ok === false ? ` · failed: ${input.failedSteps || "a step"}` : ""}` }
}

// A check whose query itself failed: say so, rather than guess.
export function uncheckable(key: string, label: string): HealthCheck {
  return { key, label, status: "unknown", detail: "Couldn't be checked just now" }
}

// The worst of a set of checks, for one line at the top ("All systems operational").
export function overallHealth(checks: HealthCheck[]): { status: HealthStatus; label: string } {
  const live = checks.filter((c) => c.status !== "unused")
  if (live.some((c) => c.status === "down")) return { status: "down", label: "Something is unavailable" }
  if (live.some((c) => c.status === "degraded")) return { status: "degraded", label: "Some systems are degraded" }
  if (live.length && live.every((c) => c.status === "operational")) return { status: "operational", label: "All systems operational" }
  return { status: "unknown", label: "Some systems haven't been checked yet" }
}

// --- notifications ----------------------------------------------------------------

// Each notification belongs to one of these; an admin can turn any of them off
// in Admin Settings (and only sees those their role can open anyway).
export type NoticeCategory = "payouts" | "affiliates" | "support" | "brokers" | "security"
export const NOTICE_CATEGORIES: { key: NoticeCategory; label: string; description: string }[] = [
  { key: "payouts", label: "Payout alerts", description: "A payout is waiting for approval or needs a retry." },
  { key: "affiliates", label: "Affiliate alerts", description: "New affiliate applications and risk signals." },
  { key: "support", label: "Support alerts", description: "A support request is waiting for a reply." },
  { key: "brokers", label: "System alerts", description: "Broker connections whose sync is failing." },
  { key: "security", label: "Security alerts", description: "Repeated failed sign-ins from one address." },
]

export type AdminNotice = { key: string; category: NoticeCategory; at: string; title: string; detail: string; href: string; tone: "danger" | "warning" | "info" | "primary" | "success" }

export function isUnread(n: Pick<AdminNotice, "key" | "at">, prefs: { readAt: string | null; readKeys: string[] }): boolean {
  if (prefs.readKeys.includes(n.key)) return false
  return !prefs.readAt || Date.parse(n.at) > Date.parse(prefs.readAt)
}
