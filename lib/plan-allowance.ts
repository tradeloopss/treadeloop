// What the Essential plan includes (Pro has no limits): up to 3 trading
// accounts, and live sync for one of them — through MetaTrader 4 or 5 only
// (Rithmic and TradingView sync stay Pro). No server imports here, so the
// Accounts page can show the same numbers and wording; the checks themselves
// are in lib/plan-limits.ts.
export const ESSENTIAL_ACCOUNT_LIMIT = 3
export const ESSENTIAL_METATRADER_LIMIT = 1

export const ACCOUNT_LIMIT_MESSAGE = `Essential includes up to ${ESSENTIAL_ACCOUNT_LIMIT} trading accounts — upgrade to Pro at /pricing for unlimited accounts.`
export const METATRADER_LIMIT_MESSAGE =
  "Essential includes live sync for 1 MetaTrader account. Disconnect the one you have to connect a different one, or upgrade to Pro at /pricing to sync more."

// An Essential user's allowance as the Accounts page shows it (null on Pro).
export interface PlanUsage {
  accounts: number
  accountLimit: number
  metatrader: number
  metatraderLimit: number
}
