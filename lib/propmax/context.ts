import type { EngineContext, EngineTrade, OpenPosition } from "@/lib/propmax/types"

export interface BuildContextInput {
  startingBalance: number
  currency?: string
  // P&L that happened before the account was tracked (opening offset).
  openingAdjustment?: number
  // Broker-reported figures when a live source provides them; else null and
  // the engine works from realized trades only (and says so).
  liveBalance?: number | null
  liveEquity?: number | null
  trades: EngineTrade[]
  openPositions?: OpenPosition[]
  // Whether this broker reports open positions at all (see EngineContext).
  livePositionsAvailable?: boolean
  // Withdrawals: they lower the balance without moving the drawdown floor.
  payouts?: { at: string; amount: number }[]
  now?: Date
  lastSyncAt?: Date | null
  // A live account whose data is older than this is treated as STALE.
  staleAfterMs?: number
  // Hours to add to UTC to reach the account's reset day boundary (e.g. -5
  // for US Eastern) — buckets realized P&L into the right trading day.
  resetOffsetHours?: number
}

const DEFAULT_STALE_MS = 12 * 60 * 1000

// One pass over realized trades → balance, high-water mark, per-day P&L.
// Mirrors lib/propfirm-rules.ts's walk; payouts come off before same-time
// trades and never move the peak.
export function buildContext(input: BuildContextInput): EngineContext {
  const now = input.now ?? new Date()
  const opening = input.openingAdjustment ?? 0
  const offsetMs = (input.resetOffsetHours ?? 0) * 60 * 60 * 1000

  const trades = [...input.trades].sort((a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime())
  const payouts = [...(input.payouts ?? [])].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  let balance = input.startingBalance + opening
  let peak = balance
  const dailyMap = new Map<string, number>()
  let nextPayout = 0

  for (const t of trades) {
    const tTime = new Date(t.exitTime).getTime()
    while (nextPayout < payouts.length && new Date(payouts[nextPayout].at).getTime() <= tTime) {
      balance -= payouts[nextPayout].amount
      nextPayout++
    }
    balance += t.pnl
    if (balance > peak) peak = balance
    const dayKey = new Date(tTime + offsetMs).toISOString().slice(0, 10)
    dailyMap.set(dayKey, (dailyMap.get(dayKey) ?? 0) + t.pnl)
  }
  for (; nextPayout < payouts.length; nextPayout++) balance -= payouts[nextPayout].amount

  const daily = [...dailyMap.entries()].map(([date, pnl]) => ({ date, pnl: Math.round(pnl * 100) / 100 })).sort((a, b) => a.date.localeCompare(b.date))

  // Realized balance from the walk is authoritative for realized rules; a
  // broker balance (if given) can override once it's known to include the
  // same history.
  const realizedBalance = Math.round(balance * 100) / 100
  const finalBalance = input.liveBalance ?? realizedBalance
  const highWaterMark = Math.max(peak, finalBalance)

  const stale = input.lastSyncAt != null && now.getTime() - input.lastSyncAt.getTime() > (input.staleAfterMs ?? DEFAULT_STALE_MS)

  return {
    startingBalance: input.startingBalance,
    currency: input.currency ?? "USD",
    balance: finalBalance,
    equity: input.liveEquity ?? null,
    highWaterMark: Math.round(highWaterMark * 100) / 100,
    daily,
    trades,
    openPositions: input.openPositions ?? [],
    now,
    lastSyncAt: input.lastSyncAt ?? null,
    stale,
    livePositionsAvailable: input.livePositionsAvailable ?? (input.openPositions?.length ?? 0) > 0,
  }
}

// Convenience for callers that only have a symbol/side/qty list of positions.
export function toOpenPositions(rows: OpenPosition[]): OpenPosition[] {
  return rows.filter((p) => p.quantity !== 0)
}
