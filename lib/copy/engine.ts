import { formatQuantity, isExpired, pointValueAt, sameInstrument, samePriceScale, unitLabel, type ContractSpec } from "./contracts"

// The copy engine's rules, as pure functions. Every quantity a follower trades
// comes out of calculateFollowerOrder — the pages, the previews and the engine
// that sends orders all call it, so what the trader is shown is what is sent.
// The answer always carries its working: each step, in words.
//
//   leader order -> copy rules -> contract -> follower sizing -> rounding ->
//   maximum position -> daily loss -> exposure -> PropSync -> final quantity

export type Side = "long" | "short"
export type SizingMode = "same" | "percentage" | "multiplier" | "risk" | "fixed" | "custom"
export type RoundingRule = "down" | "up" | "nearest" | "min1"
export type CopyAction = "open" | "increase" | "partial_close" | "close" | "modify_sl" | "modify_tp" | "trailing_stop" | "cancel"

export const SIZING_MODES: { key: SizingMode; label: string; hint: string }[] = [
  { key: "same", label: "Same size", hint: "The same quantity as the Leader." },
  { key: "percentage", label: "Percentage", hint: "A percentage of the Leader's quantity." },
  { key: "multiplier", label: "Multiplier", hint: "The Leader's quantity times a multiplier." },
  { key: "risk", label: "Risk percentage", hint: "Sized from this account's own equity, the stop and the contract." },
  { key: "fixed", label: "Fixed quantity", hint: "Always the same quantity, whatever the Leader trades." },
  { key: "custom", label: "Custom", hint: "Scaled by account size against the Leader, times a factor." },
]
export const ROUNDING_RULES: { key: RoundingRule; label: string }[] = [
  { key: "down", label: "Round down" },
  { key: "up", label: "Round up" },
  { key: "nearest", label: "Nearest" },
  { key: "min1", label: "Minimum 1" },
]
export const MULTIPLIER_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 5]
export const sizingLabel = (mode: string) => SIZING_MODES.find((m) => m.key === mode)?.label ?? mode
export const roundingLabel = (rule: string) => ROUNDING_RULES.find((r) => r.key === rule)?.label ?? rule

export type FollowerConfig = {
  enabled: boolean
  sizingMode: SizingMode
  // percent of the leader's quantity (50 = half)
  percentage: number | null
  multiplier: number | null
  fixedQuantity: number | null
  // percent of this account's equity risked per trade
  riskPercentage: number | null
  // percent applied on top of the account-size ratio (100 = in proportion)
  customFactor: number | null
  minQuantity: number | null
  maxPositionSize: number | null
  maxDailyLoss: number | null
  // percent of equity, by notional value of open positions
  maxExposure: number | null
  roundingRule: RoundingRule
}
export const DEFAULT_FOLLOWER: FollowerConfig = { enabled: true, sizingMode: "same", percentage: 100, multiplier: 1, fixedQuantity: 1, riskPercentage: 1, customFactor: 100, minQuantity: null, maxPositionSize: null, maxDailyLoss: null, maxExposure: null, roundingRule: "nearest" }

export type AccountState = {
  equity: number | null
  // today's realised and open result (negative = a loss)
  dayPnl: number
  // notional value of what is open now, in USD
  openNotional: number
  // what is already open in this symbol, in the direction of the order
  openQuantity: number
  connected: boolean
}

export type LeaderOrder = { symbol: string; side: Side; quantity: number; orderType: "market" | "limit" | "stop"; entry: number | null; stopLoss: number | null; takeProfit: number | null }

export type CopyRules = {
  marketOrders: boolean
  limitOrders: boolean
  stopOrders: boolean
  stopLoss: boolean
  takeProfit: boolean
  modifications: boolean
  partialClose: boolean
  fullClose: boolean
  cancel: boolean
  trailingStop: boolean
  direction: "both" | "long" | "short"
  symbolScope: "all" | "selected"
  // "09:30" in the trader's own time zone; both null = any time
  hoursFrom: string | null
  hoursTo: string | null
  // 0 = Sunday … 6 = Saturday
  days: number[]
}
export const DEFAULT_RULES: CopyRules = { marketOrders: true, limitOrders: true, stopOrders: true, stopLoss: true, takeProfit: true, modifications: true, partialClose: true, fullClose: true, cancel: true, trailingStop: true, direction: "both", symbolScope: "selected", hoursFrom: null, hoursTo: null, days: [1, 2, 3, 4, 5] }
export const RULE_TOGGLES: { key: keyof CopyRules; label: string }[] = [
  { key: "marketOrders", label: "Copy market orders" },
  { key: "limitOrders", label: "Copy limit orders" },
  { key: "stopOrders", label: "Copy stop orders" },
  { key: "stopLoss", label: "Copy stop loss" },
  { key: "takeProfit", label: "Copy take profit" },
  { key: "modifications", label: "Copy order modifications" },
  { key: "partialClose", label: "Copy partial close" },
  { key: "fullClose", label: "Copy full close" },
  { key: "cancel", label: "Copy cancel" },
  { key: "trailingStop", label: "Copy trailing stop" },
]

// What PropSync says about a follower account right now.
export type PropSyncState = { tracked: boolean; blocked: boolean; reason: string | null; dailyLossRemaining: number | null }
export const NO_PROPSYNC: PropSyncState = { tracked: false, blocked: false, reason: null, dailyLossRemaining: null }

export type Step = { key: string; label: string; value: string; note?: string; state: "ok" | "adjusted" | "blocked" }
export type Decision = {
  allowed: boolean
  // what the sizing rule gives before rounding and limits; null when it can't be worked out
  calculatedQuantity: number | null
  finalQuantity: number
  // what the final quantity risks to the stop, in USD; null without a stop or a known contract value
  riskAmount: number | null
  riskPerUnit: number | null
  // final follower quantity per one of the leader's
  ratio: number | null
  reason: string
  // which stage refused the copy, or cut it down
  blockedBy: "rules" | "contract" | "sizing" | "rounding" | "position" | "daily_loss" | "exposure" | "propsync" | "connection" | "disabled" | null
  limited: boolean
  symbol: string
  steps: Step[]
}

const money = (v: number) => `$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: v % 1 === 0 ? 0 : 2 })}`
const tidy = (v: number) => Math.round(v * 1e8) / 1e8
const qty = (v: number, spec: ContractSpec) => `${formatQuantity(v)} ${unitLabel(spec, v)}`

// ------------------------------------------------------------------ copy rules

// Whether the group's rules let this leader action through at all.
export function validateCopyRules(rules: CopyRules, action: CopyAction, order: Pick<LeaderOrder, "side" | "orderType" | "symbol">, ctx: { imported: string[]; minutes: number; weekday: number }): { ok: boolean; reason: string } {
  const no = (reason: string) => ({ ok: false, reason })
  if (action === "open" || action === "increase") {
    if (order.orderType === "market" && !rules.marketOrders) return no("Market orders are switched off in this group's copy rules.")
    if (order.orderType === "limit" && !rules.limitOrders) return no("Limit orders are switched off in this group's copy rules.")
    if (order.orderType === "stop" && !rules.stopOrders) return no("Stop orders are switched off in this group's copy rules.")
    if (rules.direction === "long" && order.side === "short") return no("This group copies long trades only.")
    if (rules.direction === "short" && order.side === "long") return no("This group copies short trades only.")
    if (!rules.days.includes(ctx.weekday)) return no("This group doesn't copy on this day of the week.")
    if (rules.hoursFrom && rules.hoursTo) {
      const [from, to] = [rules.hoursFrom, rules.hoursTo].map((h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5)))
      const inside = from <= to ? ctx.minutes >= from && ctx.minutes <= to : ctx.minutes >= from || ctx.minutes <= to
      if (!inside) return no(`This group only copies between ${rules.hoursFrom} and ${rules.hoursTo}.`)
    }
    if (rules.symbolScope === "selected" && !ctx.imported.some((s) => sameInstrument(s, order.symbol))) return no(`${order.symbol} isn't one of this group's contracts. Import it in the Cockpit to copy it.`)
  }
  if (action === "partial_close" && !rules.partialClose) return no("Partial closes are switched off in this group's copy rules.")
  if (action === "close" && !rules.fullClose) return no("Full closes are switched off in this group's copy rules.")
  if (action === "cancel" && !rules.cancel) return no("Cancels are switched off in this group's copy rules.")
  if (action === "trailing_stop" && !rules.trailingStop) return no("Trailing stops are switched off in this group's copy rules.")
  if (action === "modify_sl" && !(rules.stopLoss && rules.modifications)) return no("Stop loss changes are switched off in this group's copy rules.")
  if (action === "modify_tp" && !(rules.takeProfit && rules.modifications)) return no("Take profit changes are switched off in this group's copy rules.")
  return { ok: true, reason: "" }
}

export function validateContract(spec: ContractSpec, now = new Date()): { ok: boolean; reason: string } {
  if (isExpired(spec, now)) return { ok: false, reason: `${spec.symbol} has expired. Import the current contract.` }
  if (!(spec.minimumQuantity > 0) || !(spec.quantityStep > 0)) return { ok: false, reason: `${spec.symbol} has no valid minimum quantity.` }
  return { ok: true, reason: "" }
}

// ------------------------------------------------------------------ sizing

// What one contract / lot loses if the stop is hit, in USD.
export function calculateRisk(input: { entry: number | null; stopLoss: number | null; spec: ContractSpec }): { riskPerUnit: number | null; distance: number | null; why: string | null } {
  const { entry, stopLoss, spec } = input
  if (entry == null || stopLoss == null) return { riskPerUnit: null, distance: null, why: "The order has no stop loss, so what it risks can't be worked out." }
  const distance = Math.abs(entry - stopLoss)
  if (!(distance > 0)) return { riskPerUnit: null, distance: null, why: "The stop loss is at the entry price." }
  const point = pointValueAt(spec, entry)
  if (point == null) return { riskPerUnit: null, distance, why: `The contract size of ${spec.symbol} isn't known, so its risk can't be worked out in money.` }
  return { riskPerUnit: tidy(distance * point), distance, why: null }
}

// The follower's quantity before rounding and limits, with how it was reached.
export function calculatePositionSize(input: { config: FollowerConfig; leaderQuantity: number; leaderEquity: number | null; followerEquity: number | null; riskPerUnit: number | null; riskWhy: string | null; spec: ContractSpec }): { raw: number | null; formula: string; why: string | null; riskBudget: number | null } {
  const { config: c, leaderQuantity: q, spec } = input
  const unit = unitLabel(spec, 2)
  switch (c.sizingMode) {
    case "same":
      return { raw: q, formula: `Same size as the Leader: ${formatQuantity(q)} ${unit}`, why: null, riskBudget: null }
    case "percentage": {
      const p = c.percentage ?? 100
      return { raw: tidy((q * p) / 100), formula: `${formatQuantity(q)} × ${formatQuantity(p)}% = ${formatQuantity(tidy((q * p) / 100))} ${unit}`, why: null, riskBudget: null }
    }
    case "multiplier": {
      const m = c.multiplier ?? 1
      return { raw: tidy(q * m), formula: `${formatQuantity(q)} × ${formatQuantity(m)}x = ${formatQuantity(tidy(q * m))} ${unit}`, why: null, riskBudget: null }
    }
    case "fixed": {
      const f = c.fixedQuantity ?? 1
      return { raw: f, formula: `Fixed quantity: always ${formatQuantity(f)} ${unit}`, why: null, riskBudget: null }
    }
    case "custom": {
      if (!input.leaderEquity || !input.followerEquity) return { raw: null, formula: "Scaled by account size", why: "The balance of the Leader or of this account isn't known, so the two can't be compared.", riskBudget: null }
      const factor = (c.customFactor ?? 100) / 100
      const scale = input.followerEquity / input.leaderEquity
      const raw = tidy(q * scale * factor)
      return { raw, formula: `${formatQuantity(q)} × (${money(input.followerEquity)} ÷ ${money(input.leaderEquity)})${factor === 1 ? "" : ` × ${formatQuantity(factor * 100)}%`} = ${formatQuantity(Math.round(raw * 100) / 100)} ${unit}`, why: null, riskBudget: null }
    }
    case "risk": {
      const pct = c.riskPercentage ?? 1
      if (!input.followerEquity) return { raw: null, formula: `Risk ${formatQuantity(pct)}% of equity`, why: "This account's balance isn't known, so a risk amount can't be worked out.", riskBudget: null }
      const budget = tidy((input.followerEquity * pct) / 100)
      if (input.riskPerUnit == null) return { raw: null, formula: `Risk ${formatQuantity(pct)}% of ${money(input.followerEquity)} = ${money(budget)}`, why: input.riskWhy ?? "The risk per contract can't be worked out.", riskBudget: budget }
      const raw = tidy(budget / input.riskPerUnit)
      return { raw, formula: `${money(budget)} ÷ ${money(input.riskPerUnit)} per ${unitLabel(spec, 1)} = ${formatQuantity(Math.round(raw * 100) / 100)} ${unit}`, why: null, riskBudget: budget }
    }
  }
}

// A quantity the broker will accept: a multiple of the contract's step, never
// below its minimum. 0 means the trade can't be placed at this size.
export function normalizeQuantity(raw: number, spec: Pick<ContractSpec, "minimumQuantity" | "quantityStep">, rule: RoundingRule): number {
  if (!(raw > 0)) return 0
  const steps = raw / spec.quantityStep
  // a hair of tolerance, so 0.3 / 0.1 isn't floored to 2
  const n = rule === "down" ? Math.floor(steps + 1e-9) : rule === "up" ? Math.ceil(steps - 1e-9) : Math.round(steps)
  const value = tidy(n * spec.quantityStep)
  if (value < spec.minimumQuantity) return rule === "min1" ? spec.minimumQuantity : 0
  return value
}

// The limits a follower set for itself: position size, daily loss, exposure.
export function validateRisk(input: { quantity: number; config: FollowerConfig; account: AccountState; spec: ContractSpec; price: number | null; riskPerUnit: number | null }): { quantity: number; blockedBy: Decision["blockedBy"]; reason: string; steps: Step[] } {
  const { config: c, account, spec } = input
  let quantity = input.quantity
  const steps: Step[] = []
  if (c.maxPositionSize != null) {
    const room = Math.max(0, tidy(c.maxPositionSize - account.openQuantity))
    if (quantity > room) {
      const capped = normalizeQuantity(room, spec, "down")
      steps.push({ key: "max", label: "Maximum position size", value: qty(c.maxPositionSize, spec), note: account.openQuantity > 0 ? `${formatQuantity(account.openQuantity)} already open, so ${formatQuantity(room)} more is allowed.` : `Calculated ${formatQuantity(quantity)}, allowed ${formatQuantity(c.maxPositionSize)}.`, state: capped > 0 ? "adjusted" : "blocked" })
      if (capped <= 0) return { quantity: 0, blockedBy: "position", reason: `Maximum position size reached: ${formatQuantity(account.openQuantity)} of ${formatQuantity(c.maxPositionSize)} already open.`, steps }
      quantity = capped
    } else steps.push({ key: "max", label: "Maximum position size", value: qty(c.maxPositionSize, spec), state: "ok" })
  }
  if (c.maxDailyLoss != null) {
    const lost = Math.max(0, -account.dayPnl)
    const remaining = tidy(c.maxDailyLoss - lost)
    const risk = input.riskPerUnit != null ? tidy(quantity * input.riskPerUnit) : null
    if (remaining <= 0) {
      steps.push({ key: "daily", label: "Maximum daily loss", value: money(c.maxDailyLoss), note: `${money(lost)} lost today.`, state: "blocked" })
      return { quantity: 0, blockedBy: "daily_loss", reason: "Daily loss limit reached. This account copies again tomorrow.", steps }
    }
    if (risk != null && risk > remaining) {
      steps.push({ key: "daily", label: "Maximum daily loss", value: money(c.maxDailyLoss), note: `${money(remaining)} remains; this trade risks ${money(risk)}.`, state: "blocked" })
      return { quantity: 0, blockedBy: "daily_loss", reason: `Only ${money(remaining)} of daily risk remains, and this trade risks ${money(risk)}.`, steps }
    }
    steps.push({ key: "daily", label: "Maximum daily loss", value: money(c.maxDailyLoss), note: `${money(remaining)} remains${risk != null ? `; this trade risks ${money(risk)}` : ""}.`, state: "ok" })
  }
  if (c.maxExposure != null) {
    const point = pointValueAt(spec, input.price)
    if (account.equity && point != null && input.price) {
      const now = (account.openNotional / account.equity) * 100
      const after = ((account.openNotional + quantity * input.price * point) / account.equity) * 100
      const note = `Now ${now.toFixed(0)}%, after this trade ${after.toFixed(0)}%.`
      if (after > c.maxExposure + 1e-9) {
        steps.push({ key: "exposure", label: "Maximum exposure", value: `${formatQuantity(c.maxExposure)}%`, note, state: "blocked" })
        return { quantity: 0, blockedBy: "exposure", reason: `This trade would exceed the follower's maximum exposure (${after.toFixed(0)}% against a limit of ${formatQuantity(c.maxExposure)}%).`, steps }
      }
      steps.push({ key: "exposure", label: "Maximum exposure", value: `${formatQuantity(c.maxExposure)}%`, note, state: "ok" })
    } else steps.push({ key: "exposure", label: "Maximum exposure", value: `${formatQuantity(c.maxExposure)}%`, note: "Not checked: it needs this account's equity, a price and a known contract size.", state: "ok" })
  }
  return { quantity, blockedBy: null, reason: "", steps }
}

// PropSync has the last word on anything that adds risk to a prop account.
export function validatePropSyncRules(prop: PropSyncState, risk: number | null): { ok: boolean; reason: string; step: Step | null } {
  if (!prop.tracked) return { ok: true, reason: "", step: null }
  if (prop.blocked) return { ok: false, reason: prop.reason ?? "PropSync has stopped new trades on this account.", step: { key: "propsync", label: "PropSync rules", value: "Blocked", note: prop.reason ?? undefined, state: "blocked" } }
  if (prop.dailyLossRemaining != null && risk != null && risk > prop.dailyLossRemaining) {
    const reason = `Copying this trade would exceed the account's daily loss limit: it risks ${money(risk)} and ${money(prop.dailyLossRemaining)} remains.`
    return { ok: false, reason, step: { key: "propsync", label: "PropSync rules", value: "Blocked", note: reason, state: "blocked" } }
  }
  return { ok: true, reason: "", step: { key: "propsync", label: "PropSync rules", value: "Passed", note: prop.dailyLossRemaining != null ? `${money(prop.dailyLossRemaining)} of daily loss remains.` : undefined, state: "ok" } }
}

export type FollowerOrderInput = {
  order: LeaderOrder
  // the contract the follower will actually trade (after symbol mapping)
  spec: ContractSpec
  config: FollowerConfig
  leaderEquity: number | null
  account: AccountState
  propSync?: PropSyncState
  // null = don't apply the group's copy rules (a preview of sizing alone)
  rules?: { rules: CopyRules; imported: string[]; minutes: number; weekday: number } | null
  now?: Date
}

// The whole pipeline for one follower and one new leader order.
export function calculateFollowerOrder(input: FollowerOrderInput): Decision {
  const { order, spec, config, account } = input
  const steps: Step[] = [{ key: "leader", label: "Leader", value: `${order.side === "long" ? "BUY" : "SELL"} ${formatQuantity(order.quantity)} ${order.symbol}`, state: "ok" }]
  const stop = (blockedBy: Decision["blockedBy"], reason: string, calculated: number | null = null, extra: Step[] = []): Decision => ({ allowed: false, calculatedQuantity: calculated, finalQuantity: 0, riskAmount: null, riskPerUnit: null, ratio: 0, reason, blockedBy, limited: false, symbol: spec.symbol, steps: [...steps, ...extra, { key: "final", label: "Final copy size", value: "Not copied", note: reason, state: "blocked" }] })

  if (!config.enabled) return stop("disabled", "Copying is switched off for this account.")
  if (!account.connected) return stop("connection", "This account isn't connected, so it can't receive orders.")
  if (input.rules) {
    const r = validateCopyRules(input.rules.rules, "open", order, input.rules)
    if (!r.ok) return stop("rules", r.reason)
  }
  const contract = validateContract(spec, input.now)
  if (!contract.ok) return stop("contract", contract.reason)
  if (spec.symbol.toUpperCase() !== order.symbol.toUpperCase()) steps.push({ key: "mapping", label: "Symbol mapping", value: `${order.symbol} → ${spec.symbol}`, state: "ok" })

  const risk = calculateRisk({ entry: order.entry, stopLoss: order.stopLoss, spec })
  const size = calculatePositionSize({ config, leaderQuantity: order.quantity, leaderEquity: input.leaderEquity, followerEquity: account.equity, riskPerUnit: risk.riskPerUnit, riskWhy: risk.why, spec })
  steps.push({ key: "sizing", label: SIZING_MODES.find((m) => m.key === config.sizingMode)!.label, value: size.formula, state: size.raw == null ? "blocked" : "ok" })
  if (size.raw == null) return stop("sizing", size.why ?? "The size can't be worked out.")

  let quantity = normalizeQuantity(size.raw, spec, config.roundingRule)
  if (config.minQuantity != null && quantity > 0 && quantity < config.minQuantity) quantity = normalizeQuantity(config.minQuantity, spec, "up")
  if (tidy(quantity) !== tidy(size.raw)) steps.push({ key: "rounding", label: "Rounding", value: ROUNDING_RULES.find((r) => r.key === config.roundingRule)!.label, note: `${formatQuantity(Math.round(size.raw * 100) / 100)} becomes ${formatQuantity(quantity)} (${spec.symbol} trades in steps of ${formatQuantity(spec.quantityStep)}).`, state: quantity > 0 ? "adjusted" : "blocked" })
  if (quantity <= 0) return stop("rounding", "This trade will not be copied because the calculated position size is below the minimum quantity.", size.raw)

  const limits = validateRisk({ quantity, config, account, spec, price: order.entry, riskPerUnit: risk.riskPerUnit })
  if (limits.blockedBy) return stop(limits.blockedBy, limits.reason, size.raw, limits.steps)
  const limited = limits.quantity < quantity
  quantity = limits.quantity
  steps.push(...limits.steps)

  const riskAmount = risk.riskPerUnit != null ? tidy(quantity * risk.riskPerUnit) : null
  const prop = validatePropSyncRules(input.propSync ?? NO_PROPSYNC, riskAmount)
  if (!prop.ok) return stop("propsync", prop.reason, size.raw, prop.step ? [prop.step] : [])
  if (prop.step) steps.push(prop.step)

  const reason = limited ? "Position size capped by your maximum." : tidy(quantity) !== tidy(size.raw) ? `Rounded to ${qty(quantity, spec)}.` : "Copied at the calculated size."
  steps.push({ key: "final", label: "Final copy size", value: qty(quantity, spec), note: riskAmount != null ? `Risks ${money(riskAmount)} to the stop.` : undefined, state: "ok" })
  return { allowed: true, calculatedQuantity: size.raw, finalQuantity: quantity, riskAmount, riskPerUnit: risk.riskPerUnit, ratio: order.quantity > 0 ? tidy(quantity / order.quantity) : null, reason, blockedBy: limited ? "position" : null, limited, symbol: spec.symbol, steps }
}

// How a follower stands against its own limits, before any order arrives.
export function riskStatus(config: FollowerConfig, account: AccountState, prop: PropSyncState = NO_PROPSYNC): { status: "healthy" | "limited" | "blocked"; note: string; remaining: number | null } {
  if (!config.enabled) return { status: "blocked", note: "Copying is switched off.", remaining: null }
  if (!account.connected) return { status: "blocked", note: "Not connected.", remaining: null }
  if (prop.blocked) return { status: "blocked", note: prop.reason ?? "Stopped by PropSync.", remaining: null }
  const own = config.maxDailyLoss != null ? tidy(config.maxDailyLoss - Math.max(0, -account.dayPnl)) : null
  const remaining = [own, prop.dailyLossRemaining].filter((v): v is number => v != null).sort((a, b) => a - b)[0] ?? null
  if (remaining != null && remaining <= 0) return { status: "blocked", note: "Daily loss limit reached.", remaining: 0 }
  const limit = config.maxDailyLoss ?? null
  if (remaining != null && limit != null && remaining <= limit * 0.25) return { status: "limited", note: `Risk remaining: ${money(remaining)}`, remaining }
  return { status: "healthy", note: remaining != null ? `Risk remaining: ${money(remaining)}` : "No daily limit set.", remaining }
}

// ------------------------------------------------------------------ synchronisation

export type LivePosition = { key: string; symbol: string; side: Side; quantity: number; entry: number | null; stopLoss: number | null; takeProfit: number | null; price: number | null }
export type LeaderEvent =
  | { action: "open"; key: string; position: LivePosition }
  | { action: "increase"; key: string; position: LivePosition; added: number }
  | { action: "partial_close"; key: string; position: LivePosition; closed: number; fraction: number }
  | { action: "close"; key: string; previous: LivePosition }
  | { action: "modify_sl" | "trailing_stop" | "modify_tp"; key: string; position: LivePosition; previous: LivePosition }

const differs = (a: number | null, b: number | null) => (a == null) !== (b == null) || (a != null && b != null && Math.abs(a - b) > 1e-9)

// What changed on the leader's account between two looks at it. A stop moved
// in the trade's favour is read as a trailing stop; any other move as a change.
export function planLeaderEvents(previous: LivePosition[], current: LivePosition[]): LeaderEvent[] {
  const events: LeaderEvent[] = []
  const before = new Map(previous.map((p) => [p.key, p]))
  const seen = new Set<string>()
  for (const p of current) {
    seen.add(p.key)
    const old = before.get(p.key)
    if (!old) {
      events.push({ action: "open", key: p.key, position: p })
      continue
    }
    if (p.quantity > old.quantity + 1e-9) events.push({ action: "increase", key: p.key, position: p, added: tidy(p.quantity - old.quantity) })
    else if (p.quantity < old.quantity - 1e-9) events.push({ action: "partial_close", key: p.key, position: p, closed: tidy(old.quantity - p.quantity), fraction: tidy((old.quantity - p.quantity) / old.quantity) })
    if (differs(p.stopLoss, old.stopLoss)) {
      const favourable = p.stopLoss != null && old.stopLoss != null && (p.side === "long" ? p.stopLoss > old.stopLoss : p.stopLoss < old.stopLoss)
      events.push({ action: favourable ? "trailing_stop" : "modify_sl", key: p.key, position: p, previous: old })
    }
    if (differs(p.takeProfit, old.takeProfit)) events.push({ action: "modify_tp", key: p.key, position: p, previous: old })
  }
  for (const old of previous) if (!seen.has(old.key)) events.push({ action: "close", key: old.key, previous: old })
  return events
}

// How much of its own position a follower closes when the leader closes part of theirs.
export function proportionalClose(followerQuantity: number, fraction: number, spec: Pick<ContractSpec, "minimumQuantity" | "quantityStep">): number {
  const quantity = normalizeQuantity(followerQuantity * fraction, spec, "nearest")
  return Math.min(followerQuantity, quantity)
}

// The follower's stop or target for the leader's: the same price when both
// trade at the same price, otherwise the same distance from the follower's own entry.
export function translatePrice(input: { leaderPrice: number | null; leaderEntry: number | null; followerEntry: number | null; leaderSymbol: string; followerSymbol: string }): number | null {
  if (input.leaderPrice == null) return null
  if (samePriceScale(input.leaderSymbol, input.followerSymbol)) return input.leaderPrice
  if (input.leaderEntry == null || input.followerEntry == null) return null
  return tidy(input.followerEntry + (input.leaderPrice - input.leaderEntry))
}

// One id per leader event, and one per follower order made from it — so every
// follower order can be traced to the leader order it came from, and the same
// event can never be copied twice.
export const masterOrderId = (groupId: number, leaderPositionId: number, version: number) => `m${groupId}-p${leaderPositionId}-v${version}`
export const followerOrderId = (master: string, followerAccountId: number) => `${master}-f${followerAccountId}`

// ------------------------------------------------------------------ health

export type Health = "connected" | "syncing" | "warning" | "disconnected" | "auth"
export const HEALTH_LABELS: Record<Health, string> = { connected: "Connected", syncing: "Syncing", warning: "Warning", disconnected: "Disconnected", auth: "Authentication required" }

// A connection's state from what its last sync reported and how long ago.
export function connectionHealth(input: { linked: boolean; status: string | null; lastSyncAt: number | null; message?: string | null; now?: number }): Health {
  if (!input.linked) return "disconnected"
  const status = (input.status ?? "").toLowerCase()
  const message = (input.message ?? "").toLowerCase()
  if (/auth|password|login|credential|invalid account/.test(message) && status !== "ok" && status !== "connected") return "auth"
  if (status === "pending") return "syncing"
  if (status === "error" || status === "inactive") return "disconnected"
  if (input.lastSyncAt == null) return "syncing"
  const age = (input.now ?? Date.now()) - input.lastSyncAt
  return age > 30 * 60_000 ? "warning" : "connected"
}

// "4 / 4 synced": followers that are switched on, connected and not blocked.
export function syncSummary(followers: { enabled: boolean; health: Health; blocked: boolean }[]): { synced: number; total: number; tone: "good" | "warn" | "bad" | "none" } {
  const total = followers.length
  const synced = followers.filter((f) => f.enabled && (f.health === "connected" || f.health === "syncing") && !f.blocked).length
  return { synced, total, tone: total === 0 ? "none" : synced === total ? "good" : synced === 0 ? "bad" : "warn" }
}

// Why a group can't be switched on yet (empty = it can).
export function activationProblems(input: { leaderConnected: boolean; hasLeader: boolean; followers: { name: string; config: FollowerConfig; connected: boolean }[]; contracts: number; symbolScope: "all" | "selected" }): string[] {
  const problems: string[] = []
  if (!input.hasLeader) problems.push("Choose a Leader account.")
  else if (!input.leaderConnected) problems.push("The Leader account isn't connected.")
  if (input.followers.length === 0) problems.push("Add at least one Follower account.")
  if (input.followers.length > 0 && !input.followers.some((f) => f.connected)) problems.push("None of the Follower accounts is connected.")
  if (input.symbolScope === "selected" && input.contracts === 0) problems.push("Import at least one contract, or set the group to copy all symbols.")
  for (const f of input.followers) {
    const c = f.config
    const bad = (c.sizingMode === "percentage" && !(Number(c.percentage) > 0)) || (c.sizingMode === "multiplier" && !(Number(c.multiplier) > 0)) || (c.sizingMode === "fixed" && !(Number(c.fixedQuantity) > 0)) || (c.sizingMode === "risk" && !(Number(c.riskPercentage) > 0 && Number(c.riskPercentage) <= 100)) || (c.sizingMode === "custom" && !(Number(c.customFactor) > 0))
    if (bad) problems.push(`${f.name}: the ${sizingLabel(c.sizingMode).toLowerCase()} sizing has no valid value.`)
    if (c.maxPositionSize != null && !(c.maxPositionSize > 0)) problems.push(`${f.name}: the maximum position size must be above zero.`)
    if (c.maxDailyLoss != null && !(c.maxDailyLoss > 0)) problems.push(`${f.name}: the maximum daily loss must be above zero.`)
  }
  return problems
}
