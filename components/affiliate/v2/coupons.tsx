"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { Copy, Infinity as InfinityIcon, MessageSquarePlus, TicketPercent } from "lucide-react"
import { contactAffiliateSupport } from "@/app/actions/affiliate"
import { money } from "@/lib/affiliates/types"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { copyText } from "./referral-link"
import { EmptyState, InlineError, StatusChip, btnClass, fmtDate, ghostBtnClass } from "./ui"
import { cn } from "@/lib/utils"

// Coupons are created by the TradeLoop team only (the program's rule): this
// page shows the affiliate's codes and lets them ASK for one — the request goes
// to the affiliate team through the existing support queue.

export type CouponV2View = { id: number; code: string; discountType: string; discountValue: number; durationMonths: number; plan: string | null; campaign: string | null; usageLimit: number | null; uses: number; expiresAt: string | null; status: string; permanent: boolean; stats: { customers: number; revenue: number; commission: number } }

export function RequestCouponButton({ autoOpen = false }: { autoOpen?: boolean }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  useEffect(() => {
    if (autoOpen) setOpen(true)
  }, [autoOpen])
  const submit = () =>
    start(async () => {
      setError(null)
      const res = await contactAffiliateSupport({ subject: "Coupon request", message }).catch(() => ({ ok: false as const, error: "We couldn't send that. Try again." }))
      if (res.ok) {
        toast.success("Coupon request sent. The affiliate team will get back to you by email.")
        setMessage("")
        setOpen(false)
      } else setError(res.error)
    })
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btnClass}>
        <MessageSquarePlus className="size-4" aria-hidden /> Request a coupon
      </button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none sm:max-w-md">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <DialogHeader>
              <DialogTitle className="text-base font-semibold">Request a coupon</DialogTitle>
              <DialogDescription>Coupons are created for you by the TradeLoop team. Tell them what it&apos;s for — the code you&apos;d like, the discount, the campaign and how long it should run.</DialogDescription>
            </DialogHeader>
            <textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, 2000))} rows={5} required minLength={10} placeholder="e.g. A code ESLAM20 for 20% off the first month, for my October YouTube video, until Nov 30." className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50" />
            {error && <InlineError>{error}</InlineError>}
            <DialogFooter className="max-sm:rounded-b-none">
              <button type="button" className={ghostBtnClass} onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </button>
              <button type="submit" className={btnClass} disabled={pending || message.trim().length < 10}>
                {pending ? "Sending…" : "Send request"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function CouponCards({ coupons }: { coupons: CouponV2View[] }) {
  if (coupons.length === 0)
    return (
      <EmptyState icon={TicketPercent} title="No coupons yet" action={<RequestCouponButton />}>
        A customer who pays with one of your codes is credited to you, even without a link click.
      </EmptyState>
    )
  const now = Date.now()
  return (
    <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {coupons.map((c) => {
        const expired = !!c.expiresAt && new Date(c.expiresAt).getTime() < now
        const state = expired ? "expired" : c.status === "active" ? "active" : "disabled"
        const off = c.discountType === "fixed" ? `${money(c.discountValue)} off` : `${c.discountValue}% off`
        return (
          <li key={c.id} className={cn("v2-card relative flex min-w-0 flex-col overflow-hidden p-4 sm:p-5", state !== "active" && "opacity-75")}>
            <div aria-hidden className="pointer-events-none absolute -end-8 -top-8 size-28 rounded-full bg-[radial-gradient(circle,rgb(217_70_239/0.22),transparent_70%)]" />
            <div className="relative flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2">
                  <span className="font-mono text-lg font-bold tracking-wider">{c.code}</span>
                  <button type="button" onClick={() => copyText(c.code, "Coupon code copied!")} aria-label={`Copy ${c.code}`} className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
                    <Copy className="size-4" aria-hidden />
                  </button>
                </p>
                <p className="text-sm font-semibold text-primary">
                  {off} · {c.durationMonths === 1 ? "first month" : `${c.durationMonths} months`}
                  {c.plan ? ` · ${c.plan}` : ""}
                </p>
              </div>
              <StatusChip status={state} />
            </div>
            <dl className="relative mt-4 grid grid-cols-3 gap-2 text-center">
              {(
                [
                  ["Uses", `${c.uses}${c.usageLimit ? ` / ${c.usageLimit}` : ""}`],
                  ["Conversions", c.stats.customers.toLocaleString("en-US")],
                  ["Commission", money(c.stats.commission)],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="rounded-lg bg-muted/40 px-1 py-2">
                  <dt className="text-[10px] text-muted-foreground">{k}</dt>
                  <dd className="text-[13px] font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="relative mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              {c.permanent ? (
                <>
                  <InfinityIcon className="size-3.5" aria-hidden /> Your permanent code
                </>
              ) : c.expiresAt ? (
                `${expired ? "Expired" : "Expires"} ${fmtDate(c.expiresAt)}`
              ) : (
                "No expiry"
              )}
              {c.campaign ? ` · ${c.campaign}` : ""}
            </p>
          </li>
        )
      })}
    </ul>
  )
}
