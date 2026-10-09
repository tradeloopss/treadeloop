import { test } from "node:test"
import assert from "node:assert/strict"
import { deviceStatus, OFFLINE_AFTER_MS } from "@/lib/ninjatrader/sync"

// The device's status is shown in separate layers (Phase 4): the connector
// (add-on reachable), NinjaTrader, and the broker. When a layer can't be known
// it is "unknown", never a false "connected".

const base = { lastSeenAt: null, lastHeartbeatAt: null, ntConnected: null, brokerConnected: null, revokedAt: null }
const ago = (ms: number) => new Date(Date.now() - ms)

test("layers, with unknown rather than a false connected", () => {
  // never checked in
  assert.deepEqual(deviceStatus(base), { connector: "offline", ninjaTrader: "unknown", broker: "unknown" })
  // checked in recently, broker connected
  assert.deepEqual(deviceStatus({ ...base, lastHeartbeatAt: ago(1000), ntConnected: true, brokerConnected: true }), { connector: "online", ninjaTrader: "online", broker: "online" })
  // checked in, but no account status reported -> broker unknown, not "connected"
  assert.deepEqual(deviceStatus({ ...base, lastHeartbeatAt: ago(1000), ntConnected: true, brokerConnected: null }), { connector: "online", ninjaTrader: "online", broker: "unknown" })
  // checked in, broker disconnected
  assert.deepEqual(deviceStatus({ ...base, lastHeartbeatAt: ago(1000), ntConnected: true, brokerConnected: false }), { connector: "online", ninjaTrader: "online", broker: "offline" })
  // gone stale -> nothing below the connector is known
  assert.deepEqual(deviceStatus({ ...base, lastHeartbeatAt: ago(OFFLINE_AFTER_MS + 1000), ntConnected: true, brokerConnected: true }), { connector: "offline", ninjaTrader: "unknown", broker: "unknown" })
  // revoked -> offline regardless
  assert.deepEqual(deviceStatus({ ...base, lastHeartbeatAt: ago(1000), ntConnected: true, brokerConnected: true, revokedAt: ago(1000) }), { connector: "offline", ninjaTrader: "unknown", broker: "unknown" })
  // backward compatible: falls back to lastSeenAt when the heartbeat column is empty
  assert.deepEqual(deviceStatus({ ...base, lastSeenAt: ago(1000), ntConnected: true, brokerConnected: true }), { connector: "online", ninjaTrader: "online", broker: "online" })
})
