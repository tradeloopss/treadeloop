import Link from "next/link"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { getFunnel, getOverview, getRevenue, listUsers } from "@/lib/admin/metrics"
import { AdminPageHeader, BarList, Panel, StatePill, StatRow, StatTile, fmtAgo, fmtDate, fmtMoney, fmtNumber } from "@/components/admin/ui"

export default async function AdminOverviewPage() {
  const admin = await requireAdmin({ user: ["list"] })
  const canBilling = roleCan(admin.role, { billing: ["view"] })

  const [overview, funnel, revenue, recent] = await Promise.all([
    getOverview(),
    getFunnel(30),
    canBilling ? getRevenue() : Promise.resolve(null),
    listUsers({ page: 1 }),
  ])

  return (
    <div>
      <AdminPageHeader title="Overview" description="The whole platform at a glance." />
      <div className="space-y-6 p-4 sm:p-6">
        <StatRow>
          <StatTile label="Users" value={fmtNumber(overview.users)} note={`+${overview.signups7d} this week`} />
          <StatTile label="Active today" value={fmtNumber(overview.dau)} note={`${fmtNumber(overview.mau)} in the last 30 days`} />
          {revenue && <StatTile label="Estimated MRR" value={fmtMoney(revenue.mrr)} note={`${revenue.paying} paying · list price`} />}
          {revenue && <StatTile label="On free trial" value={fmtNumber(revenue.trialing)} note={`${revenue.granted} admin grants`} />}
          <StatTile label="Trades logged this week" value={fmtNumber(overview.trades7d)} note={`by ${overview.traders7d} trader${overview.traders7d === 1 ? "" : "s"}`} />
        </StatRow>

        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title="Onboarding funnel" description="Users who signed up in the last 30 days.">
            <BarList items={funnel.map((f) => ({ label: f.step, value: f.users }))} total={funnel[0].users} />
          </Panel>

          <Panel
            title="Newest users"
            action={
              <Link href="/admin/users" className="text-xs font-medium text-primary hover:underline">
                All users
              </Link>
            }
          >
            <ul className="divide-y">
              {recent.rows.slice(0, 8).map((u) => (
                <li key={u.id}>
                  <Link href={`/admin/users/${u.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-primary">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{u.name || u.email}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {u.email} · joined {fmtDate(u.createdAt)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="hidden text-xs text-muted-foreground sm:inline">seen {fmtAgo(u.seen)}</span>
                      <StatePill state={u.state} />
                    </span>
                  </Link>
                </li>
              ))}
              {recent.rows.length === 0 && <li className="py-8 text-center text-sm text-muted-foreground">No users yet.</li>}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  )
}
