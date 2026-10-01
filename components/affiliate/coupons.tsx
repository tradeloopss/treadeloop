"use client"

import { useState } from "react"
import { Plus, TicketPercent } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { addCoupon, changeCouponStatus } from "@/app/actions/affiliate"
import { count, money } from "@/lib/affiliates/types"
import { ConfirmButton } from "./confirm"
import { CopyButton } from "./copy"
import { Empty, StatusBadge, TableShell, THead, fmtDay, selectClass, tdClass, thClass } from "./ui"
import { useAction } from "./use-action"

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
  stats: { customers: number; revenue: number; commission: number }
}

const BLANK = { code: "", percent: "10", durationMonths: "1", plan: "", campaignId: "", usageLimit: "", expiresAt: "" }

export function CouponsManager({ coupons, campaigns, enabled, maxPercent }: { coupons: CouponView[]; campaigns: { id: number; name: string }[]; enabled: boolean; maxPercent: number }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(BLANK)
  const { pending, run } = useAction()
  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: k === "code" ? e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") : e.target.value }))
  const expired = (c: CouponView) => !!c.expiresAt && new Date(c.expiresAt).getTime() < Date.now()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{enabled ? `Give your audience a discount of up to ${maxPercent}%. A customer who pays with your code is credited to you, even without a link click.` : "Coupons are switched off in the program right now."}</p>
        {enabled && (
          <Button onClick={() => (setForm(BLANK), setOpen(true))}>
            <Plus className="size-4" aria-hidden /> New coupon
          </Button>
        )}
      </div>

      {coupons.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <Empty icon={TicketPercent} title="No coupons yet" action={enabled ? <Button onClick={() => setOpen(true)}>Create a coupon</Button> : undefined}>
            A code your audience types at checkout — easy to say out loud in a video or a stream.
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
              <th className={`${thClass} text-end`}>Actions</th>
            </tr>
          </THead>
          <tbody className="divide-y">
            {coupons.map((c) => (
              <tr key={c.id}>
                <td className={tdClass}>
                  <p className="font-mono text-sm font-semibold">{c.code}</p>
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
                  <div className="flex items-center justify-end gap-1.5">
                    <CopyButton value={c.code} label="Copy code" />
                    {c.status === "active" ? (
                      <ConfirmButton title={`Disable ${c.code}?`} description="The code stops working at checkout straight away. Customers who already used it stay credited to you." confirmLabel="Disable" destructive action={() => changeCouponStatus(c.id, "disabled")}>
                        Disable
                      </ConfirmButton>
                    ) : (
                      enabled &&
                      !expired(c) && (
                        <ConfirmButton title={`Enable ${c.code}?`} description="The code starts working at checkout again." confirmLabel="Enable" action={() => changeCouponStatus(c.id, "active")}>
                          Enable
                        </ConfirmButton>
                      )
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              run(
                () => addCoupon({ code: form.code, percent: Number(form.percent), durationMonths: Number(form.durationMonths), plan: form.plan || null, campaignId: form.campaignId ? Number(form.campaignId) : null, usageLimit: form.usageLimit ? Number(form.usageLimit) : null, expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null }),
                () => setOpen(false)
              )
            }}
          >
            <DialogHeader>
              <DialogTitle>New coupon</DialogTitle>
              <DialogDescription>For new customers only, one use per customer. It works at checkout as soon as it&apos;s created.</DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Code
              <Input value={form.code} onChange={set("code")} maxLength={20} placeholder="ALEX20" className="font-mono uppercase" required autoFocus />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                Discount (%, up to {maxPercent})
                <Input type="number" inputMode="numeric" min={1} max={maxPercent} step={1} value={form.percent} onChange={set("percent")} required />
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                Applies to the first
                <select value={form.durationMonths} onChange={set("durationMonths")} className={selectClass}>
                  {[1, 2, 3, 6, 12].map((m) => (
                    <option key={m} value={m}>
                      {m === 1 ? "month" : `${m} months`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                Plan
                <select value={form.plan} onChange={set("plan")} className={selectClass}>
                  <option value="">All plans</option>
                  <option value="essential">Essential only</option>
                  <option value="pro">Pro only</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                Campaign
                <select value={form.campaignId} onChange={set("campaignId")} className={selectClass}>
                  <option value="">No campaign</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                Usage limit (optional)
                <Input type="number" inputMode="numeric" min={1} step={1} value={form.usageLimit} onChange={set("usageLimit")} placeholder="No limit" />
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                Expires (optional)
                <Input type="date" value={form.expiresAt} onChange={set("expiresAt")} />
              </label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || form.code.length < 3}>
                {pending ? "Creating…" : "Create coupon"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
