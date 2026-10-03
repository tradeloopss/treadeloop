"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowRight, Check, ChevronRight, Clock, Plus, Wallet } from "lucide-react"
import { RequestPayout, type RequestPayoutProps } from "@/components/affiliate/request-payout-dialog"
import { MethodMark, PayoutMethodDialog } from "@/components/affiliate/payout-method-dialog"
import type { MethodDialogConfig, MethodView } from "@/components/affiliate/payouts"
import { PAYOUT_METHOD_BLURBS, PAYOUT_METHOD_LABELS, money, type PayoutMethodType } from "@/lib/affiliates/types"
import { btnClass } from "./ui"
import { cn } from "@/lib/utils"

// The V2 Wallet and Payouts pages open the SAME Request Payout window as the
// Classic dashboard — amount, method, fee, limits and every check stay exactly
// as they are, and the server decides again when the request is made.

const inHold = (m: MethodView) => !!m.holdUntil && new Date(m.holdUntil).getTime() > Date.now()
const usable = (m: MethodView) => m.status === "active" && !inHold(m)

function OpenOnce({ open, when }: { open: () => void; when: boolean }) {
  const done = useRef(false)
  useEffect(() => {
    if (when && !done.current) {
      done.current = true
      open()
    }
  }, [when, open])
  return null
}

// "Withdraw Now →" — and, with ?withdraw=1 in the address (Quick actions,
// the dashboard), the window opens by itself.
export function WithdrawButton({ request, label = "Withdraw Now", autoOpen = false, className, showHint = true }: { request: RequestPayoutProps; label?: string; autoOpen?: boolean; className?: string; showHint?: boolean }) {
  return (
    <RequestPayout
      {...request}
      trigger={(open, hint) => (
        <div className="flex flex-col gap-1.5">
          <button type="button" onClick={() => open()} className={cn(btnClass, "h-11 px-5", className)}>
            {label} <ArrowRight className="size-4" aria-hidden />
          </button>
          {showHint && hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          <OpenOnce open={open} when={autoOpen} />
        </div>
      )}
    />
  )
}

// The payout methods the program offers, as cards. One the affiliate already
// has (and can be paid to) opens the withdrawal with it; one they don't have
// opens "Add payout method" on that type.
export function PaymentMethodsGrid({ request, offered, methods, config }: { request: RequestPayoutProps; offered: PayoutMethodType[]; methods: MethodView[]; config: MethodDialogConfig }) {
  const [adding, setAdding] = useState<PayoutMethodType | null>(null)
  return (
    <>
      <RequestPayout
        {...request}
        trigger={(open) => (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {offered.map((type) => {
              const mine = methods.filter((m) => m.type === type && m.status !== "removed" && m.status !== "rejected")
              const ready = mine.find(usable)
              const held = mine.find((m) => m.status === "active" && inHold(m))
              const blurb = PAYOUT_METHOD_BLURBS[type]
              return (
                <li key={type}>
                  <button
                    type="button"
                    onClick={() => (ready ? open(ready.id) : mine.length ? open() : setAdding(type))}
                    className="v2-card group flex h-full w-full items-center gap-3 p-4 text-start transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                  >
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-background/60">
                      <MethodMark type={type} className="size-7" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{PAYOUT_METHOD_LABELS[type].replace("Crypto — ", "")}</span>
                      <span className="block truncate text-xs text-muted-foreground">{ready ? ready.nickname || ready.label : held ? "In its security hold" : mine.length ? "Waiting for verification" : blurb.timing}</span>
                      <span className={cn("mt-1 inline-flex items-center gap-1 text-[11px] font-medium", ready ? "text-gain" : "text-muted-foreground")}>
                        {ready ? <Check className="size-3" aria-hidden /> : mine.length ? <Clock className="size-3" aria-hidden /> : <Plus className="size-3" aria-hidden />}
                        {ready ? "Ready to withdraw" : mine.length ? "Added" : "Add method"}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </button>
                </li>
              )
            })}
            {offered.length === 0 && <li className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground sm:col-span-2 xl:col-span-4">No payout methods are offered right now.</li>}
          </ul>
        )}
      />
      {adding && <PayoutMethodDialog key={adding} open onOpenChange={(o) => !o && setAdding(null)} {...config} methods={[adding, ...config.methods.filter((m) => m !== adding)]} />}
    </>
  )
}

export function BalanceHero({ request, available, pending, lifetime, processing, autoOpen }: { request: RequestPayoutProps; available: number; pending: number; lifetime: number; processing: number; autoOpen: boolean }) {
  const rows: [string, number][] = [
    ["Available balance", available],
    ["Pending", pending],
    ["Lifetime earnings", lifetime],
  ]
  return (
    <section className="v2-card-glow relative overflow-hidden p-5 sm:p-6">
      <div aria-hidden className="pointer-events-none absolute -end-16 -top-16 size-56 rounded-full bg-[radial-gradient(circle,rgb(139_92_246/0.35),transparent_70%)]" />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <span className="v2-icon flex size-14 shrink-0 items-center justify-center rounded-2xl" aria-hidden>
            <Wallet className="size-7" />
          </span>
          <div>
            <p className="text-sm text-muted-foreground">Total balance</p>
            <p className="text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">{money(available + pending)}</p>
            {processing > 0 && <p className="text-xs text-muted-foreground">{money(processing)} on its way to you</p>}
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-3 sm:gap-6">
          {rows.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="truncate text-[11px] text-muted-foreground sm:text-xs">{label}</dt>
              <dd className="truncate text-base font-semibold tabular-nums sm:text-lg">{money(value)}</dd>
            </div>
          ))}
        </dl>
        <WithdrawButton request={request} autoOpen={autoOpen} />
      </div>
    </section>
  )
}
