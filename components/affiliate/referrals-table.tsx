"use client"

import { useState, useTransition } from "react"
import { Users } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { loadReferral } from "@/app/actions/affiliate"
import type { ReferralDetail } from "@/lib/affiliates/queries"
import { money, signedMoney } from "@/lib/affiliates/types"
import { Empty, FieldRow, LEDGER_TYPE_LABELS, StatusBadge, TableShell, THead, fmtDay, tdClass, thClass } from "./ui"

export type ReferralRow = { id: number; publicId: string; status: string; source: string; plan: string | null; billing: string | null; country: string | null; campaign: string | null; revenue: number; commission: number; createdAt: string }

const EVENT_LABELS: Record<string, string> = { signup: "Signed up", trial: "Started a trial", subscription: "Became a paying customer", payment: "Payment", cancelled: "Cancelled", refund: "Refund", chargeback: "Chargeback" }
const planLabel = (plan: string | null, billing: string | null) => (plan ? `${plan.charAt(0).toUpperCase()}${plan.slice(1)}${billing ? ` · ${billing}` : ""}` : "—")

export function ReferralsTable({ rows, filtered }: { rows: ReferralRow[]; filtered: boolean }) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<ReferralDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, start] = useTransition()

  function show(publicId: string) {
    setSelected(publicId)
    setDetail(null)
    setError(null)
    setOpen(true)
    start(async () => {
      const res = await loadReferral(publicId)
      if (res.ok) setDetail(res.referral)
      else setError(res.error)
    })
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border bg-card">
        <Empty icon={Users} title={filtered ? "No referrals match these filters" : "No referrals yet"}>
          {filtered ? "Try a different status or clear the search." : "When someone signs up through your link or uses your coupon, they'll appear here."}
        </Empty>
      </div>
    )
  }

  return (
    <>
      <TableShell>
        <THead>
          <tr>
            <th className={thClass}>Referral</th>
            <th className={thClass}>Status</th>
            <th className={thClass}>Plan</th>
            <th className={thClass}>Campaign</th>
            <th className={thClass}>Signed up</th>
            <th className={`${thClass} text-end`}>Revenue</th>
            <th className={`${thClass} text-end`}>Commission</th>
          </tr>
        </THead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.id} className="cursor-pointer hover:bg-muted/30" onClick={() => show(r.publicId)}>
              <td className={tdClass}>
                <button type="button" className="font-mono text-xs font-medium text-primary hover:underline" onClick={(e) => (e.stopPropagation(), show(r.publicId))} aria-label={`Details for ${r.publicId}`}>
                  {r.publicId}
                </button>
              </td>
              <td className={tdClass}>
                <StatusBadge status={r.status} />
              </td>
              <td className={`${tdClass} capitalize`}>{planLabel(r.plan, r.billing)}</td>
              <td className={`${tdClass} text-muted-foreground`}>{r.campaign ?? (r.source === "coupon" ? "Coupon" : "Main link")}</td>
              <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>{fmtDay(r.createdAt)}</td>
              <td className={`${tdClass} text-end tabular-nums`}>{money(r.revenue)}</td>
              <td className={`${tdClass} text-end tabular-nums font-medium`}>{money(r.commission)}</td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* The dialog, docked to the edge as a side panel. */}
        <DialogContent className="left-auto right-0 top-0 h-svh max-w-full translate-x-0 translate-y-0 content-start overflow-y-auto rounded-none sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono">{selected}</DialogTitle>
            <DialogDescription>Customer identities are private — a referral is shown by its reference only.</DialogDescription>
          </DialogHeader>
          {loading && !detail && (
            <div role="status" aria-label="Loading" className="space-y-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-5 animate-pulse rounded bg-muted" />
              ))}
            </div>
          )}
          {error && <p className="rounded-lg bg-[var(--loss)]/10 px-3 py-2 text-sm text-[var(--loss)]">{error}</p>}
          {detail && (
            <div className="space-y-5">
              <div className="divide-y rounded-lg border px-3">
                <FieldRow label="Status">
                  <StatusBadge status={detail.status} />
                </FieldRow>
                <FieldRow label="Plan">
                  <span className="capitalize">{planLabel(detail.plan, detail.billing)}</span>
                </FieldRow>
                <FieldRow label="Came from">{detail.source === "coupon" ? `Coupon ${detail.coupon ?? ""}` : (detail.campaign ?? "Main link")}</FieldRow>
                {detail.source !== "coupon" && detail.coupon && <FieldRow label="Coupon used">{detail.coupon}</FieldRow>}
                <FieldRow label="Country">{detail.country ?? "—"}</FieldRow>
                <FieldRow label="Device">
                  <span className="capitalize">{detail.device ?? "—"}</span>
                </FieldRow>
                <FieldRow label="First click">{fmtDay(detail.clickedAt)}</FieldRow>
                <FieldRow label="Signed up">{fmtDay(detail.createdAt)}</FieldRow>
                <FieldRow label="First payment">{fmtDay(detail.firstPaymentAt)}</FieldRow>
                <FieldRow label="Revenue">{money(detail.revenue)}</FieldRow>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold">Commissions</h3>
                {detail.ledger.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No commission yet. It&apos;s created when this customer makes a payment.</p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {detail.ledger.map((l) => (
                      <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span>
                          {LEDGER_TYPE_LABELS[l.type] ?? l.type}
                          {l.ratePercent != null && <span className="text-muted-foreground"> · {l.ratePercent}%</span>}
                          <span className="block text-xs text-muted-foreground">{fmtDay(l.createdAt)}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <StatusBadge status={l.status} />
                          <span className="tabular-nums font-medium">{signedMoney(l.amount)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold">Timeline</h3>
                <ol className="space-y-3 border-s ps-4">
                  {detail.events.map((e) => (
                    <li key={e.id} className="relative text-sm">
                      <span className="absolute -start-[21px] top-1.5 size-2 rounded-full bg-primary" aria-hidden />
                      {EVENT_LABELS[e.type] ?? e.type}
                      {e.amount != null && <span className="text-muted-foreground"> · {money(e.amount)}</span>}
                      <span className="block text-xs text-muted-foreground">{fmtDay(e.createdAt)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
