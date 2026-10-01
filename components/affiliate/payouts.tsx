"use client"

import { useState } from "react"
import { Banknote, Plus, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cancelPayoutRequest, deletePayoutMethod, makeDefaultPayoutMethod, savePayoutMethod, submitPayoutRequest } from "@/app/actions/affiliate"
import { PAYOUT_METHOD_LABELS, PAYOUT_METHOD_TYPES, money, type PayoutMethodType } from "@/lib/affiliates/types"
import { ConfirmButton } from "./confirm"
import { Empty, StatusBadge, TableShell, THead, fmtDay, selectClass, tdClass, thClass } from "./ui"
import { useAction } from "./use-action"

export type MethodView = { id: number; type: string; label: string; isDefault: boolean }
export type PayoutView = { id: number; amount: number; methodType: string; methodLabel: string; status: string; failureReason: string | null; requestedAt: string; processedAt: string | null }

const methodName = (type: string) => PAYOUT_METHOD_LABELS[type as PayoutMethodType] ?? type
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "")

// --- Request a payout -------------------------------------------------------

export function RequestPayout({ available, minPayout, methods, blocked, eta }: { available: number; minPayout: number; methods: MethodView[]; blocked: string | null; eta: string }) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState("")
  const [methodId, setMethodId] = useState("")
  // One key per opening of the dialog: submitting twice can't pay twice.
  const [key, setKey] = useState("")
  const { pending, run } = useAction()
  const value = Number(amount)
  const problem = !amount ? null : !Number.isFinite(value) || value <= 0 ? "Enter an amount." : value < minPayout ? `The minimum payout is ${money(minPayout)}.` : value > available ? "That's more than your available balance." : null
  const reason = blocked ?? (methods.length === 0 ? "Add a payout method below first." : available < minPayout ? `You need at least ${money(minPayout)} available to request a payout.` : null)

  return (
    <>
      <Button
        disabled={!!reason}
        title={reason ?? undefined}
        onClick={() => {
          setAmount(available.toFixed(2))
          setMethodId(String((methods.find((m) => m.isDefault) ?? methods[0])?.id ?? ""))
          setKey(newKey())
          setOpen(true)
        }}
      >
        <Banknote className="size-4" aria-hidden /> Request payout
      </Button>
      {reason && <p className="mt-1.5 text-xs text-muted-foreground">{reason}</p>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (problem || !amount) return
              run(() => submitPayoutRequest({ amount: Math.round(value * 100) / 100, methodId: Number(methodId), key }), () => setOpen(false))
            }}
          >
            <DialogHeader>
              <DialogTitle>Request a payout</DialogTitle>
              <DialogDescription>
                {money(available)} available. Payouts are reviewed and sent by our team — usually {eta} after approval.
              </DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Amount (USD)
              <div className="flex gap-2">
                <Input type="number" inputMode="decimal" min={minPayout} max={available} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!problem} required autoFocus />
                <Button type="button" variant="outline" onClick={() => setAmount(available.toFixed(2))}>
                  Max
                </Button>
              </div>
              {problem && (
                <span className="text-[var(--loss)]" role="alert">
                  {problem}
                </span>
              )}
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Send to
              <select value={methodId} onChange={(e) => setMethodId(e.target.value)} className={selectClass} required>
                {methods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {methodName(m.type)} — {m.label}
                  </option>
                ))}
              </select>
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !!problem || !amount || !methodId}>
                {pending ? "Requesting…" : `Request ${amount && !problem ? money(value) : "payout"}`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// --- Payout methods ---------------------------------------------------------

const FIELDS: Record<PayoutMethodType, { key: string; label: string; placeholder?: string; type?: string; maxLength?: number }[]> = {
  paypal: [{ key: "email", label: "PayPal email", type: "email", placeholder: "you@example.com" }],
  wise: [
    { key: "email", label: "Wise email", type: "email", placeholder: "you@example.com" },
    { key: "holder", label: "Account holder name" },
  ],
  bank: [
    { key: "holder", label: "Account holder name" },
    { key: "bankName", label: "Bank name" },
    { key: "account", label: "IBAN or account number" },
    { key: "swift", label: "SWIFT / BIC (optional)", maxLength: 11 },
    { key: "country", label: "Bank country (2-letter code)", placeholder: "US", maxLength: 2 },
  ],
}

export function PayoutMethods({ methods }: { methods: MethodView[] }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<PayoutMethodType>("paypal")
  const [details, setDetails] = useState<Record<string, string>>({})
  const { pending, run } = useAction()

  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold">Payout methods</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Where we send your money. Account details are stored encrypted and shown masked.</p>
        </div>
        <Button variant="outline" onClick={() => (setDetails({}), setOpen(true))}>
          <Plus className="size-4" aria-hidden /> Add method
        </Button>
      </div>
      {methods.length === 0 ? (
        <Empty icon={Wallet} title="No payout method yet">
          Add PayPal, Wise or a bank account to be able to request payouts.
        </Empty>
      ) : (
        <ul className="divide-y">
          {methods.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {methodName(m.type)}
                  {m.isDefault && <span className="ms-2 rounded-full bg-primary/12 px-2 py-0.5 text-xs font-medium text-primary">Default</span>}
                </p>
                <p className="truncate font-mono text-xs text-muted-foreground">{m.label}</p>
              </div>
              <div className="flex gap-1.5">
                {!m.isDefault && (
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => makeDefaultPayoutMethod(m.id))}>
                    Make default
                  </Button>
                )}
                <ConfirmButton title="Remove this payout method?" description="Payouts already requested keep going to it. You can add it again any time." confirmLabel="Remove" destructive action={() => deletePayoutMethod(m.id)}>
                  Remove
                </ConfirmButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              run(() => savePayoutMethod(type, details), () => setOpen(false))
            }}
          >
            <DialogHeader>
              <DialogTitle>Add a payout method</DialogTitle>
              <DialogDescription>Double-check the details — a payout sent to the wrong account can&apos;t always be recovered.</DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Method
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value as PayoutMethodType)
                  setDetails({})
                }}
                className={selectClass}
              >
                {PAYOUT_METHOD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PAYOUT_METHOD_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            {FIELDS[type].map((f) => (
              <label key={f.key} className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                {f.label}
                <Input type={f.type ?? "text"} value={details[f.key] ?? ""} onChange={(e) => setDetails((d) => ({ ...d, [f.key]: e.target.value }))} placeholder={f.placeholder} maxLength={f.maxLength ?? 120} autoComplete="off" required={!f.label.includes("optional")} />
              </label>
            ))}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Add method"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}

// --- History ----------------------------------------------------------------

export function PayoutHistory({ payouts }: { payouts: PayoutView[] }) {
  if (payouts.length === 0) {
    return (
      <div className="rounded-xl border bg-card">
        <Empty icon={Banknote} title="No payouts yet">
          Once you request one, you can follow it here from requested to paid.
        </Empty>
      </div>
    )
  }
  return (
    <TableShell>
      <THead>
        <tr>
          <th className={thClass}>Requested</th>
          <th className={thClass}>Method</th>
          <th className={thClass}>Status</th>
          <th className={thClass}>Completed</th>
          <th className={`${thClass} text-end`}>Amount</th>
          <th className={`${thClass} text-end`}>Actions</th>
        </tr>
      </THead>
      <tbody className="divide-y">
        {payouts.map((p) => (
          <tr key={p.id}>
            <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>{fmtDay(p.requestedAt)}</td>
            <td className={tdClass}>
              {methodName(p.methodType)}
              <span className="block font-mono text-xs text-muted-foreground">{p.methodLabel}</span>
            </td>
            <td className={tdClass}>
              <StatusBadge status={p.status} />
              {p.status === "failed" && p.failureReason && <span className="mt-1 block max-w-56 text-xs text-[var(--loss)]">{p.failureReason}</span>}
            </td>
            <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>{fmtDay(p.processedAt)}</td>
            <td className={`${tdClass} text-end tabular-nums font-medium`}>{money(p.amount)}</td>
            <td className={`${tdClass} text-end`}>
              {p.status === "pending" && (
                <ConfirmButton title="Cancel this payout request?" description={`${money(p.amount)} goes back to your available balance.`} confirmLabel="Cancel request" destructive action={() => cancelPayoutRequest(p.id)}>
                  Cancel
                </ConfirmButton>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  )
}
