"use client"

import { useEffect, useState } from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Loader2, Share2, UserRound, Users, X } from "lucide-react"
import { loadReferral } from "@/app/actions/affiliate"
import type { ReferralDetail } from "@/lib/affiliates/queries"
import { money } from "@/lib/affiliates/types"
import { CommissionDialog, commissionRef, type LedgerView } from "./ledger"
import { useShareLink } from "./header-tools"
import { EmptyState, InlineError, StatusChip, btnClass, fmtAgo, fmtDate } from "./ui"
import { cn } from "@/lib/utils"

// Referrals are shown by their public id (TL-49281) — never a customer's name
// or email — the same rule as the Classic dashboard.

export type ReferralView = { id: number; publicId: string; status: string; source: string; plan: string | null; billing: string | null; campaign: string | null; revenue: number; commission: number; createdAt: string; firstPaymentAt: string | null }

const plan = (p: string | null) => (p ? `TradeLoop ${p.charAt(0).toUpperCase()}${p.slice(1)}` : "No plan yet")
const sourceText = (r: Pick<ReferralView, "source" | "campaign">) => r.campaign ?? (r.source === "coupon" ? "Coupon" : "Your link")

export function ReferralList({ rows, openId, referralUrl, filtered }: { rows: ReferralView[]; openId?: string | null; referralUrl: string; filtered: boolean }) {
  const [open, setOpen] = useState<string | null>(openId ?? null)
  const share = useShareLink(referralUrl)
  if (rows.length === 0)
    return (
      <EmptyState
        icon={Users}
        title={filtered ? "No referrals match" : "No referrals yet"}
        action={
          filtered ? undefined : (
            <button type="button" onClick={() => share()} className={btnClass}>
              <Share2 className="size-4" aria-hidden /> Share Referral Link
            </button>
          )
        }
      >
        {filtered ? "Try another tab or search." : "Share your referral link to get your first customer."}
      </EmptyState>
    )
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              {["Customer", "Joined", "Plan", "Status", "Lifetime value", "Commission", "Source"].map((h, i) => (
                <th key={h} className={cn("px-3 pb-2 font-medium", i >= 4 && i <= 5 ? "text-end" : "text-start")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id} tabIndex={0} onClick={() => setOpen(r.publicId)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(r.publicId))} className="cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none" aria-label={`Customer ${r.publicId}`}>
                <td className="px-3 py-3">
                  <span className="flex items-center gap-2.5">
                    <span className="v2-icon flex size-8 items-center justify-center rounded-full" aria-hidden>
                      <UserRound className="size-4" />
                    </span>
                    <span className="font-mono text-[13px] font-semibold">{r.publicId}</span>
                  </span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{fmtAgo(r.createdAt)}</td>
                <td className="px-3 py-3 whitespace-nowrap">{plan(r.plan)}</td>
                <td className="px-3 py-3">
                  <StatusChip status={r.status} />
                </td>
                <td className="px-3 py-3 text-end tabular-nums">{money(r.revenue)}</td>
                <td className="px-3 py-3 text-end font-semibold text-gain tabular-nums">{money(r.commission)}</td>
                <td className="max-w-[160px] truncate px-3 py-3 text-muted-foreground">{sourceText(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => setOpen(r.publicId)} className="flex w-full items-center gap-3 rounded-xl border bg-background/30 p-3 text-start">
              <span className="v2-icon flex size-10 items-center justify-center rounded-full" aria-hidden>
                <UserRound className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-sm font-semibold">{r.publicId}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  Signed up {fmtAgo(r.createdAt)} · {sourceText(r)}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-sm font-semibold tabular-nums">{money(r.commission)}</span>
                <StatusChip status={r.firstPaymentAt && r.status === "active" ? "paid" : r.status} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <CustomerDrawer publicId={open} onClose={() => setOpen(null)} />
    </>
  )
}

// The customer profile: plan, dates, value, where they came from, and every
// commission they've generated.
export function CustomerDrawer({ publicId, onClose }: { publicId: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<ReferralDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [commission, setCommission] = useState<LedgerView | null>(null)
  useEffect(() => {
    setDetail(null)
    setError(null)
    if (!publicId) return
    loadReferral(publicId)
      .then((res) => (res.ok ? setDetail(res.referral) : setError(res.error)))
      .catch(() => setError("We couldn't load this customer."))
  }, [publicId])
  const earned = detail ? detail.ledger.filter((l) => l.type !== "payout" && !["reversed", "refunded", "cancelled"].includes(l.status)).reduce((s, l) => s + l.amount, 0) : 0
  const toView = (l: ReferralDetail["ledger"][number]): LedgerView => ({ id: l.id, type: l.type, status: l.status, amount: l.amount, baseAmount: null, ratePercent: l.ratePercent, ruleSource: null, holdUntil: l.holdUntil ? new Date(l.holdUntil).toISOString() : null, note: null, createdAt: new Date(l.createdAt).toISOString(), referral: detail?.publicId ?? null, plan: detail?.plan ?? null })
  const latest = detail?.ledger.find((l) => l.type === "subscription")

  return (
    <>
      <DialogPrimitive.Root open={!!publicId} onOpenChange={(o) => !o && onClose()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/45 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
          <DialogPrimitive.Popup className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90svh] flex-col rounded-t-2xl border-t bg-popover text-popover-foreground shadow-2xl outline-none data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom md:inset-y-0 md:start-auto md:end-0 md:max-h-none md:w-[440px] md:rounded-none md:border-s md:border-t-0 md:data-open:slide-in-from-right md:data-closed:slide-out-to-right">
            <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="v2-icon flex size-11 items-center justify-center rounded-full" aria-hidden>
                  <UserRound className="size-5" />
                </span>
                <div className="min-w-0">
                  <DialogPrimitive.Title className="font-mono text-base font-semibold">{publicId}</DialogPrimitive.Title>
                  <p className="text-xs text-muted-foreground">{detail ? `Joined ${fmtDate(detail.createdAt)}` : "Customer profile"}</p>
                </div>
              </div>
              <DialogPrimitive.Close aria-label="Close" className="inline-flex size-10 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted">
                <X className="size-5" aria-hidden />
              </DialogPrimitive.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {error ? (
                <InlineError>{error}</InlineError>
              ) : !detail ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  <dl className="divide-y rounded-xl border bg-background/30 text-sm">
                    {(
                      [
                        ["Plan", plan(detail.plan) + (detail.billing ? ` · ${detail.billing}` : "")],
                        ["Status", <StatusChip key="s" status={detail.status} />],
                        ["Joined", fmtDate(detail.createdAt)],
                        ["First payment", detail.firstPaymentAt ? fmtDate(detail.firstPaymentAt) : "Not yet"],
                        ["Lifetime value", money(detail.revenue)],
                        ["Commission generated", money(Math.round(earned * 100) / 100)],
                        ["Referral source", detail.source === "coupon" ? `Coupon${detail.coupon ? ` ${detail.coupon}` : ""}` : "Your link"],
                        ["Campaign", detail.campaign ?? "—"],
                        ["Country", detail.country ?? "—"],
                      ] as const
                    ).map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="text-end font-medium">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div>
                    <p className="mb-2 text-sm font-semibold">Commission history</p>
                    {detail.ledger.length === 0 ? (
                      <p className="rounded-xl border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">No commissions from this customer yet.</p>
                    ) : (
                      <ul className="divide-y rounded-xl border">
                        {detail.ledger.map((l) => (
                          <li key={l.id}>
                            <button type="button" onClick={() => setCommission(toView(l))} disabled={l.type !== "subscription"} className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-start text-sm hover:bg-muted/40 disabled:cursor-default disabled:hover:bg-transparent">
                              <span>
                                <span className="block font-medium">{l.type === "subscription" ? `Commission #${commissionRef(l.id)}` : l.type}</span>
                                <span className="block text-xs text-muted-foreground">{fmtDate(l.createdAt)}</span>
                              </span>
                              <span className="flex items-center gap-2">
                                <span className={cn("font-semibold tabular-nums", l.amount < 0 ? "text-loss" : "text-gain")}>{money(l.amount)}</span>
                                <StatusChip status={l.status} />
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {latest && (
                    <button type="button" onClick={() => setCommission(toView(latest))} className={cn(btnClass, "h-11 w-full")}>
                      View Commission Details
                    </button>
                  )}
                </div>
              )}
            </div>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <CommissionDialog row={commission} onClose={() => setCommission(null)} />
    </>
  )
}
