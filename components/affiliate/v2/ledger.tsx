"use client"

import { useEffect, useState } from "react"
import { CircleCheck, CircleDashed, Loader2, Receipt } from "lucide-react"
import { loadReferral } from "@/app/actions/affiliate"
import type { ReferralDetail } from "@/lib/affiliates/queries"
import { money, signedMoney } from "@/lib/affiliates/types"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState, InlineError, StatusChip, fmtDate } from "./ui"
import { cn } from "@/lib/utils"

// Ledger rows (Earnings, Wallet → Transactions) and the commission detail window.

export type LedgerView = { id: number; type: string; status: string; amount: number; baseAmount: number | null; ratePercent: number | null; ruleSource: string | null; holdUntil: string | null; note: string | null; createdAt: string; referral: string | null; plan: string | null }

const TYPE_LABELS: Record<string, string> = { subscription: "Commission", bonus: "Bonus", adjustment: "Adjustment", refund: "Refund", reversal: "Reversal", payout: "Withdrawal" }
const RULE_LABELS: Record<string, string> = { affiliate: "Custom rate", campaign: "Campaign rate", coupon: "Coupon rate", tier: "Tier rate", default: "Standard rate" }
export const commissionRef = (id: number) => `C-${String(id).padStart(5, "0")}`

function describe(r: LedgerView) {
  if (r.type === "subscription" && r.baseAmount != null) return `${r.ratePercent}% of ${money(r.baseAmount)}${r.referral ? ` · ${r.referral}` : ""}`
  if (r.type === "payout") return "Payout to your payout method"
  return r.note ?? (r.referral ? r.referral : "—")
}

export function LedgerList({ rows, emptyTitle = "No transactions yet", emptyBody = "No commissions yet. Your first referral will appear here." }: { rows: LedgerView[]; emptyTitle?: string; emptyBody?: string }) {
  const [open, setOpen] = useState<LedgerView | null>(null)
  if (rows.length === 0) return <EmptyState icon={Receipt} title={emptyTitle}>{emptyBody}</EmptyState>
  const clickable = (r: LedgerView) => r.type === "subscription"
  return (
    <>
      {/* Desktop: a table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-start text-xs text-muted-foreground">
              <th className="px-3 pb-2 text-start font-medium">Date</th>
              <th className="px-3 pb-2 text-start font-medium">Type</th>
              <th className="px-3 pb-2 text-start font-medium">Description</th>
              <th className="px-3 pb-2 text-end font-medium">Amount</th>
              <th className="px-3 pb-2 text-end font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id} className={cn(clickable(r) && "cursor-pointer hover:bg-muted/40")} onClick={() => clickable(r) && setOpen(r)} tabIndex={clickable(r) ? 0 : undefined} onKeyDown={(e) => clickable(r) && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(r))} aria-label={clickable(r) ? `Commission ${commissionRef(r.id)} details` : undefined}>
                <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{fmtDate(r.createdAt)}</td>
                <td className="px-3 py-3 font-medium whitespace-nowrap">{TYPE_LABELS[r.type] ?? r.type}</td>
                <td className="max-w-[320px] truncate px-3 py-3 text-muted-foreground">{describe(r)}</td>
                <td className={cn("px-3 py-3 text-end font-semibold whitespace-nowrap tabular-nums", r.amount < 0 ? "text-loss" : "text-gain")}>{signedMoney(r.amount)}</td>
                <td className="px-3 py-3 text-end">
                  <StatusChip status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Phone: cards */}
      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" disabled={!clickable(r)} onClick={() => setOpen(r)} className="flex w-full items-center gap-3 rounded-xl border bg-background/30 p-3 text-start disabled:cursor-default">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{TYPE_LABELS[r.type] ?? r.type}</span>
                <span className="block truncate text-xs text-muted-foreground">{describe(r)}</span>
                <span className="block text-[11px] text-muted-foreground">{fmtDate(r.createdAt)}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className={cn("text-sm font-semibold tabular-nums", r.amount < 0 ? "text-loss" : "text-gain")}>{signedMoney(r.amount)}</span>
                <StatusChip status={r.status} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <CommissionDialog row={open} onClose={() => setOpen(null)} />
    </>
  )
}

type Step = { label: string; at: Date | null; done: boolean }

// "Commission #C-04829": what it was for, how it was worked out, and where it
// is on its way to the affiliate — from the referral's own history.
export function CommissionDialog({ row, onClose }: { row: LedgerView | null; onClose: () => void }) {
  const [detail, setDetail] = useState<ReferralDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    setDetail(null)
    setError(null)
    if (!row?.referral) return
    setLoading(true)
    loadReferral(row.referral)
      .then((res) => (res.ok ? setDetail(res.referral) : setError(res.error)))
      .catch(() => setError("We couldn't load this commission's history."))
      .finally(() => setLoading(false))
  }, [row])

  const now = Date.now()
  const created = row ? new Date(row.createdAt) : null
  const payment = detail?.events.filter((e) => e.type === "payment" && created && new Date(e.createdAt).getTime() <= created.getTime() + 60_000).map((e) => new Date(e.createdAt)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null
  const trial = detail?.events.find((e) => e.type === "trial")
  const available = row?.holdUntil ? new Date(row.holdUntil) : null
  const steps: Step[] = [
    { label: "Referral (link clicked)", at: detail?.clickedAt ? new Date(detail.clickedAt) : null, done: !!detail?.clickedAt },
    { label: "Sign-up", at: detail ? new Date(detail.createdAt) : null, done: !!detail },
    ...(trial ? [{ label: "Trial", at: new Date(trial.createdAt), done: true }] : []),
    { label: "Payment", at: payment, done: !!payment || !!row },
    { label: "Commission", at: created, done: !!row },
    { label: "Available", at: available, done: row ? ["available", "paid"].includes(row.status) || (!!available && available.getTime() <= now && row.status === "approved") : false },
  ]

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none sm:max-w-lg">
        {row && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                Commission #{commissionRef(row.id)} <StatusChip status={row.status} />
              </DialogTitle>
              <DialogDescription>Recorded {fmtDate(row.createdAt, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border bg-background/30 p-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Customer</dt>
                <dd className="font-mono font-medium">{row.referral ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Plan</dt>
                <dd className="font-medium capitalize">{detail?.plan ?? row.plan ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Subscription</dt>
                <dd className="font-medium capitalize">{detail?.billing ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Commission</dt>
                <dd className="font-semibold text-gain tabular-nums">{money(row.amount)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Rate</dt>
                <dd className="font-medium">{row.ratePercent != null && row.baseAmount != null ? `${row.ratePercent}% of ${money(row.baseAmount)}` : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Rule</dt>
                <dd className="font-medium">{row.ruleSource ? (RULE_LABELS[row.ruleSource] ?? row.ruleSource) : "—"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Available</dt>
                <dd className="font-medium">{["available", "paid"].includes(row.status) ? "Now" : available ? fmtDate(available) : "After its holding period"}</dd>
              </div>
            </dl>
            <div>
              <p className="mb-2 text-sm font-semibold">Timeline</p>
              {loading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Loading history…
                </p>
              ) : error ? (
                <InlineError>{error}</InlineError>
              ) : (
                <ol className="relative ms-2 border-s ps-5">
                  {steps.map((s) => (
                    <li key={s.label} className="relative pb-3 last:pb-0">
                      <span className={cn("absolute -start-[29px] top-0 flex size-[18px] items-center justify-center rounded-full bg-background", s.done ? "text-primary" : "text-muted-foreground")} aria-hidden>
                        {s.done ? <CircleCheck className="size-[18px]" /> : <CircleDashed className="size-[18px]" />}
                      </span>
                      <p className={cn("text-sm", s.done ? "font-medium" : "text-muted-foreground")}>{s.label}</p>
                      <p className="text-xs text-muted-foreground">{s.at ? fmtDate(s.at, { month: "short", day: "numeric", year: "numeric" }) : s.done ? "—" : "Waiting"}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
