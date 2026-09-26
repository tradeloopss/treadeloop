// Broker-agnostic order execution — the vocabulary shared by the app (which
// writes order commands), the rule guard (which vets them), and the per-broker
// executors (the MT5 worker, the Rithmic order plant, later Tradovate).
//
// The app is otherwise read-only; these commands are the ONE write path to a
// broker, and only run when the account has execution explicitly enabled (a
// stored trading/master credential), never by default.

export type OrderKind = "close" | "partial_close" | "modify" | "cancel" | "place"

export type OrderBroker = "mt5" | "mt4" | "rithmic" | "tradovate"

export type OrderSide = "long" | "short"
export type OrderType = "market" | "limit" | "stop"

export type OrderStatus =
  | "pending" // written, awaiting an executor
  | "blocked" // the rule guard refused it (never sent)
  | "sent" // handed to the broker, awaiting confirmation
  | "filled" // broker confirmed
  | "rejected" // broker rejected it
  | "failed" // couldn't reach/execute (transient) — may retry
  | "unsupported" // this broker's execution isn't wired yet (e.g. Tradovate)

// The parameters an executor needs, by kind. All optional here; validated per
// kind when submitted.
export interface OrderCommandInput {
  accountId: number
  broker: OrderBroker
  kind: OrderKind
  // For close/partial/modify: the broker's position id/ticket (as a string, so
  // 64-bit ids never round). For cancel/modify-pending: the order id.
  positionRef?: string | null
  orderRef?: string | null
  symbol?: string | null
  side?: OrderSide | null
  volume?: number | null // lots / contracts (place, partial_close)
  price?: number | null // limit/stop price (place); exit price hint (close)
  stopLoss?: number | null
  takeProfit?: number | null
  orderType?: OrderType | null // place
}

// What the guard decides before anything is sent.
export interface GuardDecision {
  allowed: boolean
  reasons: string[]
  // A hard breach the order would cause (blocks); a soft warning is advisory.
  severity: "ok" | "warning" | "block"
}

// The broker's raw reply, normalized just enough for the UI.
export interface OrderResult {
  status: OrderStatus
  message: string
  brokerRef?: string | null // fill/order id the broker returned
  raw?: unknown
}
