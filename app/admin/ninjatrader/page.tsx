import type { Metadata } from "next"
import { requireAdmin } from "@/lib/admin/guard"
import { missingConfiguration, ninjatraderAdminOverview } from "@/lib/tradovate/admin"
import { AdminPageHeader, EmptyRow, Panel, StatePill, StatRow, StatTile, fmtAgo, fmtDateTime } from "@/components/admin/ui"
import { NinjatraderConnectionControls, NinjatraderKillSwitch } from "@/components/admin/ninjatrader/controls"

export const metadata: Metadata = { title: "NinjaTrader — TradeLoop admin" }

// Monitoring for the NinjaTrader (Tradovate OAuth) integration: its on/off
// state, connection health across all users, and per-connection retry/pause.
// Read-only — nothing here places an order — and scoped to this integration, so
// the kill switch and controls cannot affect MT4/MT5 copy trading. No token,
// secret or balance is shown.
export default async function AdminNinjatraderPage() {
  await requireAdmin({ brokers: ["view"] })
  const [overview, missing] = await Promise.all([ninjatraderAdminOverview(), Promise.resolve(missingConfiguration())])
  const { gate, connections, accounts } = overview

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
      </div>
    </div>
  )
}
