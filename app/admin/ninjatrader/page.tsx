import type { Metadata } from "next"
import { requireAdmin } from "@/lib/admin/guard"
import { missingConfiguration, ninjatraderAdminOverview } from "@/lib/tradovate/admin"
import { ninjatraderDevicesOverview, ninjatraderVpsLoginsOverview } from "@/lib/ninjatrader/admin"
import { adminVpsOverview } from "@/lib/vps/server"
import { AdminPageHeader, EmptyRow, Panel, StatePill, StatRow, StatTile, fmtAgo, fmtDateTime } from "@/components/admin/ui"
import { NinjatraderConnectionControls, NinjatraderDeviceControls, NinjatraderKillSwitch } from "@/components/admin/ninjatrader/controls"
import { VpsInstanceControls } from "@/components/admin/ninjatrader/vps-controls"

// online / offline / unknown → an admin status pill.
const layerState: Record<string, string> = { online: "active", offline: "inactive", unknown: "pending" }
const layerLabel: Record<string, string> = { online: "Connected", offline: "Offline", unknown: "Unknown" }

export const metadata: Metadata = { title: "NinjaTrader — TradeLoop admin" }

// Monitoring for the NinjaTrader (Tradovate OAuth) integration: its on/off
// state, connection health across all users, and per-connection retry/pause.
// Read-only — nothing here places an order — and scoped to this integration, so
// the kill switch and controls cannot affect MT4/MT5 copy trading. No token,
// secret or balance is shown.
export default async function AdminNinjatraderPage() {
  await requireAdmin({ brokers: ["view"] })
  const [overview, devicesOverview, vps, vpsInstances, missing] = await Promise.all([ninjatraderAdminOverview(), ninjatraderDevicesOverview(), ninjatraderVpsLoginsOverview(), adminVpsOverview(), Promise.resolve(missingConfiguration())])
  const { gate, connections, accounts } = overview
  const { devices } = devicesOverview

  const gatePill = gate.enabled
    ? { state: "active", label: "Live" }
    : gate.reason === "killed"
      ? { state: "suspended", label: "Turned off" }
      : { state: "pending", label: "Awaiting vendor approval" }

  const connPill: Record<string, string> = { connected: "active", pending: "pending", reauth: "past_due", error: "suspended", disconnected: "inactive" }

  return (
    <div>
      <AdminPageHeader title="NinjaTrader" description="The NinjaTrader (Tradovate OAuth) sync integration — read-only. Separate from MT4/MT5 copy trading." />
      <div className="space-y-6 p-4 sm:p-6">
        <Panel title="Integration status" description="Whether customers can connect NinjaTrader and sync right now.">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <StatePill state={gatePill.state}>{gatePill.label}</StatePill>
            <span className="text-muted-foreground">
              {gate.enabled
                ? "Configured and on — customers can connect and sync."
                : gate.reason === "killed"
                  ? "An admin turned the integration off. Existing accounts and trades are kept; nothing new syncs."
                  : "Not configured yet. It stays in its safe state until authorized-vendor OAuth credentials are added — then it turns on here."}
            </span>
          </div>
          {!gate.enabled && gate.reason === "unconfigured" && missing.length > 0 && (
            <p className="mb-4 text-xs text-muted-foreground">
              Still required: <span className="font-medium text-foreground">{missing.join(", ")}</span> (names only — set these in the server environment once vendor access is approved).
            </p>
          )}
          <p className="mb-2 text-sm font-medium">Kill switch</p>
          <p className="mb-3 text-xs text-muted-foreground">Turns the NinjaTrader integration on or off independently. Does not affect MT4/MT5 copy trading or any other provider.</p>
          <NinjatraderKillSwitch disabled={overview.killSwitch} />
        </Panel>

        <StatRow>
          <StatTile label="Connections" value={String(connections.total)} note={`${connections.connected} connected · ${connections.disconnected} disconnected`} />
          <StatTile label="Authorizing" value={String(connections.pending)} note="first sync in progress" />
          <StatTile label="Needs reauth" value={String(overview.needsReauth)} note="authorization expired" />
          <StatTile label="Sync failures" value={String(overview.syncFailures)} note="connections in error" />
          <StatTile label="Accounts" value={String(accounts.total)} note={`${accounts.demo} demo · ${accounts.live} live`} />
          <StatTile label="Last successful sync" value={overview.lastSuccessfulSyncAt ? fmtAgo(overview.lastSuccessfulSyncAt) : "—"} note={overview.lastSuccessfulSyncAt ? fmtDateTime(overview.lastSuccessfulSyncAt) : "no sync yet"} />
        </StatRow>

        <Panel title="Connections needing attention" description="Failed or expired connections, newest first. Retry re-reads the account; Pause stops it syncing. Neither places an order.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Connection</th>
                  <th className="px-3 py-2 font-medium">User</th>
                  <th className="px-3 py-2 font-medium">Env</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Last error</th>
                  <th className="px-3 py-2 font-medium">Last sync</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {overview.problems.length === 0 ? (
                  <EmptyRow colSpan={7}>No failing or expired connections.</EmptyRow>
                ) : (
                  overview.problems.map((p) => (
                    <tr key={p.connectionId}>
                      <td className="px-3 py-2 font-mono text-xs">#{p.connectionId}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{p.userId.slice(0, 8)}…</td>
                      <td className="px-3 py-2 text-xs capitalize">{p.environment}</td>
                      <td className="px-3 py-2">
                        <StatePill state={connPill[p.status] ?? "inactive"}>{p.status}</StatePill>
                        {p.errorCount > 0 && <span className="ms-1.5 text-xs text-muted-foreground">×{p.errorCount}</span>}
                      </td>
                      <td className="max-w-[22rem] truncate px-3 py-2 text-xs text-muted-foreground" title={p.lastSyncError ?? undefined}>
                        {p.lastSyncError ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{p.lastSyncAt ? fmtAgo(p.lastSyncAt) : "—"}</td>
                      <td className="px-3 py-2">
                        <NinjatraderConnectionControls connectionId={p.connectionId} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <StatRow>
          <StatTile label="Add-on devices" value={String(devicesOverview.total)} note={`${devicesOverview.online} online now`} />
          <StatTile label="Devices with errors" value={String(devicesOverview.errored)} note="recent ingest errors" />
          <StatTile label="VPS logins" value={String(vps.total)} note="operator-run server path" />
        </StatRow>

        <Panel title="Add-on devices" description="Every trader's TradeLoop add-on (provider_device_keys). The add-on runs inside their NinjaTrader and posts read-only. No key, token or balance is shown. Reconcile rebuilds a user's journal; Revoke stops that add-on at once.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">User</th>
                  <th className="px-3 py-2 font-medium">Device</th>
                  <th className="px-3 py-2 font-medium">Version</th>
                  <th className="px-3 py-2 font-medium">NinjaTrader</th>
                  <th className="px-3 py-2 font-medium">Broker</th>
                  <th className="px-3 py-2 font-medium">Last heartbeat</th>
                  <th className="px-3 py-2 font-medium">Queue</th>
                  <th className="px-3 py-2 font-medium">Errors</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {devices.length === 0 ? (
                  <EmptyRow colSpan={9}>No add-on devices yet.</EmptyRow>
                ) : (
                  devices.map((d) => (
                    <tr key={d.id} className={d.revokedAt ? "opacity-50" : undefined}>
                      <td className="px-3 py-2 text-xs">{d.userEmail ?? `${d.userId.slice(0, 8)}…`}</td>
                      <td className="px-3 py-2 text-xs">
                        <span className="block font-medium text-foreground">{d.label ?? "—"}</span>
                        <span className="block text-muted-foreground">
                          {d.os ?? "unknown OS"} · …{d.keyHint}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{d.clientVersion ?? "—"}</td>
                      <td className="px-3 py-2">
                        <StatePill state={layerState[d.revokedAt ? "offline" : d.layers.ninjaTrader] ?? "inactive"}>{d.revokedAt ? "Revoked" : layerLabel[d.layers.ninjaTrader]}</StatePill>
                      </td>
                      <td className="px-3 py-2">
                        <StatePill state={layerState[d.revokedAt ? "offline" : d.layers.broker] ?? "inactive"}>{layerLabel[d.revokedAt ? "offline" : d.layers.broker]}</StatePill>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground" title={d.lastHeartbeatAt ? fmtDateTime(d.lastHeartbeatAt) : undefined}>
                        {d.lastHeartbeatAt ? fmtAgo(d.lastHeartbeatAt) : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{d.queueDepth ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{d.errorCount || "—"}</td>
                      <td className="px-3 py-2">
                        <NinjatraderDeviceControls deviceId={d.id} revoked={d.revokedAt != null} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="VPS logins" description="The operator-run server path (ninjatrader_connections). Shown for monitoring only — no username, password or token is displayed.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">User</th>
                  <th className="px-3 py-2 font-medium">Connection</th>
                  <th className="px-3 py-2 font-medium">Kind</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Last seen</th>
                  <th className="px-3 py-2 font-medium">Last fill</th>
                  <th className="px-3 py-2 font-medium">Errors</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {vps.logins.length === 0 ? (
                  <EmptyRow colSpan={7}>No VPS logins.</EmptyRow>
                ) : (
                  vps.logins.map((l) => (
                    <tr key={l.id}>
                      <td className="px-3 py-2 text-xs">{l.userEmail ?? `${l.userId.slice(0, 8)}…`}</td>
                      <td className="px-3 py-2 font-mono text-xs">{l.ntConnectionName}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{l.connectionKind ?? "—"}</td>
                      <td className="px-3 py-2">
                        <StatePill state={connPill[l.status] ?? "inactive"}>{l.status}</StatePill>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{l.lastSeenAt ? fmtAgo(l.lastSeenAt) : "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{l.lastFillAt ? fmtAgo(l.lastFillAt) : "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{l.errorCount || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <StatRow>
          <StatTile label="Managed VPS" value={String(vpsInstances.total)} note={`${vpsInstances.online} connected`} />
          <StatTile label="VPS provider" value={vpsInstances.instances[0]?.simulated === false ? "live" : "mock / simulated"} note="VPS_PROVIDER" />
        </StatRow>

        <Panel title="Managed VPS instances" description="TradeLoop-managed Windows VPS running NinjaTrader + the add-on + the read-only agent. Health is shown in layers — never a false connected. A simulated (mock) provider is labelled; no real server exists behind it. No key, token, password or balance is shown.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">User</th>
                  <th className="px-3 py-2 font-medium">Provider</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">VPS</th>
                  <th className="px-3 py-2 font-medium">Agent</th>
                  <th className="px-3 py-2 font-medium">NinjaTrader</th>
                  <th className="px-3 py-2 font-medium">Broker</th>
                  <th className="px-3 py-2 font-medium">Last heartbeat</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {vpsInstances.instances.length === 0 ? (
                  <EmptyRow colSpan={9}>No managed VPS instances yet.</EmptyRow>
                ) : (
                  vpsInstances.instances.map((v) => (
                    <tr key={v.id}>
                      <td className="px-3 py-2 text-xs">{v.userEmail ?? `${v.userId.slice(0, 8)}…`}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {v.provider}
                        {v.simulated && <span className="ms-1 rounded bg-muted px-1 py-0.5 text-[10px]">simulated</span>}
                      </td>
                      <td className="px-3 py-2 text-xs capitalize">{v.status.replace(/_/g, " ")}</td>
                      <td className="px-3 py-2">
                        <StatePill state={layerState[v.health.vps] ?? "inactive"}>{layerLabel[v.health.vps]}</StatePill>
                      </td>
                      <td className="px-3 py-2">
                        <StatePill state={layerState[v.health.agent] ?? "inactive"}>{layerLabel[v.health.agent]}</StatePill>
                      </td>
                      <td className="px-3 py-2">
                        <StatePill state={layerState[v.health.ninjaTrader] ?? "inactive"}>{layerLabel[v.health.ninjaTrader]}</StatePill>
                      </td>
                      <td className="px-3 py-2">
                        <StatePill state={layerState[v.health.broker] ?? "inactive"}>{layerLabel[v.health.broker]}</StatePill>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground" title={v.lastHeartbeatAt ? fmtDateTime(v.lastHeartbeatAt) : undefined}>
                        {v.lastHeartbeatAt ? fmtAgo(v.lastHeartbeatAt) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <VpsInstanceControls instanceId={v.id} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  )
}
