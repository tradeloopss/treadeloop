import Link from "next/link"
import { Banknote, Download } from "lucide-react"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { payoutsPage } from "@/lib/affiliates/admin-queries"
import { PAGE_SIZE } from "@/lib/affiliates/queries"
import { PAYOUT_METHOD_LABELS, money, type PayoutMethodType } from "@/lib/affiliates/types"
import { AdminPageHeader, Pager } from "@/components/admin/ui"
import { Empty, StatusBadge, TableShell, THead, fmtDay, linkButtonClass, tdClass, thClass } from "@/components/affiliate/ui"
import { PayoutActions } from "@/components/admin/affiliates/actions"

const TABS: [string, string][] = [["open", "To process"], ["paid", "Paid"], ["failed", "Failed"], ["cancelled", "Cancelled"], ["", "All"]]

export default async function AdminAffiliatePayoutsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const admin = await requireAdmin({ affiliates: ["view"] })
  const canManage = roleCan(admin.role, { affiliates: ["manage"] })
  const sp = await searchParams
  const status = sp.status === undefined ? "open" : TABS.some(([v]) => v === sp.status) ? sp.status : "open"
  const page = await payoutsPage({ status: status || undefined, page: Math.max(1, Number(sp.page) || 1) })

  return (
    <div>
      <AdminPageHeader
        title="Payouts"
        description="Payouts are sent by hand: open one to see where it goes, send the money, then mark it paid."
        action={
          <a href={`/admin/affiliates/export/payouts${status && status !== "open" ? `?status=${status}` : ""}`} className={linkButtonClass}>
            <Download className="size-4" aria-hidden /> Export
          </a>
        }
      />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="inline-flex w-fit flex-wrap rounded-lg bg-muted p-[3px]" role="group" aria-label="Status">
          {TABS.map(([v, label]) => (
            <Link key={v || "all"} href={`?status=${v}`} aria-current={v === status ? "true" : undefined} className={`rounded-md px-2.5 py-1 text-xs font-medium ${v === status ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {label}
            </Link>
          ))}
        </div>

        {page.rows.length === 0 ? (
          <div className="rounded-xl border bg-card">
            <Empty icon={Banknote} title={status === "open" ? "Nothing to process" : "No payouts here"}>
              {status === "open" ? "Payout requests from affiliates show up here." : undefined}
            </Empty>
          </div>
        ) : (
          <TableShell>
            <THead>
              <tr>
                <th className={thClass}>Affiliate</th>
                <th className={thClass}>Requested</th>
                <th className={thClass}>Method</th>
                <th className={thClass}>Status</th>
                <th className={`${thClass} text-end`}>Amount</th>
                <th className={`${thClass} text-end`}>Actions</th>
              </tr>
            </THead>
            <tbody className="divide-y">
              {page.rows.map((p) => {
                const name = `${p.firstName} ${p.lastName}`.trim()
                return (
                  <tr key={p.id}>
                    <td className={tdClass}>
                      <Link href={`/admin/affiliates/${p.affiliateId}`} className="font-medium hover:underline">
                        {name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{p.email}</p>
                      {(p.fraudLock || p.payoutHold) && <p className="text-[11px] text-[var(--chart-4)]">{p.fraudLock ? "Fraud lock is on — review before paying" : "Payout hold is on"}</p>}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>{fmtDay(p.requestedAt)}</td>
                    <td className={tdClass}>
                      {PAYOUT_METHOD_LABELS[p.methodType as PayoutMethodType] ?? p.methodType}
                      <span className="block font-mono text-xs text-muted-foreground">{p.methodLabel}</span>
                    </td>
                    <td className={tdClass}>
                      <StatusBadge status={p.status} />
                      {p.status === "paid" && <span className="mt-1 block text-xs text-muted-foreground">{fmtDay(p.processedAt)}{p.providerRef ? ` · ${p.providerRef}` : ""}</span>}
                      {p.status === "failed" && p.failureReason && <span className="mt-1 block max-w-56 text-xs text-[var(--loss)]">{p.failureReason}</span>}
                    </td>
                    <td className={`${tdClass} text-end tabular-nums font-medium`}>{money(p.amount)}</td>
                    <td className={tdClass}>{p.methodId != null && <PayoutActions id={p.id} status={p.status} amount={p.amount} name={name} canManage={canManage} />}</td>
                  </tr>
                )
              })}
            </tbody>
          </TableShell>
        )}
        {page.total > PAGE_SIZE && <Pager page={page.page} total={page.total} pageSize={PAGE_SIZE} params={{ status }} />}
      </div>
    </div>
  )
}
