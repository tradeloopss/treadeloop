"use client"

import { useEffect, useState } from "react"
import { ChevronRight, Loader2, Pencil, Plus, ShieldAlert, Star, Trash2, Wallet, Zap } from "lucide-react"
import { toast } from "sonner"
import { connectStripe, deletePayoutMethod, makeDefaultPayoutMethod, renamePayoutMethod, togglePayoutMethod } from "@/app/actions/affiliate"
import { MethodMark, PayoutMethodDialog } from "@/components/affiliate/payout-method-dialog"
import type { MethodDialogConfig, MethodView } from "@/components/affiliate/payouts"
import { useAction } from "@/components/affiliate/use-action"
import { cryptoSpec } from "@/lib/affiliates/crypto"
import { describeMethod, fmtWhen, inHold } from "@/lib/affiliates/payout-form"
import { methodLabel } from "@/lib/affiliates/types"
import { cn } from "@/lib/utils"
import { DetailRows, Sheet, sheetBtn, sheetBtnDanger, sheetBtnQuiet } from "./sheet"
import { EmptyState, StatusChip, fmtDate } from "./ui"

// Saved payout methods — where a payout is sent. Adding, renaming, choosing the
// default and removing all happen here (the Wallet); the Payout page only picks
// one. The destination itself is only ever shown masked: the full account or
// address never reaches the browser.

// The state a method is in, in the words the affiliate needs.
export function methodState(m: MethodView): { status: string; text: string } {
  if (m.status === "active") return inHold(m) ? { status: "pending", text: "Security hold" } : { status: "active", text: "Active" }
  if (m.status === "pending_verification" || m.status === "verification_required") return { status: "pending", text: "Verifying" }
  if (m.status === "rejected") return { status: "rejected", text: "Rejected" }
  return { status: "disabled", text: "Disabled" }
}

export function DefaultBadge({ className }: { className?: string }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-full border border-primary/30 bg-primary/12 px-2 py-0.5 text-[11px] font-semibold text-primary", className)}>Default</span>
}

// Logo, name, masked destination — the way a method looks in every list.
export function MethodSummary({ method, showState = false, className }: { method: MethodView; showState?: boolean; className?: string }) {
  const d = describeMethod(method)
  const state = methodState(method)
  return (
    <span className={cn("flex min-w-0 flex-1 items-center gap-3", className)}>
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-background/60">
        <MethodMark type={method.type} className="size-7" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{d.name}</span>
          {method.isDefault && <DefaultBadge />}
        </span>
        <span className="block truncate font-mono text-xs text-muted-foreground">{d.detail}</span>
      </span>
      {(showState || state.status !== "active") && <StatusChip status={state.status} label={state.text} className="normal-case" />}
    </span>
  )
}

type View = "details" | "edit" | "delete"

export function MethodManager({ methods, config, autoPayoutOn, openId = null }: { methods: MethodView[]; config: MethodDialogConfig; autoPayoutOn: boolean; openId?: number | null }) {
  const [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState<number | null>(openId)
  const [view, setView] = useState<View>("details")
  const [name, setName] = useState("")
  const [redirecting, setRedirecting] = useState(false)
  const { pending, run } = useAction()
  const method = methods.find((m) => m.id === selected) ?? null

  // A method opened from the Wallet (?m=12) that has since been removed: nothing to show.
  useEffect(() => {
    if (selected != null && !methods.some((m) => m.id === selected)) setSelected(null)
  }, [methods, selected])

  const open = (id: number) => {
    setView("details")
    setSelected(id)
  }
  const close = () => {
    if (pending) return
    setSelected(null)
    setView("details")
  }
  async function verify() {
    setRedirecting(true)
    const res = await connectStripe()
    if (res.ok) window.location.href = res.url
    else {
      setRedirecting(false)
      toast.error(res.error)
    }
  }

  const coin = cryptoSpec(method?.type)
  const state = method ? methodState(method) : null
  const held = !!method && method.status === "active" && inHold(method)
  const others = methods.filter((m) => m.id !== method?.id && m.status === "active").length

  return (
    <>
      {methods.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No payout methods yet"
          action={
            config.methods.length > 0 ? (
              <button type="button" onClick={() => setAdding(true)} className="v2-btn inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold">
                <Plus className="size-4" aria-hidden /> Add Payout Method
              </button>
            ) : undefined
          }
        >
          Add a payout method to receive your earnings.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {methods.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => open(m.id)} className="v2-card group flex w-full items-center gap-2 p-3.5 text-start transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none active:scale-[0.995] sm:p-4" aria-label={`${describeMethod(m).name}, ${m.label}: manage`}>
                <MethodSummary method={m} showState />
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {methods.length > 0 && config.methods.length > 0 && (
        <button type="button" onClick={() => setAdding(true)} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/45 text-sm font-semibold text-primary transition-colors hover:bg-primary/[0.07] focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
          <Plus className="size-4" aria-hidden /> Add Payout Method
        </button>
      )}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldAlert className="mt-px size-3.5 shrink-0" aria-hidden />
        Adding a method only saves where your payouts go — it never sends money.{config.holdHours > 0 ? ` A new method can be paid to after a ${config.holdHours}-hour security hold.` : ""}
      </p>

      <PayoutMethodDialog open={adding} onOpenChange={setAdding} {...config} />

      <Sheet
        open={!!method}
        onOpenChange={(next) => !next && close()}
        locked={pending}
        title={view === "edit" ? "Edit Payout Method" : view === "delete" ? "Delete this payout method?" : "Payout Method"}
        description={view === "edit" ? "You can change the label." : view === "delete" ? "This can't be undone." : "Details, default and removal."}
        footer={
          !method ? undefined : view === "edit" ? (
            <>
              <button type="button" className={sheetBtnQuiet} onClick={() => setView("details")} disabled={pending}>
                Cancel
              </button>
              <button type="submit" form="v2-method-rename" className={cn(sheetBtn, "v2-btn")} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null} {pending ? "Saving…" : "Save"}
              </button>
            </>
          ) : view === "delete" ? (
            <>
              <button type="button" className={sheetBtnQuiet} onClick={() => setView("details")} disabled={pending}>
                Keep Method
              </button>
              <button
                type="button"
                className={sheetBtnDanger}
                disabled={pending}
                onClick={() =>
                  run(
                    () => deletePayoutMethod(method.id),
                    () => {
                      setSelected(null)
                      setView("details")
                    }
                  )
                }
              >
                {pending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Trash2 className="size-4" aria-hidden />} {pending ? "Deleting…" : "Delete Method"}
              </button>
            </>
          ) : undefined
        }
      >
        {method && view === "details" && (
          <>
            <div className="flex items-center gap-3 rounded-2xl border bg-background/40 p-3.5">
              <MethodSummary method={method} showState />
            </div>
            <DetailRows
              rows={[
                { label: "Type", value: coin ? coin.assetName : methodLabel(method.type) },
                coin && { label: "Network", value: coin.networkLabel },
                { label: coin ? "Address" : "Account", value: <span className="font-mono">{method.label}</span> },
                method.metadata?.country && { label: "Country", value: config.countries.find((c) => c.code === method.metadata!.country)?.name ?? method.metadata.country },
                !coin && method.metadata?.currency && { label: "Currency", value: method.metadata.currency },
                { label: "Status", value: <StatusChip status={state!.status} label={state!.text} className="normal-case" /> },
                method.createdAt && { label: "Added", value: fmtDate(method.createdAt) },
                method.isDefault && {
                  label: "Automatic payouts",
                  value: (
                    <span className="inline-flex items-center gap-1">
                      <Zap className="size-3.5 text-primary" aria-hidden /> {autoPayoutOn ? "On" : "Off"}
                    </span>
                  ),
                },
              ]}
            />
            {held && <p className="rounded-xl border border-warning/30 bg-warning/[0.08] px-3.5 py-2.5 text-[13px]">Security hold — this method can be paid to from {fmtWhen(method.holdUntil!)}.</p>}
            {method.status === "rejected" && <p className="rounded-xl border border-loss/30 bg-loss/[0.06] px-3.5 py-2.5 text-[13px] text-loss">This method was rejected and can&apos;t be used. Contact affiliate support.</p>}
            <div className="flex flex-col gap-2">
              {method.status === "active" && !method.isDefault && (
                <button type="button" className={cn(sheetBtn, "v2-btn flex-none")} disabled={pending} onClick={() => run(() => makeDefaultPayoutMethod(method.id))}>
                  {pending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Star className="size-4" aria-hidden />} Set as Default
                </button>
              )}
              {(method.status === "pending_verification" || method.status === "verification_required") && method.type === "stripe" && (
                <button type="button" className={cn(sheetBtn, "v2-btn flex-none")} disabled={redirecting} onClick={verify}>
                  {redirecting ? "Opening Stripe…" : "Verify with Stripe"}
                </button>
              )}
              <button
                type="button"
                className={cn(sheetBtnQuiet, "flex-none")}
                disabled={pending}
                onClick={() => {
                  setName(method.nickname ?? "")
                  setView("edit")
                }}
              >
                <Pencil className="size-4" aria-hidden /> Edit Label
              </button>
              {method.status === "active" && (
                <button type="button" className={cn(sheetBtnQuiet, "flex-none")} disabled={pending} onClick={() => run(() => togglePayoutMethod(method.id, false))}>
                  Disable
                </button>
              )}
              {method.status === "disabled" && (
                <button type="button" className={cn(sheetBtnQuiet, "flex-none")} disabled={pending} onClick={() => run(() => togglePayoutMethod(method.id, true))}>
                  Enable
                </button>
              )}
              <button type="button" className={cn(sheetBtn, "flex-none border border-loss/35 text-loss hover:bg-loss/[0.07]")} disabled={pending} onClick={() => setView("delete")}>
                <Trash2 className="size-4" aria-hidden /> Delete Method
              </button>
            </div>
            {method.status === "active" && <p className="text-xs text-muted-foreground">A disabled method stays on file but isn&apos;t paid to. Enabling it again doesn&apos;t restart a security hold.</p>}
          </>
        )}

        {method && view === "edit" && (
          <form
            id="v2-method-rename"
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              run(() => renamePayoutMethod(method.id, name), () => setView("details"))
            }}
          >
            <label className="flex flex-col gap-1.5 text-xs font-medium">
              Label
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={coin ? coin.defaultNickname : methodLabel(method.type)} autoFocus className="h-12 rounded-xl border border-input bg-background px-3.5 text-sm font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40" />
            </label>
            <p className="rounded-xl bg-muted/50 px-3.5 py-2.5 font-mono text-xs text-muted-foreground">{method.label}</p>
            <p className="text-xs text-muted-foreground">To change where the money goes, add a new method — for your security the account itself can&apos;t be edited in place.</p>
          </form>
        )}

        {method && view === "delete" && (
          <>
            <div className="flex items-center gap-3 rounded-2xl border bg-background/40 p-3.5">
              <MethodSummary method={method} />
            </div>
            {method.isDefault && (
              <p role="alert" className="flex gap-2.5 rounded-xl border border-warning/35 bg-warning/[0.08] px-3.5 py-3 text-[13px] leading-relaxed">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <span>
                  <span className="font-semibold">This is your default method.</span> {others > 0 ? "Another active method becomes the default, and automatic payouts go there." : "You won't have an active payout method left, so automatic payouts stop until you add one."}
                </span>
              </p>
            )}
            <p className="text-sm text-muted-foreground">Payouts already made keep their record. Adding this method again later starts a new security hold.</p>
          </>
        )}
      </Sheet>
    </>
  )
}
