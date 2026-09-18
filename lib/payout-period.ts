export type PayoutPeriod = "monthly" | "biweekly"

export interface PayoutLine {
  accountId: number
  accountName: string
  firmName: string | null
  amount: number
  count: number
}

export interface PayoutSummary {
  period: PayoutPeriod
  periodLabel: string
  start: string
  end: string
  total: number
  currency: string
  accountCount: number
  lines: PayoutLine[]
  traderName: string
  traderImage: string | null
}

// Bi-weekly follows the cadence prop firms actually pay on: the 1st–15th and
// the 16th–end of month, rather than a rolling 14 days from an arbitrary
// anchor date, so the window is the same for everyone and lines up with the
// firm's own payout cycle.
export function resolvePeriod(period: PayoutPeriod, now: Date = new Date()): { start: Date; end: Date; label: string } {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const monthName = new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })

  if (period === "monthly") {
    return {
      start: new Date(Date.UTC(year, month, 1, 0, 0, 0)),
      end: new Date(Date.UTC(year, month + 1, 0, 23, 59, 59)),
      label: monthName,
    }
  }

  const firstHalf = now.getUTCDate() <= 15
  const start = new Date(Date.UTC(year, month, firstHalf ? 1 : 16, 0, 0, 0))
  const end = firstHalf
    ? new Date(Date.UTC(year, month, 15, 23, 59, 59))
    : new Date(Date.UTC(year, month + 1, 0, 23, 59, 59))
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
  return { start, end, label: `${fmt(start)} – ${fmt(end)}, ${year}` }
}
