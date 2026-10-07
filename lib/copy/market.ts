import type { ContractSpec } from "./contracts"

// Whether the market a contract trades on is open right now, from its regular
// weekly hours. Pure: the Cockpit shows it beside the exchange's own clock.
//
// It is the timetable, not a feed: exchange holidays and early closes are not
// in it, and the Cockpit says so. A contract whose venue isn't known reads
// "unknown" rather than a guess.

export type MarketState = "open" | "closed" | "pre" | "post" | "unknown"
export const MARKET_LABELS: Record<MarketState, string> = { open: "Market Open", closed: "Market Closed", pre: "Pre-Market", post: "Post-Market", unknown: "Market hours unknown" }

export type MarketStatus = {
  state: MarketState
  label: string
  // the exchange's clock: 08:55:15, and the zone it is in (CT, ET)
  clock: string
  zone: string
  // when it is closed: when it opens again, in words
  note: string | null
}

type Venue = { timeZone: string; zone: string; open: (weekday: number, minutes: number) => { state: MarketState; note: string | null } }

const H = (h: number, m = 0) => h * 60 + m
const closed = (note: string) => ({ state: "closed" as const, note })
const OPEN = { state: "open" as const, note: null }

// CME Globex (index, energy, metal and currency futures): Sunday 17:00 to
// Friday 16:00 Central, with an hour off every day from 16:00.
const GLOBEX: Venue = {
  timeZone: "America/Chicago",
  zone: "CT",
  open: (d, m) => {
    if (d === 6 || (d === 5 && m >= H(16)) || (d === 0 && m < H(17))) return closed("Reopens Sunday 17:00 CT")
    if (d >= 1 && d <= 4 && m >= H(16) && m < H(17)) return closed("Daily break: reopens 17:00 CT")
    return OPEN
  },
}
// Spot currencies: Sunday 17:00 to Friday 17:00 New York, around the clock.
const FOREX: Venue = {
  timeZone: "America/New_York",
  zone: "ET",
  open: (d, m) => (d === 6 || (d === 5 && m >= H(17)) || (d === 0 && m < H(17)) ? closed("Reopens Sunday 17:00 ET") : OPEN),
}
// Spot metals: the same week, opening an hour later, with an hour off from 17:00.
const METALS: Venue = {
  timeZone: "America/New_York",
  zone: "ET",
  open: (d, m) => {
    if (d === 6 || (d === 5 && m >= H(17)) || (d === 0 && m < H(18))) return closed("Reopens Sunday 18:00 ET")
    if (d >= 1 && d <= 4 && m >= H(17) && m < H(18)) return closed("Daily break: reopens 18:00 ET")
    return OPEN
  },
}
const VENUES: Partial<Record<ContractSpec["type"], Venue>> = { future: GLOBEX, forex: FOREX, metal: METALS }

function local(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00"
  return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")), minutes: Number(get("hour")) * 60 + Number(get("minute")), clock: `${get("hour")}:${get("minute")}:${get("second")}` }
}

export function marketStatus(spec: Pick<ContractSpec, "type"> | null | undefined, now: Date = new Date()): MarketStatus {
  const venue = spec ? VENUES[spec.type] : undefined
  // no venue known: still a clock (Chicago's, the futures trader's reference), and no claim about the market
  const at = local(venue?.timeZone ?? GLOBEX.timeZone, now)
  if (!venue) return { state: "unknown", label: MARKET_LABELS.unknown, clock: at.clock, zone: GLOBEX.zone, note: null }
  const { state, note } = venue.open(at.weekday, at.minutes)
  return { state, label: MARKET_LABELS[state], clock: at.clock, zone: venue.zone, note }
}
