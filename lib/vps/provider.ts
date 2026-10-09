import type { ProviderHealth, ProviderServerState, ServerInfo } from "./types"
import { MockVpsProvider } from "./providers/mock"

// The one seam between TradeLoop and whatever actually runs Windows VMs. A
// real provider (Hetzner, DigitalOcean, Azure, …) implements this against its
// API; the mock provider simulates it for development and tests. Nothing above
// this interface knows which is in use — except that `real` is surfaced to the
// UI/admin so a simulated environment is never shown as a real one.
//
// Choosing a provider is deliberately runtime config (VPS_PROVIDER), not a
// hard dependency, so the whole architecture builds and is tested without any
// cloud account. See docs/vps-provisioning.md.

export interface CreateServerInput {
  userId: string
  instanceId: number
  region?: string
  // Baked into the VM's user-data by a real provider so the agent can
  // authenticate and reach the cloud. Never persisted or logged by TradeLoop.
  // The mock provider ignores them.
  agentKey?: string
  cloudUrl?: string
}

export interface VpsProvider {
  readonly id: string
  // false for the mock/dev provider — callers must label the environment as
  // simulated and must never report a real VM as created/connected.
  readonly real: boolean
  createServer(input: CreateServerInput): Promise<ServerInfo>
  destroyServer(providerServerId: string): Promise<void>
  rebootServer(providerServerId: string): Promise<void>
  getServerState(providerServerId: string): Promise<ProviderServerState>
  getServerInfo(providerServerId: string): Promise<ServerInfo>
  getServerHealth(providerServerId: string): Promise<ProviderHealth>
}

// A real provider is wired in here once its SDK + credentials exist. Until
// then, selecting anything other than "mock" fails loudly rather than
// pretending — a genuine external blocker (credentials/account), not a bug.
export function getVpsProvider(env: NodeJS.ProcessEnv = process.env): VpsProvider {
  const id = (env.VPS_PROVIDER ?? "mock").trim().toLowerCase()
  if (id === "mock" || id === "") return new MockVpsProvider()
  throw new Error(`VPS_PROVIDER="${id}" is not implemented. Configure a real provider (see docs/vps-provisioning.md) or use "mock".`)
}

// Whether a real (non-mock) provider is configured. The UI/admin use this to
// mark simulated environments and to gate the real client-facing flow.
export function vpsProviderIsReal(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return getVpsProvider(env).real
  } catch {
    return false
  }
}
