// Pure helpers for making sense of what a broker reports about an account.
// Kept free of database and network code so they can be tested on their own.

// The subset of Rithmic's RMS limits that matter here (lib/rithmic-client.ts
// RithmicAccountRms satisfies this).
export interface BrokerRiskLimits {
  autoLiquidateThreshold: number | null
  minAccountBalance: number | null
}

// The account sizes prop firms actually sell.
export const STANDARD_ACCOUNT_SIZES = [10_000, 25_000, 50_000, 75_000, 100_000, 150_000, 200_000, 250_000, 300_000]

// Many firms put the size in the Rithmic account id or name ("BX50K-…",
// "MFFU-100K-…", "TPT150K…"). Only an explicit "<n>K" that is a size firms
// sell counts, so an order or customer number is never mistaken for one.
export function sizeFromAccountName(...names: (string | null | undefined)[]): number | null {
  for (const name of names) {
    if (!name) continue
    for (const match of name.toUpperCase().matchAll(/(?<!\d)(\d{2,3})\s?K(?!\d)/g)) {
      const size = Number(match[1]) * 1000
      if (STANDARD_ACCOUNT_SIZES.includes(size)) return size
    }
  }
  return null
}

// Rithmic doesn't report an account's starting size, only its balance now.
// Working the size back means taking the realized P&L (and any payouts,
// which leave the account) back out of that balance:
//
//  - a size written into the account's own id or name wins outright;
//  - when the trades on file explain the balance to within 3% of a size
//    firms sell, it's that size — the gap is commissions and fees, which
//    the fill history doesn't carry;
//  - otherwise the fill history is incomplete (Rithmic only keeps recent
//    fills, so a funded account that has been trading for months has
//    profit the trades don't show). An account is never more than a few
//    percent below its size — the drawdown would have closed it — so the
//    largest size the balance could still be alive on is the best guess;
//  - a balance too small or too large for any prop-firm size is a plain
//    broker account: keep it as it is, to the nearest $100.
export function inferStartingBalance(
  currentBalance: number,
  netRealizedPnl: number,
  options: { payouts?: number; accountNames?: (string | null | undefined)[] } = {},
): number {
  const named = sizeFromAccountName(...(options.accountNames ?? []))
  if (named != null) return named

  const raw = currentBalance - netRealizedPnl + (options.payouts ?? 0)
  const exact = STANDARD_ACCOUNT_SIZES.find((size) => Math.abs(raw - size) / size <= 0.03)
  if (exact != null) return exact

  const survivable = STANDARD_ACCOUNT_SIZES.filter((size) => raw >= size * 0.9 && raw <= size * 1.5)
  if (survivable.length > 0) return survivable[survivable.length - 1]

  return Math.max(0, Math.round(raw / 100) * 100)
}

// What Rithmic's risk system says the account is liquidated at: the explicit
// auto-liquidate threshold when the firm sets one, else the minimum account
// balance. Only trusted when it sits where a drawdown floor would — below
// the balance and within the balance's own order of magnitude — since some
// firms leave these fields at margin-style or placeholder values.
export function brokerDrawdownFloor(balance: number, rms: BrokerRiskLimits | undefined, snapshot: { minAccountBalance: number | null }): number | null {
  const candidate = rms?.autoLiquidateThreshold ?? rms?.minAccountBalance ?? snapshot.minAccountBalance
  if (candidate == null) return null
  if (candidate >= balance || candidate < balance * 0.5) return null
  return candidate
}

// Whether a Rithmic account is a funded (payout-stage) account or still an
// evaluation, read off the id and name the firm gave it. Firms label the
// funded stage consistently — "PA" (performance account), "FUNDED", "LIVE",
// "XFA", "PRO" — and evaluations as "EVAL", "SIM", "TC" or a challenge name.
// Anything unlabelled is treated as an evaluation, the safer default.
export function phaseFromAccountName(...names: (string | null | undefined)[]): "funded" | "evaluation" {
  const FUNDED = new Set(["PA", "FUNDED", "LIVE", "XFA", "PRO", "PAYOUT"])
  const EVALUATION = new Set(["EVAL", "EVALUATION", "SIM", "TC", "CHALLENGE", "COMBINE", "TRIAL", "DEMO"])
  for (const name of names) {
    if (!name) continue
    const tokens = name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
    if (tokens.some((t) => EVALUATION.has(t))) return "evaluation"
    if (tokens.some((t) => FUNDED.has(t) || /^PA\d+$/.test(t))) return "funded"
  }
  return "evaluation"
}
