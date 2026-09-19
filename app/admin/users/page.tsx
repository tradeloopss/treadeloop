import Link from "next/link"
import { requireAdmin } from "@/lib/admin/guard"
import { listUsers, PAGE_SIZE, type DirectoryFilters } from "@/lib/admin/metrics"
import { AdminPageHeader, EmptyRow, FilterSelect, Pager, StatePill, fmtAgo, fmtDate } from "@/components/admin/ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Search = Record<string, string | undefined>

function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined
}

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin({ user: ["list"] })
  const sp = await searchParams
  const isDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
  const filters: DirectoryFilters = {
    q: sp.q?.trim() || undefined,
    state: pick(sp.state, ["active", "inactive", "suspended", "canceled"] as const),
    plan: pick(sp.plan, ["essential", "pro"] as const),
    broker: pick(sp.broker, ["rithmic", "metatrader", "none"] as const),
    activity: pick(sp.activity, ["7d", "30d", "dormant"] as const),
    from: isDate(sp.from),
    to: isDate(sp.to),
    page: Number(sp.page) || 1,
  }
  const { rows, total, page } = await listUsers(filters)

  return (
    <div>
      <AdminPageHeader title="Users" description="Every trader account. Open one for details and actions." />
      <div className="p-4 sm:p-6">
        <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Search
            <Input name="q" defaultValue={filters.q} placeholder="Email or name" className="h-9" />
          </label>
          <FilterSelect label="Status" name="state" defaultValue={filters.state} options={[["", "Any"], ["active", "Active"], ["inactive", "Inactive (never subscribed)"], ["canceled", "Canceled"], ["suspended", "Suspended"]]} />
          <FilterSelect label="Plan" name="plan" defaultValue={filters.plan} options={[["", "Any"], ["essential", "Essential"], ["pro", "Pro"]]} />
          <FilterSelect label="Broker" name="broker" defaultValue={filters.broker} options={[["", "Any"], ["rithmic", "Rithmic connected"], ["metatrader", "MetaTrader connected"], ["none", "None connected"]]} />
          <FilterSelect label="Activity" name="activity" defaultValue={filters.activity} options={[["", "Any"], ["7d", "Seen in last 7 days"], ["30d", "Seen in last 30 days"], ["dormant", "Dormant 30+ days"]]} />
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Joined from
            <Input type="date" name="from" defaultValue={filters.from} className="h-9" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Joined to
            <Input type="date" name="to" defaultValue={filters.to} className="h-9" />
          </label>
          <div className="flex gap-2">
            <Button type="submit" className="h-9">Apply</Button>
            <Button nativeButton={false} variant="outline" className="h-9" render={<Link href="/admin/users">Reset</Link>} />
          </div>
        </form>

        <div className="mt-4 overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b text-start text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Plan</th>
                <th className="px-3 py-3 font-medium">Brokers</th>
                <th className="px-3 py-3 text-end font-medium">Trades</th>
                <th className="px-3 py-3 font-medium">Last seen</th>
                <th className="px-4 py-3 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <Link href={`/admin/users/${u.id}`} className="block max-w-[280px] hover:text-primary">
                      <span className="block truncate font-medium">{u.name || "—"}</span>
                      <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <StatePill state={u.state} />
                    {u.role && u.role !== "user" && <span className="ms-1.5 text-xs text-muted-foreground">admin</span>}
                  </td>
                  <td className="px-3 py-3 capitalize">
                    {u.is_owner ? "Owner" : u.plan && u.has_access ? `${u.plan}${u.sub_status === "trialing" ? " (trial)" : u.sub_source === "admin" ? " (granted)" : ""}` : "—"}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {[u.rithmic && "Rithmic", u.mt && "MetaTrader"].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-3 py-3 text-end tabular-nums">{Number(u.trades).toLocaleString("en-US")}</td>
                  <td className="px-3 py-3 text-muted-foreground">{fmtAgo(u.seen)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtDate(u.createdAt)}</td>
                </tr>
              ))}
              {rows.length === 0 && <EmptyRow colSpan={7}>No users match these filters.</EmptyRow>}
            </tbody>
          </table>
        </div>
        <Pager page={page} total={total} pageSize={PAGE_SIZE} params={{ ...sp, page: undefined }} />
      </div>
    </div>
  )
}
