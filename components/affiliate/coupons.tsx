import { TicketPercent } from "lucide-react"
import { count, money } from "@/lib/affiliates/types"
import { CopyButton } from "./copy"
import { Empty, StatusBadge, TableShell, THead, fmtDay, tdClass, thClass } from "./ui"

export type CouponView = {
  id: number
  code: string
  percent: number
  durationMonths: number
  plan: string | null
  campaign: string | null
  usageLimit: number | null
  uses: number
  expiresAt: string | null
  status: string
  // their standing code, created by the program
  permanent?: boolean
  stats: { customers: number; revenue: number; commission: number }
}

// The affiliate's discount codes, to read and copy. Coupons are created — and
// switched off or on — by the TradeLoop team only (admin → the affiliate's
// page); there is nothing here that changes one.
export function CouponsList({ coupons }: { coupons: CouponView[] }) {
  const expired = (c: CouponView) => !!c.expiresAt && new Date(c.expiresAt).getTime() < Date.now()

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">A customer who pays with one of your codes is credited to you, even without a link click. Codes are created for you by the TradeLoop team — contact affiliate support if you need one for a campaign.</p>

      {coupons.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <Empty icon={TicketPercent} title="No coupons yet">
            When the TradeLoop team creates a code for you, it appears here — ready to copy and share.
          </Empty>
        </div>
      ) : (
        <TableShell>
          <THead>
            <tr>
              <th className={thClass}>Code</th>
              <th className={thClass}>Discount</th>
              <th className={thClass}>Status</th>
              <th className={`${thClass} text-end`}>Uses</th>
              <th className={`${thClass} text-end`}>Customers</th>
              <th className={`${thClass} text-end`}>Commission</th>
              <th className={thClass}>Expires</th>
              <th className={`${thClass} text-end`}>
                <span className="sr-only">Copy</span>
              </th>
            </tr>
          </THead>
          <tbody className="divide-y">
            {coupons.map((c) => (
              <tr key={c.id}>
                <td className={tdClass}>
                  <p className="font-mono text-sm font-semibold">
                    {c.code}
                    {c.permanent && <span className="ms-2 rounded-full bg-primary/12 px-2 py-0.5 font-sans text-xs font-medium text-primary">Permanent</span>}
                  </p>
                  {c.campaign && <p className="text-xs text-muted-foreground">{c.campaign}</p>}
                </td>
                <td className={tdClass}>
                  {c.percent}% off
                  <span className="block text-xs text-muted-foreground">
                    {c.durationMonths === 1 ? "first month" : `first ${c.durationMonths} months`}
                    {c.plan ? ` · ${c.plan} only` : ""}
                  </span>
                </td>
                <td className={tdClass}>
                  <StatusBadge status={c.status === "active" && expired(c) ? "disabled" : c.status} label={c.status === "active" && expired(c) ? "Expired" : undefined} />
                </td>
                <td className={`${tdClass} text-end tabular-nums`}>
                  {count(c.uses)}
                  {c.usageLimit != null && <span className="text-muted-foreground"> / {count(c.usageLimit)}</span>}
                </td>
                <td className={`${tdClass} text-end tabular-nums`}>{count(c.stats.customers)}</td>
                <td className={`${tdClass} text-end tabular-nums font-medium`}>{money(c.stats.commission)}</td>
                <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>{c.expiresAt ? fmtDay(c.expiresAt) : "Never"}</td>
                <td className={tdClass}>
                  <div className="flex items-center justify-end">
                    <CopyButton value={c.code} label="Copy code" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </div>
  )
}
