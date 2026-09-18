// Shared between the chart server action and the client dialog — kept out of
// app/actions/chart.ts because a "use server" file's exports must all be
// async server actions, and these are plain sync helpers.
//
// Retention limits aren't hardcoded here: unlike a public data vendor with a
// documented lookback window, how far back a given Rithmic account's market
// data actually goes depends on that account's own subscription, so every
// timeframe is always offered — an unavailable one simply comes back from
// Rithmic as "no data" (see app/actions/chart.ts) rather than being
// pre-filtered out.
const DAY = 86_400

export const INTERVAL_LIMITS: Record<string, { padding: number; label: string }> = {
  "1m": { padding: 0.25 * DAY, label: "1m" },
  "5m": { padding: DAY, label: "5m" },
  "15m": { padding: 2 * DAY, label: "15m" },
  "60m": { padding: 5 * DAY, label: "1h" },
  "1d": { padding: 20 * DAY, label: "1D" },
}

export function defaultInterval(entryTime: string): string {
  const ageDays = (Date.now() - new Date(entryTime).getTime()) / (DAY * 1000)
  if (ageDays <= 5) return "5m"
  if (ageDays <= 55) return "15m"
  if (ageDays <= 700) return "60m"
  return "1d"
}

export function availableIntervals(): string[] {
  return Object.keys(INTERVAL_LIMITS)
}
