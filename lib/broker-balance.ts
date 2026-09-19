// Pure helpers for making sense of what a broker reports about an account.
// Kept free of database and network code so they can be tested on their own.

// The subset of Rithmic's RMS limits that matter here (lib/rithmic-client.ts
// RithmicAccountRms satisfies this).
export interface BrokerRiskLimits {
  autoLiquidateThreshold: number | null
  minAccountBalance: number | null
}

// The account sizes prop firms actually sell. A balance worked back to
// within 3% of one of these is that size — the gap is commissions and
// fees, which the fill history doesn't carry.
const STANDARD_ACCOUNT_SIZES = [10_000, 25_000, 50_000, 75_000, 100_000, 150_000, 200_000, 250_000, 300_000]

// Rithmic doesn't report an account's starting size, but it does report the
// balance now, and every fill since the account opened is imported — so the
// size is the balance with all realized P&L taken back out.
export function inferStartingBalance(currentBalance: number, netRealizedPnl: number): number {
  const raw = currentBalance - netRealizedPnl
  const standard = STANDARD_ACCOUNT_SIZES.find((size) => Math.abs(raw - size) / size <= 0.03)
  return standard ?? Math.max(0, Math.round(raw / 100) * 100)
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
