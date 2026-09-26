// PropFirm Max rule engine — the shared vocabulary. Deliberately plain
// TypeScript (no enums, no parameter properties) so the pure engine runs
// under Node's type-stripping in tests.
//
// The engine is config-driven: a firm's rules are DATA (a map of rule configs
// on a versioned RuleSet), and each rule TYPE is one evaluator module. Adding
// a firm is data; adding a rule type is one evaluator. The UI only ever sees
// RuleResult, never firm-specific branching.

// Every rule type the engine can evaluate. New types are added here + one
// evaluator in lib/propmax/rules. Not every account has every rule.
export type RuleType =
  | "max_daily_loss"
  | "max_drawdown"
  | "profit_target"
  | "min_trading_days"
  | "max_trading_days"
  | "consistency"
  | "max_position_size"
  | "max_contracts"
  | "max_open_positions"
  | "inactivity"
  | "weekend_holding"
  | "news_restriction"
  | "min_trade_duration"

// How close a rule is to being broken. UNKNOWN/STALE exist so the engine never
// shows false safety when it can't actually verify a rule (spec §52, §73).
export type RuleStatus =
  | "safe"
  | "watch"
  | "warning"
  | "critical"
  | "breached"
  | "not_applicable"
  | "unknown"
  | "stale"

// What crossing the limit means for the account.
export type Severity = "info" | "warning" | "soft_breach" | "hard_breach" | "account_failure"

export type Unit = "currency" | "percentage" | "count" | "days" | "minutes"

// How a threshold is measured. Firms differ, so this is explicit per rule.
export type DailyLossBasis = "start_of_day_equity" | "start_of_day_balance" | "prior_day_balance"
export type DrawdownModel = "trailing" | "static" | "eod"

// One rule's configuration, as stored on a RuleSet version (JSON). `type`
// selects the evaluator; the rest is read by that evaluator. A value is a
// currency amount or a percentage of the starting balance depending on `unit`.
export interface RuleConfig {
  type: RuleType
  // Absent/"none" means the firm has no such rule → the evaluator returns
  // not_applicable rather than guessing.
  enabled?: boolean
  unit?: Unit
  value?: number | null
  // rule-specific knobs (only the ones a given type reads)
  basis?: DailyLossBasis // max_daily_loss
  model?: DrawdownModel // max_drawdown
  severity?: Severity // override the type's default
  // consistency: largest day may be at most `value`% of the profit measured.
  // max_position_size: value is lots/contracts; symbol optional for per-symbol.
  symbol?: string | null
  // human note carried from the source (shown under the rule)
  note?: string | null
}

// Provenance for a rule set version (spec §38). Never invented.
export interface RuleSource {
  name: string // "Apex official rules", "Prop Firm Match", …
  url?: string | null
  type: "official_rules" | "official_help_center" | "program_docs" | "propfirmmatch" | "other"
  verifiedAt?: string | null // ISO
  confidence: "high" | "medium" | "low"
}

// A closed trade the engine reasons over (realized P&L). Mapped from the
// canonical `trades` table.
export interface EngineTrade {
  exitTime: string // ISO — realized at close
  entryTime: string // ISO
  pnl: number // net of fees
  symbol: string
  side: "long" | "short"
  quantity: number
}

// A currently-open position, when the broker gives us one (live risk). Any
// field the broker doesn't report is null, and the engine degrades to
// not_applicable/unknown rather than guessing.
export interface OpenPosition {
  symbol: string
  side: "long" | "short"
  quantity: number
  openedAt?: string | null
  unrealizedPnl?: number | null
  riskIfStopHit?: number | null // signed loss if SL is hit, when SL known
}

// Everything an evaluator needs. Built once by lib/propmax/context.ts so each
// evaluator stays a pure function of (config, context).
export interface EngineContext {
  startingBalance: number
  currency: string
  // Realized balance = startingBalance + net P&L (+ opening adjustment) −
  // payouts. Equity is the live figure when the broker reports one, else null.
  balance: number
  equity: number | null
  highWaterMark: number
  // Per-day realized P&L, ascending, in the account's reset timezone.
  daily: { date: string; pnl: number }[]
  trades: EngineTrade[]
  openPositions: OpenPosition[]
  now: Date
  // When the account's data was last synced; drives STALE. Null = never/manual.
  lastSyncAt: Date | null
  stale: boolean
  // True when this account's broker actually reports open positions (even if
  // there are none right now). When false, position-count and weekend rules
  // return UNKNOWN instead of a false "safe" (spec §73).
  livePositionsAvailable: boolean
}

// The engine's per-rule output (spec §70). The UI renders only this.
export interface RuleResult {
  type: RuleType
  name: string
  status: RuleStatus
  severity: Severity
  unit: Unit
  currentValue: number | null
  limitValue: number | null
  remainingValue: number | null
  percentageUsed: number | null
  distanceToBreach: number | null
  explanation: string
  source: RuleSource | null
  evaluatedAt: string // ISO
  dataFresh: boolean
}

// One evaluator: pure, total, never throws — an unknown/insufficient input
// yields a RuleResult with status "unknown", never a guess.
export interface RuleEvaluator {
  type: RuleType
  name: string
  defaultSeverity: Severity
  unit: Unit
  evaluate: (config: RuleConfig, ctx: EngineContext, source: RuleSource | null) => RuleResult
}
