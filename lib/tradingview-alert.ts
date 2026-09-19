// The alert message a trader pastes into TradingView, kept apart from the
// parser that reads it back (lib/tradingview-webhook.ts) because the connect
// UI is a client component and that parser reaches for node:crypto.
//
// `{{...}}` are TradingView's own placeholders, substituted before the alert
// is delivered. `{{strategy.order.*}}` only resolves on an alert created
// from a strategy — on a plain chart alert TradingView sends the placeholder
// text through as-is, which parseTradingViewAlert rejects by name.
export function tradingviewAlertTemplate(): string {
  return `{
  "symbol": "{{ticker}}",
  "action": "{{strategy.order.action}}",
  "qty": "{{strategy.order.contracts}}",
  "price": "{{strategy.order.price}}",
  "time": "{{timenow}}",
  "id": "{{strategy.order.id}}"
}`
}
