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
//
// As of the 2026-09-27 review this also covers the major FOREX/CFD firms
// (assetClass: "forex"). Those firms publish everything as percentages of the
// account balance rather than per-size dollars, so their entries carry
// percentages, not `sizes` tables, and multi-step challenges are modelled as
// one preset per phase ("… — Phase 1" / "… — Phase 2") because a single preset
// only holds one profit target. Every forex and every newly-added futures
// entry carries a `sourceUrl` pointing at the exact rulebook page its numbers
// came from — nothing here is invented; where a specific value genuinely
// couldn't be pinned to a source it's flagged in `notes` and left conservative.
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
  // Which market this firm's accounts trade. Drives the catalog's assetClass
  // and the default account sizes we materialize (forex sells 10K–200K,
  // futures 25K–150K). Defaults to "futures" when omitted (the original
  // presets were all futures firms).
  assetClass?: "futures" | "forex"
  // A link to the exact rulebook page these numbers came from, stamped onto
  // every seeded rule version so the source is one click away.
  sourceUrl?: string
  // When this entry was last checked against the firm's published rules
  // (ISO date). Falls back to the module's review date when omitted.
  verifiedAt?: string
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

  // ===========================================================================
  // NEW FUTURES FIRMS (added 2026-09-27) — sourced from each firm's help center
  // / published rules. Dollar figures listed under `sizes` are verbatim from
  // the source; percentages are the fallback for unlisted sizes.
  // ===========================================================================
  {
    firm: "Lucid Trading",
    program: "LucidFlex Evaluation",
    profitTargetPct: 6,
    maxDrawdownPct: 4,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: 2,
    consistencyPct: 50,
    assetClass: "futures",
    sourceUrl: "https://support.lucidtrading.com/en/articles/12945795-lucidflex-funded-account",
    sizes: {
      50_000: { profitTarget: 3_000, maxDrawdown: 2_000 },
      100_000: { profitTarget: 6_000, maxDrawdown: 3_000 },
    },
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes:
      "LucidFlex evaluation: 6% target ($50K → $3,000, $100K → $6,000) against an end-of-day trailing max loss ($2,000 / $3,000) that stops trailing once it locks at the starting balance + $100. No daily loss limit, 2 minimum trading days, 50% consistency to pass. Funded accounts drop the consistency rule (optional daily loss) and pay 90/10.",
  },
  {
    firm: "FundedNext Futures",
    program: "Flex Challenge",
    profitTargetPct: 5,
    maxDrawdownPct: 3,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: 3,
    consistencyPct: 40,
    assetClass: "futures",
    sourceUrl: "https://helpfutures.fundednext.com/en/articles/14878751-what-is-fundednext-futures-flex-challenge",
    sizes: {
      50_000: { profitTarget: 2_500, maxDrawdown: 1_500 },
    },
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes:
      "Futures Flex challenge (single phase): $50K → $2,500 target with an end-of-day trailing max loss of $1,500 that locks at the starting balance + $100. 40% best-day consistency and at least 3 profitable days to pass; no daily loss limit on Flex. FundedNext also runs Rapid Pro / Rapid Daily models with different rules (some carry a 5% daily loss) — verify your exact plan.",
  },
  {
    firm: "Top One Futures",
    program: "Instant Sim-Funded",
    profitTargetPct: 6,
    maxDrawdownPct: 4,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: null,
    consistencyPct: 20,
    assetClass: "futures",
    sourceUrl: "https://help.toponefutures.com/en/articles/11020805-overview-of-the-instant-sim-funded-program",
    funded: { consistencyPct: 20, minPayoutDays: null, minDayProfit: null },
    notes:
      "Instant Sim-Funded program (no evaluation phase). End-of-day trailing max drawdown fixed per size — $1,000/25K, $2,000/50K, $4,000/100K, $6,000/150K (a flat 4%) — that locks once your balance peaks. No daily loss limit; 10-second minimum hold. The 6% shown is the first-payout profit threshold (then 5%, then 4% for later payouts), not a pass/fail target. No single day may exceed 20% of total profit.",
  },
  {
    firm: "Traders Launch",
    program: "Full Session Evaluation",
    profitTargetPct: 2,
    maxDrawdownPct: 1,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: null,
    assetClass: "futures",
    sourceUrl: "https://propfirmbridge.com/futures-firms/traders-launch-futures-prop-firm-review-2026",
    sizes: {
      100_000: { profitTarget: 2_000, maxDrawdown: 1_000 },
      200_000: { profitTarget: 4_000, maxDrawdown: 2_000 },
      300_000: { profitTarget: 6_000, maxDrawdown: 3_000 },
    },
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes:
      "Full Session evaluation. Unusually low 2% target ($2K/$4K/$6K on 100K/200K/300K) with a very tight 1% end-of-day trailing max loss ($1,000/$2,000/$3,000) that locks at the starting balance. No separate daily loss limit. Contract limits start at 2/4/6 minis (20/40/60 micros). Account sizes are 100K/200K/300K only.",
  },
  {
    firm: "E8 Futures",
    program: "E8 Signature Futures",
    profitTargetPct: 6,
    maxDrawdownPct: 4,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: null,
    assetClass: "futures",
    sourceUrl: "https://helpfutures.e8markets.com/en/articles/10148976-e8-trader-stage-objectives-and-rules-for-model-2",
    sizes: {
      25_000: { profitTarget: 1_500, maxDrawdown: 1_000 },
      50_000: { profitTarget: 3_000, maxDrawdown: 2_000 },
      100_000: { profitTarget: 6_000, maxDrawdown: 3_000 },
      150_000: { profitTarget: 9_000, maxDrawdown: 4_500 },
    },
    funded: { consistencyPct: 35, minPayoutDays: null, minDayProfit: null },
    notes:
      "E8 Signature Futures: flat 6% closed-profit target with an end-of-day trailing max loss (4% on 25K/50K → $1,000/$2,000; 3% on 100K/150K → $3,000/$4,500). No daily loss limit, no consistency rule and no minimum days during evaluation; a 35% best-day rule applies only once funded. Must place and close a trade at least every 60 days.",
  },
  {
    firm: "TradeDay",
    program: "Evaluation (EOD)",
    profitTargetPct: 6,
    maxDrawdownPct: 4,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: 5,
    consistencyPct: 30,
    assetClass: "futures",
    sourceUrl: "https://tradeday.freshdesk.com/en/support/solutions/articles/103000008855-what-is-the-maximum-drawdown-rule-",
    sizes: {
      50_000: { profitTarget: 3_000, maxDrawdown: 2_000 },
      100_000: { profitTarget: 6_000, maxDrawdown: 3_000 },
    },
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes:
      "TradeDay evaluation (EOD model): 6% target ($50K → $3,000, $100K → $6,000) against an end-of-day trailing max loss ($2,000 / $3,000) that stops trailing at the starting balance. No daily loss limit, 5 minimum trading days, 30% consistency. TradeDay also offers Intraday and Static drawdown models; the trailing drawdown becomes static once funded. Per-size target confirmed on 50K/100K; other sizes follow the same 6%.",
  },
  {
    firm: "Blue Guardian Futures",
    program: "Standard Account",
    profitTargetPct: 6,
    maxDrawdownPct: 5,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: null,
    assetClass: "futures",
    sourceUrl: "https://helpfutures.blueguardian.com/en/articles/15654479-standard-account-rules",
    funded: { consistencyPct: 40, minPayoutDays: null, minDayProfit: null },
    notes:
      "Blue Guardian Futures Standard: 6% profit target with an end-of-day trailing max drawdown (a fixed dollar amount per account size, roughly 5% — confirm your size's exact figure) that locks at the starting balance + $100 after your first payout. A 40% consistency rule applies at the funded stage. The Guardian (8% target, no daily loss, 30% consistency), Reserve and Direct models differ — pick the one you bought.",
  },
  {
    firm: "FuturesElite",
    program: "Elite Evaluation",
    profitTargetPct: 6,
    maxDrawdownPct: 4,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: 3,
    assetClass: "futures",
    sourceUrl: "https://joinprop.com/prop-firm/futureselite/",
    sizes: {
      50_000: { profitTarget: 3_000, maxDrawdown: 2_000 },
      100_000: { profitTarget: 6_000, maxDrawdown: 3_000 },
    },
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes:
      "FuturesElite 'Elite' evaluation: per-size targets ($50K → $3,000, $100K → $6,000) over at least 3 trading days, with an end-of-day trailing max loss ($2,000 / $3,000). No daily loss limit and no funded consistency rule on Elite; the trailing drawdown locks at the starting balance after the max is reached in profit or after the first payout. Distinct from the forex firm 'FundedElite'.",
  },
  {
    firm: "DayTraders",
    program: "EOD Account",
    profitTargetPct: 6,
    maxDrawdownPct: 5,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: 2,
    assetClass: "futures",
    sourceUrl: "https://daytraders.com/help/articles/14473672-eod-account-rules",
    sizes: {
      50_000: { profitTarget: 3_000, maxDrawdown: 2_500 },
      100_000: { profitTarget: 6_000, maxDrawdown: 3_000 },
    },
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes:
      "DayTraders.com EOD account: 6% target ($50K → $3,000, $100K → $6,000) against an end-of-day trailing max loss ($2,500 / $3,000) that locks at the starting balance. Minimum 2 qualifying days (a day whose net profit meets the account's minimum and passes the consistency rule). DayTraders also sells Intraday-Trailing, Static, S2F and S2L account types with their own figures — this is the EOD model.",
  },

  // ===========================================================================
  // FOREX / CFD FIRMS (added 2026-09-27) — percentages of the account balance,
  // sourced from each firm's rulebook. Multi-step challenges are one preset per
  // phase; the final step carries a `funded` block so the funded stage is
  // selectable. Firms sell many models — the notes name which one this is.
  // ===========================================================================

  // --- FundedNext (forex/CFD) ---
  {
    firm: "FundedNext",
    program: "Stellar 2-Step — Phase 1",
    profitTargetPct: 8,
    maxDrawdownPct: 10,
    drawdownType: "static",
    dailyLossLimitPct: 5,
    minTradingDays: 5,
    assetClass: "forex",
    sourceUrl: "https://fundednext.com/cfds/stellar-2-step",
    notes:
      "Stellar 2-Step CFD challenge, Phase 1 (8% target). The 10% max loss is static (equity must stay above 90% of the initial balance); the 5% daily loss is measured from the day's starting balance. Both phases need 5 trading days.",
  },
  {
    firm: "FundedNext",
    program: "Stellar 2-Step — Phase 2",
    profitTargetPct: 5,
    maxDrawdownPct: 10,
    drawdownType: "static",
    dailyLossLimitPct: 5,
    minTradingDays: 5,
    assetClass: "forex",
    sourceUrl: "https://fundednext.com/cfds/stellar-2-step",
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes:
      "Stellar 2-Step Phase 2 (5% target). Same 10% static max loss and 5% daily loss as Phase 1. The funded stage keeps those limits with no profit target and pays an 80% split (select the 'funded' phase).",
  },

  // --- FundingPips ---
  {
    firm: "FundingPips",
    program: "2-Step Standard — Phase 1",
    profitTargetPct: 8,
    maxDrawdownPct: 10,
    drawdownType: "static",
    dailyLossLimitPct: 5,
    minTradingDays: 3,
    assetClass: "forex",
    sourceUrl: "https://help.fundingpips.com/hc/en-us/articles/34501809112081-2-Step-Standard",
    notes:
      "2-Step Standard Phase 1 (8% target). 10% overall max loss is static on the initial balance; the 5% daily loss is on the higher of the day's starting balance or equity. 3 trading days per phase. (The 10% Phase-1 target option was retired 24 July 2026.)",
  },
  {
    firm: "FundingPips",
    program: "2-Step Standard — Phase 2",
    profitTargetPct: 5,
    maxDrawdownPct: 10,
    drawdownType: "static",
    dailyLossLimitPct: 5,
    minTradingDays: 3,
    assetClass: "forex",
    sourceUrl: "https://help.fundingpips.com/hc/en-us/articles/34501809112081-2-Step-Standard",
    funded: { consistencyPct: 35, minPayoutDays: null, minDayProfit: null },
    notes:
      "2-Step Standard Phase 2 (5% target). No consistency rule to pass; once funded a 35% best-day rule caps how much of a payout period's profit any one day can be.",
  },

  // --- E8 Markets (forex) ---
  {
    firm: "E8 Markets",
    program: "E8 One (8% drawdown track)",
    profitTargetPct: 12,
    maxDrawdownPct: 8,
    drawdownType: "static",
    dailyLossLimitPct: 5.3,
    minTradingDays: null,
    assetClass: "forex",
    sourceUrl: "https://help.e8markets.com/en/articles/11775980-e8-one",
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes:
      "E8 One is fully configurable: pick a max drawdown of 4/6/8/10/14% (the profit target is 1.5× that = 6/9/12/15/21%) with the paired daily loss of 3/4/5.3/6.6/9.2%. This preset is the 8%-drawdown track (12% target, 5.3% daily). All drawdown is static on the initial balance; no minimum days (one trade every 60 days keeps it active). Adjust to the track you bought.",
  },

  // --- BrightFunded ---
  {
    firm: "BrightFunded",
    program: "2-Step Bright — Phase 1",
    profitTargetPct: 8,
    maxDrawdownPct: 8,
    drawdownType: "static",
    dailyLossLimitPct: 4,
    minTradingDays: 5,
    assetClass: "forex",
    sourceUrl: "https://brightfunded.com/",
    notes:
      "2-Step Bright Phase 1 (8% target). Both the 8% max loss and 4% daily loss are static (fixed from the starting balance — they never move). 5 trading days per phase. Sources differ on whether the overall cap is 8% (this Bright plan) or 10% (the Classic plan) — confirm which you bought.",
  },
  {
    firm: "BrightFunded",
    program: "2-Step Bright — Phase 2",
    profitTargetPct: 5,
    maxDrawdownPct: 8,
    drawdownType: "static",
    dailyLossLimitPct: 4,
    minTradingDays: 5,
    assetClass: "forex",
    sourceUrl: "https://brightfunded.com/",
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes:
      "2-Step Bright Phase 2 (5% target). Same 8% static max loss and 4% static daily loss. BrightFunded advertises up to a 100% split on early payouts.",
  },

  // --- The5ers ---
  {
    firm: "The5ers",
    program: "High Stakes — Phase 1",
    profitTargetPct: 10,
    maxDrawdownPct: 10,
    drawdownType: "static",
    dailyLossLimitPct: 5,
    minTradingDays: 3,
    assetClass: "forex",
    sourceUrl: "https://the5ers.com/challenge-programs-bootcamp-high-stakes-hyper-growth-explained/",
    notes:
      "High Stakes 2-step Phase 1 (10% target). 10% overall max loss and 5% daily loss on the initial balance. Each step needs 3 'profitable' days of at least 0.5% of the initial balance (not just any trading day).",
  },
  {
    firm: "The5ers",
    program: "High Stakes — Phase 2",
    profitTargetPct: 5,
    maxDrawdownPct: 10,
    drawdownType: "static",
    dailyLossLimitPct: 5,
    minTradingDays: 3,
    assetClass: "forex",
    sourceUrl: "https://the5ers.com/challenge-programs-bootcamp-high-stakes-hyper-growth-explained/",
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes:
      "High Stakes Phase 2 (5% target). Same 10% max loss and 5% daily loss; again 3 profitable days of 0.5%+. Funding starts at an 80% split.",
  },
  {
    firm: "The5ers",
    program: "Hyper Growth (1-Step, $25K)",
    profitTargetPct: 10,
    maxDrawdownPct: 6,
    drawdownType: "static",
    dailyLossLimitPct: 3,
    minTradingDays: null,
    assetClass: "forex",
    sourceUrl: "https://the5ers.com/hyper-growth/",
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes:
      "Hyper Growth is a one-step $25K program: a single 10% target with a tighter 6% max loss and 3% daily loss, then instant funding.",
  },

  // --- Alpha Capital ---
  {
    firm: "Alpha Capital",
    program: "Alpha Pro — Phase 1",
    profitTargetPct: 8,
    maxDrawdownPct: 8,
    drawdownType: "static",
    dailyLossLimitPct: 5,
    minTradingDays: 3,
    assetClass: "forex",
    sourceUrl: "https://alphacapitalgroup.uk/",
    notes:
      "Alpha Pro 8% two-step, Phase 1 (8% target, 8% static max loss = the account's fixed dollar max). Daily loss is 3–5% off the day's starting balance/equity (5% shown). 3 trading days per phase. Alpha also sells 6%- and 10%-drawdown tracks. Average trade duration must exceed 2 minutes and ≥50% of profit must come from trades held over 2 minutes (not modelled here).",
  },
  {
    firm: "Alpha Capital",
    program: "Alpha Pro — Phase 2",
    profitTargetPct: 5,
    maxDrawdownPct: 8,
    drawdownType: "static",
    dailyLossLimitPct: 5,
    minTradingDays: 3,
    assetClass: "forex",
    sourceUrl: "https://alphacapitalgroup.uk/",
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes: "Alpha Pro Phase 2 (5% target). Same 8% static max loss; 3 trading days.",
  },

  // --- AquaFunded ---
  {
    firm: "AquaFunded",
    program: "2-Step Standard — Phase 1",
    profitTargetPct: 8,
    maxDrawdownPct: 8,
    drawdownType: "static",
    dailyLossLimitPct: 3,
    minTradingDays: null,
    assetClass: "forex",
    sourceUrl: "https://help.aquafunded.com/en/articles/15281226-2-step-standard",
    notes:
      "2-Step Standard Phase 1 (8% target). 8% overall max loss is static on the initial balance; 3% daily loss, reset 00:00 UTC. AquaFunded's 2-Step Pro uses a 10% trailing drawdown instead — this is the Standard (static) model.",
  },
  {
    firm: "AquaFunded",
    program: "2-Step Standard — Phase 2",
    profitTargetPct: 5,
    maxDrawdownPct: 8,
    drawdownType: "static",
    dailyLossLimitPct: 3,
    minTradingDays: null,
    assetClass: "forex",
    sourceUrl: "https://help.aquafunded.com/en/articles/15281226-2-step-standard",
    funded: { consistencyPct: 15, minPayoutDays: null, minDayProfit: null },
    notes:
      "2-Step Standard Phase 2 (5% target). Funded payouts need the best day under 15% of total profit (breaking it blocks the payout, not the account).",
  },

  // --- Crypto Fund Trader ---
  {
    firm: "Crypto Fund Trader",
    program: "2-Step — Phase 1",
    profitTargetPct: 8,
    maxDrawdownPct: 12,
    drawdownType: "static",
    dailyLossLimitPct: 5,
    minTradingDays: 3,
    assetClass: "forex",
    sourceUrl: "https://cryptofundtrader.com/",
    notes:
      "2-Step challenge Phase 1 (8% target). 12% overall max loss with a 5% daily loss on equity (reset 00:05 UTC). The 1-step and instant variants use a trailing drawdown instead. EAs, news and copy trading are allowed.",
  },
  {
    firm: "Crypto Fund Trader",
    program: "2-Step — Phase 2",
    profitTargetPct: 4,
    maxDrawdownPct: 12,
    drawdownType: "static",
    dailyLossLimitPct: 5,
    minTradingDays: 3,
    assetClass: "forex",
    sourceUrl: "https://cryptofundtrader.com/",
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes: "2-Step Phase 2 (4% target). Same 12% max loss and 5% daily loss.",
  },

  // --- Moneta Funded ---
  {
    firm: "Moneta Funded",
    program: "1-Step Challenge",
    profitTargetPct: 12,
    maxDrawdownPct: 6,
    drawdownType: "trailing",
    dailyLossLimitPct: 3,
    minTradingDays: null,
    consistencyPct: 20,
    assetClass: "forex",
    sourceUrl: "https://www.monetafunded.com/general-rules/",
    funded: { consistencyPct: 20, minPayoutDays: null, minDayProfit: null },
    notes:
      "1-Step Challenge: 12% target, 6% trailing max loss, 3% daily loss. A consistency cap (15% or 20% depending on the add-on) limits any single day's share of profit; 20% shown.",
  },
  {
    firm: "Moneta Funded",
    program: "2-Step — Phase 1",
    profitTargetPct: 5,
    maxDrawdownPct: 10,
    drawdownType: "static",
    dailyLossLimitPct: 4,
    minTradingDays: null,
    assetClass: "forex",
    sourceUrl: "https://www.monetafunded.com/general-rules/",
    notes:
      "2-Step Phase 1. 10% static max loss, 4% daily loss. Sources list the two-step targets as 5% (Phase 1) then 10% (Phase 2) — an unusually reversed order, so verify against your dashboard. Max loss is 8% or 10% depending on the add-on (10% shown).",
  },
  {
    firm: "Moneta Funded",
    program: "2-Step — Phase 2",
    profitTargetPct: 10,
    maxDrawdownPct: 10,
    drawdownType: "static",
    dailyLossLimitPct: 4,
    minTradingDays: null,
    assetClass: "forex",
    sourceUrl: "https://www.monetafunded.com/general-rules/",
    funded: { consistencyPct: 20, minPayoutDays: null, minDayProfit: null },
    notes:
      "2-Step Phase 2 (10% target per published rules — confirm, as this is higher than Phase 1). Same 10% static max loss and 4% daily loss.",
  },

  // --- Top One Trader ---
  {
    firm: "Top One Trader",
    program: "1-Step Flash",
    profitTargetPct: 10,
    maxDrawdownPct: 7,
    drawdownType: "trailing",
    dailyLossLimitPct: 4,
    minTradingDays: 3,
    assetClass: "forex",
    sourceUrl: "https://help.toponetrader.com/en/articles/8318230-what-are-the-rules-for-the-1-step-flash-challenge-account",
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes:
      "1-Step Flash: 10% target, 7% trailing max drawdown, 4% daily loss, and at least 3 profitable trading days. On a payout request the max drawdown locks to your starting balance and stops trailing (not modelled). Funded Flash accounts add a 3% daily profit cap.",
  },

  // --- Blue Guardian (forex/CFD) ---
  {
    firm: "Blue Guardian",
    program: "2-Step Pro — Phase 1",
    profitTargetPct: 10,
    maxDrawdownPct: 10,
    drawdownType: "trailing",
    dailyLossLimitPct: 4,
    minTradingDays: null,
    assetClass: "forex",
    sourceUrl: "https://help.blueguardian.com/en/articles/14062433-2-step-pro-rules",
    notes:
      "2-Step Pro (CFD) Phase 1 (10% target). The 10% max drawdown is trailing (relative to peak); 4% daily loss on the higher of balance/equity, reset 5pm EST. Blue Guardian also sells 2-Step Standard (8%→4%) and Nano (8%→5%, 3% daily) — pick your model.",
  },
  {
    firm: "Blue Guardian",
    program: "2-Step Pro — Phase 2",
    profitTargetPct: 4,
    maxDrawdownPct: 10,
    drawdownType: "trailing",
    dailyLossLimitPct: 4,
    minTradingDays: null,
    assetClass: "forex",
    sourceUrl: "https://help.blueguardian.com/en/articles/14062433-2-step-pro-rules",
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes: "2-Step Pro Phase 2 (4% target). Same 10% trailing max drawdown and 4% daily loss.",
  },

  // --- Atmos Funded ---
  {
    firm: "Atmos Funded",
    program: "1-Step Standard",
    profitTargetPct: 10,
    maxDrawdownPct: 6,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: null,
    assetClass: "forex",
    sourceUrl: "https://atmosfunded.com/rules/",
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes:
      "1-Step Standard: 10% target with a 6% trailing max loss (adjusts up as the balance grows and locks after your first payout).",
  },
  {
    firm: "Atmos Funded",
    program: "1-Step Plus",
    profitTargetPct: 6,
    maxDrawdownPct: 3,
    drawdownType: "trailing",
    dailyLossLimitPct: null,
    minTradingDays: null,
    consistencyPct: 45,
    assetClass: "forex",
    sourceUrl: "https://atmosfunded.com/rules/",
    funded: { consistencyPct: 45, minPayoutDays: null, minDayProfit: null },
    notes: "1-Step Plus: 6% target, a tight 3% trailing max loss, no daily loss limit, and a 45% consistency rule.",
  },
  {
    firm: "Atmos Funded",
    program: "Nova Challenge",
    profitTargetPct: 5,
    maxDrawdownPct: 8,
    drawdownType: "trailing",
    dailyLossLimitPct: 4,
    minTradingDays: null,
    assetClass: "forex",
    sourceUrl: "https://atmosfunded.com/rules/",
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes: "Nova Challenge: 5% target, 8% trailing max loss, 4% daily loss.",
  },

  // --- Hola Prime ---
  {
    firm: "Hola Prime",
    program: "2-Step Prime — Phase 1",
    profitTargetPct: 8,
    maxDrawdownPct: 10,
    drawdownType: "trailing",
    dailyLossLimitPct: 5,
    minTradingDays: 3,
    assetClass: "forex",
    sourceUrl: "https://holaprime.com/forex/faq/hola-prime-challenges/hola-prime-2-step-prime-challenge/",
    notes: "2-Step Prime Phase 1 (8% target). 10% max drawdown is trailing; 5% daily loss. 3 trading days per phase.",
  },
  {
    firm: "Hola Prime",
    program: "2-Step Prime — Phase 2",
    profitTargetPct: 5,
    maxDrawdownPct: 10,
    drawdownType: "trailing",
    dailyLossLimitPct: 5,
    minTradingDays: 3,
    assetClass: "forex",
    sourceUrl: "https://holaprime.com/forex/faq/hola-prime-challenges/hola-prime-2-step-prime-challenge/",
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes: "2-Step Prime Phase 2 (5% target). Same 10% trailing max drawdown and 5% daily loss.",
  },

  // --- FundedElite (forex — distinct from FuturesElite) ---
  {
    firm: "FundedElite",
    program: "2-Step — Phase 1",
    profitTargetPct: 8,
    maxDrawdownPct: 8,
    drawdownType: "static",
    dailyLossLimitPct: 5,
    minTradingDays: 3,
    assetClass: "forex",
    sourceUrl: "https://propfirmmatch.com/prop-firms/fundedelite/challenges",
    notes:
      "2-Step evaluation Phase 1 (8% target). 8% max loss is static; daily loss 3–5% depending on plan (5% shown). 3 trading days minimum. Scalping under ~30s–3min and HFT are prohibited (not modelled). Distinct from the futures firm 'FuturesElite'.",
  },
  {
    firm: "FundedElite",
    program: "2-Step — Phase 2",
    profitTargetPct: 5,
    maxDrawdownPct: 8,
    drawdownType: "static",
    dailyLossLimitPct: 5,
    minTradingDays: 3,
    assetClass: "forex",
    sourceUrl: "https://propfirmmatch.com/prop-firms/fundedelite/challenges",
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes: "2-Step Phase 2 (5% target). Same 8% static max loss.",
  },

  // --- Maven (Maven Trading) ---
  {
    firm: "Maven",
    program: "1-Step",
    profitTargetPct: 8,
    maxDrawdownPct: 5,
    drawdownType: "trailing",
    dailyLossLimitPct: 3,
    minTradingDays: null,
    assetClass: "forex",
    sourceUrl: "https://propjournal.net/prop-firms/maven-trading/rules",
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes: "Maven 1-Step: 8% target, 5% trailing max drawdown, 3% daily loss, no minimum days.",
  },
  {
    firm: "Maven",
    program: "2-Step — Phase 1",
    profitTargetPct: 8,
    maxDrawdownPct: 8,
    drawdownType: "static",
    dailyLossLimitPct: 4,
    minTradingDays: 4,
    assetClass: "forex",
    sourceUrl: "https://propjournal.net/prop-firms/maven-trading/rules",
    notes:
      "Maven 2-Step Phase 1 (8% target). The 1-step's trailing model becomes an 8% static max drawdown here, with a 4% daily loss and 4 minimum trading days.",
  },
  {
    firm: "Maven",
    program: "2-Step — Phase 2",
    profitTargetPct: 5,
    maxDrawdownPct: 8,
    drawdownType: "static",
    dailyLossLimitPct: 4,
    minTradingDays: 4,
    assetClass: "forex",
    sourceUrl: "https://propjournal.net/prop-firms/maven-trading/rules",
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes:
      "Maven 2-Step Phase 2 (5% target). Same 8% static max drawdown and 4% daily loss. Reviewers note a $10K payout cap.",
  },

  // ===========================================================================
  // ADDITIONAL PLANS (added 2026-09-27) — alternate models for firms already
  // listed above (1-step vs 2-step, Standard vs Pro), so a firm's other
  // published challenges are selectable too. Same sourcing discipline.
  // ===========================================================================

  // --- FundedNext (1-step) ---
  {
    firm: "FundedNext",
    program: "Stellar 1-Step",
    profitTargetPct: 10,
    maxDrawdownPct: 6,
    drawdownType: "static",
    dailyLossLimitPct: 3,
    minTradingDays: 2,
    assetClass: "forex",
    sourceUrl: "https://fundednext.com/cfds/stellar-1-step",
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes:
      "Stellar 1-Step CFD challenge: 10% target, 6% overall max loss (equity must stay above 94% of the initial balance — static) and 3% daily loss. At least 2 trading days; 5-day reward cycle.",
  },

  // --- FundingPips (1-step) ---
  {
    firm: "FundingPips",
    program: "1-Step Standard",
    profitTargetPct: 10,
    maxDrawdownPct: 6,
    drawdownType: "static",
    dailyLossLimitPct: 3,
    minTradingDays: null,
    assetClass: "forex",
    sourceUrl: "https://fundingpips.com/",
    funded: { consistencyPct: 35, minPayoutDays: null, minDayProfit: null },
    notes:
      "1-Step Standard: 10% target, 6% static max loss, 3% daily loss, no minimum trading days. A 35% best-day rule applies to funded payouts.",
  },

  // --- BrightFunded (2-Step Classic) ---
  {
    firm: "BrightFunded",
    program: "2-Step Classic — Phase 1",
    profitTargetPct: 10,
    maxDrawdownPct: 10,
    drawdownType: "static",
    dailyLossLimitPct: 5,
    minTradingDays: 5,
    assetClass: "forex",
    sourceUrl: "https://brightfunded.com/",
    notes:
      "2-Step Classic Phase 1 (10% target). More room than the Bright plan: 5% daily loss and a 10% static max loss (both fixed from the starting balance). 5 trading days per phase.",
  },
  {
    firm: "BrightFunded",
    program: "2-Step Classic — Phase 2",
    profitTargetPct: 5,
    maxDrawdownPct: 10,
    drawdownType: "static",
    dailyLossLimitPct: 5,
    minTradingDays: 5,
    assetClass: "forex",
    sourceUrl: "https://brightfunded.com/",
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes: "2-Step Classic Phase 2 (5% target). Same 10% static max loss and 5% daily loss.",
  },

  // --- The5ers (Bootcamp) ---
  {
    firm: "The5ers",
    program: "Bootcamp (3-step)",
    profitTargetPct: 6,
    maxDrawdownPct: 5,
    drawdownType: "static",
    dailyLossLimitPct: 5,
    minTradingDays: null,
    assetClass: "forex",
    sourceUrl: "https://the5ers.com/challenge-programs-bootcamp-high-stakes-hyper-growth-explained/",
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes:
      "Bootcamp is a low-cost 3-step scaling program: three 6% steps (then 5% once funded) against a strict 5% max loss and 5% daily loss (a 3% daily pause applies only once funded). A stop-loss is required on every trade (not modelled). This preset represents one 6% step.",
  },

  // --- Alpha Capital (Alpha Pro 6% track) ---
  {
    firm: "Alpha Capital",
    program: "Alpha Pro 6% — Phase 1",
    profitTargetPct: 6,
    maxDrawdownPct: 6,
    drawdownType: "static",
    dailyLossLimitPct: 5,
    minTradingDays: 3,
    assetClass: "forex",
    sourceUrl: "https://alphacapitalgroup.uk/",
    notes:
      "Alpha Pro 6% two-step, Phase 1: a 6% target with a matching 6% static max loss (1:1). Daily loss 3–5% off the day's start (5% shown). 3 trading days per phase.",
  },
  {
    firm: "Alpha Capital",
    program: "Alpha Pro 6% — Phase 2",
    profitTargetPct: 6,
    maxDrawdownPct: 6,
    drawdownType: "static",
    dailyLossLimitPct: 5,
    minTradingDays: 3,
    assetClass: "forex",
    sourceUrl: "https://alphacapitalgroup.uk/",
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes: "Alpha Pro 6% Phase 2: another 6% target within the same 6% static max loss.",
  },

  // --- AquaFunded (2-Step Pro, trailing) ---
  {
    firm: "AquaFunded",
    program: "2-Step Pro — Phase 1",
    profitTargetPct: 8,
    maxDrawdownPct: 10,
    drawdownType: "trailing",
    dailyLossLimitPct: 3,
    minTradingDays: null,
    assetClass: "forex",
    sourceUrl: "https://help.aquafunded.com/en/articles/15281229-2-step-pro",
    notes:
      "2-Step Pro Phase 1 (8% target). Unlike the Standard model, the 10% max loss is trailing (relative to peak); 3% daily loss, reset 00:00 UTC.",
  },
  {
    firm: "AquaFunded",
    program: "2-Step Pro — Phase 2",
    profitTargetPct: 5,
    maxDrawdownPct: 10,
    drawdownType: "trailing",
    dailyLossLimitPct: 3,
    minTradingDays: null,
    assetClass: "forex",
    sourceUrl: "https://help.aquafunded.com/en/articles/15281229-2-step-pro",
    funded: { consistencyPct: 15, minPayoutDays: null, minDayProfit: null },
    notes:
      "2-Step Pro Phase 2 (5% target). Same 10% trailing max loss and 3% daily loss; funded payouts keep the 15% best-day rule.",
  },

  // --- Hola Prime (1-step) ---
  {
    firm: "Hola Prime",
    program: "1-Step Prime",
    profitTargetPct: 10,
    maxDrawdownPct: 6,
    drawdownType: "trailing",
    dailyLossLimitPct: 3,
    minTradingDays: 2,
    assetClass: "forex",
    sourceUrl: "https://holaprime.com/",
    funded: { consistencyPct: null, minPayoutDays: null, minDayProfit: null },
    notes:
      "1-Step Prime: 10% target, 6% max drawdown (trailing), 3% daily loss, at least 2 trading days. Some sources list a 6%-target variant — confirm your account type.",
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
