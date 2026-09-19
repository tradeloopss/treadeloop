"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  cancelWhopMembership,
  createWhopPromoCode,
  deleteWhopPromoCode,
  extendWhopMembership,
  pauseWhopMembership,
  refundWhopPayment,
  resumeWhopMembership,
  retryWhopPayment,
  type ActionResult,
} from "@/app/actions/admin"

const selectClass = "h-9 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground"

function useAction() {
  const [pending, startTransition] = useTransition()
  const perform = (action: () => Promise<ActionResult>, onSuccess?: () => void) =>
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        toast.success(result.message ?? "Done.")
        onSuccess?.()
      } else toast.error(result.error)
    })
  return { pending, perform }
}

// Pause / resume / extend / cancel one Whop membership. Shown on the user
// profile next to their Whop subscription.
export function MembershipControls({ membershipId, status, cancelAtPeriodEnd }: { membershipId: string; status: string; cancelAtPeriodEnd: boolean }) {
  const { pending, perform } = useAction()
  const [panel, setPanel] = useState<"pause" | "extend" | "cancel" | null>(null)
  const [until, setUntil] = useState("")
  const [days, setDays] = useState("30")
  const [reason, setReason] = useState("")
  const paused = status === "paused"
  const ended = status === "canceled" || status === "expired" || status === "completed"

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {!ended && !paused && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setPanel(panel === "pause" ? null : "pause")}>
            Pause billing
          </Button>
        )}
        {paused && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => perform(() => resumeWhopMembership(membershipId))}>
            Resume billing
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setPanel(panel === "extend" ? null : "extend")}>
          Extend
        </Button>
        {!ended && !cancelAtPeriodEnd && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setPanel(panel === "cancel" ? null : "cancel")}>
            Cancel…
          </Button>
        )}
      </div>

      {panel === "pause" && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3"
          onSubmit={(e) => {
            e.preventDefault()
            perform(() => pauseWhopMembership(membershipId, until ? new Date(until).toISOString() : null), () => setPanel(null))
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Resume automatically on (optional)
            <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="h-9" />
          </label>
          <Button size="sm" type="submit" disabled={pending}>Pause now</Button>
          <p className="w-full text-xs text-muted-foreground">Stops charging their card; they keep access while paused.</p>
        </form>
      )}

      {panel === "extend" && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3"
          onSubmit={(e) => {
            e.preventDefault()
            perform(() => extendWhopMembership(membershipId, Number(days)), () => setPanel(null))
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Free days to add
            <Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} className="h-9 w-28" required />
          </label>
          <Button size="sm" type="submit" disabled={pending}>Add free days</Button>
          <p className="w-full text-xs text-muted-foreground">Pushes the next charge out by that many days — e.g. to extend a trial or make up for downtime.</p>
        </form>
      )}

      {panel === "cancel" && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3"
          onSubmit={(e) => {
            e.preventDefault()
            const now = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("data-now") === "1"
            if (now && !confirm("Cancel immediately? They lose access right away and Whop does not refund automatically.")) return
            perform(() => cancelWhopMembership(membershipId, !now, reason), () => setPanel(null))
          }}
        >
          <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Reason (for the audit log)
            <Input value={reason} onChange={(e) => setReason(e.target.value)} className="h-9" placeholder="e.g. requested by user" />
          </label>
          <Button size="sm" type="submit" variant="outline" disabled={pending}>Cancel at period end</Button>
          <Button size="sm" type="submit" variant="destructive" data-now="1" disabled={pending}>Cancel now</Button>
        </form>
      )}
    </div>
  )
}

export function RefundButton({ paymentId, email, amount, currency }: { paymentId: string; email: string | null; amount: number | null; currency: string }) {
  const { pending, perform } = useAction()
  const [open, setOpen] = useState(false)
  const [partial, setPartial] = useState("")
  if (!open) {
    return (
      <Button size="sm" variant="outline" disabled={pending} onClick={() => setOpen(true)}>
        Refund…
      </Button>
    )
  }
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const value = partial ? Number(partial) : null
        const label = value != null ? `Refund ${value.toFixed(2)} ${currency.toUpperCase()}` : `Refund the full ${amount != null ? amount.toFixed(2) : ""} ${currency.toUpperCase()}`
        if (!confirm(`${label} to ${email ?? "this customer"}? This can't be undone.`)) return
        perform(() => refundWhopPayment(paymentId, value, email), () => setOpen(false))
      }}
    >
      <Input type="number" step="0.01" min="0.01" max={amount ?? undefined} value={partial} onChange={(e) => setPartial(e.target.value)} placeholder={amount != null ? `Full (${amount.toFixed(2)})` : "Amount"} className="h-8 w-32 text-xs" />
      <Button size="sm" variant="destructive" type="submit" disabled={pending}>Confirm refund</Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Button>
    </form>
  )
}

export function RetryPaymentButton({ paymentId, email }: { paymentId: string; email: string | null }) {
  const { pending, perform } = useAction()
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => perform(() => retryWhopPayment(paymentId, email))}>
      Retry charge
    </Button>
  )
}

export function PromoCodeForm() {
  const { pending, perform } = useAction()
  const [code, setCode] = useState("")
  const [promoType, setPromoType] = useState<"percentage" | "flat_amount">("percentage")
  const [amountOff, setAmountOff] = useState("20")
  const [durationMonths, setDurationMonths] = useState("1")
  const [newUsersOnly, setNewUsersOnly] = useState(true)
  const [onePerCustomer, setOnePerCustomer] = useState(true)
  const [stock, setStock] = useState("")
  const [expiresAt, setExpiresAt] = useState("")

  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault()
        perform(
          () =>
            createWhopPromoCode({
              code,
              promoType,
              amountOff: Number(amountOff),
              durationMonths: Number(durationMonths),
              newUsersOnly,
              onePerCustomer,
              stock: stock ? Number(stock) : null,
              expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
            }),
          () => setCode("")
        )
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Code
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="LAUNCH20" className="h-9 font-mono uppercase" required />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Discount
        <div className="flex gap-1.5">
          <Input type="number" step="0.01" min="0.01" value={amountOff} onChange={(e) => setAmountOff(e.target.value)} className="h-9 min-w-20 flex-1" required />
          <select value={promoType} onChange={(e) => setPromoType(e.target.value as "percentage" | "flat_amount")} className={selectClass}>
            <option value="percentage">% off</option>
            <option value="flat_amount">$ off</option>
          </select>
        </div>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Applies for (months)
        <Input type="number" min={1} max={36} value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} className="h-9" required />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Max uses (blank = unlimited)
        <Input type="number" min={1} value={stock} onChange={(e) => setStock(e.target.value)} className="h-9" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Expires (optional)
        <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="h-9" />
      </label>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" checked={newUsersOnly} onChange={(e) => setNewUsersOnly(e.target.checked)} className="size-4" /> New customers only
      </label>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" checked={onePerCustomer} onChange={(e) => setOnePerCustomer(e.target.checked)} className="size-4" /> One use per customer
      </label>
      <div className="flex items-end">
        <Button type="submit" disabled={pending} className="h-9">Create code</Button>
      </div>
    </form>
  )
}

export function DeletePromoButton({ id, code }: { id: string; code: string | null }) {
  const { pending, perform } = useAction()
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (confirm(`Delete promo code ${code ?? id}? Existing discounts already applied are not affected.`)) perform(() => deleteWhopPromoCode(id, code))
      }}
    >
      Delete
    </Button>
  )
}
