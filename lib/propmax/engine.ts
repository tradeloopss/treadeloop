import type { EngineContext, RuleConfig, RuleResult, RuleSource, RuleStatus } from "@/lib/propmax/types"
import { evaluateRule } from "@/lib/propmax/rules"

// A versioned rule set: the rules that apply to one account (program + size +
// phase + effective version) and where they came from.
export interface RuleSet {
  rules: RuleConfig[]
  source: RuleSource | null
  versionLabel?: string | null
}

// Sort/priority so the most dangerous rule is always first (spec §17). Lower
// rank = shown first.
const STATUS_RANK: Record<RuleStatus, number> = {
  breached: 0,
  critical: 1,
  warning: 2,
  watch: 3,
  stale: 4,
  unknown: 5,
  safe: 6,
  not_applicable: 7,
}

export interface AccountRisk {
  // Overall, from the worst active rule.
  status: "safe" | "watch" | "warning" | "critical" | "breached" | "stale" | "unknown"
  counts: Record<"safe" | "watch" | "warning" | "critical" | "breached" | "unknown" | "stale" | "not_applicable", number>
  // The single rule closest to (or past) a breach, for the headline.
  closest: RuleResult | null
  dataFresh: boolean
}

export interface AccountEvaluation {
  rules: RuleResult[] // sorted, priority first
  risk: AccountRisk
  payout: PayoutEligibility
  evaluatedAt: string
}

export interface PayoutEligibility {
  eligible: boolean
  // Present only when the account's rules actually let us judge it.
  determinable: boolean
  reasons: string[]
}

// Evaluate every rule in the set against the context.
export function evaluateAccount(ctx: EngineContext, ruleSet: RuleSet): AccountEvaluation {
  const results = ruleSet.rules
    .map((r) => evaluateRule(r, ctx, ruleSet.source))
    .filter((r) => r.status !== "not_applicable")
  results.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || severityRank(b) - severityRank(a))

  return {
    rules: results,
    risk: summarize(ctx, results),
    payout: payoutEligibility(ctx, ruleSet.rules, results),
    evaluatedAt: ctx.now.toISOString(),
  }
}

function severityRank(r: RuleResult): number {
  return { account_failure: 4, hard_breach: 3, soft_breach: 2, warning: 1, info: 0 }[r.severity]
}

function summarize(ctx: EngineContext, results: RuleResult[]): AccountRisk {
  const counts = { safe: 0, watch: 0, warning: 0, critical: 0, breached: 0, unknown: 0, stale: 0, not_applicable: 0 }
  for (const r of results) counts[r.status]++
  // The worst status decides the account headline — but a breach only counts
  // when it's a real account-ending severity, not an informational flag.
  let status: AccountRisk["status"] = "safe"
  const order: AccountRisk["status"][] = ["breached", "critical", "warning", "watch", "stale", "unknown", "safe"]
  for (const s of order) {
    if (results.some((r) => r.status === s)) {
      status = s
      break
    }
  }
  const closest =
    results.filter((r) => r.percentageUsed != null && r.severity !== "info").sort((a, b) => (b.percentageUsed ?? 0) - (a.percentageUsed ?? 0))[0] ?? null
  return { status, counts, closest, dataFresh: !ctx.stale }
}

// A basic composite: eligible only if every gating rule the account has says
// so. Undeterminable (→ never a false "eligible") when required data/rules are
// missing.
function payoutEligibility(ctx: EngineContext, configs: RuleConfig[], results: RuleResult[]): PayoutEligibility {
  const has = (t: RuleConfig["type"]) => configs.some((c) => c.type === t && c.enabled !== false && c.value != null)
  const reasons: string[] = []
  if (ctx.stale) return { eligible: false, determinable: false, reasons: ["Account data is stale — sync before judging payout eligibility."] }

  let eligible = true
  const result = (t: RuleConfig["type"]) => results.find((r) => r.type === t)

  if (has("min_trading_days")) {
    const r = result("min_trading_days")
    if (r && r.currentValue != null && r.limitValue != null && r.currentValue < r.limitValue) {
      eligible = false
      reasons.push(`Minimum trading days: ${r.currentValue} of ${r.limitValue}.`)
    }
  }
  if (has("profit_target")) {
    const r = result("profit_target")
    if (r && r.currentValue != null && r.limitValue != null && r.currentValue < r.limitValue) {
      eligible = false
      reasons.push(`Profit target: ${r.remainingValue} still to go.`)
    }
  }
  if (has("consistency")) {
    const r = result("consistency")
    if (r && (r.status === "warning" || r.status === "critical" || r.status === "breached")) {
      eligible = false
      reasons.push("Consistency rule not met yet.")
    } else if (r && r.status === "unknown") {
      return { eligible: false, determinable: false, reasons: ["Not enough profit yet to judge the consistency rule."] }
    }
  }

  const anyBreached = results.some((r) => r.status === "breached")
  if (anyBreached) {
    eligible = false
    reasons.push("A rule is currently breached.")
  }
  if (eligible) reasons.push("All payout requirements met.")
  return { eligible, determinable: true, reasons }
}
