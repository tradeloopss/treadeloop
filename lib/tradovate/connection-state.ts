// The user-facing states of the NinjaTrader (Tradovate OAuth) integration, as
// pure functions so the Account Manager and its tests agree exactly.
//
// Two layers:
//   • the integration itself — is "Connect NinjaTrader" offered at all? (env
//     config + the admin kill switch), and
//   • one connection — where a connected account is in its lifecycle.
//
// Nothing here reads the database or the environment; callers pass what they
// read. "Connected" is only ever returned once a real sync has completed, so a
// started-but-unconfirmed OAuth never shows as connected.

// What the "Connect NinjaTrader" entry point should show.
//   available          — OAuth is configured and on; the connect button works.
//   pending_approval    — not configured yet (awaiting vendor credentials); explain, don't offer a live connect.
//   unavailable         — an admin turned the integration off (kill switch).
export type IntegrationState = "available" | "pending_approval" | "unavailable"

export function integrationState(gate: { enabled: boolean; reason: "ok" | "unconfigured" | "killed" }): IntegrationState {
  if (gate.enabled) return "available"
  return gate.reason === "killed" ? "unavailable" : "pending_approval"
}

export const INTEGRATION_STATE_COPY: Record<IntegrationState, { label: string; detail: string }> = {
  available: { label: "Available", detail: "Connect your NinjaTrader account and your trades sync automatically." },
  pending_approval: { label: "Coming soon", detail: "One-click NinjaTrader sign-in is pending NinjaTrader's vendor approval. It will turn on here once approved." },
  unavailable: { label: "Temporarily unavailable", detail: "NinjaTrader sync is paused for maintenance. Your existing accounts and trades are unaffected." },
}

// Where one connection is. These are the states the spec asks the UI to tell apart.
//   not_connected          — no live connection (never connected, or disconnected).
//   authorization_pending  — OAuth done or in progress, first sync not finished yet.
//   connected              — authorized AND a sync has completed with data validated.
//   sync_failed            — a sync error; the connection is still authorized.
//   authorization_expired  — the login needs to be re-authorized (reauth).
export type ConnectionState = "not_connected" | "authorization_pending" | "connected" | "sync_failed" | "authorization_expired"

// `status` / `syncStage` are the trading_connections fields (see lib/tradovate/connections.ts).
export function connectionState(conn: { status: string; syncStage: string | null } | null): ConnectionState {
  if (!conn || conn.status === "disconnected") return "not_connected"
  if (conn.status === "reauth") return "authorization_expired"
  // a sync error is a failed sync, not a lost authorization
  if (conn.status === "error" || conn.syncStage === "error") return "sync_failed"
  // connected, and the first sync actually finished: only now is it "Connected"
  if (conn.status === "connected" && conn.syncStage === "complete") return "connected"
  // authorized, but the first sync hasn't finished (pending / syncing)
  return "authorization_pending"
}

export const CONNECTION_STATE_COPY: Record<ConnectionState, { label: string; tone: "neutral" | "progress" | "good" | "bad" }> = {
  not_connected: { label: "Not connected", tone: "neutral" },
  authorization_pending: { label: "Authorizing & syncing…", tone: "progress" },
  connected: { label: "Connected & syncing", tone: "good" },
  sync_failed: { label: "Sync failed", tone: "bad" },
  authorization_expired: { label: "Authorization expired", tone: "bad" },
}

// Does this state mean the account is live and importing? (for "Connected" badges)
export const isLiveConnection = (s: ConnectionState) => s === "connected"
