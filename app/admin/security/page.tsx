import Link from "next/link"
import { requireAdmin } from "@/lib/admin/guard"
import { getSecurityOverview, listSecurityEvents, PAGE_SIZE } from "@/lib/admin/metrics"
import { SECURITY_EVENT_LABELS } from "@/lib/security"
import { AdminPageHeader, EmptyRow, FilterSelect, Pager, Panel, StatRow, StatTile, fmtAgo, fmtNumber, fmtPercent } from "@/components/admin/ui"
import { SecurityEventsTable } from "@/components/admin/security-events-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default async function AdminSecurityPage({ searchParams }: { searchParams: Promise<{ type?: string; q?: string; page?: string }> }) {
  await requireAdmin({ security: ["view"] })
  const sp = await searchParams
  const type = sp.type && sp.type in SECURITY_EVENT_LABELS ? sp.type : undefined
  const [overview, events] = await Promise.all([
    getSecurityOverview(),
    listSecurityEvents({ type, q: sp.q?.trim() || undefined, page: Number(sp.page) || 1 }),
  ])

  return (
    <div>
      <AdminPageHeader
        title="Security"
        description="Sign-ins, failed attempts, and password and 2FA changes. Sign-in is rate-limited to 3 attempts per 10 seconds per IP."
      />
      <div className="space-y-6 p-4 sm:p-6">
        <StatRow>
          <StatTile label="Failed sign-ins, 24h" value={fmtNumber(overview.failed24h)} note={`${overview.blocked24h} blocked (suspended)`} />
          <StatTile label="Wrong 2FA codes, 24h" value={fmtNumber(overview.twoFactorFailed24h)} />
          <StatTile label="Sign-ins, 24h" value={fmtNumber(overview.signIns24h)} note={`${overview.newIp24h} from a new IP`} />
          <StatTile label="Password resets, 24h" value={fmtNumber(overview.resets24h)} note="requested or completed" />
          <StatTile label="Using 2FA" value={fmtPercent(overview.totalUsers ? overview.twoFactorUsers / overview.totalUsers : null)} note={`${overview.twoFactorUsers} of ${overview.totalUsers} users`} />
        </StatRow>

        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title="Suspicious IPs" description="5+ failed sign-ins or 2FA codes from one IP in the last 24 hours.">
            <ul className="divide-y text-sm">
              {overview.suspiciousIps.map((r) => (
                <li key={r.ip} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={`?q=${encodeURIComponent(r.ip)}`} className="font-mono text-xs hover:text-primary">{r.ip}</Link>
                  <span className="text-muted-foreground">
                    {r.failures} failures · {r.emails} account{r.emails === "1" ? "" : "s"} · {fmtAgo(r.last)}
                  </span>
                </li>
              ))}
              {overview.suspiciousIps.length === 0 && <li className="py-6 text-center text-muted-foreground">Nothing unusual.</li>}
            </ul>
          </Panel>
          <Panel title="Targeted accounts" description="5+ failed sign-ins against one email in the last 24 hours.">
            <ul className="divide-y text-sm">
              {overview.targetedEmails.map((r) => (
                <li key={r.email} className="flex items-center justify-between gap-3 py-2.5">
                  {r.userId ? (
                    <Link href={`/admin/users/${r.userId}`} className="truncate hover:text-primary">{r.email}</Link>
                  ) : (
                    <span className="truncate">{r.email} <span className="text-xs text-muted-foreground">(no account)</span></span>
                  )}
                  <span className="shrink-0 text-muted-foreground">
                    {r.failures} failures · {r.ips} IP{r.ips === "1" ? "" : "s"} · {fmtAgo(r.last)}
                  </span>
                </li>
              ))}
              {overview.targetedEmails.length === 0 && <li className="py-6 text-center text-muted-foreground">Nothing unusual.</li>}
            </ul>
          </Panel>
        </div>

        <div>
          <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
            <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs text-muted-foreground">
              Email or IP
              <Input name="q" defaultValue={sp.q} className="h-9" />
            </label>
            <FilterSelect label="Event" name="type" defaultValue={type} options={[["", "Any"], ...Object.entries(SECURITY_EVENT_LABELS)]} />
            <Button type="submit" className="h-9">Apply</Button>
          </form>
          <div className="mt-4 overflow-x-auto rounded-xl border bg-card">
            <SecurityEventsTable rows={events.rows} empty={<EmptyRow colSpan={5}>No events match.</EmptyRow>} />
          </div>
          <Pager page={events.page} total={events.total} pageSize={PAGE_SIZE} params={{ type, q: sp.q }} />
        </div>
      </div>
    </div>
  )
}
