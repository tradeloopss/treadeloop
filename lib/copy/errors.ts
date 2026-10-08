// Why an order did not go through, sorted into what a trader can do about it.
// The broker's own words are kept as they came (they are the evidence); this
// adds the kind of failure and the next step. Pure: used by the engine when it
// writes an alert and by the pages when they show an order's reason.

export type FailureCategory = "authentication" | "connection" | "symbol" | "margin" | "volume" | "market_closed" | "broker_rejection" | "compliance" | "account_disabled" | "timeout" | "unknown"

export const FAILURE_LABELS: Record<FailureCategory, string> = {
  authentication: "Authentication",
  connection: "Connection",
  symbol: "Symbol",
  margin: "Insufficient margin",
  volume: "Volume",
  market_closed: "Market closed",
  broker_rejection: "Broker rejection",
  compliance: "Provider rules",
  account_disabled: "Trading disabled",
  timeout: "Timeout",
  unknown: "Unknown",
}

const ACTIONS: Record<FailureCategory, string> = {
  authentication: "Reconnect the account with its current password on the Accounts page.",
  connection: "Check the account on the Connection page, then use Retry.",
  symbol: "Map this symbol to the follower's own name for it in Risk Management, under Symbol mapping.",
  margin: "Free up margin on the account, or lower its copy size in Risk Management.",
  volume: "Change the account's copy size or rounding in Risk Management so the size fits the broker's limits.",
  market_closed: "The market for this symbol is closed. Nothing to do: the next trade is copied when it is open.",
  broker_rejection: "The broker refused the order. Check the account in the Trade Manager, then use Retry.",
  compliance: "The provider's rules don't allow this. Choose a different Follower, or see the provider's rules on the account.",
  account_disabled: "The broker won't let this login trade: the saved password is the investor (read-only) one, or trading is switched off for the account. Enter the master password under Allow orders, then use Retry.",
  timeout: "The broker didn't answer in time. Check the account before retrying: the position may already be open.",
  unknown: "Check the account in the Trade Manager.",
}

// The first that matches wins: the more specific a cause, the earlier it is asked.
const PATTERNS: [FailureCategory, RegExp][] = [
  ["compliance", /does(n't| not) permit|not permitted|places no orders on|can't be connected to tradeloop|can't be in a copy group/i],
  ["timeout", /timed? ?out|did(n't| not) answer|stopped before the broker answered|no answer/i],
  ["authentication", /rejected the login|invalid account|authori[sz]ation failed|wrong password|invalid password|not authori[sz]ed/i],
  ["account_disabled", /trade (is )?disabled|trading (is |has been )?disabled|account (is )?disabled|autotrading disabled|read.?only|investor password|can't receive orders/i],
  ["margin", /no money|not enough money|insufficient (margin|funds)|\bmargin\b/i],
  ["market_closed", /market (is )?closed|trading session|off quotes|no quotes|no prices/i],
  ["volume", /invalid volume|volume (limit|step)|lot size|(minimum|maximum) (volume|lot)|limit of (orders|volume)/i],
  ["symbol", /unknown symbol|invalid symbol|no such symbol|symbol .*(not found|unavailable|isn't available|is not available)|not in market watch/i],
  ["connection", /\bipc\b|no connection|connection (lost|failed)|not connected|disconnected|terminal|bridge|its record is gone/i],
  ["broker_rejection", /reject|requote|price changed|invalid stops|invalid request|invalid price|too many requests|retcode|refused/i],
]

// An alert its trader can put right on the spot: the order had no password that trades to go out with.
export const wantsOrdersAllowed = (e: { code: string; body: string | null }): boolean => e.code === "order_unsupported" || (e.code.startsWith("order_") && classifyFailure(e.body).category === "account_disabled")

export function classifyFailure(message: string | null | undefined): { category: FailureCategory; label: string; action: string } {
  const text = message ?? ""
  const category = PATTERNS.find(([, re]) => re.test(text))?.[0] ?? "unknown"
  return { category, label: FAILURE_LABELS[category], action: ACTIONS[category] }
}
