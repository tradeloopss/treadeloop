// Real evaluation rules for major futures prop firms, researched directly
// (not recalled from memory) as of September 2026 — sourced from each
// firm's own help center / published rules where possible. Percentages are
// normalized against a representative account size (usually $50K) since
// that's how every firm here actually structures pricing — the dollar
// thresholds scale with whatever starting balance the user's account has,
// computed by lib/propfirm-rules.ts.
//
// Most firms offer more than one evaluation structure (e.g. Apex's EOD vs
// Intraday, Bulenox's two DLL options) — those are listed as separate
// entries under the same firm so picking the right one actually matters,
// rather than flattening every firm to a single generic "Evaluation".
//
// These WILL drift out of date — firms change rules over time, and a couple
// of these had genuinely conflicting numbers across sources (called out in
// `notes` where that happened). Each entry's `notes` also flags real
// mechanics this tracker's simple model can't capture (consistency rules,
// drawdown "lock" behavior, soft-breach counters, etc.). Treat this as a
// verified starting point, not a substitute for the firm's own rulebook.
export interface PropFirmPreset {
  firm: string
  program: string
  profitTargetPct: number | null
  maxDrawdownPct: number
  drawdownType: "trailing" | "static"
  dailyLossLimitPct: number | null
  minTradingDays: number | null
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
    notes: "Real-time trailing drawdown follows peak equity tick by tick, including unrealized gains. Also enforces a 40% consistency rule (no single day above 40% of total profit) — not tracked here.",
  },
  {
    firm: "Bulenox",
    program: "Evaluation — With daily loss",
    profitTargetPct: 6,
    maxDrawdownPct: 5,
    drawdownType: "trailing",
    dailyLossLimitPct: 2.2,
    minTradingDays: null,
    notes: "End-of-day trailing drawdown with a daily loss limit as a tradeoff. Same 40% consistency rule as the No Scaling option — not tracked here.",
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
    notes: "The Max Loss Limit locks once you reach starting balance + profit target (not modeled). An optional daily loss limit exists but isn't required. Best single day is capped at 50% of the profit target — not tracked here. Newer Topstep accounts run on TopstepX rather than Rithmic, but CSV-imported trades still work here.",
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
    notes: "No daily loss limit on any MyFundedFutures plan — the trailing drawdown is the only hard risk rule, and it locks once you hit the profit target. A 50% consistency rule applies — not tracked here.",
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
    notes: "50% consistency rule applies — not tracked here. Drawdown switches from end-of-day to intraday trailing once you're funded (PRO stage) — this preset is for the Test evaluation only.",
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
    notes: "Uses a 30% single-day rule instead of a hard daily loss limit — not tracked here. Drawdown ranges 2.5–3% depending on the specific account type (Explode variants run lower); confirm yours.",
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
    notes: "50% consistency rule applies — not tracked here. Drawdown is calculated from the end-of-day closing balance only, not intraday equity.",
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
    notes: "Daily loss limit is a soft-breach system — hitting it pauses that day, and only a 3rd hit within a rolling 30 days closes the account. That's not modeled here, so this preset leaves it off; if you're being strict, treat any daily-loss hit as a warning rather than a hard breach. No minimum trading days. Best day capped at 50% of profit target — not tracked here.",
  },
  // --- Funded Futures Family ---
  {
    firm: "Funded Futures Family",
    program: "Prime",
    profitTargetPct: 5,
    maxDrawdownPct: 4,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: null,
    notes:
      "Drawdown recalculates once per day at market close (end-of-day trailing), not on live intraday equity — this tracker's trailing calc runs closer to an intraday model, so it can be slightly stricter than FFF's own. Sources disagree on a minimum trading day count (one says none, another says 1) — treat 1 as the safe assumption. No consistency rule on the Prime evaluation.",
  },
  {
    firm: "Funded Futures Family",
    program: "Velocity",
    profitTargetPct: 10,
    maxDrawdownPct: 5,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: null,
    notes:
      "Real-time intraday trailing drawdown (unlike Prime's end-of-day version), so this tracker's model matches Velocity closely. Faster funded payouts (3 trading days vs 5) aren't modeled here since this tracker only covers the evaluation phase.",
  },
  {
    firm: "Funded Futures Family",
    program: "Premier+ (EOD)",
    profitTargetPct: 6,
    maxDrawdownPct: 3,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: null,
    notes:
      "End-of-day trailing drawdown variant — recalculates once per day at close, so this tracker's intraday-style trailing calc can flag a breach slightly earlier than FFF's own. $750 max drawdown on a $25K account per the firm's published numbers (3%); one source instead listed $2,250 (9%) for this plan, which we couldn't reconcile — verify against your own account before relying on this.",
  },
  {
    firm: "Funded Futures Family",
    program: "Premier+ (Intraday)",
    profitTargetPct: 6,
    maxDrawdownPct: 4,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: null,
    notes:
      "Real-time intraday trailing drawdown variant. $1,000 max drawdown on a $25K account per the firm's published numbers (4%); one source instead listed $2,250 (9%) for this plan, which we couldn't reconcile — verify against your own account before relying on this.",
  },
]

export function getPresetPrograms(firm: string): PropFirmPreset[] {
  return PROP_FIRM_PRESETS.filter((p) => p.firm === firm)
}

export const PROP_FIRM_NAMES = Array.from(new Set(PROP_FIRM_PRESETS.map((p) => p.firm)))
