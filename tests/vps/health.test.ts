import { test } from "node:test"
import assert from "node:assert/strict"
import { AGENT_STALE_MS, layeredHealth, overallHealth } from "@/lib/vps/health"

const ago = (ms: number) => new Date(Date.now() - ms)

test("health is layered, and unknown is never a false connected", () => {
  // being built, nothing reported yet
  assert.deepEqual(layeredHealth({ status: "provisioning", agentLastHeartbeatAt: null, ninjaTraderRunning: null, brokerConnected: null }), {
    vps: "unknown",
    agent: "unknown",
    ninjaTrader: "unknown",
    broker: "unknown",
    tradeloop: "online",
  })

  // fully up
  assert.deepEqual(layeredHealth({ status: "connected", agentLastHeartbeatAt: ago(1000), ninjaTraderRunning: true, brokerConnected: true }), {
    vps: "online",
    agent: "online",
    ninjaTrader: "online",
    broker: "online",
    tradeloop: "online",
  })

  // agent reports but doesn't know the broker yet -> broker unknown, not a false connected
  assert.equal(layeredHealth({ status: "awaiting_auth", agentLastHeartbeatAt: ago(1000), ninjaTraderRunning: true, brokerConnected: null }).broker, "unknown")

  // agent gone stale -> nothing below it is known; vps offline
  const stale = layeredHealth({ status: "connected", agentLastHeartbeatAt: ago(AGENT_STALE_MS + 5000), ninjaTraderRunning: true, brokerConnected: true })
  assert.deepEqual([stale.agent, stale.vps, stale.ninjaTrader, stale.broker], ["offline", "offline", "unknown", "unknown"])

  // destroyed
  assert.equal(layeredHealth({ status: "destroyed", agentLastHeartbeatAt: ago(1000), ninjaTraderRunning: true, brokerConnected: true }).vps, "offline")
})

test("overall health summarizes the layers", () => {
  assert.equal(overallHealth({ vps: "online", agent: "online", ninjaTrader: "online", broker: "online", tradeloop: "online" }), "online")
  assert.equal(overallHealth({ vps: "offline", agent: "offline", ninjaTrader: "unknown", broker: "unknown", tradeloop: "online" }), "offline")
  assert.equal(overallHealth({ vps: "online", agent: "online", ninjaTrader: "unknown", broker: "unknown", tradeloop: "online" }), "unknown")
})
