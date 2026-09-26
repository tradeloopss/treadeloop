// The PropFirm-rule pre-check that runs before an order is sent to a broker.
// Pure and testable. The principle: you can ALWAYS reduce risk (close, partial
// close, cancel, adjust protection), but OPENING new risk is vetted against the
// account's rules — a breached account or an order that would break a hard rule
// is blocked before it ever leaves TradeLoop.
import type { AccountEvaluation } from "@/lib/propmax/engine"
import type { GuardDecision, OrderCommandInput } from "@/lib/order-execution/types"

export function guardOrder(input: OrderCommandInput, evaluation: AccountEvaluation | null): GuardDecision {
  // Reducing or adjusting an existing position never adds risk.
  if (input.kind === "close" || input.kind === "partial_close" || input.kind === "cancel" || input.kind === "modify") {
    return { allowed: true, reasons: [], severity: "ok" }
  }

  // Opening new risk. With no prop-firm rules on the account, there's nothing
  // to vet against — allowed, but say so.
  if (!evaluation) {
    return { allowed: true, reasons: ["No prop-firm rules on this account — order not rule-checked."], severity: "ok" }
  }

  const rules = evaluation.rules
  const breached = rules.filter((r) => r.status === "breached")
  if (evaluation.risk.status === "breached" || breached.length > 0) {
    return {
      allowed: false,
      severity: "block",
      reasons: ["Account has a breached rule — new positions are blocked.", ...breached.map((r) => r.name)],
    }
  }

  const reasons: string[] = []
  let severity: GuardDecision["severity"] = "ok"

  const contracts = rules.find((r) => r.type === "max_contracts")
  if (contracts && contracts.currentValue != null && contracts.limitValue != null && input.volume != null) {
    if (contracts.currentValue + input.volume > contracts.limitValue) {
      reasons.push(`Would exceed the max position size (${contracts.currentValue} + ${input.volume} > ${contracts.limitValue}).`)
      severity = "block"
    }
  }

  const positions = rules.find((r) => r.type === "max_open_positions")
  if (positions && positions.currentValue != null && positions.limitValue != null && positions.currentValue >= positions.limitValue) {
    reasons.push(`Already at the maximum open positions (${positions.limitValue}).`)
    severity = "block"
  }

  // A hard rule sitting at CRITICAL is a strong warning against adding risk,
  // but not an automatic block (the trader may be scaling into a winner).
  const critical = rules.filter((r) => r.status === "critical" && (r.severity === "hard_breach" || r.severity === "account_failure"))
  if (critical.length > 0 && severity !== "block") {
    severity = "warning"
    reasons.push(...critical.map((r) => `${r.name} is at critical — adding risk is discouraged.`))
  }

  return { allowed: severity !== "block", reasons, severity }
}
