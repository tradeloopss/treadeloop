import type { RealtimeEvent, RealtimeHandlers, RealtimeStatus, RealtimeSubscription } from "@/lib/providers/types"
import {
  AUTH_REQUEST_ID,
  HEARTBEAT_FRAME,
  HEARTBEAT_INTERVAL_MS,
  SILENCE_TIMEOUT_MS,
  authorizeFrame,
  isShutdown,
  parseFrame,
  propsEvents,
  requestFrame,
  responseFor,
} from "@/lib/tradovate/protocol"
import { backoffMs } from "@/lib/tradovate/http"

// One Tradovate user-data WebSocket, kept alive for as long as the connection
// is active — what Tradovate's conformance stage 2 checks:
//   • authorize with the access token after the server's "o" frame
//   • exactly one user/syncrequest per socket lifecycle (with entityTypes)
//   • "[]" heartbeats every 2.5 s, also under heavy message volume
//   • a socket silent for 15 s is treated as dead
//   • automatic reconnection with exponential backoff (+ jitter), re-authorizing
//     with the current token, and a status callback so the caller can run a
//     reconciliation sync after every reconnect (events missed while down)
// The WebSocket class and timers are injectable, so this is tested without a
// network or real time.

export interface SocketLike {
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: (() => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code?: number; reason?: string }) => void) | null
  onerror: ((ev: unknown) => void) | null
}

export interface Timers {
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (h: unknown) => void
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (h: unknown) => void
  now: () => number
}

export interface TradovateSocketOptions {
  environment: string
  url: string
  token: () => string // read on every (re)connect, so a renewed token is used
  userId: string
  entityTypes: string[]
  handlers: RealtimeHandlers
  createSocket: (url: string) => SocketLike
  timers?: Timers
  maxBackoffMs?: number
  log?: (event: string, fields: Record<string, unknown>) => void
}

const realTimers: Timers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
}

const SYNC_REQUEST_ID = 1

export class TradovateSocket implements RealtimeSubscription {
  private opts: TradovateSocketOptions
  private timers: Timers
  private socket: SocketLike | null = null
  private heartbeat: unknown = null
  private watchdog: unknown = null
  private reconnectTimer: unknown = null
  private attempt = 0
  private stopped = false
  private authorized = false
  private syncSent = false // per socket lifecycle
  private lastFrameAt = 0
  status: RealtimeStatus = "closed"

  constructor(opts: TradovateSocketOptions) {
    this.opts = opts
    this.timers = opts.timers ?? realTimers
  }

  start(): this {
    this.stopped = false
    this.connect()
    return this
  }

  async close(): Promise<void> {
    this.stopped = true
    if (this.reconnectTimer != null) this.timers.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.teardown(1000, "client closing")
    this.setStatus("closed")
  }

  private setStatus(status: RealtimeStatus, detail?: string) {
    if (this.status === status) return
    this.status = status
    this.opts.handlers.onStatus?.(status, detail)
  }

  private connect() {
    if (this.stopped) return
    this.authorized = false
    this.syncSent = false
    this.setStatus(this.attempt === 0 ? "connecting" : "degraded", this.attempt === 0 ? undefined : "reconnecting")
    let socket: SocketLike
    try {
      socket = this.opts.createSocket(this.opts.url)
    } catch {
      this.scheduleReconnect("socket could not be created")
      return
    }
    this.socket = socket
    this.lastFrameAt = this.timers.now()
    socket.onmessage = (ev) => this.onFrame(typeof ev.data === "string" ? ev.data : String(ev.data))
    socket.onclose = (ev) => {
      if (this.socket !== socket) return
      this.socket = null
      this.stopTimers()
      this.scheduleReconnect(`closed${ev.code ? ` (${ev.code})` : ""}`)
    }
    socket.onerror = () => {
      // onclose follows; nothing else to do here
    }
    // Liveness: a socket that goes silent for 15 s is replaced.
    this.watchdog = this.timers.setInterval(() => {
      if (this.timers.now() - this.lastFrameAt > SILENCE_TIMEOUT_MS) {
        this.opts.log?.("ws_silent", { environment: this.opts.environment })
        this.teardown(4000, "silent")
        this.scheduleReconnect("silent for 15s")
      }
    }, 1_000)
  }

  private onFrame(raw: string) {
    this.lastFrameAt = this.timers.now()
    const frame = parseFrame(raw)
    if (frame.type === "open") {
      this.setStatus("authorizing")
      this.socket?.send(authorizeFrame(this.opts.token()))
      return
    }
    if (frame.type === "heartbeat" || frame.type === "unknown") return
    if (frame.type === "close") {
      this.teardown(1000, "server closed")
      this.scheduleReconnect(frame.reason ?? "server closed")
      return
    }
    const messages = frame.messages
    if (isShutdown(messages)) {
      this.teardown(1000, "server shutdown")
      this.scheduleReconnect("server shutdown")
      return
    }
    if (!this.authorized) {
      const auth = responseFor(messages, AUTH_REQUEST_ID)
      if (auth) {
        if (auth.s === 200) {
          this.authorized = true
          this.startHeartbeat()
          this.sendSyncRequest()
        } else {
          this.opts.log?.("ws_auth_failed", { environment: this.opts.environment, status: auth.s ?? null })
          this.teardown(4001, "unauthorized")
          this.scheduleReconnect("authorization refused")
        }
      }
      return
    }
    const sync = responseFor(messages, SYNC_REQUEST_ID)
    if (sync) {
      if (sync.s === 200) {
        this.attempt = 0
        this.setStatus("live")
        if (sync.d && typeof sync.d === "object" && this.opts.handlers.onSnapshot) {
          const entities: Record<string, unknown[]> = {}
          for (const [k, v] of Object.entries(sync.d as Record<string, unknown>)) if (Array.isArray(v)) entities[k] = v
          void this.opts.handlers.onSnapshot(this.opts.environment, entities)
        }
      } else {
        this.setStatus("degraded", `sync request refused (${sync.s ?? "?"})`)
      }
    }
    for (const p of propsEvents(messages)) {
      const event: RealtimeEvent = { environment: this.opts.environment, entityType: p.entityType, eventType: p.eventType, entity: p.entity }
      void this.opts.handlers.onEvent(event)
    }
  }

  private sendSyncRequest() {
    if (this.syncSent || !this.socket) return
    this.syncSent = true
    this.socket.send(requestFrame("user/syncrequest", SYNC_REQUEST_ID, { users: [Number(this.opts.userId)], entityTypes: this.opts.entityTypes }))
  }

  private startHeartbeat() {
    if (this.heartbeat != null) this.timers.clearInterval(this.heartbeat)
    this.heartbeat = this.timers.setInterval(() => this.socket?.send(HEARTBEAT_FRAME), HEARTBEAT_INTERVAL_MS)
  }

  private stopTimers() {
    if (this.heartbeat != null) this.timers.clearInterval(this.heartbeat)
    if (this.watchdog != null) this.timers.clearInterval(this.watchdog)
    this.heartbeat = null
    this.watchdog = null
  }

  private teardown(code: number, reason: string) {
    this.stopTimers()
    const s = this.socket
    this.socket = null
    if (s) {
      s.onclose = null
      s.onmessage = null
      try {
        s.close(code, reason)
      } catch {
        // already closed
      }
    }
  }

  private scheduleReconnect(reason: string) {
    if (this.stopped || this.reconnectTimer != null) return
    const wait = backoffMs(this.attempt, 1_000, this.opts.maxBackoffMs ?? 60_000)
    this.attempt++
    this.setStatus("degraded", reason)
    this.opts.log?.("ws_reconnect_scheduled", { environment: this.opts.environment, reason, attempt: this.attempt, waitMs: wait })
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, wait)
  }
}
