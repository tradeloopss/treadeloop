// Managed Windows VPS for NinjaTrader — shared types (no DB, no I/O, so the
// pure parts run under Node's type stripping in tests). See
// docs/managed-vps-architecture.md.

// The instance lifecycle, mirrored by vps_instances.status.
export type VpsStatus =
  | "provisioning" // the server is being created
  | "installing" // Windows is up; agent / NinjaTrader / add-on going on
  | "configuring" // device identity, services, startup
  | "ready" // everything installed and healthy, no account yet
  | "awaiting_auth" // waiting for the client's one-time account authentication
  | "connected" // broker connected and syncing
  | "disconnected" // was connected, now stale/offline
  | "error"
  | "rebooting"
  | "destroying"
  | "destroyed"

// A single health layer. "unknown" is used whenever we can't actually tell —
// never a false "online".
export type Layer = "online" | "offline" | "unknown"

// What a VpsProvider reports about the raw server.
export type ProviderServerState = "creating" | "running" | "rebooting" | "stopped" | "destroyed" | "error"

export interface ServerInfo {
  providerServerId: string
  hostname: string | null
  publicIp: string | null
  region: string | null
  operatingSystem: string | null
}

export interface ProviderHealth {
  reachable: boolean
  detail?: string
}
