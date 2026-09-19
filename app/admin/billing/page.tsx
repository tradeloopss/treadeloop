import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { getRevenue, listSubscriptions } from "@/lib/admin/metrics"
import { rowGrantsAccess } from "@/lib/subscription"
import { RevokeGrantButton } from "@/components/admin/row-actions"
import { AdminPageHeader, EmptyRow, Panel, StatePill, StatRow, StatTile, fmtDate, fmtMoney, fmtNumber, fmtPercent } from "@/components/admin/ui"
import { cn } from "@/lib/utils"

const TABS: [string, string][] = [
  ["", "All"],
  ["access", "Has access"],
  ["trialing", "Trialing"],
  ["canceled", "Canceled"],
  ["admin", "Admin grants"],
  ["pending", "Abandoned checkouts"],
]

export default async function AdminBillingPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const admin = await requireAdmin({ billing: ["view"] })
  const canManage = roleCan(admin.role, { billing: ["manage"] })
  const { status } = await searchParams
  const [revenue, subs] = await Promise.all([getRevenue(), listSubscriptions(status)])

  return (
    <div>
      <AdminPageHeader
        title="Billing & revenue"
        description="From TradeLoop's subscription records. Revenue is estimated at list price."
        action={
          <a href="https://whop.com/dashboard" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-muted">
            Open Whop dashboard <ExternalLink className="size-3.5" />
          </a>
        }
      />
      <div className="space-y-6 p-4 sm:p-6">
        <StatRow>
          <StatTile label="Estimated MRR" value={fmtMoney(revenue.mrr)} note={`${revenue.paying} paying subscriber${revenue.paying === 1 ? "" : "s"}`} />
          <StatTile label="Estimated ARR" value={fmtMoney(revenue.arr)} note="MRR × 12" />
          <StatTile label="Churn, last 30 days" value={fmtPercent(revenue.churnRate)} note={`${revenue.churned30d} canceled or expired`} />
          <StatTile label="ARPU" value={revenue.arpu == null ? "—" : fmtMoney(revenue.arpu)} note="per paying user / month" />
          <StatTile label="Estimated LTV" value={revenue.ltv == null ? "—" : fmtMoney(revenue.ltv)} note={revenue.ltv == null ? "needs churn history" : "ARPU ÷ monthly churn"} />
        </StatRow>
        <StatRow>
          <StatTile label="On free trial" value={fmtNumber(revenue.trialing)} note="not yet counted in MRR" />
          <StatTile label="Admin grants" value={fmtNumber(revenue.granted)} note="access with no payment" />
          <StatTile label="Abandoned checkouts" value={fmtNumber(revenue.abandonedCheckouts7d)} note="started in the last 7 days" />
          {(["pro", "essential"] as const).map((plan) => (
            <StatTile
              key={plan}
              label={plan === "pro" ? "Pro" : "Essential"}
              value={fmtNumber(revenue.byPlan[plan]?.paying ?? 0)}
              note={`paying · ${revenue.byPlan[plan]?.trialing ?? 0} trialing`}
            />
          ))}
        </StatRow>

        <Panel title="Subscriptions" description="Grant or revoke free access from a user's page. Refunds, coupons, pauses and affiliate payouts are handled in Whop.">
          <div className="mb-4 flex flex-wrap gap-1.5">
            {TABS.map(([value, label]) => (
              <Link
                key={value}
                href={value ? `?status=${value}` : "?"}
                className={cn("rounded-full border px-3 py-1 text-xs", (status ?? "") === value ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}
              >
                {label}
              </Link>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">User</th>
                  <th className="pb-2 font-medium">Plan</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Source</th>
                  <th className="pb-2 font-medium">Period end</th>
                  <th className="pb-2 font-medium">Updated</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {subs.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2.5 pr-3">
                      {s.userId ? (
                        <Link href={`/admin/users/${s.userId}`} className="hover:text-primary">{s.email || s.name}</Link>
                      ) : (
                        <span className="text-muted-foreground">{s.email || "unmatched payment"}</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 capitalize">{s.plan}{s.billing ? ` · ${s.billing}` : ""}</td>
                    <td className="py-2.5 pr-3"><StatePill state={s.source === "admin" && s.status === "active" && !rowGrantsAccess(s) ? "expired" : s.status} /></td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{s.source === "admin" ? "Admin grant" : "Whop"}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{fmtDate(s.currentPeriodEnd)}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{fmtDate(s.updatedAt)}</td>
                    <td className="py-2.5 text-right">{canManage && s.source === "admin" && rowGrantsAccess(s) && <RevokeGrantButton subscriptionId={s.id} />}</td>
                  </tr>
                ))}
                {subs.length === 0 && <EmptyRow colSpan={7}>No subscriptions here.</EmptyRow>}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  )
}
