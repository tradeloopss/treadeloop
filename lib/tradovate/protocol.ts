// Tradovate's WebSocket wire format (partner.tradovate.com → WebSockets):
//   server → "o" open · "h" heartbeat · "a[…]" JSON array of messages · "c[code,reason]" close
//   client → "authorize\n0\n\n<token>" · "<endpoint>\n<id>\n<query>\n<json body>" · "[]" heartbeat
// A message is { i: request id, s: status, d: data } for a response, or
// { e: "props", d: { entityType, eventType, entity } } for a realtime change.
// Pure functions only, so the protocol is unit-tested without a socket.

export interface WsMessage {
  i?: number
  s?: number
  d?: unknown
  e?: string
}

export type Frame =
  | { type: "open" }
  | { type: "heartbeat" }
  | { type: "close"; code: number | null; reason: string | null }
  | { type: "data"; messages: WsMessage[] }
  | { type: "unknown"; raw: string }

export const HEARTBEAT_FRAME = "[]"
export const HEARTBEAT_INTERVAL_MS = 2_500 // required: every 2.5 s
export const SILENCE_TIMEOUT_MS = 15_000 // Tradovate drops a socket silent this long
export const AUTH_REQUEST_ID = 0

export function parseFrame(raw: string): Frame {
  if (raw === "o") return { type: "open" }
  if (raw === "h") return { type: "heartbeat" }
  const kind = raw.charAt(0)
  const rest = raw.slice(1)
  if (kind === "a") {
    try {
      const parsed = JSON.parse(rest)
      return Array.isArray(parsed) ? { type: "data", messages: parsed as WsMessage[] } : { type: "unknown", raw }
    } catch {
      return { type: "unknown", raw }
    }
  }
  if (kind === "c") {
    try {
      const [code, reason] = JSON.parse(rest) as [unknown, unknown]
      return { type: "close", code: typeof code === "number" ? code : null, reason: typeof reason === "string" ? reason : null }
    } catch {
      return { type: "close", code: null, reason: null }
    }
  }
  return { type: "unknown", raw }
}

export function authorizeFrame(accessToken: string): string {
  return `authorize\n${AUTH_REQUEST_ID}\n\n${accessToken}`
}

export function requestFrame(endpoint: string, id: number, body?: unknown, query = ""): string {
  return `${endpoint}\n${id}\n${query}\n${body === undefined ? "" : JSON.stringify(body)}`
}

export interface PropsEvent {
  entityType: string
  eventType: "Created" | "Updated" | "Deleted"
  entity: Record<string, unknown>
}

// Realtime entity changes in a data frame's messages.
export function propsEvents(messages: WsMessage[]): PropsEvent[] {
  const out: PropsEvent[] = []
  for (const m of messages) {
    if (m.e !== "props" || !m.d || typeof m.d !== "object") continue
    const d = m.d as Record<string, unknown>
    const eventType = d.eventType
    if (typeof d.entityType !== "string" || (eventType !== "Created" && eventType !== "Updated" && eventType !== "Deleted")) continue
    if (!d.entity || typeof d.entity !== "object") continue
    out.push({ entityType: d.entityType, eventType, entity: d.entity as Record<string, unknown> })
  }
  return out
}

// The response to request `id`, if this frame carries it.
export function responseFor(messages: WsMessage[], id: number): WsMessage | null {
  return messages.find((m) => m.i === id && m.e === undefined) ?? null
}

// A server-initiated shutdown notice ({ e: "shutdown" }).
export function isShutdown(messages: WsMessage[]): boolean {
  return messages.some((m) => m.e === "shutdown")
}

// Penalty tickets (partner.tradovate.com → Penalty Tickets): an over-limit
// call answers 200 with p-ticket / p-time / p-captcha. Wait p-time seconds and
// resend the same request with the ticket added; p-captcha means a human must
// solve a reCAPTCHA, which a server integration must never try to do.
export interface PenaltyTicket {
  ticket: string
  waitMs: number
  captcha: boolean
}

export function penaltyTicket(body: unknown): PenaltyTicket | null {
  if (!body || typeof body !== "object") return null
  const b = body as Record<string, unknown>
  if (typeof b["p-ticket"] !== "string") return null
  const seconds = typeof b["p-time"] === "number" ? b["p-time"] : 0
  return { ticket: b["p-ticket"], waitMs: Math.max(0, seconds) * 1000, captcha: b["p-captcha"] === true }
}
