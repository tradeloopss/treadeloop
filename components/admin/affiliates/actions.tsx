"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  adjustBalance,
  approveCommissionEarly,
  disableAffiliateCoupon,
  resolveSignal,
  reverseCommissionManually,
  reviewApplication,
  setAffiliateCode,
  setAffiliateFlags,
  setAffiliateStatus,
  setAffiliateTier,
} from "@/app/actions/admin-affiliates"
import { money } from "@/lib/affiliates/types"
import { ConfirmButton } from "@/components/affiliate/confirm"
import { selectClass } from "@/components/affiliate/ui"
import { useAction } from "@/components/affiliate/use-action"

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "")

// --- Applications -------------------------------------------------------------

export function ApplicationActions({ id, status, name }: { id: number; status: string; name: string }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <ConfirmButton variant="default" title={`Approve ${name}?`} description="They get access to the affiliate portal and an email telling them so." confirmLabel="Approve" action={() => reviewApplication(id, "approve")}>
        Approve
      </ConfirmButton>
      {status === "pending" && (
        <ConfirmButton title="Mark as under review?" description="Use this when you need more time. The applicant sees that their application is being reviewed." confirmLabel="Mark in review" action={() => reviewApplication(id, "review")}>
          In review
        </ConfirmButton>
      )}
      {status !== "rejected" && (
        <ConfirmButton
          variant="destructive"
          destructive
          title={`Reject ${name}?`}
          description="They're emailed the decision and can apply again later."
          confirmLabel="Reject"
          reason={{ label: "Reason (optional — included in the email)", placeholder: "e.g. We couldn't verify the audience you described." }}
          action={(reason) => reviewApplication(id, "reject", reason)}
        >
          Reject
        </ConfirmButton>
      )}
    </div>
  )
}

// --- Affiliate standing -------------------------------------------------------

export function StandingActions({ id, status, name }: { id: number; status: string; name: string }) {
  if (status === "approved") {
    return (
      <ConfirmButton
        variant="destructive"
        destructive
        title={`Suspend ${name}?`}
        description="Their links stop tracking, they stop earning on new payments and they lose access to the portal. Commissions already earned are NOT touched — reverse those separately if you need to."
        confirmLabel="Suspend"
        reason={{ label: "Reason (optional — included in the email)" }}
        action={(reason) => setAffiliateStatus(id, "suspended", reason)}
      >
        Suspend
      </ConfirmButton>
    )
  }
  if (status === "suspended") {
    return (
      <ConfirmButton variant="default" title={`Reinstate ${name}?`} description="Their links start tracking again and the portal is unlocked. Payments made while suspended don't earn retroactively." confirmLabel="Reinstate" action={() => setAffiliateStatus(id, "approved")}>
        Reinstate
      </ConfirmButton>
    )
  }
  return <ApplicationActions id={id} status={status} name={name} />
}

export function FlagToggles({ id, payoutHold, fraudLock }: { id: number; payoutHold: boolean; fraudLock: boolean }) {
  const { pending, run } = useAction()
  return (
    <ul className="divide-y rounded-lg border">
      <li>
        <label className="flex cursor-pointer items-center justify-between gap-4 px-3 py-2.5">
          <span>
            <span className="block text-sm font-medium">Payout hold</span>
            <span className="block text-xs text-muted-foreground">Blocks new payout requests. Commissions keep clearing.</span>
          </span>
          <input type="checkbox" role="switch" checked={payoutHold} disabled={pending} onChange={(e) => run(() => setAffiliateFlags(id, { payoutHold: e.target.checked }))} className="size-4 accent-[var(--primary)]" />
        </label>
      </li>
      <li>
        <label className="flex cursor-pointer items-center justify-between gap-4 px-3 py-2.5">
          <span>
            <span className="block text-sm font-medium">Fraud lock</span>
            <span className="block text-xs text-muted-foreground">Blocks payouts and stops commissions becoming available while you investigate.</span>
          </span>
          <input type="checkbox" role="switch" checked={fraudLock} disabled={pending} onChange={(e) => run(() => setAffiliateFlags(id, { fraudLock: e.target.checked }))} className="size-4 accent-[var(--primary)]" />
        </label>
      </li>
    </ul>
  )
}

export function TierSelect({ id, tierId, tiers }: { id: number; tierId: number | null; tiers: { id: number; name: string; ratePercent: number }[] }) {
  const { pending, run } = useAction()
  return (
    <select aria-label="Tier" value={tierId ?? ""} disabled={pending} onChange={(e) => run(() => setAffiliateTier(id, e.target.value ? Number(e.target.value) : null))} className={selectClass}>
      <option value="">Automatic (by paying customers)</option>
      {tiers.map((t) => (
        <option key={t.id} value={t.id}>
          Always {t.name} ({t.ratePercent}%)
        </option>
      ))}
    </select>
  )
}

export function CodeEditor({ id, code }: { id: number; code: string }) {
  const [value, setValue] = useState(code)
  const { pending, run } = useAction()
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (value === code) return
        if (!window.confirm(`Change the referral code from "${code}" to "${value}"? Links using the old code stop tracking.`)) return
        run(() => setAffiliateCode(id, value))
      }}
    >
      <Input aria-label="Referral code" value={value} onChange={(e) => setValue(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))} maxLength={24} className="font-mono" />
      <Button type="submit" variant="outline" disabled={pending || value === code || value.length < 3}>
        Change
      </Button>
    </form>
  )
}

// --- Ledger -------------------------------------------------------------------

export function AdjustDialog({ id, name }: { id: number; name: string }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<"bonus" | "adjustment">("bonus")
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [key, setKey] = useState("")
  const { pending, run } = useAction()
  const value = Number(amount)
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setAmount("")
          setNote("")
          setKey(newKey())
          setOpen(true)
        }}
      >
        Add bonus / adjustment
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              run(() => adjustBalance({ affiliateId: id, type, amount: value, note, key }), () => setOpen(false))
            }}
          >
            <DialogHeader>
              <DialogTitle>Ledger entry for {name}</DialogTitle>
              <DialogDescription>Adds a new line to their ledger — existing lines are never edited. It&apos;s available to withdraw immediately, and they&apos;re notified with your note.</DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Type
              <select value={type} onChange={(e) => setType(e.target.value as "bonus" | "adjustment")} className={selectClass}>
                <option value="bonus">Bonus (adds to their balance)</option>
                <option value="adjustment">Adjustment (use a negative amount to deduct)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Amount (USD)
              <Input type="number" inputMode="decimal" step="0.01" min={type === "bonus" ? 0.01 : undefined} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={type === "bonus" ? "50.00" : "-25.00"} required autoFocus />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Note (the affiliate sees this)
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} required />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !Number.isFinite(value) || value === 0 || !note.trim()}>
                {pending ? "Adding…" : `Add ${Number.isFinite(value) && value !== 0 ? money(value) : "entry"}`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function LedgerRowActions({ id, type, status, amount }: { id: number; type: string; status: string; amount: number }) {
  if (type === "payout" || amount <= 0 || ["reversed", "refunded", "cancelled"].includes(status)) return null
  return (
    <div className="flex justify-end gap-1.5">
      {status === "pending" && (
        <ConfirmButton size="xs" title="Approve this commission now?" description="It skips the rest of its holding period and becomes available to withdraw." confirmLabel="Approve" action={() => approveCommissionEarly(id)}>
          Approve
        </ConfirmButton>
      )}
      <ConfirmButton
        size="xs"
        variant="destructive"
        destructive
        title={`Reverse this ${money(amount)} entry?`}
        description="A matching negative line is added; nothing is deleted. If it was already paid out, the amount comes off their available balance."
        confirmLabel="Reverse"
        reason={{ label: "Reason (the affiliate sees this)", required: true }}
        action={(reason) => reverseCommissionManually(id, reason)}
      >
        Reverse
      </ConfirmButton>
    </div>
  )
}

export function CouponDisableButton({ id, code }: { id: number; code: string }) {
  return (
    <ConfirmButton size="xs" variant="destructive" destructive title={`Disable ${code}?`} description="The code stops working at checkout. Customers who already used it stay credited." confirmLabel="Disable" action={() => disableAffiliateCoupon(id)}>
      Disable
    </ConfirmButton>
  )
}

// --- Risk ---------------------------------------------------------------------

export function SignalActions({ id, status }: { id: number; status: string }) {
  if (status === "cleared" || status === "actioned") return null
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {status === "open" && (
        <ConfirmButton size="xs" title="Start reviewing this signal?" confirmLabel="Mark reviewing" action={() => resolveSignal(id, "reviewing")}>
          Review
        </ConfirmButton>
      )}
      <ConfirmButton size="xs" title="Clear this signal?" description="Use this when you've looked and it's fine. Nothing changes for the affiliate." confirmLabel="Clear" action={() => resolveSignal(id, "cleared")}>
        Clear
      </ConfirmButton>
      <ConfirmButton size="xs" title="Mark as actioned?" description="Records that you acted on it (a suspension, a reversal, a hold). This doesn't take any action itself — do that from the affiliate's page." confirmLabel="Mark actioned" action={() => resolveSignal(id, "actioned")}>
        Actioned
      </ConfirmButton>
    </div>
  )
}
