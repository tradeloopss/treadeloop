// Standard prop-firm evaluation methodology (trailing/static drawdown, daily
// loss limit, profit target, minimum trading days, consistency rule, and
// once funded, payout eligibility) — this is the common, industry-wide
// model every prop firm's rules are a variant of, not something specific to
// one firm. The actual thresholds always come from the user's own rules for
// their specific firm/program — never hardcoded here, since those numbers
// vary by firm, account size, and change over time, and getting one wrong
// would misrepresent something with real financial stakes for the user.
//
// Thresholds are dollar amounts when the rules carry them (the way firms
// publish them), and otherwise a percentage of the starting balance.
//
// Known limitation, surfaced in the UI rather than hidden: this evaluates
// CLOSED trades only (realized P&L) — it can't see live floating P&L on an
// open position the way the prop firm's own real-time platform does, so a
// currently-open losing trade won't show here until it's closed. Users
// should treat this as a helper/tracker, not a final authority — the prop
// firm's own dashboard is still the source of truth.

export interface PropFirmRules {
  phase: string
  profitTargetPct: number | null
  maxDrawdownPct: number
  drawdownType: "trailing" | "static"
  dailyLossLimitPct: number | null
  minTradingDays: number | null
  // Exact dollar thresholds — used ahead of the percentages when set.
  profitTargetAmount?: number | null
  maxDrawdownAmount?: number | null
  dailyLossLimitAmount?: number | null
  // Largest profitable day may be at most this % of the profit made (since
  // the last payout, once funded). null = no consistency rule.
  consistencyPct?: number | null
  // Funded only: days at or above minDayProfit needed before a payout can
  // be requested, and the most one request can be for.
  minPayoutDays?: number | null
  minDayProfit?: number | null
  payoutCap?: number | null
}

export interface PropFirmTrade {
  exitTime: string
  pnl: number
}

// Money leaving the account outside of trading — a payout received. Lowers
// the balance from that day on without moving the drawdown floor, which is
// how every firm here treats withdrawals.
export interface PropFirmCashEvent {
  at: string
  amount: number
}

export type PropFirmStatus = "active" | "passed" | "breached"

export interface PropFirmEvaluation {
  status: PropFirmStatus
  breachReason: string | null
  breachedAt: string | null
  netProfitAtBreach: number | null
  daysToBreachOrPass: number | null
  currentBalance: number
  peakBalance: number
  drawdownLimitAmount: number
  currentDrawdownAmount: number
  drawdownRemainingAmount: number
  profitTargetAmount: number | null
  netProfit: number
  profitProgressPct: number | null
  dailyLossLimitAmount: number | null
  worstDayLossAmount: number
  tradingDays: number
  minTradingDaysMet: boolean
  // Consistency: the best day's share of the profit it's measured against
  // (all profit in evaluation, profit since the last payout once funded).
  // null when there's no profit to measure against yet.
  largestDayProfit: number
  consistencySharePct: number | null
  consistencyMet: boolean
  // Funded: progress towards the next payout.
  cycleNetProfit: number
  qualifyingDays: number
  payoutEligible: boolean
  payoutAvailable: number | null
}

export function evaluatePropFirmAccount(
  rules: PropFirmRules,
  startingBalance: number,
  trades: PropFirmTrade[],
  openingAdjustment = 0,
  cashEvents: PropFirmCashEvent[] = []
): PropFirmEvaluation {
  const sorted = [...trades].sort((a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime())
  const payouts = [...cashEvents].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  // openingAdjustment folds in P&L that happened before this account was
  // added to the tracker (see propFirmRules.openingBalanceAdjustment) — it
  // corrects where the walk starts, but can't reconstruct the exact peak or
  // daily-loss history from before that point.
  let balance = startingBalance + openingAdjustment
  let peak = balance
  let breach: { reason: string; at: string; netProfit: number } | null = null
  const dailyPnl = new Map<string, number>()

  const maxDrawdownAmount = rules.maxDrawdownAmount ?? startingBalance * (rules.maxDrawdownPct / 100)
  const dailyLossLimitAmount =
    rules.dailyLossLimitAmount ?? (rules.dailyLossLimitPct != null ? startingBalance * (rules.dailyLossLimitPct / 100) : null)

  let nextPayout = 0
  for (const t of sorted) {
    // Payouts before this trade come off the balance first. They don't
    // touch the peak: the floor stays where it was, so the account has to
    // earn the withdrawn amount back before it has the same room again.
    while (nextPayout < payouts.length && new Date(payouts[nextPayout].at).getTime() <= new Date(t.exitTime).getTime()) {
      balance -= payouts[nextPayout].amount
      nextPayout++
    }
    balance += t.pnl
    if (balance > peak) peak = balance

    const day = t.exitTime.slice(0, 10)
    const dayTotal = (dailyPnl.get(day) ?? 0) + t.pnl
    dailyPnl.set(day, dayTotal)

    if (!breach) {
      const ddReference = rules.drawdownType === "trailing" ? peak : startingBalance
      const currentDrawdown = ddReference - balance
      if (currentDrawdown >= maxDrawdownAmount) {
        breach = { reason: `Max drawdown exceeded (${rules.drawdownType})`, at: t.exitTime, netProfit: balance - startingBalance }
      } else if (dailyLossLimitAmount != null && -dayTotal >= dailyLossLimitAmount) {
        breach = { reason: "Daily loss limit exceeded", at: t.exitTime, netProfit: balance - startingBalance }
      }
    }
  }
  while (nextPayout < payouts.length) {
    balance -= payouts[nextPayout].amount
    nextPayout++
  }

  const tradingDays = dailyPnl.size
  const netProfit = balance - startingBalance
  const profitTargetAmount =
    rules.profitTargetAmount ?? (rules.profitTargetPct != null ? startingBalance * (rules.profitTargetPct / 100) : null)
  const minTradingDaysMet = rules.minTradingDays == null || tradingDays >= rules.minTradingDays
  const worstDayLossAmount = Math.max(0, -Math.min(0, ...Array.from(dailyPnl.values()), 0))

  const ddReferenceNow = rules.drawdownType === "trailing" ? peak : startingBalance
  const currentDrawdownAmount = Math.max(0, ddReferenceNow - balance)

  // Consistency and payout progress are measured over the current payout
  // cycle once funded (everything since the last payout), and over the
  // whole evaluation otherwise.
  const funded = rules.phase === "funded"
  const lastPayoutAt = funded && payouts.length ? payouts[payouts.length - 1].at.slice(0, 10) : null
  const cycleDays = [...dailyPnl.entries()].filter(([day]) => lastPayoutAt == null || day > lastPayoutAt)
  const cycleNetProfit = cycleDays.reduce((sum, [, pnl]) => sum + pnl, 0)
  const largestDayProfit = Math.max(0, ...cycleDays.map(([, pnl]) => pnl))
  const consistencySharePct = cycleNetProfit > 0 ? (largestDayProfit / cycleNetProfit) * 100 : null
  const consistencyMet = rules.consistencyPct == null || consistencySharePct == null || consistencySharePct <= rules.consistencyPct
  const qualifyingDays = rules.minDayProfit != null ? cycleDays.filter(([, pnl]) => pnl >= rules.minDayProfit!).length : cycleDays.filter(([, pnl]) => pnl > 0).length
  const payoutEligible =
    funded && cycleNetProfit > 0 && consistencyMet && (rules.minPayoutDays == null || qualifyingDays >= rules.minPayoutDays)
  const payoutAvailable = funded && cycleNetProfit > 0 ? (rules.payoutCap != null ? Math.min(cycleNetProfit, rules.payoutCap) : cycleNetProfit) : null

  let status: PropFirmStatus = "active"
  let resolvedAt: string | null = null
  if (breach) {
    status = "breached"
    resolvedAt = breach.at
  } else if (!funded && profitTargetAmount != null && netProfit >= profitTargetAmount && minTradingDaysMet && consistencyMet) {
    status = "passed"
    resolvedAt = sorted[sorted.length - 1]?.exitTime ?? null
  }

  const firstTradeAt = sorted[0]?.exitTime
  const daysToBreachOrPass =
    resolvedAt && firstTradeAt
      ? Math.max(0, Math.round((new Date(resolvedAt).getTime() - new Date(firstTradeAt).getTime()) / 86_400_000))
      : null

  return {
    status,
    breachReason: breach?.reason ?? null,
    breachedAt: breach?.at ?? null,
    netProfitAtBreach: breach?.netProfit ?? null,
    daysToBreachOrPass,
    currentBalance: balance,
    peakBalance: peak,
    drawdownLimitAmount: maxDrawdownAmount,
    currentDrawdownAmount,
    drawdownRemainingAmount: Math.max(0, maxDrawdownAmount - currentDrawdownAmount),
    profitTargetAmount,
    netProfit,
    profitProgressPct: profitTargetAmount ? (netProfit / profitTargetAmount) * 100 : null,
    dailyLossLimitAmount,
    worstDayLossAmount,
    tradingDays,
    minTradingDaysMet,
    largestDayProfit,
    consistencySharePct,
    consistencyMet,
    cycleNetProfit,
    qualifyingDays,
    payoutEligible,
    payoutAvailable,
  }
}
