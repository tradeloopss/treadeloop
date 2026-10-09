import type { VpsStatus } from "./types"

// The provisioning pipeline, as a pure state machine so it can be unit-tested
// without a provider or a database. The DB layer (lib/vps/server.ts) runs the
// provider action for the current step, then calls nextStep/statusForStep to
// advance. See docs/vps-provisioning.md.

export const PROVISION_STEPS = [
  "create_server", // ask the provider for a Windows VM
  "wait_for_windows", // wait until Windows is reachable
  "install_agent", // the read-only TradeLoop VPS agent
  "install_ninjatrader", // NinjaTrader 8
  "install_addon", // the TradeLoopSync add-on
  "configure_device", // device identity + TradeLoop endpoint
  "start_services", // agent + NinjaTrader on startup
  "health_check", // confirm everything is up
] as const

export type ProvisionStep = (typeof PROVISION_STEPS)[number]

// The next step after this one, or null when provisioning is finished.
export function nextStep(step: ProvisionStep): ProvisionStep | null {
  const i = PROVISION_STEPS.indexOf(step)
  if (i < 0 || i >= PROVISION_STEPS.length - 1) return null
  return PROVISION_STEPS[i + 1]
}

// The instance status while a given step runs.
export function statusForStep(step: ProvisionStep): VpsStatus {
  switch (step) {
    case "create_server":
    case "wait_for_windows":
      return step === "create_server" ? "provisioning" : "installing"
    case "install_agent":
    case "install_ninjatrader":
    case "install_addon":
      return "installing"
    case "configure_device":
    case "start_services":
      return "configuring"
    case "health_check":
      return "ready"
  }
}

// Once the last step completes the instance is ready but has no account yet, so
// it waits for the client's one-time authentication inside NinjaTrader.
export const STATUS_AFTER_PROVISIONING: VpsStatus = "awaiting_auth"

// Statuses from which an agent report can move the instance. Driven by the
// broker connection the agent (via the add-on) observes — never by TradeLoop
// logging anyone in.
export function statusFromBroker(current: VpsStatus, brokerConnected: boolean): VpsStatus {
  if (current === "destroyed" || current === "destroying" || current === "error") return current
  if (brokerConnected) return "connected"
  // broker not connected: ready/awaiting_auth stay as they are; a previously
  // connected instance drops to disconnected.
  if (current === "connected") return "disconnected"
  return current === "ready" ? "awaiting_auth" : current
}

// Steps that are safe to (re)run — all of them are idempotent in a real
// provider (install checks "already installed"), so a retry after a failure or
// a reboot never does harm.
export const RESUMABLE = true
