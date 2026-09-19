import { createHash } from "node:crypto"
// Turns the body of a TradingView alert into one fill. Kept free of database
// and network code so it can be exercised on its own.
//
// TradingView has no account API a third party can read, so a webhook alert
// is the only sanctioned way to get a paper-trading fill out of it in real
// time. The alert message is written by the trader, from the template in
// tradingviewAlertTemplate() (lib/tradingview-alert.ts) — TradingView
// substitutes its {{...}}
// placeholders before delivering it. That means the body arriving here is
// whatever they pasted, so every field is read defensively and across the
// aliases other TradingView tools have made common (side/action,
// contracts/qty/quantity, …).

export interface TradingViewFill {
  eventId: string
  symbol: string
  action: "Buy" | "Sell"
  quantity: number
  price: number
  filledAt: Date
}

export class TradingViewAlertError extends Error {}

function pick(body: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = body[key]
    if (value != null && value !== "") return String(value).trim()
  }
  return undefined
}

// A placeholder TradingView didn't substitute arrives as the literal
// "{{strategy.order.action}}" — a strategy field on an alert that isn't a
// strategy alert. Worth naming exactly, since it's the most common setup
// mistake and the fix (create the alert from the strategy, not the chart)
// isn't obvious from a generic parse error.
function isUnsubstituted(value: string | undefined): boolean {
  return value != null && value.includes("{{")
}

function parseNumber(value: string | undefined): number | null {
  if (value == null) return null
  // TradingView formats by the chart's locale, so thousands separators and a
  // comma decimal both turn up: "1,234.5" and "1234,5" are the same price.
  const cleaned = value.replace(/\s/g, "").replace(/,(?=\d{3}\b)/g, "")
  const n = Number(cleaned.includes(",") ? cleaned.replace(",", ".") : cleaned)
  return Number.isFinite(n) ? n : null
}

function parseTime(value: string | undefined): Date {
  if (!value) return new Date()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

// TradingView symbols arrive either bare ("MNQZ2026") or exchange-qualified
// ("CME_MINI:MNQZ2026"); the journal keys trades on the bare symbol.
function normalizeSymbol(raw: string): string {
  const afterExchange = raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw
  return afterExchange.trim().toUpperCase()
}

export function parseTradingViewAlert(rawBody: string): TradingViewFill {
  const text = rawBody.trim()
  if (!text) throw new TradingViewAlertError("The alert arrived empty — paste the alert message from the setup steps.")

  let body: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) throw new Error("not an object")
    body = parsed as Record<string, unknown>
  } catch {
    throw new TradingViewAlertError("The alert message isn't the JSON from the setup steps — copy it again, placeholders and all.")
  }

  const symbolRaw = pick(body, "symbol", "ticker", "instrument")
  const actionRaw = pick(body, "action", "side", "direction")
  const qtyRaw = pick(body, "qty", "quantity", "contracts", "size", "position_size")
  const priceRaw = pick(body, "price", "fill_price", "fillPrice", "close")

  if (isUnsubstituted(actionRaw) || isUnsubstituted(qtyRaw) || isUnsubstituted(priceRaw)) {
    throw new TradingViewAlertError(
      "TradingView sent the placeholders instead of values — create the alert from your strategy (Add alert on <strategy>), not from the chart.",
    )
  }

  if (!symbolRaw) throw new TradingViewAlertError("The alert didn't say which symbol was traded.")
  if (!actionRaw) throw new TradingViewAlertError("The alert didn't say whether it was a buy or a sell.")

  const actionLower = actionRaw.toLowerCase()
  const action: "Buy" | "Sell" | null = actionLower.startsWith("b") || actionLower === "long"
    ? "Buy"
    : actionLower.startsWith("s") || actionLower === "short"
      ? "Sell"
      : null
  if (!action) throw new TradingViewAlertError(`"${actionRaw}" isn't a buy or a sell.`)

  const quantity = parseNumber(qtyRaw)
  if (quantity == null || quantity <= 0) throw new TradingViewAlertError("The alert didn't carry how many contracts or shares were filled.")

  const price = parseNumber(priceRaw)
  if (price == null || price <= 0) throw new TradingViewAlertError("The alert didn't carry a fill price.")

  const symbol = normalizeSymbol(symbolRaw)
  const filledAt = parseTime(pick(body, "time", "timenow", "timestamp"))

  // TradingView retries a delivery it thinks failed, and the same alert can
  // fire twice on one bar. The order id alone doesn't separate them (it's
  // the Pine order's name, e.g. "Long", reused every time), so the event's
  // identity is everything that describes the fill, hashed to stay short.
  const orderId = pick(body, "id", "order_id", "orderId") ?? ""
  const explicit = pick(body, "event_id", "eventId")
  const eventId =
    explicit && !isUnsubstituted(explicit)
      ? explicit
      : createHash("sha256")
          .update([orderId, symbol, action, quantity, price, filledAt.toISOString()].join("|"))
          .digest("hex")
          .slice(0, 32)

  return { eventId, symbol, action, quantity, price, filledAt }
}
