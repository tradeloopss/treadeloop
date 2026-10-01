"use client"

import { useState } from "react"
import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { disableAffiliateCoupon, enableAffiliateCoupon, generateAffiliateCoupon, refreshAffiliatePermanentCoupon, setAffiliateCouponAccess } from "@/app/actions/admin-affiliates"
import { count } from "@/lib/affiliates/types"
import { ConfirmButton } from "@/components/affiliate/confirm"
import { CopyButton } from "@/components/affiliate/copy"
import { StatusBadge, selectClass } from "@/components/affiliate/ui"
import { useAction } from "@/components/affiliate/use-action"

const label = "flex flex-col gap-1.5 text-xs text-muted-foreground"

export type AdminCoupon = { id: number; code: string; percent: number; durationMonths: number; uses: number; status: string; permanent: boolean; byAdmin: boolean }

const BLANK = { code: "", percent: "20", durationMonths: "1", plan: "", usageLimit: "", expiresAt: "" }

// Everything an admin decides about one affiliate's coupons: whether the
// Coupons section of their portal is open, how large a discount they may offer,
// their permanent code, and coupons generated for them here.
export function CouponAdmin({
  affiliateId,
  name,
  ready,
  access,
  program,
  coupons,
}: {
  affiliateId: number
  name: string
  // approved and set up: codes can be made for them
  ready: boolean
  access: { couponsEnabled: boolean; maxCouponPercent: number | null }
  program: { couponsEnabled: boolean; maxCouponPercent: number; permanentPercent: number; permanentMonths: number }
  coupons: AdminCoupon[]
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [max, setMax] = useState(access.maxCouponPercent == null ? "" : String(access.maxCouponPercent))
  const { pending, run } = useAction()
  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: k === "code" ? e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") : e.target.value }))
  const permanent = coupons.find((c) => c.permanent)
  const stale = !!permanent && program.permanentPercent > 0 && (permanent.percent !== program.permanentPercent || permanent.durationMonths !== program.permanentMonths)
  const effective = access.maxCouponPercent ?? program.maxCouponPercent

  return (
    <div className="flex flex-col gap-4">
      <ul className="divide-y rounded-lg border">
        <li>
          <label className="flex cursor-pointer items-center justify-between gap-4 px-3 py-3">
            <span>
              <span className="block text-sm font-medium text-foreground">Coupons section</span>
              <span className="block text-xs text-muted-foreground">
                {access.couponsEnabled ? `Open: ${name} can create their own coupons, up to ${effective}% off.` : "Closed: they only have their permanent code and the coupons you generate."}
                {access.couponsEnabled && !program.couponsEnabled ? " Coupons are switched off in the program rules, so this has no effect yet." : ""}
              </span>
            </span>
            <input type="checkbox" role="switch" aria-label="Coupons section" checked={access.couponsEnabled} disabled={pending} onChange={(e) => run(() => setAffiliateCouponAccess(affiliateId, { couponsEnabled: e.target.checked }))} className="size-4 shrink-0 accent-[var(--primary)]" />
          </label>
        </li>
      </ul>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          run(() => setAffiliateCouponAccess(affiliateId, { maxCouponPercent: max === "" ? null : Number(max) }))
        }}
      >
        <label className={`${label} min-w-40 flex-1`}>
          Largest discount they can offer (%)
          <Input type="number" inputMode="numeric" min={1} max={100} step={1} value={max} onChange={(e) => setMax(e.target.value)} placeholder={`Program: ${program.maxCouponPercent}%`} />
        </label>
        <Button type="submit" variant="outline" disabled={pending || max === (access.maxCouponPercent == null ? "" : String(access.maxCouponPercent))}>
          Save
        </Button>
        <Button type="button" disabled={!ready} title={ready ? undefined : "Available once the affiliate is approved and set up"} onClick={() => (setForm(BLANK), setOpen(true))}>
          <Sparkles className="size-4" aria-hidden /> Generate coupon
        </Button>
      </form>

      {coupons.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No coupons yet.{" "}
          {ready && program.permanentPercent > 0 && (
            <button type="button" className="font-medium text-primary hover:underline" disabled={pending} onClick={() => run(() => refreshAffiliatePermanentCoupon(affiliateId))}>
              Create their permanent {program.permanentPercent}% code
            </button>
          )}
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {coupons.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="font-mono font-medium">{c.code}</span>
                {c.permanent && <span className="ms-2 rounded-full bg-primary/12 px-2 py-0.5 text-xs font-medium text-primary">Permanent</span>}
                {c.byAdmin && <span className="ms-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Generated</span>}
                <span className="block text-xs text-muted-foreground">
                  {c.percent}% off · {c.durationMonths === 1 ? "first month" : `first ${c.durationMonths} months`} · {count(c.uses)} use{c.uses === 1 ? "" : "s"}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <StatusBadge status={c.status} />
                <CopyButton value={c.code} iconOnly label={`Copy ${c.code}`} />
                {c.permanent && stale && (
                  <ConfirmButton size="xs" title={`Update ${c.code} to ${program.permanentPercent}%?`} description="The code stays the same; its discount is replaced with the program's current one. Customers who already used it keep what they got." confirmLabel="Update" action={() => refreshAffiliatePermanentCoupon(affiliateId)}>
                    Update
                  </ConfirmButton>
                )}
                {c.status === "active" ? (
                  <ConfirmButton size="xs" variant="destructive" destructive title={`Disable ${c.code}?`} description="The code stops working at checkout. Customers who already used it stay credited." confirmLabel="Disable" action={() => disableAffiliateCoupon(c.id)}>
                    Disable
                  </ConfirmButton>
                ) : (
                  <ConfirmButton size="xs" title={`Enable ${c.code}?`} description="The code starts working at checkout again." confirmLabel="Enable" action={() => enableAffiliateCoupon(c.id)}>
                    Enable
                  </ConfirmButton>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {ready && coupons.length > 0 && !permanent && program.permanentPercent > 0 && (
        <button type="button" className="self-start text-xs font-medium text-primary hover:underline" disabled={pending} onClick={() => run(() => refreshAffiliatePermanentCoupon(affiliateId))}>
          Create their permanent {program.permanentPercent}% code
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              run(
                () => generateAffiliateCoupon(affiliateId, { code: form.code, percent: Number(form.percent), durationMonths: Number(form.durationMonths), plan: form.plan || null, usageLimit: form.usageLimit ? Number(form.usageLimit) : null, expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null }),
                () => setOpen(false)
              )
            }}
          >
            <DialogHeader>
              <DialogTitle>Generate a coupon for {name}</DialogTitle>
              <DialogDescription>A real promo code at checkout, for new customers, one use per customer. Anyone who pays with it is credited to this affiliate.</DialogDescription>
            </DialogHeader>
            <label className={label}>
              Code
              <Input value={form.code} onChange={set("code")} maxLength={20} placeholder="Leave empty to generate one" className="font-mono uppercase" autoFocus />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={label}>
                Discount (%)
                <Input type="number" inputMode="numeric" min={1} max={100} step={1} value={form.percent} onChange={set("percent")} required />
              </label>
              <label className={label}>
                Applies to the first
                <select value={form.durationMonths} onChange={set("durationMonths")} className={selectClass}>
                  {[1, 2, 3, 6, 12].map((m) => (
                    <option key={m} value={m}>
                      {m === 1 ? "month" : `${m} months`}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Plan
                <select value={form.plan} onChange={set("plan")} className={selectClass}>
                  <option value="">All plans</option>
                  <option value="essential">Essential only</option>
                  <option value="pro">Pro only</option>
                </select>
              </label>
              <label className={label}>
                Usage limit
                <Input type="number" inputMode="numeric" min={1} step={1} value={form.usageLimit} onChange={set("usageLimit")} placeholder="No limit" />
              </label>
              <label className={`${label} sm:col-span-2`}>
                Expires
                <Input type="date" value={form.expiresAt} onChange={set("expiresAt")} />
                <span>Leave empty for a code that never expires.</span>
              </label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Generating…" : "Generate coupon"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
