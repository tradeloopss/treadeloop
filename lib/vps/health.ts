import type { Layer, VpsStatus } from "./types"

// The five health layers the client and admin see, derived purely so they can
// be unit-tested. The rule throughout: when we cannot actually tell, the layer
// is "unknown" — never a false "online". Below the agent (NinjaTrader, broker)
// nothing is known once the agent itself is stale.

export interface Health {
  vps: Layer
  agent: Layer
  ninjaTrader: Layer
  broker: Layer
  tradeloop: Layer
}

export interface HealthInput {
  status: VpsStatus
  agentLastHeartbeatAt: Date | null
  ninjaTraderRunning: boolean | null // from the agent; null = not reported
  brokerConnected: boolean | null // from the add-on via the agent; null = not reported
  now?: number
}

// The agent heartbeats about every 30s; stale after 90s.
export const AGENT_STALE_MS = 90_000

export function layeredHealth(i: HealthInput): Health {
  const now = i.now ?? Date.now()
  const agentOnline = i.agentLastHeartbeatAt != null && now - i.agentLastHeartbeatAt.getTime() < AGENT_STALE_MS
  const everSeen = i.agentLastHeartbeatAt != null

  const agent: Layer = agentOnline ? "online" : everSeen ? "offline" : "unknown"

  let vps: Layer
  if (i.status === "destroyed" || i.status === "destroying" || i.status === "error") vps = "offline"
  else if (i.status === "provisioning" || i.status === "installing" || i.status === "configuring") vps = "unknown" // being built
  else vps = agentOnline ? "online" : everSeen ? "offline" : "unknown"

  // NinjaTrader / broker are only trustworthy while the agent is online.
  const ninjaTrader: Layer = !agentOnline ? "unknown" : i.ninjaTraderRunning == null ? "unknown" : i.ninjaTraderRunning ? "online" : "offline"
  const broker: Layer = !agentOnline ? "unknown" : i.brokerConnected == null ? "unknown" : i.brokerConnected ? "online" : "offline"

  // TradeLoop cloud: this code answering at all means the cloud is up.
  const tradeloop: Layer = "online"

  return { vps, agent, ninjaTrader, broker, tradeloop }
}

// A single word for the whole environment, for lists and badges.
export function overallHealth(h: Health): Layer {
  if (h.vps === "online" && h.agent === "online" && h.broker === "online") return "online"
  if (h.vps === "offline" || h.agent === "offline") return "offline"
  return "unknown"
}
