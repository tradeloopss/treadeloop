import Link from "next/link"
import { requireAdmin } from "@/lib/admin/guard"
import { ROLE_LABELS, isAdminRole } from "@/lib/admin/access"
import { listTeam } from "@/lib/admin/metrics"
import { isOwnerEmail } from "@/lib/subscription"
import { AddTeamMember, RoleSelect } from "@/components/admin/forms"
import { AdminPageHeader, Panel, fmtAgo } from "@/components/admin/ui"

const ROLE_SUMMARY: [string, string][] = [
  ["Super Admin", "Everything: users, billing, brokers, announcements, audit log and the team."],
  ["Support", "View users, log in as them, suspend and sign them out, view billing, force broker syncs."],
  ["Billing Manager", "View users and revenue, grant and revoke free plans."],
  ["Content", "Announcements, starter tags and playbooks, and taking down public share links."],
]

export default async function AdminTeamPage() {
  const admin = await requireAdmin({ team: ["manage"] })
  const team = await listTeam()

  return (
    <div>
      <AdminPageHeader title="Team & roles" description="Who can use the admin panel, and what each role is allowed to do." />
      <div className="space-y-6 p-4 sm:p-6">
        <Panel title="Add a team member">
          <AddTeamMember />
        </Panel>

        <Panel title="Team">
          <ul className="divide-y">
            {team.map((m) => {
              const owner = isOwnerEmail(m.email)
              return (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <Link href={`/admin/users/${m.id}`} className="min-w-0 hover:text-primary">
                    <span className="block truncate text-sm font-medium">{m.name || m.email}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {m.email} · last seen {fmtAgo(m.seen)}
                    </span>
                  </Link>
                  {owner || m.id === admin.id ? (
                    <span className="text-sm text-muted-foreground">
                      {isAdminRole(m.role) ? ROLE_LABELS[m.role] : m.role}
                      {owner ? " · owner" : " · you"}
                    </span>
                  ) : (
                    <RoleSelect userId={m.id} role={m.role} />
                  )}
                </li>
              )
            })}
          </ul>
        </Panel>

        <Panel title="What each role can do">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {ROLE_SUMMARY.map(([role, text]) => (
              <div key={role} className="rounded-lg border p-3">
                <dt className="font-medium">{role}</dt>
                <dd className="mt-1 text-muted-foreground">{text}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            Emails listed in OWNER_EMAILS are always Super Admins. No role can log in as another admin.
          </p>
        </Panel>
      </div>
    </div>
  )
}
