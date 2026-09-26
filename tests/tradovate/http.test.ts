import { test } from "node:test"
import assert from "node:assert/strict"
import { tradovateRequest, type HttpDeps } from "@/lib/tradovate/http"
import { ProviderError } from "@/lib/providers/types"
import { scriptedFetch } from "./helpers"

const BASE = "https://demo.example/v1"
const TOKEN = "secret-access-token"

function deps(fetch: typeof globalThis.fetch, extra: Partial<HttpDeps> = {}) {
  const slept: number[] = []
  const logs: string[] = []
  const d: HttpDeps = {
    fetch,
    sleep: async (ms) => void slept.push(ms),
    log: (event, fields) => void logs.push(JSON.stringify({ event, ...fields })),
    ...extra,
  }
  return { d, slept, logs }
}

async function rejects(p: Promise<unknown>, kind: string): Promise<ProviderError> {
  try {
    await p
  } catch (err) {
    assert.ok(err instanceof ProviderError, `expected ProviderError, got ${err}`)
    assert.equal(err.kind, kind)
    return err
  }
  assert.fail(`expected a ${kind} error`)
}

test("sends the bearer token and query, returns the JSON", async () => {
  const f = scriptedFetch([{ json: [{ id: 1 }] }])
  const { d } = deps(f.fetch)
  const out = await tradovateRequest(BASE, { path: "/fill/list", query: { a: 1, skip: undefined }, token: TOKEN }, d)
  assert.deepEqual(out, [{ id: 1 }])
  assert.equal(f.calls[0].url, `${BASE}/fill/list?a=1`)
  assert.equal(f.calls[0].headers.Authorization, `Bearer ${TOKEN}`)
})

test("penalty ticket: waits p-time and resends with the ticket", async () => {
  const f = scriptedFetch([{ json: { "p-ticket": "TICKET-1", "p-time": 4 } }, { json: { ok: true } }])
  const { d, slept, logs } = deps(f.fetch)
  const out = await tradovateRequest(BASE, { method: "POST", path: "/cashBalance/getcashbalancesnapshot", body: { accountId: 5 }, token: TOKEN }, d)
  assert.deepEqual(out, { ok: true })
  assert.deepEqual(slept, [4000])
  assert.equal(f.calls.length, 2)
  assert.deepEqual(f.calls[1].body, { accountId: 5, "p-ticket": "TICKET-1" })
  assert.ok(!logs.join("\n").includes("TICKET-1"), "the ticket is not logged")
})

test("penalty ticket with a captcha: stops, never retried, one-hour pause", async () => {
  const f = scriptedFetch([{ json: { "p-ticket": "T", "p-time": 1, "p-captcha": true } }])
  const { d, slept } = deps(f.fetch)
  const err = await rejects(tradovateRequest(BASE, { method: "POST", path: "/x", body: {} }, d), "captcha")
  assert.equal(err.retryAfterMs, 60 * 60 * 1000)
  assert.equal(f.calls.length, 1)
  assert.deepEqual(slept, [])
})

test("repeated penalty tickets give up as rate_limited", async () => {
  const f = scriptedFetch([1, 2, 3, 4, 5].map(() => ({ json: { "p-ticket": "T", "p-time": 1 } })))
  const { d } = deps(f.fetch, { maxPenalties: 2 })
  await rejects(tradovateRequest(BASE, { method: "POST", path: "/x", body: {} }, d), "rate_limited")
  assert.equal(f.calls.length, 3)
})

test("429: no retry, one-hour pause", async () => {
  const f = scriptedFetch([{ status: 429 }, { json: {} }])
  const { d, slept } = deps(f.fetch)
  const err = await rejects(tradovateRequest(BASE, { path: "/x" }, d), "rate_limited")
  assert.equal(err.retryAfterMs, 60 * 60 * 1000)
  assert.equal(f.calls.length, 1)
  assert.deepEqual(slept, [])
})

test("401 is an auth error and is not retried", async () => {
  const f = scriptedFetch([{ status: 401 }, { json: {} }])
  const { d } = deps(f.fetch)
  await rejects(tradovateRequest(BASE, { path: "/x", token: TOKEN }, d), "auth")
  assert.equal(f.calls.length, 1)
})

test("403 and 404 map to forbidden and not_found", async () => {
  await rejects(tradovateRequest(BASE, { path: "/x" }, deps(scriptedFetch([{ status: 403 }]).fetch).d), "forbidden")
  await rejects(tradovateRequest(BASE, { path: "/x" }, deps(scriptedFetch([{ status: 404 }]).fetch).d), "not_found")
})

test("5xx and network errors retry with backoff, then succeed", async () => {
  const f = scriptedFetch([{ status: 502 }, new TypeError("fetch failed"), { json: { ok: 1 } }])
  const { d, slept } = deps(f.fetch)
  assert.deepEqual(await tradovateRequest(BASE, { path: "/x" }, d), { ok: 1 })
  assert.equal(f.calls.length, 3)
  assert.equal(slept.length, 2)
  assert.ok(slept[1] >= slept[0] / 2, "backoff does not shrink")
})

test("5xx that never recovers ends as a server error", async () => {
  const f = scriptedFetch([{ status: 500 }, { status: 500 }, { status: 503 }])
  const { d } = deps(f.fetch, { maxRetries: 2 })
  await rejects(tradovateRequest(BASE, { path: "/x" }, d), "server")
  assert.equal(f.calls.length, 3)
})

test("errorText in a 200 body is an invalid-request error", async () => {
  const f = scriptedFetch([{ json: { errorText: "Access is denied" } }])
  await rejects(tradovateRequest(BASE, { path: "/x" }, deps(f.fetch).d), "invalid")
})

test("tokens never reach the logs", async () => {
  const f = scriptedFetch([{ status: 500 }, { json: {} }])
  const { d, logs } = deps(f.fetch)
  await tradovateRequest(BASE, { path: "/x", token: TOKEN }, d)
  assert.ok(logs.length > 0)
  assert.ok(!logs.join("\n").includes(TOKEN))
})
