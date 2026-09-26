import { ProviderError } from "@/lib/providers/types"
import { penaltyTicket } from "@/lib/tradovate/protocol"

// One HTTP call to Tradovate, with the handling Tradovate's conformance
// testing asks for:
//   • penalty ticket (200 + p-ticket): wait p-time, resend with the ticket
//   • p-captcha: stop — a reCAPTCHA can't (and mustn't) be answered by a server
//   • 429: user-level limit — no retries for an hour (retrying resets the clock)
//   • 401: never retried here; the caller renews/refreshes the token
//   • network errors and 5xx: retried with exponential backoff + jitter
// Tokens and secrets never appear in errors or logs.

export interface HttpDeps {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  maxRetries?: number // for network/5xx
  maxPenalties?: number
  log?: (event: string, fields: Record<string, unknown>) => void
}

export interface RequestSpec {
  method?: "GET" | "POST"
  path: string // "/account/list"
  query?: Record<string, string | number | undefined>
  body?: Record<string, unknown>
  token?: string | null
}

const HOUR = 60 * 60 * 1000
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function backoffMs(attempt: number, baseMs = 500, capMs = 30_000): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt)
  return Math.round(exp / 2 + Math.random() * (exp / 2))
}

export async function tradovateRequest<T>(baseUrl: string, spec: RequestSpec, deps: HttpDeps = {}): Promise<T> {
  const doFetch = deps.fetch ?? fetch
  const sleep = deps.sleep ?? defaultSleep
  const maxRetries = deps.maxRetries ?? 3
  const maxPenalties = deps.maxPenalties ?? 3
  const method = spec.method ?? (spec.body ? "POST" : "GET")
  const qs = spec.query
    ? Object.entries(spec.query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : ""
  const url = `${baseUrl}${spec.path}${qs ? `?${qs}` : ""}`

  let attempt = 0
  let penalties = 0
  let ticket: string | null = null
  for (;;) {
    let res: Response
    try {
      const body = method === "POST" ? JSON.stringify(ticket ? { ...(spec.body ?? {}), "p-ticket": ticket } : (spec.body ?? {})) : undefined
      res = await doFetch(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(spec.token ? { Authorization: `Bearer ${spec.token}` } : {}),
        },
        body,
        signal: AbortSignal.timeout(deps.timeoutMs ?? 20_000),
      })
    } catch (err) {
      if (attempt < maxRetries) {
        deps.log?.("http_retry", { path: spec.path, attempt, reason: "network" })
        await sleep(backoffMs(attempt++))
        continue
      }
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
      throw new ProviderError("network", timedOut ? "Tradovate didn't answer in time." : "Couldn't reach Tradovate.")
    }

    if (res.status === 401) throw new ProviderError("auth", "Tradovate authorization expired. Please reconnect your account.", { status: 401 })
    if (res.status === 403) throw new ProviderError("forbidden", "Tradovate refused this request for your account.", { status: 403 })
    if (res.status === 404) throw new ProviderError("not_found", "Tradovate couldn't find that.", { status: 404 })
    if (res.status === 429) {
      deps.log?.("rate_limited", { path: spec.path, status: 429 })
      throw new ProviderError("rate_limited", "Tradovate is limiting requests — syncing pauses for an hour.", { status: 429, retryAfterMs: HOUR })
    }
    if (res.status >= 500) {
      if (attempt < maxRetries) {
        deps.log?.("http_retry", { path: spec.path, attempt, status: res.status })
        await sleep(backoffMs(attempt++))
        continue
      }
      throw new ProviderError("server", "Tradovate is having trouble right now.", { status: res.status })
    }
    if (!res.ok) throw new ProviderError("invalid", `Tradovate rejected the request (${res.status}).`, { status: res.status })

    let json: unknown
    try {
      json = await res.json()
    } catch {
      throw new ProviderError("invalid", "Tradovate sent an unreadable response.")
    }

    const penalty = penaltyTicket(json)
    if (penalty) {
      deps.log?.("penalty_ticket", { path: spec.path, waitMs: penalty.waitMs, captcha: penalty.captcha })
      if (penalty.captcha) throw new ProviderError("captcha", "Tradovate wants a security check we can't complete automatically — syncing pauses for an hour.", { retryAfterMs: HOUR })
      if (penalties++ >= maxPenalties) throw new ProviderError("rate_limited", "Tradovate is limiting requests — syncing will retry shortly.", { retryAfterMs: Math.max(penalty.waitMs, 60_000) })
      await sleep(penalty.waitMs)
      ticket = penalty.ticket
      continue
    }
    if (json && typeof json === "object" && !Array.isArray(json) && typeof (json as Record<string, unknown>).errorText === "string") {
      throw new ProviderError("invalid", String((json as Record<string, unknown>).errorText).slice(0, 200))
    }
    return json as T
  }
}
