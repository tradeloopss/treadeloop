// Pure derivation of alerts and daily snapshots from an evaluated account.
// Kept side-effect-free so it's unit-testable; app/actions/propmax.ts persists
// what these return. An alert fires only in the genuine danger zone
// (warning/critical/breached) — never on a safe/unknown/stale rule — and its
// dedupeKey makes writing idempotent: one alert per (account, rule, level, day),
// so a rule sitting at "critical" all day doesn't spam, but a move from
// warning→critical does raise a fresh one.
import type { PropMaxAccountView } from "@/lib/propmax/account"
import type { RuleResult } from "@/lib/propmax/types"

export interface AlertDraft {
  propAccountId: number
  userId: string
  ruleType: string | null
  status: string
  severity: string
  title: string
  body: string
  percentageUsed: number | null
  dedupeKey: string
}

export interface SnapshotDraft {
  propAccountId: number
  userId: string
  date: string
  balance: string | null
  equity: string | null
  highWaterMark: string | null
  riskStatus: string
  evaluation: PropMaxAccountView["evaluation"]
}

// Only these statuses are worth interrupting a trader for.
const ALERT_STATUSES = new Set(["warning", "critical", "breached"])

function statusWord(status: string): string {
  switch (status) {
    case "breached":
      return "breached"
    case "critical":
      return "critical — very close to breach"
    case "warning":
      return "approaching the limit"
    default:
      return status
  }
}

function alertTitle(accountName: string, rule: RuleResult): string {
  const pct = rule.percentageUsed != null ? ` (${Math.round(rule.percentageUsed)}%)` : ""
  return `${accountName}: ${rule.name} ${statusWord(rule.status)}${pct}`
}

// The alerts this account's current evaluation warrants, for `date` (YYYY-MM-DD).
export function deriveAlerts(view: PropMaxAccountView, userId: string, date: string): AlertDraft[] {
  if (!view.binding || !view.evaluation || view.propAccountId == null) return []
  const propAccountId = view.propAccountId
  const drafts: AlertDraft[] = []
  for (const rule of view.evaluation.rules) {
    if (!ALERT_STATUSES.has(rule.status)) continue
    drafts.push({
      propAccountId,
      userId,
      ruleType: rule.type,
      status: rule.status,
      severity: rule.severity,
      title: alertTitle(view.name, rule),
      body: rule.explanation,
      percentageUsed: rule.percentageUsed,
      dedupeKey: `${propAccountId}:${rule.type}:${rule.status}:${date}`,
    })
  }
  return drafts
}

// The daily snapshot row for this account (one per account per day; the caller
// upserts on (propAccountId, date)).
export function buildSnapshot(view: PropMaxAccountView, userId: string, date: string): SnapshotDraft | null {
  if (view.propAccountId == null || !view.evaluation || !view.metrics) return null
  const num = (n: number | null) => (n != null ? String(Math.round(n * 100) / 100) : null)
  return {
    propAccountId: view.propAccountId,
    userId,
    date,
    balance: num(view.metrics.balance),
    equity: num(view.metrics.equity),
    highWaterMark: num(view.metrics.highWaterMark),
    riskStatus: view.evaluation.risk.status,
    evaluation: view.evaluation,
  }
}
