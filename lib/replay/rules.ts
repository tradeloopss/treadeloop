// Prop-firm safety engine for replay. Turns the raw session numbers into the
// rule-card progress bars and the pre-trade SAFE / WARNING / WOULD-BREACH
// verdict, so the replay warns before a simulated order breaks a rule. Pure and
// account-agnostic — the same logic serves FTMO, Apex, Topstep, etc.
import type { AccountState, PropFirmRuleSet, ReplayAccount, RuleProgress, RuleStatus } from "@/lib/replay/types"

const WARN_AT = 0.8 // fraction of a limit that flips a rule to "warning"

export interface SessionStats {
  realizedTotal: number // sum of all closed-trade P&L
  realizedToday: number // closed-trade P&L on the current replay day
  unrealized: number // open-position P&L at the current price
  worstEquity: number // lowest equity seen this session (for max drawdown)
  tradingDays: number // distinct days with at least one closed trade
}

export function accountState(account: ReplayAccount, s: SessionStats): AccountState {
  const balance = account.startingBalance + s.realizedTotal
  return {
    balance,
    equity: balance + s.unrealized,
    todayPnl: s.realizedToday + s.unrealized,
    openRisk: 0, // filled in by the page (needs open trades) — kept here for shape
    openTrades: 0,
  }
}

function statusFor(used: number, limit: number | null): RuleStatus {
  if (limit == null || limit <= 0) return "safe"
  if (used >= limit) return "breach"
  if (used >= limit * WARN_AT) return "warning"
  return "safe"
}

// used = how much of each limit is consumed; limit = the cap; pct against limit.
export function ruleProgress(account: ReplayAccount, s: SessionStats): RuleProgress[] {
  const r: PropFirmRuleSet = account.rules
  const equity = account.startingBalance + s.realizedTotal + s.unrealized
  const profit = Math.max(0, s.realizedTotal)
  const dailyLossUsed = Math.max(0, -(s.realizedToday + s.unrealized))
  const drawdownUsed = Math.max(0, account.startingBalance - Math.min(s.worstEquity, equity))

  const rows: RuleProgress[] = []
  const push = (label: string, used: number, limit: number | null) =>
    rows.push({ label, used, limit, pct: limit && limit > 0 ? Math.min(100, (used / limit) * 100) : 0, status: statusFor(used, limit) })

  push("Profit Target", profit, r.profitTarget)
  push("Daily Loss", dailyLossUsed, r.dailyLoss)
  push("Max Drawdown", drawdownUsed, r.maxDrawdown)
  if (r.minTradingDays != null) {
    rows.push({
      label: "Trading Days",
      used: s.tradingDays,
      limit: r.minTradingDays,
      pct: r.minTradingDays > 0 ? Math.min(100, (s.tradingDays / r.minTradingDays) * 100) : 0,
      status: "safe", // a progress goal, never a breach
    })
  }
  return rows
}

// The worst status across the account-ending rules (daily loss + drawdown).
export function overallStatus(rows: RuleProgress[]): RuleStatus {
  const risky = rows.filter((x) => x.label === "Daily Loss" || x.label === "Max Drawdown")
  if (risky.some((x) => x.status === "breach")) return "breach"
  if (risky.some((x) => x.status === "warning")) return "warning"
  return "safe"
}

// Before placing a trade: add its worst-case stop loss to today's loss and the
// drawdown, and report whether that projection is safe, close, or a breach.
export function projectTrade(
  account: ReplayAccount,
  s: SessionStats,
  worstCaseLoss: number,
): { status: RuleStatus; message: string | null } {
  const r = account.rules
  const projectedDaily = Math.max(0, -(s.realizedToday + s.unrealized) + worstCaseLoss)
  const equity = account.startingBalance + s.realizedTotal + s.unrealized
  const projectedDrawdown = Math.max(0, account.startingBalance - Math.min(s.worstEquity, equity - worstCaseLoss))

  if (r.dailyLoss != null && projectedDaily >= r.dailyLoss) {
    return { status: "breach", message: "This trade could breach the daily loss limit if the stop is hit." }
  }
  if (r.maxDrawdown != null && projectedDrawdown >= r.maxDrawdown) {
    return { status: "breach", message: "This trade could breach the max drawdown if the stop is hit." }
  }
  if (r.dailyLoss != null && projectedDaily >= r.dailyLoss * WARN_AT) {
    return { status: "warning", message: "This trade brings you close to the daily loss limit." }
  }
  if (r.maxDrawdown != null && projectedDrawdown >= r.maxDrawdown * WARN_AT) {
    return { status: "warning", message: "This trade brings you close to the max drawdown limit." }
  }
  return { status: "safe", message: null }
}
