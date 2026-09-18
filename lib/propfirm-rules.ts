// Standard prop-firm evaluation methodology (trailing/static drawdown, daily
// loss limit, profit target, minimum trading days) — this is the common,
// industry-wide model every prop firm's rules are a variant of, not
// something specific to one firm. The actual thresholds (profit target %,
// max drawdown %, etc.) always come from the user's own entered rules for
// their specific firm/program — never hardcoded here, since those numbers
// vary by firm, account size, and change over time, and getting one wrong
// would misrepresent something with real financial stakes for the user.
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
}

export interface PropFirmTrade {
  exitTime: string
  pnl: number
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
}

export function evaluatePropFirmAccount(
  rules: PropFirmRules,
  startingBalance: number,
  trades: PropFirmTrade[],
  openingAdjustment = 0
): PropFirmEvaluation {
  const sorted = [...trades].sort((a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime())

  // openingAdjustment folds in P&L that happened before this account was
  // added to the tracker (see propFirmRules.openingBalanceAdjustment) — it
  // corrects where the walk starts, but can't reconstruct the exact peak or
  // daily-loss history from before that point.
  let balance = startingBalance + openingAdjustment
  let peak = balance
  let breach: { reason: string; at: string; netProfit: number } | null = null
  const dailyPnl = new Map<string, number>()

  const maxDrawdownFraction = rules.maxDrawdownPct / 100
  const dailyLossFraction = rules.dailyLossLimitPct != null ? rules.dailyLossLimitPct / 100 : null

  for (const t of sorted) {
    balance += t.pnl
    if (balance > peak) peak = balance

    const day = t.exitTime.slice(0, 10)
    const dayTotal = (dailyPnl.get(day) ?? 0) + t.pnl
    dailyPnl.set(day, dayTotal)

    if (!breach) {
      const ddReference = rules.drawdownType === "trailing" ? peak : startingBalance
      const maxDrawdownAmount = ddReference * maxDrawdownFraction
      const currentDrawdown = ddReference - balance
      if (currentDrawdown >= maxDrawdownAmount) {
        breach = { reason: `Max drawdown exceeded (${rules.drawdownType})`, at: t.exitTime, netProfit: balance - startingBalance }
      } else if (dailyLossFraction != null) {
        const dailyLossLimitAmount = startingBalance * dailyLossFraction
        if (-dayTotal >= dailyLossLimitAmount) {
          breach = { reason: "Daily loss limit exceeded", at: t.exitTime, netProfit: balance - startingBalance }
        }
      }
    }
  }

  const tradingDays = dailyPnl.size
  const netProfit = balance - startingBalance
  const profitTargetAmount = rules.profitTargetPct != null ? startingBalance * (rules.profitTargetPct / 100) : null
  const minTradingDaysMet = rules.minTradingDays == null || tradingDays >= rules.minTradingDays
  const worstDayLossAmount = Math.max(0, -Math.min(0, ...Array.from(dailyPnl.values()), 0))

  const ddReferenceNow = rules.drawdownType === "trailing" ? peak : startingBalance
  const drawdownLimitAmount = ddReferenceNow * maxDrawdownFraction
  const currentDrawdownAmount = Math.max(0, ddReferenceNow - balance)

  let status: PropFirmStatus = "active"
  let resolvedAt: string | null = null
  if (breach) {
    status = "breached"
    resolvedAt = breach.at
  } else if (profitTargetAmount != null && netProfit >= profitTargetAmount && minTradingDaysMet) {
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
    drawdownLimitAmount,
    currentDrawdownAmount,
    drawdownRemainingAmount: Math.max(0, drawdownLimitAmount - currentDrawdownAmount),
    profitTargetAmount,
    netProfit,
    profitProgressPct: profitTargetAmount ? (netProfit / profitTargetAmount) * 100 : null,
    dailyLossLimitAmount: dailyLossFraction != null ? startingBalance * dailyLossFraction : null,
    worstDayLossAmount,
    tradingDays,
    minTradingDaysMet,
  }
}
