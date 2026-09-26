import type { EngineContext, RuleConfig, RuleEvaluator, RuleResult, RuleSource } from "@/lib/propmax/types"
import { amountFor, flagResult, notApplicable, progressResult, riskResult, unknown } from "@/lib/propmax/shared"

const money = (n: number, ccy = "USD") => `${ccy === "USD" ? "$" : ""}${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`
const DAY_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------- risk rules

// Worst single day's realized loss vs the daily loss limit. Note: realized
// only — a still-open losing trade doesn't show until it closes.
const maxDailyLoss: RuleEvaluator = {
  type: "max_daily_loss",
  name: "Daily loss",
  defaultSeverity: "hard_breach",
  unit: "currency",
  evaluate(config, ctx, source) {
    const limit = amountFor(config, ctx.startingBalance)
    if (limit == null) return notApplicable(this.type, this.name, this.unit, ctx, source)
    const worst = ctx.daily.reduce((w, d) => Math.min(w, d.pnl), 0) // most negative
    const used = Math.max(0, -worst)
    return riskResult({
      type: this.type,
      name: this.name,
      severity: config.severity ?? this.defaultSeverity,
      unit: this.unit,
      current: used,
      limit,
      explanation: `Your largest single-day loss so far is ${money(used, ctx.currency)} against a ${money(limit, ctx.currency)} daily limit. Measured on realized (closed) trades.`,
      ctx,
      source,
    })
  },
}

// Trailing / static / EOD max drawdown. Trailing trails the high-water mark;
// static is fixed from the starting balance; EOD is approximated from the
// realized end-of-day balance (documented limitation).
const maxDrawdown: RuleEvaluator = {
  type: "max_drawdown",
  name: "Max drawdown",
  defaultSeverity: "account_failure",
  unit: "currency",
  evaluate(config, ctx, source) {
    const limit = amountFor(config, ctx.startingBalance)
    if (limit == null) return notApplicable(this.type, this.name, this.unit, ctx, source)
    const model = config.model ?? "trailing"
    const anchor = model === "static" ? ctx.startingBalance : ctx.highWaterMark
    const floor = anchor - limit
    const used = Math.max(0, anchor - ctx.balance)
    const label = model === "static" ? "fixed from your starting balance" : model === "eod" ? "trailing your highest end-of-day balance" : "trailing your account high"
    return riskResult({
      type: this.type,
      name: this.name,
      severity: config.severity ?? this.defaultSeverity,
      unit: this.unit,
      current: used,
      limit,
      explanation: `Your drawdown limit (${label}) sits at ${money(floor, ctx.currency)}; you're ${money(ctx.balance - floor, ctx.currency)} above it.`,
      ctx,
      source,
    })
  },
}

const inactivity: RuleEvaluator = {
  type: "inactivity",
  name: "Inactivity",
  defaultSeverity: "soft_breach",
  unit: "days",
  evaluate(config, ctx, source) {
    const limit = config.enabled === false || config.value == null ? null : config.value
    if (limit == null) return notApplicable(this.type, this.name, this.unit, ctx, source)
    const last = ctx.trades.at(-1)
    if (!last) return unknown(this.type, this.name, this.unit, ctx, source, "no trades on record yet to measure inactivity from.")
    const days = Math.floor((ctx.now.getTime() - new Date(last.exitTime).getTime()) / DAY_MS)
    return riskResult({
      type: this.type,
      name: this.name,
      severity: config.severity ?? this.defaultSeverity,
      unit: this.unit,
      current: days,
      limit,
      explanation: `${days} of ${limit} allowed days since your last trade.`,
      ctx,
      source,
    })
  },
}

// ------------------------------------------------------ live-position rules

const maxOpenPositions: RuleEvaluator = {
  type: "max_open_positions",
  name: "Max open positions",
  defaultSeverity: "soft_breach",
  unit: "count",
  evaluate(config, ctx, source) {
    const limit = config.enabled === false || config.value == null ? null : config.value
    if (limit == null) return notApplicable(this.type, this.name, this.unit, ctx, source)
    if (!ctx.livePositionsAvailable) return unknown(this.type, this.name, this.unit, ctx, source, "this account doesn't report live open positions.")
    return riskResult({
      type: this.type,
      name: this.name,
      severity: config.severity ?? this.defaultSeverity,
      unit: this.unit,
      current: ctx.openPositions.length,
      limit,
      explanation: `${ctx.openPositions.length} of ${limit} open positions.`,
      ctx,
      source,
    })
  },
}

// Total contracts/lots across open positions; falls back to the largest size
// ever traded when there's no live feed (a real signal, flagged as such).
const maxContracts: RuleEvaluator = {
  type: "max_contracts",
  name: "Max contracts",
  defaultSeverity: "hard_breach",
  unit: "count",
  evaluate(config, ctx, source) {
    const limit = config.enabled === false || config.value == null ? null : config.value
    if (limit == null) return notApplicable(this.type, this.name, this.unit, ctx, source)
    if (ctx.livePositionsAvailable) {
      const total = ctx.openPositions.reduce((s, p) => s + Math.abs(p.quantity), 0)
      return riskResult({ type: this.type, name: this.name, severity: config.severity ?? this.defaultSeverity, unit: this.unit, current: total, limit, explanation: `${total} of ${limit} contracts open right now.`, ctx, source })
    }
    const maxEver = ctx.trades.reduce((m, t) => Math.max(m, Math.abs(t.quantity)), 0)
    if (maxEver === 0) return unknown(this.type, this.name, this.unit, ctx, source, "no live positions and no trade sizes to check.")
    return riskResult({ type: this.type, name: this.name, severity: config.severity ?? this.defaultSeverity, unit: this.unit, current: maxEver, limit, explanation: `No live position feed — your largest traded size so far is ${maxEver} of ${limit} contracts.`, ctx, source })
  },
}

const maxPositionSize: RuleEvaluator = {
  type: "max_position_size",
  name: "Max position size",
  defaultSeverity: "hard_breach",
  unit: "count",
  evaluate(config, ctx, source) {
    const limit = config.enabled === false || config.value == null ? null : config.value
    if (limit == null) return notApplicable(this.type, this.name, this.unit, ctx, source)
    const live = ctx.livePositionsAvailable ? ctx.openPositions.reduce((m, p) => Math.max(m, Math.abs(p.quantity)), 0) : 0
    const maxEver = ctx.trades.reduce((m, t) => Math.max(m, Math.abs(t.quantity)), 0)
    const current = ctx.livePositionsAvailable ? live : maxEver
    if (!ctx.livePositionsAvailable && maxEver === 0) return unknown(this.type, this.name, this.unit, ctx, source, "no position size to check yet.")
    return riskResult({ type: this.type, name: this.name, severity: config.severity ?? this.defaultSeverity, unit: this.unit, current, limit, explanation: `Largest position ${current} of ${limit} allowed.`, ctx, source })
  },
}

// Any open position over the weekend when the firm forbids it. UNKNOWN without
// a live feed; only warns inside the Fri-close→Sun window.
const weekendHolding: RuleEvaluator = {
  type: "weekend_holding",
  name: "Weekend holding",
  defaultSeverity: "hard_breach",
  unit: "count",
  evaluate(config, ctx, source) {
    if (config.enabled === false) return notApplicable(this.type, this.name, this.unit, ctx, source)
    if (!ctx.livePositionsAvailable) return unknown(this.type, this.name, this.unit, ctx, source, "this account doesn't report live open positions.")
    const day = ctx.now.getUTCDay() // 0 Sun … 6 Sat
    const near = day === 6 || day === 0 || (day === 5 && ctx.now.getUTCHours() >= 20)
    const open = near ? ctx.openPositions.length : 0
    return flagResult({
      type: this.type,
      name: this.name,
      severity: config.severity ?? this.defaultSeverity,
      unit: this.unit,
      count: open,
      breachStatus: "warning",
      explanation: open > 0 ? `${open} position(s) open into the weekend — this account forbids weekend holding.` : "No positions to close for the weekend right now.",
      ctx,
      source,
    })
  },
}

const newsRestriction: RuleEvaluator = {
  type: "news_restriction",
  name: "News trading",
  defaultSeverity: "hard_breach",
  unit: "count",
  evaluate(config, ctx, source) {
    if (config.enabled === false) return notApplicable(this.type, this.name, this.unit, ctx, source)
    // Needs an economic-calendar feed, which isn't wired up yet.
    return unknown(this.type, this.name, this.unit, ctx, source, "the economic calendar isn't connected yet, so news windows can't be checked.")
  },
}

const minTradeDuration: RuleEvaluator = {
  type: "min_trade_duration",
  name: "Minimum trade duration",
  defaultSeverity: "soft_breach",
  unit: "count",
  evaluate(config, ctx, source) {
    const minMinutes = config.enabled === false || config.value == null ? null : config.value
    if (minMinutes == null) return notApplicable(this.type, this.name, this.unit, ctx, source)
    const tooShort = ctx.trades.filter((t) => new Date(t.exitTime).getTime() - new Date(t.entryTime).getTime() < minMinutes * 60_000).length
    return flagResult({
      type: this.type,
      name: this.name,
      severity: config.severity ?? this.defaultSeverity,
      unit: this.unit,
      count: tooShort,
      breachStatus: "warning",
      explanation: tooShort > 0 ? `${tooShort} trade(s) held under the ${minMinutes}-minute minimum.` : `All trades meet the ${minMinutes}-minute minimum.`,
      ctx,
      source,
    })
  },
}

// -------------------------------------------------------------- progress rules

const profitTarget: RuleEvaluator = {
  type: "profit_target",
  name: "Profit target",
  defaultSeverity: "info",
  unit: "currency",
  evaluate(config, ctx, source) {
    const target = amountFor(config, ctx.startingBalance)
    if (target == null) return notApplicable(this.type, this.name, this.unit, ctx, source)
    const profit = ctx.balance - ctx.startingBalance
    const r = progressResult({ type: this.type, name: this.name, unit: this.unit, current: profit, target, explanation: `${money(Math.max(0, profit), ctx.currency)} of the ${money(target, ctx.currency)} target${profit >= target ? " — target reached." : `, ${money(target - profit, ctx.currency)} to go.`}`, ctx, source })
    return r
  },
}

const minTradingDays: RuleEvaluator = {
  type: "min_trading_days",
  name: "Minimum trading days",
  defaultSeverity: "info",
  unit: "days",
  evaluate(config, ctx, source) {
    const target = config.enabled === false || config.value == null ? null : config.value
    if (target == null) return notApplicable(this.type, this.name, this.unit, ctx, source)
    const days = ctx.daily.filter((d) => d.pnl !== 0).length
    return progressResult({ type: this.type, name: this.name, unit: this.unit, current: days, target, explanation: `${days} of ${target} required trading days.`, ctx, source })
  },
}

const maxTradingDays: RuleEvaluator = {
  type: "max_trading_days",
  name: "Maximum trading days",
  defaultSeverity: "soft_breach",
  unit: "days",
  evaluate(config, ctx, source) {
    const limit = config.enabled === false || config.value == null ? null : config.value
    if (limit == null) return notApplicable(this.type, this.name, this.unit, ctx, source)
    const days = ctx.daily.filter((d) => d.pnl !== 0).length
    return riskResult({ type: this.type, name: this.name, severity: config.severity ?? this.defaultSeverity, unit: this.unit, current: days, limit, explanation: `${days} of ${limit} allowed trading days used.`, ctx, source })
  },
}

// Largest profitable day as a share of total profit must stay at or under the
// allowed %. Gates payout eligibility — it's never an account breach.
const consistency: RuleEvaluator = {
  type: "consistency",
  name: "Consistency",
  defaultSeverity: "soft_breach",
  unit: "percentage",
  evaluate(config, ctx, source) {
    const allowed = config.enabled === false || config.value == null ? null : config.value
    if (allowed == null) return notApplicable(this.type, this.name, this.unit, ctx, source)
    const profitDays = ctx.daily.filter((d) => d.pnl > 0)
    const totalProfit = profitDays.reduce((s, d) => s + d.pnl, 0)
    if (totalProfit <= 0) return unknown(this.type, this.name, this.unit, ctx, source, "no profit yet to measure consistency against.")
    const best = profitDays.reduce((m, d) => Math.max(m, d.pnl), 0)
    const share = Math.round((best / totalProfit) * 10000) / 100
    const withinLimit = share <= allowed
    return {
      type: this.type,
      name: this.name,
      status: ctx.stale ? "stale" : withinLimit ? "safe" : "warning",
      severity: config.severity ?? this.defaultSeverity,
      unit: this.unit,
      currentValue: share,
      limitValue: allowed,
      remainingValue: Math.round((allowed - share) * 100) / 100,
      percentageUsed: Math.round((share / allowed) * 10000) / 100,
      distanceToBreach: Math.round((allowed - share) * 100) / 100,
      explanation: `Your best day is ${share}% of total profit (limit ${allowed}%).${withinLimit ? "" : " Over the limit — not payout-eligible until it evens out."}`,
      source,
      evaluatedAt: ctx.now.toISOString(),
      dataFresh: !ctx.stale,
    }
  },
}

// The evaluator registry — the engine looks rules up here by type.
export const EVALUATORS: Record<RuleConfig["type"], RuleEvaluator> = {
  max_daily_loss: maxDailyLoss,
  max_drawdown: maxDrawdown,
  profit_target: profitTarget,
  min_trading_days: minTradingDays,
  max_trading_days: maxTradingDays,
  consistency,
  max_position_size: maxPositionSize,
  max_contracts: maxContracts,
  max_open_positions: maxOpenPositions,
  inactivity,
  weekend_holding: weekendHolding,
  news_restriction: newsRestriction,
  min_trade_duration: minTradeDuration,
}

export function evaluateRule(config: RuleConfig, ctx: EngineContext, source: RuleSource | null): RuleResult {
  const evaluator = EVALUATORS[config.type]
  if (!evaluator) return unknown(config.type, config.type, "count", ctx, source, "no evaluator for this rule type.")
  try {
    return evaluator.evaluate(config, ctx, source)
  } catch {
    return unknown(config.type, evaluator.name, evaluator.unit, ctx, source, "an error occurred evaluating this rule.")
  }
}
