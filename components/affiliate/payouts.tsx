"use client"

import { useState } from "react"
import { Banknote, ExternalLink, Plus, Wallet, Zap } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cancelPayoutRequest, connectStripe, deletePayoutMethod, makeDefaultPayoutMethod, renamePayoutMethod, saveAutoPayout, submitPayoutRequest, togglePayoutMethod } from "@/app/actions/affiliate"
import { DEFAULT_PAYOUT_SETTINGS, PAYOUT_STATUS_LABELS, affiliateCanCancel, quoteFee, type FeeRule, type PayoutStatus } from "@/lib/affiliates/payout-engine"
import { cryptoSpec, cryptoSpecByNetwork, explorerTxUrl, formatAsset } from "@/lib/affiliates/crypto"
import { maskTxHash } from "@/lib/affiliates/tron"
import { methodLabel, money, type PayoutMethodType } from "@/lib/affiliates/types"
import { ConfirmButton } from "./confirm"
import { MethodMark, PayoutMethodDialog } from "./payout-method-dialog"
import { Empty, StatusBadge, TableShell, THead, fmtDay, selectClass, tdClass, thClass } from "./ui"
import { useAction } from "./use-action"

export type MethodView = { id: number; type: string; label: string; nickname: string | null; status: string; isDefault: boolean; holdUntil: string | null; metadata: Record<string, string> | null }
export type PayoutView = { id: number; amount: number; fee: number; net: number; methodType: string; methodLabel: string; status: string; mode: string; network: string | null; asset: string | null; transactionHash: string | null; failureReason: string | null; requestedAt: string; completedAt: string | null }
// What the Add Payout Method window needs, passed down from the page.
export type MethodDialogConfig = { methods: PayoutMethodType[]; countries: { code: string; name: string }[]; defaultCountry: string; holdHours: number; hasMethod: boolean }

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "")
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
const inHold = (m: MethodView) => !!m.holdUntil && new Date(m.holdUntil).getTime() > Date.now()
const usable = (m: MethodView) => m.status === "active" && !inHold(m)

// --- Add payout method ------------------------------------------------------

export function AddPayoutMethodButton({ config, variant = "default", label = "Add Payout Method" }: { config: MethodDialogConfig; variant?: "default" | "outline"; label?: string }) {
  const [open, setOpen] = useState(false)
  if (config.methods.length === 0) return null
  return (
    <>
      <Button variant={variant} size="lg" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> {label}
      </Button>
      <PayoutMethodDialog open={open} onOpenChange={setOpen} {...config} />
    </>
  )
}

// --- Saved methods ----------------------------------------------------------

function RenameButton({ method }: { method: MethodView }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(method.nickname ?? "")
  const { pending, run } = useAction()
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => (setName(method.nickname ?? ""), setOpen(true))}>
        Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              run(() => renamePayoutMethod(method.id, name), () => setOpen(false))
            }}
          >
            <DialogHeader>
              <DialogTitle>Edit payout method</DialogTitle>
              <DialogDescription>
                You can change the label. To change where the money goes, add a new method — for your security the account itself can&apos;t be edited in place.
              </DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Label
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={methodLabel(method.type)} autoFocus />
            </label>
            <p className="rounded-lg bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">{method.label}</p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function VerifyButton() {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        const res = await connectStripe()
        if (res.ok) window.location.href = res.url
        else {
          setBusy(false)
          toast.error(res.error)
        }
      }}
    >
      {busy ? "Opening Stripe…" : "Verify"}
    </Button>
  )
}

export function MethodCards({ methods, config, autoPayoutOn }: { methods: MethodView[]; config: MethodDialogConfig; autoPayoutOn: boolean }) {
  const { pending, run } = useAction()
  if (methods.length === 0) {
    return (
      <div className="rounded-xl border bg-card">
        <Empty icon={Wallet} title="No payout methods yet." action={<AddPayoutMethodButton config={config} />}>
          Add a payout method to start receiving your affiliate earnings.
        </Empty>
      </div>
    )
  }
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {methods.map((m) => (
        <li key={m.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <div className="flex items-start gap-3">
            <MethodMark type={m.type} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{m.nickname || methodLabel(m.type)}</p>
              {m.nickname && <p className="text-xs text-muted-foreground">{methodLabel(m.type)}</p>}
              {/* Only ever the masked form: TXYZ…8291, a•••@example.com */}
              <p className="truncate font-mono text-xs text-muted-foreground">{m.label}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <StatusBadge status={m.status} />
              {m.isDefault && <span className="rounded-full bg-primary/12 px-2 py-0.5 text-xs font-medium text-primary">Default</span>}
            </div>
          </div>
          {(m.isDefault || inHold(m) || m.status === "rejected") && (
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              {m.isDefault && (
                <p className="flex items-center gap-1.5">
                  <Zap className="size-3.5" aria-hidden /> Automatic payouts: <span className="font-medium text-foreground">{autoPayoutOn ? "ON" : "OFF"}</span>
                </p>
              )}
              {inHold(m) && <p className="text-[var(--chart-4)]">Security hold — can be paid to from {fmtWhen(m.holdUntil!)}.</p>}
              {m.status === "rejected" && <p className="text-[var(--loss)]">This method was rejected and can&apos;t be used. Contact affiliate support.</p>}
            </div>
          )}
          <div className="mt-auto flex flex-wrap gap-1.5 border-t pt-3">
            {m.status === "active" && !m.isDefault && (
              <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => makeDefaultPayoutMethod(m.id))}>
                Set as default
              </Button>
            )}
            <RenameButton method={m} />
            {(m.status === "pending_verification" || m.status === "verification_required") && m.type === "stripe" && <VerifyButton />}
            {m.status === "active" && (
              <ConfirmButton title="Disable this payout method?" description="It stays on file but isn't paid to. You can enable it again any time — that doesn't restart a security hold." confirmLabel="Disable" action={() => togglePayoutMethod(m.id, false)}>
                Disable
              </ConfirmButton>
            )}
            {m.status === "disabled" && (
              <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => togglePayoutMethod(m.id, true))}>
                Enable
              </Button>
            )}
            <ConfirmButton variant="ghost" title="Remove this payout method?" description="Payouts already made keep their record. Adding it again later starts a new security hold." confirmLabel="Remove" destructive action={() => deletePayoutMethod(m.id)}>
              Remove
            </ConfirmButton>
          </div>
        </li>
      ))}
    </ul>
  )
}

// --- Automatic payouts ------------------------------------------------------

export type AutoPayoutView = {
  enabled: boolean // the affiliate's own switch
  allowed: boolean // not disabled by an admin
  programOn: boolean
  paused: boolean
  threshold: number
  min: number
  max: number | null
  frequency: string
  method: { type: string; label: string } | null
  // one line: what happens next, or why nothing will
  status: string
  ready: boolean
}

export function AutoPayoutPanel({ auto }: { auto: AutoPayoutView }) {
  const [threshold, setThreshold] = useState(String(auto.threshold))
  const { pending, run } = useAction()
  const value = Number(threshold)
  const problem = !threshold ? null : !Number.isFinite(value) || value < auto.min ? `The threshold can't be below ${money(auto.min)}.` : auto.max != null && value > auto.max ? `The threshold can't be above ${money(auto.max)}.` : null
  const locked = !auto.allowed

  return (
    <section className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            Automatic Payouts
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${auto.enabled && auto.allowed ? "bg-[var(--gain)]/12 text-[var(--gain)]" : "bg-muted text-muted-foreground"}`}>{auto.enabled && auto.allowed ? "ON" : "OFF"}</span>
          </h2>
          <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">Automatically send eligible earnings when your available balance reaches the payout threshold.</p>
        </div>
        {auto.enabled ? (
          <ConfirmButton title="Switch automatic payouts off?" description="No payout will be created automatically. Your balance stays available and you can still request payouts yourself." confirmLabel="Switch off" action={() => saveAutoPayout({ enabled: false, threshold: value || null })}>
            Switch off
          </ConfirmButton>
        ) : (
          <Button disabled={pending || locked || !auto.method || !!problem} title={locked ? "Disabled for your account" : !auto.method ? "Add a default payout method first" : undefined} onClick={() => run(() => saveAutoPayout({ enabled: true, threshold: threshold ? value : null }))}>
            Switch on
          </Button>
        )}
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          Minimum payout (your threshold)
          <div className="flex gap-2">
            <Input type="number" inputMode="decimal" min={auto.min} max={auto.max ?? undefined} step="0.01" value={threshold} onChange={(e) => setThreshold(e.target.value)} disabled={locked} aria-invalid={!!problem} />
            <Button variant="outline" disabled={pending || locked || !!problem || !threshold || value === auto.threshold} onClick={() => run(() => saveAutoPayout({ enabled: auto.enabled, threshold: value }))}>
              Save
            </Button>
          </div>
          <span className={problem ? "text-[var(--loss)]" : undefined}>{problem ?? `From ${money(auto.min)}${auto.max != null ? ` to ${money(auto.max)} per payout` : ""}`}</span>
        </label>
        <div className="text-xs text-muted-foreground">
          Payout method
          <p className="mt-1.5 text-sm font-medium text-foreground">{auto.method ? methodLabel(auto.method.type) : "None"}</p>
          <p className="font-mono">{auto.method?.label ?? "Add one and make it the default"}</p>
        </div>
        <div className="text-xs text-muted-foreground">
          Frequency
          <p className="mt-1.5 text-sm font-medium text-foreground">{auto.frequency}</p>
          <p>Set by the program</p>
        </div>
        <div className="text-xs text-muted-foreground">
          Next eligible payout
          <p className={`mt-1.5 text-sm font-medium ${auto.ready ? "text-[var(--gain)]" : "text-foreground"}`}>{auto.status}</p>
        </div>
      </div>
      {(locked || auto.paused || !auto.programOn) && (
        <p className="border-t px-5 py-3 text-xs text-[var(--chart-4)]">
          {locked ? "Automatic payouts have been switched off for your account by our team. Your balance and payout methods are unaffected, and you can still request payouts yourself. Contact affiliate support if you have questions." : auto.paused ? "All payouts are temporarily paused by our team. Nothing is lost — your balance stays available." : "Automatic payouts aren't running for the program right now. Your setting is saved and takes effect when they resume."}
        </p>
      )}
    </section>
  )
}

// --- Request a payout -------------------------------------------------------

// instantUpTo: the most a crypto payout can be for it to be sent automatically (null when that isn't on).
// instantTypes: the crypto methods something is set up to send automatically.
// prices: the market price in USD of assets that aren't dollar-pegged, when known — for an estimate only.
export function RequestPayout({ available, min, max, methods, blocked, eta, feePolicy, fees, approval, instantUpTo = null, instantTypes = ["crypto_trc20"], prices = {} }: { available: number; min: number; max: number | null; methods: MethodView[]; blocked: string | null; eta: string; feePolicy: "platform" | "affiliate"; fees: Record<string, FeeRule>; approval: "manual" | "automatic"; instantUpTo?: number | null; instantTypes?: string[]; prices?: Record<string, number> }) {
  const ready = methods.filter(usable)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState("")
  const [methodId, setMethodId] = useState("")
  // One key per opening of the dialog: submitting twice can't pay twice.
  const [key, setKey] = useState("")
  const { pending, run } = useAction()
  const most = Math.min(available, max ?? Infinity)
  const value = Number(amount)
  const problem = !amount ? null : !Number.isFinite(value) || value <= 0 ? "Enter an amount." : Math.round(value * 100) / 100 !== value ? "Use at most two decimal places." : value < min ? `The minimum payout is ${money(min)}.` : max != null && value > max ? `The most you can withdraw in one payout is ${money(max)}.` : value > available ? "That's more than your available balance." : null
  const waiting = methods.find((m) => m.status === "active" && inHold(m))
  const reason = blocked ?? (methods.length === 0 ? "Add a payout method first." : ready.length === 0 ? (waiting ? `Your payout method is in its security hold until ${fmtWhen(waiting.holdUntil!)}.` : "You don't have an active payout method.") : available < min ? `You need at least ${money(min)} available to request a payout.` : null)
  const method = ready.find((m) => String(m.id) === methodId)
  // The same quote the server computes and stores — shown before anything is sent.
  const quote = method && amount && !problem ? quoteFee(value, method.type, { ...DEFAULT_PAYOUT_SETTINGS, feePolicy, fees: fees as typeof DEFAULT_PAYOUT_SETTINGS.fees }) : null
  const coin = cryptoSpec(method?.type)
  // A crypto payout inside the limit is normally sent without waiting for review.
  const automatic = instantUpTo != null && !!coin && instantTypes.includes(coin.type)
  const instant = automatic && !(quote && quote.net > instantUpTo)
  const price = coin && !coin.usdPegged ? prices[coin.asset] : undefined

  return (
    <>
      <Button
        size="lg"
        disabled={!!reason}
        title={reason ?? undefined}
        onClick={() => {
          setAmount((Math.floor(most * 100) / 100).toFixed(2))
          setMethodId(String((ready.find((m) => m.isDefault) ?? ready[0])?.id ?? ""))
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
              run(() => submitPayoutRequest({ amount: value, methodId: Number(methodId), key }), () => setOpen(false))
            }}
          >
            <DialogHeader>
              <DialogTitle>Request a payout</DialogTitle>
              <DialogDescription>
                {money(available)} available.{instant ? "" : ` ${approval === "manual" ? "Each request is reviewed by our team before it's sent" : "Requests go straight to the payout queue"} — usually ${eta}.`}
              </DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Amount (USD)
              <div className="flex gap-2">
                <Input type="number" inputMode="decimal" min={min} max={most} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!problem} required autoFocus />
                <Button type="button" variant="outline" onClick={() => setAmount((Math.floor(most * 100) / 100).toFixed(2))}>
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
                {ready.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nickname || methodLabel(m.type)} — {m.label}
                  </option>
                ))}
              </select>
            </label>
            {quote && (
              <dl className="divide-y rounded-lg border text-sm">
                <div className="flex justify-between px-3 py-2">
                  <dt className="text-muted-foreground">Amount</dt>
                  <dd className="tabular-nums">{money(quote.amount)}</dd>
                </div>
                <div className="flex justify-between px-3 py-2">
                  <dt className="text-muted-foreground">Fee{quote.estimated ? " (estimated)" : ""}</dt>
                  <dd className="tabular-nums">{quote.fee > 0 ? `− ${money(quote.fee)}` : "None"}</dd>
                </div>
                <div className="flex justify-between px-3 py-2 font-medium">
                  <dt>You receive{coin ? (coin.usdPegged ? ` (${coin.asset}, ${coin.standard})` : ` (in ${coin.asset})`) : ""}</dt>
                  <dd className="tabular-nums">{money(quote.net)}</dd>
                </div>
                {coin && !coin.usdPegged && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    {price ? `About ${formatAsset(quote.net / price, coin.asset, 6)} at the current price. ` : ""}The exact amount of {coin.asset} is set by the market price at the moment the payout is sent.
                  </div>
                )}
              </dl>
            )}
            {automatic && coin && instantUpTo != null && (
              <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                {!instant
                  ? `${coin.assetName} payouts above ${money(instantUpTo)} are reviewed by our team before they're sent.`
                  : `${coin.assetName} payouts up to ${money(instantUpTo)} are normally sent to your wallet automatically, within minutes. Check the address — a transfer on the ${coin.networkLabel} network can't be reversed.`}
              </p>
            )}
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

// --- History ----------------------------------------------------------------

export function PayoutHistory({ payouts }: { payouts: PayoutView[] }) {
  if (payouts.length === 0) {
    return (
      <div className="rounded-xl border bg-card">
        <Empty icon={Banknote} title="No payouts yet">
          Once you request one — or an automatic payout is created — you can follow it here from requested to completed.
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
        {payouts.map((p) => {
          const link = explorerTxUrl(p.network, p.transactionHash)
          return (
            <tr key={p.id}>
              <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>
                {fmtDay(p.requestedAt)}
                {p.mode === "automatic" && <span className="block text-xs">Automatic</span>}
              </td>
              <td className={tdClass}>
                {methodLabel(p.methodType)}
                <span className="block font-mono text-xs text-muted-foreground">{p.methodLabel}</span>
              </td>
              <td className={tdClass}>
                <StatusBadge status={p.status} label={PAYOUT_STATUS_LABELS[p.status as PayoutStatus]} />
                {p.transactionHash && (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Transaction:{" "}
                    {link ? (
                      <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-primary hover:underline">
                        {maskTxHash(p.transactionHash)} <ExternalLink className="size-3" aria-hidden />
                      </a>
                    ) : (
                      <span className="font-mono">{maskTxHash(p.transactionHash)}</span>
                    )}
                  </span>
                )}
                {["failed", "rejected", "reversed", "retry_required"].includes(p.status) && p.failureReason && p.status !== "retry_required" && <span className="mt-1 block max-w-56 text-xs text-[var(--loss)]">{p.failureReason}</span>}
              </td>
              <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>{fmtDay(p.completedAt)}</td>
              <td className={`${tdClass} text-end tabular-nums font-medium`}>
                {money(p.amount)}
                {p.fee > 0 && (
                  <span className="block text-xs font-normal text-muted-foreground">
                    − {money(p.fee)} fee = {money(p.net)}
                  </span>
                )}
                {p.asset && <span className="block text-xs font-normal text-muted-foreground">{cryptoSpecByNetwork(p.network)?.summary ?? p.asset}</span>}
              </td>
              <td className={`${tdClass} text-end`}>
                {affiliateCanCancel(p.status) && (
                  <ConfirmButton title="Cancel this payout request?" description={`${money(p.amount)} goes back to your available balance.`} confirmLabel="Cancel request" destructive action={() => cancelPayoutRequest(p.id)}>
                    Cancel
                  </ConfirmButton>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </TableShell>
  )
}
