import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan, ROLE_LABELS, isAdminRole } from "@/lib/admin/access"
import { ACTION_LABELS } from "@/lib/admin/audit"
import { getUserProfile, getUserStorage, listImports, listSecurityEvents, listSyncRuns, listUserTickets } from "@/lib/admin/metrics"
import { SecurityEventsTable } from "@/components/admin/security-events-table"
import { TicketStatus } from "@/components/ticket-status"
import { isOwnerEmail, rowGrantsAccess } from "@/lib/subscription"
import { UserActions } from "@/components/admin/user-actions"
import { ForceSyncButton, RevokeGrantButton } from "@/components/admin/row-actions"
import { MembershipControls } from "@/components/admin/whop-controls"
import { EmptyRow, Panel, StatePill, SyncStatus, fmtAgo, fmtBytes, fmtDate, fmtDateTime } from "@/components/admin/ui"

const PROVIDER_LABELS: Record<string, string> = { credential: "Email & password", google: "Google", github: "GitHub" }

function device(userAgent: string | null) {
  if (!userAgent) return "Unknown device"
  const os = /iPhone|iPad/.test(userAgent) ? "iOS" : /Android/.test(userAgent) ? "Android" : /Mac OS/.test(userAgent) ? "macOS" : /Windows/.test(userAgent) ? "Windows" : /Linux/.test(userAgent) ? "Linux" : "Other"
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Chrome\//.test(userAgent) ? "Chrome" : /Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "Browser"
  return `${browser} on ${os}`
}

function syncHealth(c: { lastSyncStatus: string | null; lastSyncedAt: Date | null }) {
  if (c.lastSyncStatus === "error") return "failing" as const
  if (!c.lastSyncedAt) return "never" as const
  return new Date(c.lastSyncedAt).getTime() < Date.now() - 3600_000 ? ("stale" as const) : ("healthy" as const)
}

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin({ user: ["get"] })
  const { id } = await params
  const profile = await getUserProfile(id)
  if (!profile) notFound()
  const canSecurity = roleCan(admin.role, { security: ["view"] })
  const canSupport = roleCan(admin.role, { support: ["view"] })
  const [security, tickets, storage, imports, syncRuns] = await Promise.all([
    canSecurity ? listSecurityEvents({ userId: id, limit: 15 }) : Promise.resolve(null),
    canSupport ? listUserTickets(id) : Promise.resolve([]),
    getUserStorage(id),
    listImports({ userId: id, limit: 10 }),
    listSyncRuns({ userId: id, limit: 10 }),
  ])
  const { user, counts } = profile

  const owner = isOwnerEmail(user.email)
  const current = profile.subscriptions.find((s) => s.status !== "pending" && rowGrantsAccess(s))
  const state = user.banned ? "suspended" : current || owner ? "active" : profile.subscriptions.some((s) => s.status !== "pending") ? "canceled" : "inactive"
  const can = {
    impersonate: roleCan(admin.role, { user: ["impersonate"] }) && !isAdminRole(user.role) && !owner,
    ban: roleCan(admin.role, { user: ["ban"] }) && !owner && (!isAdminRole(user.role) || admin.role === "super_admin"),
    revoke: roleCan(admin.role, { session: ["revoke"] }),
    grant: roleCan(admin.role, { billing: ["manage"] }),
    security: roleCan(admin.role, { security: ["manage"] }) && (!isAdminRole(user.role) || admin.role === "super_admin"),
  }
  const hasPassword = profile.providers.some((p) => p.providerId === "credential")
  const canSync = roleCan(admin.role, { brokers: ["sync"] })
  const canBilling = roleCan(admin.role, { billing: ["view"] })

  return (
    <div>
      <div className="border-b px-4 py-5 sm:px-6">
        <Link href="/admin/users" className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Users
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{user.name || user.email}</h1>
          <StatePill state={state} />
          {owner && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">Owner</span>}
          {isAdminRole(user.role) && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{ROLE_LABELS[user.role]}</span>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {user.email} · joined {fmtDate(user.createdAt)} · last seen {fmtAgo(profile.sessions.find((s) => !s.impersonatedBy)?.updatedAt)}
        </p>
        {user.banned && (
          <p className="mt-3 rounded-lg bg-[var(--loss)]/10 px-3 py-2 text-sm text-[var(--loss)]">
            Suspended{user.banReason ? `: ${user.banReason}` : ""}
            {user.banExpires ? ` · until ${fmtDate(user.banExpires)}` : " · until lifted"}
          </p>
        )}
        <div className="mt-4">
          <UserActions userId={user.id} userLabel={user.email} banned={!!user.banned} isSelf={user.id === admin.id} twoFactorEnabled={!!user.twoFactorEnabled} hasPassword={hasPassword} can={can} />
        </div>
      </div>

      <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-2">
        <Panel title="Account">
          <dl className="grid grid-cols-[140px_1fr] gap-y-2.5 text-sm">
            <dt className="text-muted-foreground">Sign-in methods</dt>
            <dd>{profile.providers.map((p) => PROVIDER_LABELS[p.providerId] ?? p.providerId).join(", ") || "—"}</dd>
            <dt className="text-muted-foreground">Email verified</dt>
            <dd>{user.emailVerified ? "Yes" : "No"}</dd>
            <dt className="text-muted-foreground">Two-factor auth</dt>
            <dd>{user.twoFactorEnabled ? "On (authenticator app)" : "Off"}</dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd>{owner ? "Owner (Super Admin)" : isAdminRole(user.role) ? ROLE_LABELS[user.role] : "Trader"}</dd>
            <dt className="text-muted-foreground">User ID</dt>
            <dd className="truncate font-mono text-xs">{user.id}</dd>
          </dl>
        </Panel>

        <Panel title="Journal">
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            {[
              ["Trades", counts.trades],
              ["Trading accounts", counts.accounts],
              ["Journal entries", counts.journal],
              ["Playbooks", counts.playbooks],
              ["Prop firm rules", counts.propfirm],
              ["Tag groups", counts.tagGroups],
            ].map(([label, value]) => (
              <div key={label as string}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-lg font-semibold tabular-nums">{Number(value).toLocaleString("en-US")}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            Last trade logged {fmtAgo(counts.lastTrade)}. Storage {fmtBytes(storage.total)}
            {storage.total > 0 && ` (trades ${fmtBytes(storage.trades)}, journal ${fmtBytes(storage.journal)}, imports ${fmtBytes(storage.imports)})`}.
          </p>
        </Panel>

        <Panel title="Connected brokers" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Connection</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Last sync</th>
                  <th className="pb-2 font-medium">Last error</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {profile.rithmic.map((c) => (
                  <tr key={`r${c.id}`}>
                    <td className="py-2.5 pr-3">Rithmic · {c.accountName || c.systemName}</td>
                    <td className="py-2.5 pr-3"><SyncStatus status={syncHealth(c)} /></td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{fmtAgo(c.lastSyncedAt)}{c.lastSyncCount ? ` · ${c.lastSyncCount} trades` : ""}</td>
                    <td className="max-w-[260px] truncate py-2.5 pr-3 text-xs text-muted-foreground" title={c.lastSyncError ?? undefined}>{c.lastSyncError ?? "—"}</td>
                    <td className="py-2.5 text-right">{canSync && <ForceSyncButton connectionId={c.id} />}</td>
                  </tr>
                ))}
                {profile.metatrader.map((c) => (
                  <tr key={`m${c.id}`}>
                    <td className="py-2.5 pr-3">MetaTrader · {c.server} · {c.login}</td>
                    <td className="py-2.5 pr-3"><SyncStatus status={syncHealth(c)} /></td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{fmtAgo(c.lastSyncedAt)}{c.lastSyncCount ? ` · ${c.lastSyncCount} trades` : ""}</td>
                    <td className="max-w-[260px] truncate py-2.5 pr-3 text-xs text-muted-foreground" title={c.lastSyncError ?? undefined}>{c.lastSyncError ?? "—"}</td>
                    <td />
                  </tr>
                ))}
                {profile.rithmic.length + profile.metatrader.length === 0 && <EmptyRow colSpan={5}>No brokers connected.</EmptyRow>}
              </tbody>
            </table>
          </div>
        </Panel>

        {canBilling && (
          <Panel title="Subscriptions" description="Newest first. Pending = checkout started but not completed.">
            <ul className="divide-y text-sm">
              {profile.subscriptions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <span>
                    <span className="font-medium capitalize">{s.plan}</span>
                    <span className="text-muted-foreground">
                      {" "}· {s.source === "admin" ? "admin grant" : s.billing ?? "billing unknown"} · {s.source === "admin" ? "ends" : "updated"} {fmtDate(s.source === "admin" ? s.currentPeriodEnd : s.updatedAt)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <StatePill state={s.source === "admin" && !rowGrantsAccess(s) && s.status === "active" ? "expired" : s.status} />
                    {s.source === "admin" && rowGrantsAccess(s) && can.grant && <RevokeGrantButton subscriptionId={s.id} />}
                  </span>
                  {s.source === "whop" && s.whopMembershipId && can.grant && (
                    <div className="w-full pt-1">
                      <MembershipControls membershipId={s.whopMembershipId} status={s.status} cancelAtPeriodEnd={false} />
                    </div>
                  )}
                </li>
              ))}
              {profile.subscriptions.length === 0 && <li className="py-6 text-center text-muted-foreground">Never started a plan.</li>}
            </ul>
          </Panel>
        )}

        <Panel title="Sign-ins" description="Most recent sessions, with the IP and device each came from.">
          <ul className="divide-y text-sm">
            {profile.sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate">{device(s.userAgent)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {s.ipAddress || "IP unknown"} · signed in {fmtDateTime(s.createdAt)}
                  </span>
                </span>
                <span className="shrink-0 text-xs">
                  {s.impersonatedBy ? (
                    <span className="rounded-full bg-[var(--chart-4)]/15 px-2 py-0.5 text-[var(--chart-4)]">admin login-as</span>
                  ) : new Date(s.expiresAt).getTime() > Date.now() ? (
                    <span className="text-muted-foreground">active {fmtAgo(s.updatedAt)}</span>
                  ) : (
                    <span className="text-muted-foreground">expired</span>
                  )}
                </span>
              </li>
            ))}
            {profile.sessions.length === 0 && <li className="py-6 text-center text-muted-foreground">No sessions on record.</li>}
          </ul>
        </Panel>

        <Panel title="File imports" description="CSV and report uploads, newest first.">
          <ul className="divide-y text-sm">
            {imports.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate">{i.fileName ?? "(unnamed file)"}</span>
                  <span className="block text-xs text-muted-foreground">
                    {i.source ?? "Unrecognized"} · {fmtAgo(i.createdAt)}
                    {i.status === "imported" ? ` · ${i.imported} new, ${i.duplicates} duplicates` : ` · ${i.error}`}
                  </span>
                </span>
                <StatePill state={i.status === "imported" ? "active" : i.resolvedAt ? "inactive" : "suspended"}>
                  {i.status === "imported" ? "Imported" : i.resolvedAt ? "Handled" : "Failed"}
                </StatePill>
              </li>
            ))}
            {imports.length === 0 && <li className="py-6 text-center text-muted-foreground">No file imports.</li>}
          </ul>
        </Panel>

        <Panel title="Broker sync runs" description="Latest sync attempts for this user's connections.">
          <ul className="divide-y text-sm">
            {syncRuns.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block">
                    {r.broker === "rithmic" ? "Rithmic" : "MetaTrader"} · {r.trigger === "auto" ? "background" : r.trigger}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {fmtAgo(r.createdAt)}{r.status === "ok" ? ` · ${r.imported ?? 0} new` : ` · ${r.error}`}
                  </span>
                </span>
                <StatePill state={r.status === "ok" ? "active" : "suspended"}>{r.status === "ok" ? "OK" : "Error"}</StatePill>
              </li>
            ))}
            {syncRuns.length === 0 && <li className="py-6 text-center text-muted-foreground">No sync runs recorded.</li>}
          </ul>
        </Panel>

        {security && (
          <Panel title="Security activity" description="Latest sign-ins, failed attempts and credential changes." className="xl:col-span-2">
            <div className="overflow-x-auto">
              <SecurityEventsTable rows={security.rows} showUser={false} empty={<tr><td colSpan={4} className="py-6 text-center text-sm text-muted-foreground">Nothing recorded yet.</td></tr>} />
            </div>
          </Panel>
        )}

        {canSupport && (
          <Panel title="Support requests">
            <ul className="divide-y text-sm">
              {tickets.map((t) => (
                <li key={t.id}>
                  <Link href={`/admin/support/${t.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-primary">
                    <span className="truncate">{t.subject}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground">{fmtAgo(t.lastMessageAt)}</span>
                      <TicketStatus status={t.status} forStaff />
                    </span>
                  </Link>
                </li>
              ))}
              {tickets.length === 0 && <li className="py-6 text-center text-muted-foreground">No requests.</li>}
            </ul>
          </Panel>
        )}

        <Panel title="Admin activity on this account" className="xl:col-span-2">
          <ul className="divide-y text-sm">
            {profile.audit.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span>
                  <span className="font-medium">{ACTION_LABELS[a.action] ?? a.action}</span>
                  <span className="text-muted-foreground"> by {a.actorEmail}</span>
                </span>
                <span className="text-xs text-muted-foreground">{fmtDateTime(a.createdAt)}</span>
              </li>
            ))}
            {profile.audit.length === 0 && <li className="py-6 text-center text-muted-foreground">No admin actions yet.</li>}
          </ul>
        </Panel>
      </div>
    </div>
  )
}
