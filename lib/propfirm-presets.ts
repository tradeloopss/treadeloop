// Real evaluation rules for major futures prop firms, researched directly
// (not recalled from memory) as of September 2026 — sourced from each
// firm's own help center / published rules where possible.
//
// Most firms publish their rules in dollars per account size, and those
// dollars don't always scale linearly (Funded Futures Family's Velocity
// plan, say, is a $4,000 target on $50K but $7,000 on $100K). Where the
// exact per-size figures are known they're listed in `sizes` and used as-is
// for that account size; the top-level percentages are the $50K figures and
// are only the fallback for a size the firm doesn't list. Everything is
// turned into the dollar thresholds the tracker actually checks by
// resolvePresetRules() below.
//
// Most firms offer more than one evaluation structure (e.g. Apex's EOD vs
// Intraday, Bulenox's two DLL options) — those are listed as separate
// entries under the same firm so picking the right one actually matters,
// rather than flattening every firm to a single generic "Evaluation".
//
// These WILL drift out of date — firms change rules over time, and a couple
// of these had genuinely conflicting numbers across sources (called out in
// `notes` where that happened). Each entry's `notes` also flags real
// mechanics this tracker's simple model can't capture (drawdown "lock"
// behavior, soft-breach counters, etc.). Treat this as a verified starting
// point, not a substitute for the firm's own rulebook.
export type DrawdownType = "trailing" | "static"

// Exact dollar thresholds for one account size.
export interface SizeRules {
  profitTarget: number | null
  maxDrawdown: number
  // Most a single payout request can be for, once funded (null = no cap known).
  payoutCap?: number | null
}

// What changes once the account is funded. Anything omitted carries over
// from the evaluation rules.
export interface FundedRules {
  maxDrawdownPct?: number
  drawdownType?: DrawdownType
  sizes?: Record<number, { maxDrawdown: number; payoutCap?: number | null }>
  // Largest profitable day may be at most this % of the profit made since
  // the last payout. null = no consistency rule.
  consistencyPct: number | null
  // Days at or above minDayProfit needed before a payout can be requested.
  minPayoutDays: number | null
  minDayProfit: number | null
}

export interface PropFirmPreset {
  firm: string
  program: string
  profitTargetPct: number | null
  maxDrawdownPct: number
  drawdownType: DrawdownType
  dailyLossLimitPct: number | null
  minTradingDays: number | null
  // Evaluation-stage consistency rule, where the firm has one.
  consistencyPct?: number | null
  sizes?: Record<number, SizeRules>
  funded?: FundedRules
  notes: string
}

export const PROP_FIRM_PRESETS: PropFirmPreset[] = [
  // --- Apex Trader Funding ---
  {
    firm: "Apex Trader Funding",
    program: "Evaluation — Intraday",
    profitTargetPct: 6,
    maxDrawdownPct: 5,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: null,
    notes:
      "No daily loss limit — the real-time trailing threshold is the only risk control, and it moves on unrealized gains too. It locks and stops trailing once you reach starting balance + profit target; this tracker doesn't model that lock, so it can flag a breach in that specific edge case where Apex wouldn't.",
  },
  {
    firm: "Apex Trader Funding",
    program: "Evaluation — EOD",
    profitTargetPct: 6,
    maxDrawdownPct: 5,
    drawdownType: "trailing",
    dailyLossLimitPct: 2,
    minTradingDays: null,
    notes: "Drawdown only recalculates once per day at market close (intraday paper profit doesn't move it) — this tracker's trailing calc is closer to Apex's Intraday model. A daily loss hit pauses trading for the day but doesn't end the account by itself.",
  },
  // --- Bulenox ---
  {
    firm: "Bulenox",
    program: "Evaluation — No Scaling (no daily loss)",
    profitTargetPct: 6,
    maxDrawdownPct: 5,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: null,
    consistencyPct: 40,
    notes: "Real-time trailing drawdown follows peak equity tick by tick, including unrealized gains. Also enforces a 40% consistency rule (no single day above 40% of total profit).",
  },
  {
    firm: "Bulenox",
    program: "Evaluation — With daily loss",
    profitTargetPct: 6,
    maxDrawdownPct: 5,
    drawdownType: "trailing",
    dailyLossLimitPct: 2.2,
    minTradingDays: null,
    consistencyPct: 40,
    notes: "End-of-day trailing drawdown with a daily loss limit as a tradeoff. Same 40% consistency rule as the No Scaling option.",
  },
  // --- Tradeify ---
  {
    firm: "Tradeify",
    program: "Select Evaluation",
    profitTargetPct: 6,
    maxDrawdownPct: 4,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: null,
    notes: "No daily loss limit during evaluation — only the trailing drawdown floor applies. Sources disagreed on whether the trailing drawdown is a flat $1,000 or scales with account size; this uses the size-scaled figure.",
  },
  {
    firm: "Tradeify",
    program: "Growth Evaluation",
    profitTargetPct: 6,
    maxDrawdownPct: 4,
    drawdownType: "trailing",
    dailyLossLimitPct: 2.5,
    minTradingDays: null,
    notes: "Growth adds a daily loss limit that Select doesn't have. Drawdown % assumed the same as Select — not independently confirmed for Growth specifically, so double-check yours.",
  },
  // --- Topstep ---
  {
    firm: "Topstep",
    program: "Trading Combine",
    profitTargetPct: 6,
    maxDrawdownPct: 4,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: null,
    consistencyPct: 50,
    notes: "The Max Loss Limit locks once you reach starting balance + profit target (not modeled). An optional daily loss limit exists but isn't required. Best single day is capped at 50% of the profit target. Newer Topstep accounts run on TopstepX rather than Rithmic, but CSV-imported trades still work here.",
  },
  // --- MyFundedFutures ---
  {
    firm: "MyFundedFutures",
    program: "Pro",
    profitTargetPct: 6,
    maxDrawdownPct: 4,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: null,
    consistencyPct: 50,
    notes: "No daily loss limit on any MyFundedFutures plan — the trailing drawdown is the only hard risk rule, and it locks once you hit the profit target. A 50% consistency rule applies.",
  },
  // --- Take Profit Trader ---
  {
    firm: "Take Profit Trader",
    program: "Test",
    profitTargetPct: 6,
    maxDrawdownPct: 4,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: 5,
    consistencyPct: 50,
    notes: "50% consistency rule applies. Drawdown switches from end-of-day to intraday trailing once you're funded (PRO stage) — this preset is for the Test evaluation only.",
  },
  // --- Leeloo Trading ---
  {
    firm: "Leeloo Trading",
    program: "Evaluation",
    profitTargetPct: 6,
    maxDrawdownPct: 3,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: 10,
    consistencyPct: 30,
    notes: "Uses a 30% single-day rule instead of a hard daily loss limit. Drawdown ranges 2.5–3% depending on the specific account type (Explode variants run lower); confirm yours.",
  },
  // --- Alpha Futures (TheTradingPit) ---
  {
    firm: "Alpha Futures (TheTradingPit)",
    program: "Standard",
    profitTargetPct: 6,
    maxDrawdownPct: 4,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: null,
    consistencyPct: 50,
    notes: "50% consistency rule applies. Drawdown is calculated from the end-of-day closing balance only, not intraday equity.",
  },
  // --- Goat Funded Futures ---
  {
    firm: "Goat Funded Futures",
    program: "EOD Challenge",
    profitTargetPct: 6,
    maxDrawdownPct: 4,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: null,
    consistencyPct: 50,
    notes: "Daily loss limit is a soft-breach system — hitting it pauses that day, and only a 3rd hit within a rolling 30 days closes the account. That's not modeled here, so this preset leaves it off; if you're being strict, treat any daily-loss hit as a warning rather than a hard breach. No minimum trading days. Best day capped at 50% of profit target.",
  },
  // --- Funded Futures Family ---
  // Per-size figures verified against the firm's own published rules
  // (fundedfuturesfamily.com, September 2026). Drawdowns don't scale
  // linearly with size on any FFF plan, so every size is listed. All FFF
  // funded accounts need a day of at least $200 profit for it to count
  // towards a payout.
  {
    firm: "Funded Futures Family",
    program: "Prime",
    profitTargetPct: 6,
    maxDrawdownPct: 4,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: 1,
    sizes: {
      25_000: { profitTarget: 1_250, maxDrawdown: 1_000 },
      50_000: { profitTarget: 3_000, maxDrawdown: 2_000, payoutCap: 2_000 },
      100_000: { profitTarget: 6_000, maxDrawdown: 3_000 },
      150_000: { profitTarget: 9_000, maxDrawdown: 4_500 },
    },
    funded: { consistencyPct: 40, minPayoutDays: 3, minDayProfit: 200 },
    notes:
      "End-of-day trailing drawdown — it recalculates once per day at market close, not on live intraday equity, so this tracker (which walks closed trades) can be slightly stricter than FFF's own. No consistency rule to pass the evaluation; a 40% rule applies to each funded payout, and payouts need 3 days of $200+ profit. The firm advertises a 1-day pass; some third-party sources list 3 days.",
  },
  {
    firm: "Funded Futures Family",
    program: "Velocity",
    profitTargetPct: 8,
    maxDrawdownPct: 4.5,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: 3,
    consistencyPct: 40,
    sizes: {
      25_000: { profitTarget: 2_500, maxDrawdown: 1_250, payoutCap: 750 },
      50_000: { profitTarget: 4_000, maxDrawdown: 2_250, payoutCap: 1_250 },
      100_000: { profitTarget: 7_000, maxDrawdown: 3_250, payoutCap: 2_250 },
      150_000: { profitTarget: 10_000, maxDrawdown: 4_750, payoutCap: 3_250 },
    },
    funded: { consistencyPct: 40, minPayoutDays: 3, minDayProfit: 200 },
    notes:
      "Real-time intraday trailing drawdown at both stages (the same dollar amount once funded), so this tracker's model matches Velocity closely apart from open-position P&L. 40% consistency applies to pass and to every payout, and the calculation resets after each approved payout. Payouts every 3 qualifying days of $200+; the Daily Payout add-on removes the day and consistency requirements, which this tracker doesn't model.",
  },
  {
    firm: "Funded Futures Family",
    program: "Premier+ (EOD)",
    profitTargetPct: 6,
    maxDrawdownPct: 3,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: 1,
    sizes: {
      25_000: { profitTarget: 1_500, maxDrawdown: 750 },
      50_000: { profitTarget: 3_000, maxDrawdown: 1_500 },
      100_000: { profitTarget: 6_000, maxDrawdown: 2_500 },
      150_000: { profitTarget: 9_000, maxDrawdown: 4_000 },
    },
    funded: { consistencyPct: null, minPayoutDays: 5, minDayProfit: 200 },
    notes:
      "End-of-day trailing drawdown variant (the FastPass option) — recalculates once per day at close, so this tracker's closed-trade walk can flag a breach slightly earlier than FFF's own. No consistency rule on standard accounts; payouts need 5 days of $200+ profit.",
  },
  {
    firm: "Funded Futures Family",
    program: "Premier+ (Intraday)",
    profitTargetPct: 6,
    maxDrawdownPct: 4,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: 1,
    sizes: {
      25_000: { profitTarget: 1_500, maxDrawdown: 1_000 },
      50_000: { profitTarget: 3_000, maxDrawdown: 2_000 },
      100_000: { profitTarget: 6_000, maxDrawdown: 3_000 },
      150_000: { profitTarget: 9_000, maxDrawdown: 4_500 },
    },
    funded: { consistencyPct: null, minPayoutDays: 5, minDayProfit: 200 },
    notes: "Real-time intraday trailing drawdown variant, with a bigger drawdown than the EOD option in exchange. No consistency rule on standard accounts; payouts need 5 days of $200+ profit.",
  },
]

export function getPresetPrograms(firm: string): PropFirmPreset[] {
  return PROP_FIRM_PRESETS.filter((p) => p.firm === firm)
}

export function findPreset(firm: string | null | undefined, program: string | null | undefined): PropFirmPreset | null {
  if (!firm || !program) return null
  return PROP_FIRM_PRESETS.find((p) => p.firm === firm && p.program === program) ?? null
}

export const PROP_FIRM_NAMES = Array.from(new Set(PROP_FIRM_PRESETS.map((p) => p.firm)))

// The account sizes a preset lists exact figures for, in order.
export function presetSizes(preset: PropFirmPreset): number[] {
  return Object.keys(preset.sizes ?? {}).map(Number).sort((a, b) => a - b)
}

// The rules as the tracker stores them: dollar thresholds for this account
// size and phase, with the matching percentages for display. Percentages
// are exact where the preset lists the size, and otherwise fall back to the
// preset's representative percentages scaled to the size.
export interface ResolvedRules {
  profitTargetAmount: number | null
  profitTargetPct: number | null
  maxDrawdownAmount: number
  maxDrawdownPct: number
  drawdownType: DrawdownType
  dailyLossLimitAmount: number | null
  dailyLossLimitPct: number | null
  minTradingDays: number | null
  consistencyPct: number | null
  minPayoutDays: number | null
  minDayProfit: number | null
  payoutCap: number | null
  // True when the preset lists this exact account size.
  exactSize: boolean
}

const pctOf = (amount: number, size: number) => Math.round((amount / size) * 10000) / 100
const amountOf = (pct: number, size: number) => Math.round(size * pct) / 100

export function resolvePresetRules(preset: PropFirmPreset, accountSize: number, phase: string): ResolvedRules {
  const size = accountSize > 0 ? accountSize : 50_000
  const sized = preset.sizes?.[size] ?? null
  const funded = phase === "funded"

  const evalTargetAmount = sized ? sized.profitTarget : preset.profitTargetPct != null ? amountOf(preset.profitTargetPct, size) : null
  const evalDrawdown = sized ? sized.maxDrawdown : amountOf(preset.maxDrawdownPct, size)
  const fundedSized = preset.funded?.sizes?.[size] ?? null
  const fundedDrawdown = fundedSized
    ? fundedSized.maxDrawdown
    : preset.funded?.maxDrawdownPct != null
      ? amountOf(preset.funded.maxDrawdownPct, size)
      : evalDrawdown

  const maxDrawdownAmount = funded ? fundedDrawdown : evalDrawdown
  const profitTargetAmount = funded ? null : evalTargetAmount
  const dailyLossLimitAmount = preset.dailyLossLimitPct != null ? amountOf(preset.dailyLossLimitPct, size) : null
  return {
    profitTargetAmount,
    profitTargetPct: profitTargetAmount != null ? pctOf(profitTargetAmount, size) : null,
    maxDrawdownAmount,
    maxDrawdownPct: pctOf(maxDrawdownAmount, size),
    drawdownType: (funded && preset.funded?.drawdownType) || preset.drawdownType,
    dailyLossLimitAmount,
    dailyLossLimitPct: preset.dailyLossLimitPct,
    minTradingDays: funded ? null : preset.minTradingDays,
    consistencyPct: funded ? (preset.funded?.consistencyPct ?? null) : (preset.consistencyPct ?? null),
    minPayoutDays: funded ? (preset.funded?.minPayoutDays ?? null) : null,
    minDayProfit: funded ? (preset.funded?.minDayProfit ?? null) : null,
    payoutCap: funded ? (fundedSized?.payoutCap ?? sized?.payoutCap ?? null) : null,
    exactSize: sized != null,
  }
}
