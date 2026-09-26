import type { EngineContext, RuleConfig, RuleResult, RuleSource, RuleStatus, Severity, Unit } from "@/lib/propmax/types"

// Maps how much of a risk limit is used to a status. Tuned so a trader gets
// WATCH well before the CRITICAL zone; BREACHED only at/over the line.
export function usageStatus(percentUsed: number): RuleStatus {
  if (percentUsed >= 100) return "breached"
  if (percentUsed >= 90) return "critical"
  if (percentUsed >= 75) return "warning"
  if (percentUsed >= 50) return "watch"
  return "safe"
}

const round2 = (n: number) => Math.round(n * 100) / 100

// A risk/limit rule (higher usage = worse): daily loss, drawdown, position
// size, contracts, inactivity. `current` and `limit` are in `unit`.
export function riskResult(args: {
  type: RuleResult["type"]
  name: string
  severity: Severity
  unit: Unit
  current: number
  limit: number
  explanation: string
  ctx: EngineContext
  source: RuleSource | null
}): RuleResult {
  const { current, limit } = args
  const pct = limit > 0 ? round2((current / limit) * 100) : 0
  const remaining = round2(limit - current)
  return {
    type: args.type,
    name: args.name,
    status: args.ctx.stale ? "stale" : usageStatus(pct),
    severity: args.severity,
    unit: args.unit,
    currentValue: round2(current),
    limitValue: round2(limit),
    remainingValue: remaining,
    percentageUsed: pct,
    distanceToBreach: remaining,
    explanation: args.explanation,
    source: args.source,
    evaluatedAt: args.ctx.now.toISOString(),
    dataFresh: !args.ctx.stale,
  }
}

// A progress rule (higher = better, never a breach): profit target, minimum
// trading days. Informational — it never threatens the account.
export function progressResult(args: {
  type: RuleResult["type"]
  name: string
  unit: Unit
  current: number
  target: number
  explanation: string
  ctx: EngineContext
  source: RuleSource | null
}): RuleResult {
  const { current, target } = args
  const pct = target > 0 ? round2((current / target) * 100) : current > 0 ? 100 : 0
  const remaining = round2(Math.max(0, target - current))
  return {
    type: args.type,
    name: args.name,
    status: args.ctx.stale ? "stale" : "safe",
    severity: "info",
    unit: args.unit,
    currentValue: round2(current),
    limitValue: round2(target),
    remainingValue: remaining,
    percentageUsed: pct,
    distanceToBreach: null,
    explanation: args.explanation,
    source: args.source,
    evaluatedAt: args.ctx.now.toISOString(),
    dataFresh: !args.ctx.stale,
  }
}

// A binary "any occurrence is a problem" rule (weekend holding, minimum trade
// duration): `count` violations → the given status, else safe.
export function flagResult(args: {
  type: RuleResult["type"]
  name: string
  severity: Severity
  unit: Unit
  count: number
  breachStatus: RuleStatus
  explanation: string
  ctx: EngineContext
  source: RuleSource | null
}): RuleResult {
  const bad = args.count > 0
  return {
    type: args.type,
    name: args.name,
    status: args.ctx.stale ? "stale" : bad ? args.breachStatus : "safe",
    severity: args.severity,
    unit: args.unit,
    currentValue: args.count,
    limitValue: 0,
    remainingValue: bad ? 0 : null,
    percentageUsed: bad ? 100 : 0,
    distanceToBreach: null,
    explanation: args.explanation,
    source: args.source,
    evaluatedAt: args.ctx.now.toISOString(),
    dataFresh: !args.ctx.stale,
  }
}

// The firm doesn't have this rule (config disabled/absent) — shown as
// "—", never as safe.
export function notApplicable(type: RuleResult["type"], name: string, unit: Unit, ctx: EngineContext, source: RuleSource | null): RuleResult {
  return {
    type,
    name,
    status: "not_applicable",
    severity: "info",
    unit,
    currentValue: null,
    limitValue: null,
    remainingValue: null,
    percentageUsed: null,
    distanceToBreach: null,
    explanation: "This account has no rule of this kind.",
    source,
    evaluatedAt: ctx.now.toISOString(),
    dataFresh: !ctx.stale,
  }
}

// We can't verify the rule (missing data / can't compute). Never guessed safe.
export function unknown(type: RuleResult["type"], name: string, unit: Unit, ctx: EngineContext, source: RuleSource | null, why: string): RuleResult {
  return {
    type,
    name,
    status: "unknown",
    severity: "info",
    unit,
    currentValue: null,
    limitValue: null,
    remainingValue: null,
    percentageUsed: null,
    distanceToBreach: null,
    explanation: `TradeLoop can't verify this rule right now: ${why}`,
    source,
    evaluatedAt: ctx.now.toISOString(),
    dataFresh: !ctx.stale,
  }
}

// Resolve a rule's threshold to a dollar amount: a currency value as-is, a
// percentage against the starting balance. Null when the rule carries none.
export function amountFor(config: RuleConfig, startingBalance: number): number | null {
  if (config.enabled === false || config.value == null) return null
  if (config.unit === "percentage") return round2(startingBalance * (config.value / 100))
  return config.value
}
