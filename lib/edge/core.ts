import { FUTURES_CONTRACTS, tradingSession } from "@/lib/calc"

// Edge Lab's analysis engine, part one: turning the trade log into something
// that can be sliced ("EURUSD + London + Long"), and measuring a slice honestly.
// Pure — no database, no clock — so every number on the screen can be checked
// by a test.
//
// Two rules run through all of it:
//   * nothing is invented: a figure that can't be computed is null, and the
//     screens say "not enough data";
//   * a high win rate on a handful of trades is not an edge. Sample size caps
//     the score outright, and significance and out-of-sample results weigh in.

// ------------------------------------------------------------------ thresholds

// Closed trades before Edge Lab says anything at all.
export const MIN_TRADES = 30
// A cell / row may show a figure from this many trades (marked as thin).
export const MIN_CELL = 5
// A pattern (an edge, a leak, a discovery) needs at least this many.
export const MIN_PATTERN = 20
// "Statistically supported" needs at least this many on each side.
export const MIN_SUPPORTED = 30

// ------------------------------------------------------------------ dimensions

export type DimId =
  | "symbol"
  | "side"
  | "session"
  | "weekday"
  | "hour"
  | "setup"
  | "strategy"
  | "hold"
  | "rr"
  | "risk"
  | "mistake"
  | "grade"
  | "account"
  | "assetClass"
  // what happened just before the trade (worked out from the trade log itself)
  | "after"
  | "ofday"
  // from check-ins and reviews
  | "emotion"
  | "confidence"
  | "stress"
  | "focus"
  | "plan"
  | "reason"
  // from daily price history, when it has been analysed
  | "trend"
  | "volatility"
  | "range"

export type DimInfo = { id: DimId; label: string; group: "market" | "timing" | "trade" | "behaviour" | "psychology" | "regime"; multi?: boolean; help?: string }

export const DIMS: DimInfo[] = [
  { id: "symbol", label: "Market", group: "market" },
  { id: "assetClass", label: "Asset class", group: "market" },
  { id: "side", label: "Direction", group: "trade" },
  { id: "session", label: "Session", group: "timing", help: "By the hour the trade was opened (UTC): Asia, London, New York morning, New York afternoon." },
  { id: "weekday", label: "Day", group: "timing" },
  { id: "hour", label: "Time of day", group: "timing", help: "The hour you opened the trade, in your own time zone." },
  { id: "setup", label: "Setup", group: "trade", multi: true, help: "The setup tags on the trade." },
  { id: "strategy", label: "Strategy", group: "trade", help: "The playbook the trade was logged under." },
  { id: "hold", label: "Holding time", group: "trade" },
  { id: "rr", label: "Planned reward : risk", group: "trade", help: "From the trade's stop and target, when it had both." },
  { id: "risk", label: "Risk size", group: "trade", help: "The trade's risk against your own typical risk, when it had a stop." },
  { id: "grade", label: "Execution grade", group: "trade" },
  { id: "mistake", label: "Mistake", group: "behaviour", multi: true },
  { id: "account", label: "Account", group: "market" },
  { id: "after", label: "Came after", group: "behaviour", help: "What the trade before it, on the same day, did." },
  { id: "ofday", label: "Trade of the day", group: "behaviour", help: "Whether it was your first, second, third… trade that day." },
  { id: "emotion", label: "Feeling before", group: "psychology" },
  { id: "confidence", label: "Confidence", group: "psychology" },
  { id: "stress", label: "Stress", group: "psychology" },
  { id: "focus", label: "Focus", group: "psychology" },
  { id: "plan", label: "Plan", group: "psychology" },
  { id: "reason", label: "Reason for the trade", group: "psychology" },
  { id: "trend", label: "Trend", group: "regime", help: "Whether the market was trending up, trending down or ranging on the daily chart, as of the day before the trade." },
  { id: "volatility", label: "Volatility", group: "regime", help: "How large the daily ranges were against the previous 100 days, as of the day before the trade." },
  { id: "range", label: "Range", group: "regime", help: "Whether the previous day's range was expanding or compressing." },
]
export const DIM_BY_ID = Object.fromEntries(DIMS.map((d) => [d.id, d])) as Record<DimId, DimInfo>
export const isDimId = (v: unknown): v is DimId => typeof v === "string" && v in DIM_BY_ID
export const dimLabel = (id: string) => (isDimId(id) ? DIM_BY_ID[id].label : id)

// A slice: every condition must hold ("symbol = EURUSD" AND "session = London").
export type Conditions = Partial<Record<DimId, string>>

export function cleanConditions(raw: unknown): Conditions {
  const out: Conditions = {}
  if (!raw || typeof raw !== "object") return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isDimId(k) && typeof v === "string" && v.trim() && v.length <= 80) out[k] = v
  return out
}
export const conditionEntries = (c: Conditions) => DIMS.filter((d) => c[d.id] != null).map((d) => [d.id, c[d.id]!] as [DimId, string])
// "EURUSD + London + Long"
export const conditionName = (c: Conditions) => conditionEntries(c).map(([, v]) => v).join(" + ") || "All trades"
export const conditionKey = (c: Conditions) => conditionEntries(c).map(([k, v]) => `${k}=${v}`).join("&")

// ------------------------------------------------------------------ the trade

export type EdgeTrade = {
  id: number
  // other trades this one stands for: the same decision copied to more accounts
  copies: number[]
  symbol: string
  pnl: number
  // result in units of the initial risk, when the trade had a stop
  r: number | null
  risk: number | null
  entry: number
  exit: number
  accountId: number | null
  // the trader's own calendar day the trade was opened on / closed on
  openDay: string
  day: string
  month: string
  dims: Partial<Record<DimId, string>>
  setups: string[]
  // every tag on the trade, setups or not
  tags: string[]
  mistakes: string[]
  // the reward : risk the trade was planned for, when it had a stop and a target
  rr: number | null
  // what the trader said about it, when they checked in or reviewed it
  psych: RawPsych | null
  // how far it went for / against, in R, when price history has been analysed
  maeR: number | null
  mfeR: number | null
}

export type RawTrade = {
  id: number
  symbol: string
  market: string
  side: string
  status: string
  pnl: number
  rMultiple: number | null
  quantity: number
  entryPrice: number
  exitPrice: number | null
  stopLoss: number | null
  takeProfit: number | null
  contractMultiplier: number
  entryTime: Date
  exitTime: Date | null
  accountId: number | null
  playbookId: number | null
  tags: string[]
  mistakes: string[]
  rating: number | null
  source: string | null
}

export type RawPsych = { emotionBefore: string | null; confidenceBefore: number | null; focusBefore: number | null; stressBefore: number | null; reason: string | null; planBefore: boolean | null; emotionAfter: string | null; planFollowed: boolean | null; interference: string[] }
export type Regime = { trend: string; volatility: string; range: string }

export type PrepareContext = {
  timeZone: string
  playbooks?: Map<number, string>
  accounts?: Map<number, string>
  // tags that are setups (the "Setups" tag group); null = every tag counts as one
  setupTags?: Set<string> | null
  psych?: Map<number, RawPsych>
  // `${instrument}|${YYYY-MM-DD}` → what the market was doing as of the day before
  regimes?: Map<string, Regime>
  excursions?: Map<number, { maeR: number | null; mfeR: number | null }>
  // count one decision once when it was copied to several accounts
  mergeCopies?: boolean
}

const MONTH_CODE = "FGHJKMNQUVXZ"
const FUTURES_ROOTS = Object.keys(FUTURES_CONTRACTS).sort((a, b) => b.length - a.length)

// "MNQZ5" → "MNQ", "EURUSDm" → "EURUSD", "BTCUSD.r" → "BTCUSD". The instrument a
// trade is *of*, whatever contract month or broker suffix it carried.
export function instrumentOf(symbol: string, market: string): string {
  const raw = symbol.trim()
  const upper = raw.toUpperCase()
  if (market === "futures" || market === "future_option") {
    for (const root of FUTURES_ROOTS) {
      if (upper === root) return root
      const rest = upper.slice(root.length)
      if (upper.startsWith(root) && /^[FGHJKMNQUVXZ]\d{1,2}$/.test(rest) && MONTH_CODE.includes(rest[0])) return root
    }
    const m = /^([A-Z0-9]{1,4}?)([FGHJKMNQUVXZ]\d{1,2})$/.exec(upper)
    return m ? m[1] : upper
  }
  // broker decorations after a separator, and the lower-case "m"/"c" some brokers append
  const base = raw.replace(/[._#].*$/, "").replace(/(?<=[A-Z]{6})[a-z]{1,2}$/, "")
  return (base || raw).toUpperCase()
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const HOLD: [number, string][] = [
  [5, "Under 5 min"],
  [30, "5–30 min"],
  [120, "30 min – 2 h"],
  [480, "2–8 h"],
  [1440, "8–24 h"],
  [Infinity, "Over a day"],
]
export const HOLD_ORDER = HOLD.map(([, l]) => l)
export const SESSION_ORDER = ["Asia", "London", "NY AM", "NY PM"]
export const WEEKDAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
export const RR_ORDER = ["Under 1R", "1–2R", "2–3R", "3R or more"]

const band = (v: number | null, bands: [number, string][]) => (v == null ? undefined : bands.find(([max]) => v <= max)?.[1])
export const CONFIDENCE_BANDS: [number, string][] = [
  [4, "Low (1–4)"],
  [6, "Medium (5–6)"],
  [9, "High (7–9)"],
  [10, "Maximum (10)"],
]
export const STRESS_BANDS: [number, string][] = [
  [3, "Low (1–3)"],
  [6, "Medium (4–6)"],
  [10, "High (7–10)"],
]
export const FOCUS_BANDS: [number, string][] = [
  [4, "Low (1–4)"],
  [7, "Medium (5–7)"],
  [10, "High (8–10)"],
]
export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())

function clock(timeZone: string) {
  let fmt: Intl.DateTimeFormat
  try {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "long" })
  } catch {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "long" })
  }
  return (ms: number) => {
    const p: Record<string, string> = {}
    for (const part of fmt.formatToParts(ms)) p[part.type] = part.value
    return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: p.weekday }
  }
}

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// The trade log → what Edge Lab analyses: closed trades only, oldest first, each
// with every way it can be sliced worked out once.
export function prepareTrades(rows: RawTrade[], ctx: PrepareContext): EdgeTrade[] {
  const at = clock(ctx.timeZone)
  const closed = rows.filter((t) => t.status === "closed" && Number.isFinite(t.pnl)).sort((a, b) => a.entryTime.getTime() - b.entryTime.getTime() || a.id - b.id)

  // $ at risk, where the trade had a stop — and what is typical for this trader
  const riskOf = (t: RawTrade) => {
    if (t.stopLoss == null || !Number.isFinite(t.stopLoss)) return null
    const risk = Math.abs(t.entryPrice - t.stopLoss) * t.quantity * (t.contractMultiplier || 1)
    return risk > 0 ? risk : null
  }
  const typicalRisk = median(closed.map(riskOf).filter((r): r is number => r != null))

  const out: EdgeTrade[] = []
  for (const t of closed) {
    const entry = t.entryTime.getTime()
    const exit = (t.exitTime ?? t.entryTime).getTime()
    const symbol = instrumentOf(t.symbol, t.market)
    const opened = at(entry)
    const closedAt = at(exit)
    const risk = riskOf(t)
    const r = t.rMultiple != null && Number.isFinite(t.rMultiple) ? t.rMultiple : risk ? t.pnl / risk : null
    const minutes = Math.max(0, (exit - entry) / 60_000)
    let rr: number | null = null
    if (t.stopLoss != null && t.takeProfit != null) {
      const riskPts = Math.abs(t.entryPrice - t.stopLoss)
      if (riskPts > 0) rr = Math.abs(t.takeProfit - t.entryPrice) / riskPts
    }
    const psych = ctx.psych?.get(t.id)
    const regime = ctx.regimes?.get(`${symbol}|${new Date(entry).toISOString().slice(0, 10)}`)
    const exc = ctx.excursions?.get(t.id)
    const setups = [...new Set((t.tags ?? []).filter((tag) => (ctx.setupTags ? ctx.setupTags.has(tag) : true)))]
    const hourBlock = Math.floor(opened.hour / 2) * 2
    const pad = (n: number) => String(n).padStart(2, "0")

    const dims: Partial<Record<DimId, string>> = {
      symbol,
      assetClass: titleCase(t.market),
      side: t.side === "short" ? "Short" : "Long",
      session: tradingSession(t.entryTime),
      weekday: opened.weekday,
      hour: `${pad(hourBlock)}:00–${pad((hourBlock + 2) % 24)}:00`,
      strategy: t.playbookId != null ? ctx.playbooks?.get(t.playbookId) : undefined,
      hold: HOLD.find(([max]) => minutes <= max)![1],
      rr: rr == null ? undefined : rr < 1 ? RR_ORDER[0] : rr < 2 ? RR_ORDER[1] : rr < 3 ? RR_ORDER[2] : RR_ORDER[3],
      risk: risk == null || !typicalRisk ? undefined : risk < typicalRisk * 0.67 ? "Smaller than usual" : risk > typicalRisk * 1.5 ? "Larger than usual" : "Usual size",
      grade: t.rating != null && t.rating >= 1 && t.rating <= 5 ? `${t.rating}★` : undefined,
      account: t.accountId != null ? ctx.accounts?.get(t.accountId) : undefined,
      emotion: psych?.emotionBefore ? titleCase(psych.emotionBefore) : undefined,
      confidence: band(psych?.confidenceBefore ?? null, CONFIDENCE_BANDS),
      stress: band(psych?.stressBefore ?? null, STRESS_BANDS),
      focus: band(psych?.focusBefore ?? null, FOCUS_BANDS),
      plan: psych?.planFollowed != null ? (psych.planFollowed ? "Followed the plan" : "Broke the plan") : psych?.planBefore != null ? (psych.planBefore ? "Followed the plan" : "Broke the plan") : undefined,
      reason: psych?.reason ? titleCase(psych.reason) : undefined,
      trend: regime ? titleCase(regime.trend) : undefined,
      volatility: regime ? `${titleCase(regime.volatility)} volatility` : undefined,
      range: regime && regime.range !== "normal" ? titleCase(regime.range) : undefined,
    }
    out.push({ id: t.id, copies: [], symbol, pnl: t.pnl, r, risk, entry, exit, accountId: t.accountId, openDay: opened.day, day: closedAt.day, month: closedAt.day.slice(0, 7), dims, setups, tags: [...new Set(t.tags ?? [])], mistakes: [...new Set(t.mistakes ?? [])], rr, psych: psych ?? null, maeR: exc?.maeR ?? null, mfeR: exc?.mfeR ?? null })
  }

  const trades = ctx.mergeCopies === false ? out : mergeCopies(out)
  sequence(trades)
  return trades
}

// The same decision copied to several accounts (same instrument, same
// direction, opened and closed within a minute of each other) is ONE decision.
// Counting it five times would make every sample look five times as solid as
// it is. The copies' results are added up; R is averaged.
export function mergeCopies(trades: EdgeTrade[]): EdgeTrade[] {
  const out: EdgeTrade[] = []
  const open = new Map<string, EdgeTrade[]>()
  for (const t of trades) {
    const key = `${t.symbol}|${t.dims.side}`
    const group = open.get(key) ?? []
    const twin = group.find((g) => Math.abs(g.entry - t.entry) <= 60_000 && Math.abs(g.exit - t.exit) <= 60_000 && g.accountId !== t.accountId)
    if (twin) {
      const n = twin.copies.length + 1
      twin.pnl += t.pnl
      if (twin.r != null && t.r != null) twin.r = (twin.r * n + t.r) / (n + 1)
      if (twin.risk != null && t.risk != null) twin.risk += t.risk
      twin.copies.push(t.id)
      twin.dims.account = undefined
      // whichever copy was checked in / reviewed speaks for the decision
      if (!twin.psych && t.psych) {
        twin.psych = t.psych
        for (const d of ["emotion", "confidence", "stress", "focus", "plan", "reason"] as DimId[]) twin.dims[d] = t.dims[d]
      }
      continue
    }
    group.push(t)
    // only the recent ones can still be twins of what comes next
    open.set(key, group.length > 12 ? group.slice(-12) : group)
    out.push(t)
  }
  return out
}

// What came before each trade, on the same day: the first trade of the day, one
// after a win or a loss — and which trade of the day it was.
function sequence(trades: EdgeTrade[]) {
  let day = ""
  let count = 0
  let prev: EdgeTrade | null = null
  for (const t of trades) {
    if (t.openDay !== day) {
      day = t.openDay
      count = 0
      prev = null
    }
    count++
    t.dims.ofday = count === 1 ? "1st of the day" : count === 2 ? "2nd of the day" : count === 3 ? "3rd of the day" : "4th or later"
    t.dims.after = !prev ? "First trade of the day" : prev.pnl < 0 ? "After a loss" : prev.pnl > 0 ? "After a win" : "After a break-even"
    prev = t
  }
}

export function matches(t: EdgeTrade, c: Conditions): boolean {
  for (const key in c) {
    const want = c[key as DimId]
    if (want == null) continue
    if (key === "setup") {
      if (!t.setups.includes(want)) return false
    } else if (key === "mistake") {
      if (!t.mistakes.includes(want)) return false
    } else if (t.dims[key as DimId] !== want) return false
  }
  return true
}
export const select = (trades: EdgeTrade[], c: Conditions) => (conditionEntries(c).length ? trades.filter((t) => matches(t, c)) : trades)

// Every value a dimension takes in these trades, with how many trades have it.
export function dimValues(trades: EdgeTrade[], dim: DimId): { value: string; n: number }[] {
  const counts = new Map<string, number>()
  for (const t of trades) {
    const values = dim === "setup" ? t.setups : dim === "mistake" ? t.mistakes : t.dims[dim] != null ? [t.dims[dim]!] : []
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return [...counts.entries()].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n || a.value.localeCompare(b.value))
}

// ------------------------------------------------------------------ statistics

export type Stats = {
  n: number
  wins: number
  losses: number
  // 0..1
  winRate: number
  net: number
  avgWin: number
  avgLoss: number
  // average $ per trade
  expectancy: number
  // gross profit / gross loss; null when there were no losing trades (or no trades)
  pf: number | null
  // how many of the trades have a result in R, and their average
  rN: number
  expR: number | null
  avgWinR: number | null
  avgLossR: number | null
  // largest peak-to-trough fall of the running total
  maxDd: number
  months: number
  posMonths: number
  // largest single win as a share of gross profit
  topWinShare: number
  first: number | null
  last: number | null
}

export function measure(trades: EdgeTrade[]): Stats {
  let wins = 0
  let losses = 0
  let gp = 0
  let gl = 0
  let net = 0
  let rN = 0
  let rSum = 0
  let rWin = 0
  let rWinN = 0
  let rLoss = 0
  let rLossN = 0
  let peak = 0
  let equity = 0
  let maxDd = 0
  let top = 0
  const months = new Map<string, number>()
  for (const t of trades) {
    net += t.pnl
    if (t.pnl > 0) {
      wins++
      gp += t.pnl
      if (t.pnl > top) top = t.pnl
    } else if (t.pnl < 0) {
      losses++
      gl -= t.pnl
    }
    if (t.r != null) {
      rN++
      rSum += t.r
      if (t.r > 0) {
        rWin += t.r
        rWinN++
      } else if (t.r < 0) {
        rLoss += t.r
        rLossN++
      }
    }
    equity += t.pnl
    if (equity > peak) peak = equity
    if (peak - equity > maxDd) maxDd = peak - equity
    months.set(t.month, (months.get(t.month) ?? 0) + t.pnl)
  }
  const n = trades.length
  // R is only quoted when most of the slice has it — otherwise it would describe a different set of trades.
  const rOk = rN >= MIN_CELL && rN >= n * 0.6
  return {
    n,
    wins,
    losses,
    winRate: n ? wins / n : 0,
    net,
    avgWin: wins ? gp / wins : 0,
    avgLoss: losses ? -gl / losses : 0,
    expectancy: n ? net / n : 0,
    pf: gl > 0 ? gp / gl : null,
    rN,
    expR: rOk ? rSum / rN : null,
    avgWinR: rOk && rWinN ? rWin / rWinN : null,
    avgLossR: rOk && rLossN ? rLoss / rLossN : null,
    maxDd,
    months: months.size,
    posMonths: [...months.values()].filter((v) => v > 0).length,
    topWinShare: gp > 0 ? top / gp : 0,
    first: n ? trades[0].entry : null,
    last: n ? trades[n - 1].entry : null,
  }
}

// The per-trade results a test compares: R where the slice has it, else dollars
// scaled by the typical loss (so one big account doesn't swamp a small one).
export function outcomes(trades: EdgeTrade[]): { values: number[]; unit: "R" | "$" } {
  const withR = trades.filter((t) => t.r != null)
  if (withR.length >= MIN_CELL && withR.length >= trades.length * 0.6) return { values: withR.map((t) => t.r!), unit: "R" }
  return { values: trades.map((t) => t.pnl), unit: "$" }
}

// --- significance ------------------------------------------------------------

function logGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]
  let y = x
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (const cj of c) ser += cj / ++y
  return -tmp + Math.log((2.5066282746310005 * ser) / x)
}
function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-300
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 3e-9) break
  }
  return h
}
function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b
}
// P(T <= t) for Student's t with `df` degrees of freedom.
export function studentCdf(t: number, df: number): number {
  if (!Number.isFinite(t) || df <= 0) return t > 0 ? 1 : 0
  const x = df / (df + t * t)
  const tail = 0.5 * incompleteBeta(df / 2, 0.5, x)
  return t >= 0 ? 1 - tail : tail
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const variance = (xs: number[], m = mean(xs)) => (xs.length > 1 ? xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1) : 0)

// How sure the data is that the average result is on this side of zero: the
// probability, 0..1, that a result this far from zero is NOT just noise
// (a one-sided t-test). null when there is too little to say.
export function confidenceVsZero(values: number[]): { confidence: number; direction: 1 | -1 } | null {
  const n = values.length
  if (n < MIN_CELL) return null
  const m = mean(values)
  const sd = Math.sqrt(variance(values, m))
  if (sd === 0) return m === 0 ? null : { confidence: 0.99, direction: m > 0 ? 1 : -1 }
  const t = m / (sd / Math.sqrt(n))
  return { confidence: Math.min(0.99, studentCdf(Math.abs(t), n - 1)), direction: t >= 0 ? 1 : -1 }
}

// Welch's test for "the average of A differs from the average of B". Returns
// the probability, 0..1, that A really is on the side of B it appears to be.
export function confidenceOfDifference(a: number[], b: number[]): { confidence: number; direction: 1 | -1 } | null {
  if (a.length < MIN_CELL || b.length < MIN_CELL) return null
  const ma = mean(a)
  const mb = mean(b)
  const va = variance(a, ma) / a.length
  const vb = variance(b, mb) / b.length
  if (va + vb === 0) return ma === mb ? null : { confidence: 0.99, direction: ma > mb ? 1 : -1 }
  const t = (ma - mb) / Math.sqrt(va + vb)
  const df = (va + vb) ** 2 / ((va * va) / (a.length - 1) + (vb * vb) / (b.length - 1) || 1e-12)
  return { confidence: Math.min(0.99, studentCdf(Math.abs(t), df)), direction: t >= 0 ? 1 : -1 }
}

// --- the score ---------------------------------------------------------------

export type ScoreBand = "Insufficient data" | "Weak" | "Unproven" | "Promising" | "Strong" | "Exceptional"
export function scoreBand(score: number | null): ScoreBand {
  if (score == null) return "Insufficient data"
  if (score <= 30) return "Weak"
  if (score <= 50) return "Unproven"
  if (score <= 70) return "Promising"
  if (score <= 85) return "Strong"
  return "Exceptional"
}

export type EdgeScore = {
  // 0..100, or null with fewer than MIN_PATTERN trades
  score: number | null
  band: ScoreBand
  // 0..1: how sure the data is that the average result is positive
  confidence: number | null
  // the pieces, each 0..1, for "why is the score what it is"
  parts: { key: string; label: string; value: number; weight: number; note: string }[]
  // the most recent 30% of the trades, measured on their own
  outOfSample: Stats | null
  // what limited the score, in words
  cap: string | null
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

// How good — and how believable — a slice is. Sample size isn't just one
// ingredient: it caps the result, so 12 trades at 90% can't outrank 200 at 58%.
export function scoreEdge(trades: EdgeTrade[], stats: Stats = measure(trades)): EdgeScore {
  const n = stats.n
  if (n < MIN_PATTERN) return { score: null, band: "Insufficient data", confidence: null, parts: [], outOfSample: null, cap: `Needs ${MIN_PATTERN} trades — has ${n}.` }
  const { values, unit } = outcomes(trades)
  const sig = confidenceVsZero(values)
  const positive = sig ? (sig.direction > 0 ? sig.confidence : 1 - sig.confidence) : 0.5
  // expectancy on a common scale: R, or dollars per trade against the average loss
  const perTrade = unit === "R" ? mean(values) : stats.avgLoss < 0 ? stats.expectancy / -stats.avgLoss : stats.expectancy > 0 ? 0.5 : 0
  const cut = Math.floor(n * 0.7)
  const oosTrades = trades.slice(cut)
  const oos = oosTrades.length >= 8 ? measure(oosTrades) : null
  const insample = measure(trades.slice(0, cut))
  const oosValue = !oos ? 0.4 : oos.expectancy <= 0 ? 0 : insample.expectancy > 0 ? clamp01(oos.expectancy / insample.expectancy) : 0.5
  const grossProfit = stats.avgWin * stats.wins

  const parts = [
    { key: "sample", label: "Sample size", weight: 0.2, value: clamp01(Math.sqrt(n / 120)), note: `${n} trades` },
    { key: "expectancy", label: "Expectancy", weight: 0.2, value: clamp01(perTrade / 0.6), note: unit === "R" ? `${perTrade >= 0 ? "+" : ""}${perTrade.toFixed(2)}R per trade` : "per trade, against the average loss" },
    { key: "pf", label: "Profit factor", weight: 0.15, value: stats.pf == null ? (stats.net > 0 ? 1 : 0) : clamp01((stats.pf - 1) / 1.2), note: stats.pf == null ? "no losing trades" : stats.pf.toFixed(2) },
    { key: "significance", label: "Statistical confidence", weight: 0.2, value: clamp01((positive - 0.5) * 2), note: `${Math.round(positive * 100)}% that it is better than break-even` },
    { key: "consistency", label: "Consistency", weight: 0.1, value: stats.months >= 3 ? stats.posMonths / stats.months : 0.4, note: stats.months >= 3 ? `profitable in ${stats.posMonths} of ${stats.months} months` : "under 3 months of history" },
    { key: "drawdown", label: "Drawdown", weight: 0.05, value: grossProfit > 0 ? clamp01(1 - stats.maxDd / grossProfit) : 0, note: "worst fall against the profit made" },
    { key: "oos", label: "Recent trades", weight: 0.1, value: oosValue, note: oos ? `the latest ${oos.n} trades on their own` : "too few recent trades to check" },
  ]
  let score = Math.round(parts.reduce((s, p) => s + p.value * p.weight, 0) * 100)
  let cap: string | null = null
  const limit = (max: number, why: string) => {
    if (score > max) {
      score = max
      cap = why
    }
  }
  if (stats.expectancy <= 0) {
    score = Math.min(score, 30)
    cap = "It has lost money on average."
  }
  if (n < 40) limit(50, `Capped: only ${n} trades.`)
  else if (n < 75) limit(70, `Capped: only ${n} trades.`)
  else if (n < 150) limit(85, `Capped: ${n} trades — "Exceptional" needs 150.`)
  if (oos && oos.expectancy <= 0 && stats.expectancy > 0) limit(60, "The most recent trades, on their own, lost money.")
  return { score, band: scoreBand(score), confidence: positive, parts, outOfSample: oos, cap }
}

// ------------------------------------------------------------------ formatting

export const fmtR = (v: number | null | undefined, digits = 2) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}R`)
export const fmtPf = (s: Pick<Stats, "pf" | "n" | "wins">) => (s.n === 0 ? "—" : s.pf == null ? (s.wins ? "No losses" : "—") : s.pf.toFixed(2))
export const fmtPct = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`)
export const fmtMoney = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "—"
  const abs = Math.abs(v)
  const text = abs >= 10_000 ? Math.round(abs).toLocaleString("en-US") : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${v < 0 ? "−" : v > 0 ? "+" : ""}$${text}`
}
// The slice's expectancy the way a trader reads it: in R when it has R, else in dollars.
export const fmtExpectancy = (s: Stats) => (s.n === 0 ? "—" : s.expR != null ? fmtR(s.expR) : fmtMoney(s.expectancy))

// A set of conditions carried in a link (`?c=`), and read back.
export const conditionsParam = (c: Conditions) => JSON.stringify(Object.fromEntries(conditionEntries(c)))
export function parseConditionsParam(raw: unknown): Conditions {
  if (typeof raw !== "string" || !raw) return {}
  try {
    return cleanConditions(JSON.parse(raw))
  } catch {
    return {}
  }
}
