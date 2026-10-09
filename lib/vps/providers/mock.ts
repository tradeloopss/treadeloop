import { randomBytes } from "node:crypto"
import type { CreateServerInput, VpsProvider } from "../provider"
import type { ProviderHealth, ProviderServerState, ServerInfo } from "../types"

// Development / test provider. It creates NOTHING real: it returns deterministic
// placeholder server info so the whole provisioning pipeline, APIs, UI and
// tests can run with no cloud account and no cost. `real` is false, so the UI
// and admin label any environment it backs as "simulated" and never claim a
// real VM exists. Production must set VPS_PROVIDER to a real provider.
export class MockVpsProvider implements VpsProvider {
  readonly id = "mock"
  readonly real = false

  async createServer(input: CreateServerInput): Promise<ServerInfo> {
    const id = `mock-${input.instanceId}-${randomBytes(3).toString("hex")}`
    return {
      providerServerId: id,
      hostname: `${id}.vps.invalid`,
      // TEST-NET-1 (RFC 5737): never a routable address, so it can't be mistaken for real.
      publicIp: `192.0.2.${(input.instanceId % 254) + 1}`,
      region: input.region ?? "mock-region",
      operatingSystem: "Windows Server 2022 (simulated)",
    }
  }

  async destroyServer(): Promise<void> {}
  async rebootServer(): Promise<void> {}
  async getServerState(): Promise<ProviderServerState> {
    return "running"
  }
  async getServerInfo(providerServerId: string): Promise<ServerInfo> {
    return { providerServerId, hostname: `${providerServerId}.vps.invalid`, publicIp: null, region: "mock-region", operatingSystem: "Windows Server 2022 (simulated)" }
  }
  async getServerHealth(): Promise<ProviderHealth> {
    return { reachable: true, detail: "simulated" }
  }
}
