import type { SocketLike, Timers } from "@/lib/tradovate/realtime"

// Test doubles: a scripted fetch, a WebSocket the test drives by hand, and
// timers that only move when the test advances them.

export interface FetchCall {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown> | null
}

type Reply = { status?: number; json?: unknown } | Error

export function scriptedFetch(replies: Reply[]) {
  const calls: FetchCall[] = []
  const queue = [...replies]
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    })
    const reply = queue.shift()
    if (!reply) throw new Error("scriptedFetch: no reply left")
    if (reply instanceof Error) throw reply
    return new Response(JSON.stringify(reply.json ?? {}), { status: reply.status ?? 200, headers: { "Content-Type": "application/json" } })
  }) as typeof fetch
  return { fetch: fn, calls }
}

export class FakeTimers implements Timers {
  current = 0
  private seq = 0
  private tasks = new Map<number, { at: number; every: number | null; fn: () => void }>()

  setInterval = (fn: () => void, ms: number) => this.add(fn, ms, ms)
  setTimeout = (fn: () => void, ms: number) => this.add(fn, ms, null)
  clearInterval = (h: unknown) => void this.tasks.delete(h as number)
  clearTimeout = (h: unknown) => void this.tasks.delete(h as number)
  now = () => this.current

  private add(fn: () => void, ms: number, every: number | null): number {
    const id = ++this.seq
    this.tasks.set(id, { at: this.current + ms, every, fn })
    return id
  }

  advance(ms: number) {
    const end = this.current + ms
    for (;;) {
      let nextId: number | null = null
      let nextAt = Infinity
      for (const [id, t] of this.tasks) if (t.at <= end && t.at < nextAt) [nextId, nextAt] = [id, t.at]
      if (nextId == null) break
      const task = this.tasks.get(nextId)!
      this.current = task.at
      if (task.every != null) task.at += task.every
      else this.tasks.delete(nextId)
      task.fn()
    }
    this.current = end
  }
}

export class FakeSocket implements SocketLike {
  url: string
  sent: string[] = []
  closed: { code?: number; reason?: string } | null = null
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null

  constructor(url: string) {
    this.url = url
  }
  send(data: string) {
    this.sent.push(data)
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason }
  }
  // Server → client
  receive(frame: string) {
    this.onmessage?.({ data: frame })
  }
  data(messages: unknown[]) {
    this.receive(`a${JSON.stringify(messages)}`)
  }
  drop(code = 1006) {
    this.onclose?.({ code })
  }
  heartbeats() {
    return this.sent.filter((s) => s === "[]").length
  }
  requests(endpoint: string) {
    return this.sent.filter((s) => s.startsWith(`${endpoint}\n`))
  }
}
