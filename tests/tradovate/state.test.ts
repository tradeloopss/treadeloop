import { test } from "node:test"
import assert from "node:assert/strict"
import { connectionState, integrationState, isLiveConnection, type ConnectionState } from "@/lib/tradovate/connection-state"
import { tradovateAvailability } from "@/lib/tradovate/config"

// The NinjaTrader (Tradovate OAuth) integration's UI states, as pure logic the
// Account Manager and the tests agree on. The point of these tests: the six
// states are told apart correctly, and "Connected" is NEVER shown before a real
// sync has finished.

test("the integration entry point reflects config and the kill switch, nothing else", () => {
  assert.equal(integrationState({ enabled: true, reason: "ok" }), "available")
  // not configured yet (awaiting vendor credentials): say "coming soon", never offer a live connect
  assert.equal(integrationState({ enabled: false, reason: "unconfigured" }), "pending_approval")
  // an admin turned it off
  assert.equal(integrationState({ enabled: false, reason: "killed" }), "unavailable")
})

test("a connection maps to exactly one of the six states", () => {
  const S = (status: string, syncStage: string | null): ConnectionState => connectionState({ status, syncStage })
  // not connected: nothing there, or disconnected
  assert.equal(connectionState(null), "not_connected")
  assert.equal(S("disconnected", "complete"), "not_connected")
  // authorization expired takes priority — the login must be re-done
  assert.equal(S("reauth", "complete"), "authorization_expired")
  // a sync error is a failed sync, not a lost authorization
  assert.equal(S("error", "importing_orders"), "sync_failed")
  assert.equal(S("connected", "error"), "sync_failed")
  // authorized but the first sync hasn't finished
  assert.equal(S("pending", null), "authorization_pending")
  assert.equal(S("connected", "finding_accounts"), "authorization_pending")
  assert.equal(S("connected", null), "authorization_pending")
  // connected AND a sync completed
  assert.equal(S("connected", "complete"), "connected")
})

test("“Connected” is only ever shown after a real sync completes", () => {
  // authorized, but data not yet retrieved → never "connected"
  for (const stage of [null, "authenticated", "finding_accounts", "importing_orders", "importing_executions", "building_trades", "calculating_pnl"]) {
    const s = connectionState({ status: "connected", syncStage: stage })
    assert.equal(s, "authorization_pending", `stage ${stage} must not read as connected`)
    assert.equal(isLiveConnection(s), false)
  }
  // only the completed sync is live
  assert.equal(isLiveConnection(connectionState({ status: "connected", syncStage: "complete" })), true)
  // an error mid-sync is a failure, not a live connection
  assert.equal(isLiveConnection(connectionState({ status: "connected", syncStage: "error" })), false)
})

test("mock mode can never be served in production", () => {
  const env = (o: Record<string, string | undefined>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv
  // development: mock is allowed
  assert.equal(tradovateAvailability(env({ TRADOVATE_MODE: "mock", NODE_ENV: "development" })).enabled, true)
  // production: mock is refused, both ways it can be flagged
  assert.equal(tradovateAvailability(env({ TRADOVATE_MODE: "mock", NODE_ENV: "production" })).enabled, false)
  assert.equal(tradovateAvailability(env({ TRADOVATE_MODE: "mock", VERCEL_ENV: "production" })).enabled, false)
  // off by default: no accidental live connect
  assert.equal(tradovateAvailability(env({})).enabled, false)
  assert.deepEqual(tradovateAvailability(env({})).missing, ["TRADOVATE_MODE"])
})
