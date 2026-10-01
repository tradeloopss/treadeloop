import Link from "next/link"
import { ShieldCheck } from "lucide-react"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { signalsPage } from "@/lib/affiliates/admin-queries"
import { FRAUD_LABELS } from "@/lib/affiliates/fraud"
import { PAGE_SIZE } from "@/lib/affiliates/queries"
import { AdminPageHeader, Pager, fmtAgo } from "@/components/admin/ui"
import { Empty, StatusBadge, TableShell, THead, tdClass, thClass } from "@/components/affiliate/ui"
import { SignalActions } from "@/components/admin/affiliates/actions"

const TABS: [string, string][] = [["open", "To review"], ["cleared", "Cleared"], ["actioned", "Actioned"], ["all", "All"]]

const DETAIL_LABELS: Record<string, string> = { clicks: "clicks", signups: "sign-ups", paidCustomers: "paying customers", refunds: "refunds", chargebacks: "chargebacks", signupsFromAffiliateNetwork: "sign-ups from one network", signupsLastHour: "sign-ups in the last hour", couponOnlyShare: "share by coupon only", paymentId: "payment", userId: "user" }

function describe(details: Record<string, unknown> | null): string {
  if (!details) return ""
  return Object.entries(details)
    .map(([k, v]) => `${typeof v === "number" && k === "couponOnlyShare" ? `${Math.round(v * 100)}%` : String(v)} ${DETAIL_LABELS[k] ?? k}`)
    .join(" · ")
}

export default async function AdminAffiliateFraudPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const admin = await requireAdmin({ affiliates: ["view"] })
  const canManage = roleCan(admin.role, { affiliates: ["manage"] })
  const sp = await searchParams
  const status = TABS.some(([v]) => v === sp.status) ? sp.status! : "open"
  const page = await signalsPage({ status, page: Math.max(1, Number(sp.page) || 1) })

  return (
    <div>
      <AdminPageHeader title="Risk" description="Patterns worth a second look. A signal never suspends anyone or reverses anything by itself — that's your call, from the affiliate's page." />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="inline-flex w-fit flex-wrap rounded-lg bg-muted p-[3px]" role="group" aria-label="Status">
          {TABS.map(([v, label]) => (
            <Link key={v} href={`?status=${v}`} aria-current={v === status ? "true" : undefined} className={`rounded-md px-2.5 py-1 text-xs font-medium ${v === status ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {label}
            </Link>
          ))}
        </div>

        {page.rows.length === 0 ? (
          <div className="rounded-xl border bg-card">
            <Empty icon={ShieldCheck} title={status === "open" ? "Nothing to review" : "No signals here"}>
              {status === "open" ? "Self-referrals, refund patterns, chargebacks and unusual traffic are flagged here as they happen." : undefined}
            </Empty>
          </div>
        ) : (
          <TableShell>
            <THead>
              <tr>
                <th className={thClass}>Signal</th>
                <th className={thClass}>Affiliate</th>
                <th className={thClass}>Risk</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>Raised</th>
                <th className={`${thClass} text-end`}>Actions</th>
              </tr>
            </THead>
            <tbody className="divide-y">
              {page.rows.map((s) => (
                <tr key={s.id}>
                  <td className={tdClass}>
                    <p className="font-medium">{FRAUD_LABELS[s.type] ?? s.type}</p>
                    <p className="max-w-80 text-xs text-muted-foreground">{describe(s.details)}</p>
                  </td>
                  <td className={tdClass}>
                    <Link href={`/admin/affiliates/${s.affiliateId}`} className="font-medium hover:underline">
                      {s.firstName} {s.lastName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {s.email}
                      {s.affiliateStatus === "suspended" ? " · suspended" : s.fraudLock ? " · fraud lock on" : s.payoutHold ? " · payout hold on" : ""}
                    </p>
                  </td>
                  <td className={tdClass}>
                    <StatusBadge status={s.risk} />
                  </td>
                  <td className={tdClass}>
                    <StatusBadge status={s.status} />
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>{fmtAgo(s.createdAt)}</td>
                  <td className={tdClass}>{canManage && <SignalActions id={s.id} status={s.status} />}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
        {page.total > PAGE_SIZE && <Pager page={page.page} total={page.total} pageSize={PAGE_SIZE} params={{ status }} />}
      </div>
    </div>
  )
}
