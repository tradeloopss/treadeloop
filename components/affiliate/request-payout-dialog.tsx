"use client"

import { useId, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Banknote, Check, ChevronDown, CircleCheck, Hourglass, Info, Loader2, Plus, Send, ShieldCheck, TriangleAlert, Wallet } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { requestPayoutNow, type RequestedPayout } from "@/app/actions/affiliate"
import { cryptoSpec, formatAsset } from "@/lib/affiliates/crypto"
import { DEFAULT_PAYOUT_SETTINGS, PAYOUT_STATUS_LABELS, quoteFee, type FeeRule, type PayoutStatus } from "@/lib/affiliates/payout-engine"
import { cents, cleanAmount, describeMethod, fmtWhen, inHold, methodUnavailable, newKey, quickAmounts, readAmount, usable } from "@/lib/affiliates/payout-form"
import { methodLabel, money } from "@/lib/affiliates/types"
import { CodeField, useActionCode } from "./action-code"
import { MethodMark, PayoutMethodDialog } from "./payout-method-dialog"
import type { MethodDialogConfig, MethodView } from "./payouts"
import { StatusBadge } from "./ui"

type Tone = "warning" | "danger" | "info"
const TONES: Record<Tone, string> = { warning: "border-[var(--chart-4)]/35 bg-[var(--chart-4)]/8 text-[var(--chart-4)]", danger: "border-[var(--loss)]/30 bg-[var(--loss)]/8 text-[var(--loss)]", info: "border-border bg-muted/50 text-muted-foreground" }

function Callout({ tone, icon: Icon, title, children, action }: { tone: Tone; icon: typeof Info; title?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div role={tone === "info" ? undefined : "alert"} className={cn("flex gap-2.5 rounded-lg border px-3 py-2.5", TONES[tone])}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        <div className={cn(tone !== "info" && "text-foreground/85")}>{children}</div>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  )
}

// --- Destination picker ---------------------------------------------------------

function MethodPicker({ methods, selected, onSelect, onAdd, canAdd, labelId, mins }: { methods: MethodView[]; selected: MethodView | null; onSelect: (id: number) => void; onAdd: () => void; canAdd: boolean; labelId: string; mins: Record<string, MethodMin> }) {
  const [open, setOpen] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  // Arrow keys move between the choices, as in any list box.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])]
    if (!items.length) return
    e.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length
    items[next].focus()
  }
  const shown = selected ? describeMethod(selected) : null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        className="flex h-14 w-full items-center gap-3 rounded-lg border border-input bg-background px-3 text-start outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 data-popup-open:border-ring data-popup-open:ring-3 data-popup-open:ring-ring/40"
      >
        {selected && shown ? (
          <>
            <MethodMark type={selected.type} className="size-8" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{shown.name}</span>
              <span className="block truncate font-mono text-xs text-muted-foreground">{shown.detail}</span>
            </span>
          </>
        ) : (
          <span className="flex-1 text-sm text-muted-foreground">Choose a payout method</span>
        )}
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-64 gap-0 p-1.5">
        <p className="px-2 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Payout method</p>
        <div ref={list} role="listbox" aria-labelledby={labelId} onKeyDown={onKeyDown} className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
          {methods.map((m) => {
            const d = describeMethod(m)
            const ok = usable(m)
            const why = methodUnavailable(m)
            const isSelected = selected?.id === m.id
            return (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={!ok}
                onClick={() => (onSelect(m.id), setOpen(false))}
                className={cn("flex w-full items-center gap-3 rounded-md px-2 py-2 text-start outline-none transition-colors", ok ? "hover:bg-muted focus-visible:bg-muted" : "cursor-not-allowed opacity-60", isSelected && "bg-primary/8")}
              >
                <MethodMark type={m.type} className="size-8" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{d.name}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">{d.detail}</span>
                  {mins[m.type] && <span className="block text-xs text-muted-foreground">Minimum {mins[m.type].text}</span>}
                  {why && <span className="block text-xs text-[var(--chart-4)]">{why}</span>}
                </span>
                {isSelected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
              </button>
            )
          })}
        </div>
        {canAdd && (
          <button type="button" onClick={() => (setOpen(false), onAdd())} className="mt-1 flex w-full items-center gap-2 rounded-md border-t px-2 py-2.5 text-start text-sm font-medium text-primary outline-none hover:bg-muted focus-visible:bg-muted">
            <Plus className="size-4" aria-hidden /> Add payout method
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

// --- The dialog -----------------------------------------------------------------

// A payout method's own minimum: as it is set ("5 USDT", "0.1 LTC") and in US
// dollars — null when the coin's price isn't known (the server then decides).
export type MethodMin = { text: string; usd: number | null; title: string }

export type RequestPayoutProps = {
  available: number
  // commission still inside its holding period
  pendingBalance?: number
  min: number
  max: number | null
  // by method type: the least a payout by that method can be, when it has a minimum of its own
  methodMins?: Record<string, MethodMin>
  methods: MethodView[]
  // why nothing can be requested right now (payouts paused, a hold on the
  // account, a payout already in progress…), decided by the server
  blocked: string | null
  eta: string
  feePolicy: "platform" | "affiliate"
  fees: Record<string, FeeRule>
  approval: "manual" | "automatic"
  // the most a crypto payout can be for it to be sent automatically (null when that isn't on)
  instantUpTo?: number | null
  // the crypto methods something is set up to send automatically
  instantTypes?: string[]
  // market price in USD of assets that aren't dollar-pegged, when known — for an estimate only
  prices?: Record<string, number>
  // the affiliate has automatic payouts switched on
  autoPayoutOn?: boolean
  // what the Add Payout Method window needs; without it there is no "add" shortcut
  methodConfig?: MethodDialogConfig
  // Draws whatever opens the window, in place of the standard "Request payout"
  // button and its hint (V2 Wallet: "Withdraw Now", a payment method card…).
  // `open` can preselect one of the affiliate's methods.
  trigger?: (open: (methodId?: number) => void, hint: string | null) => React.ReactNode
}

const SUCCESS_STATUS: Partial<Record<PayoutStatus, string>> = { pending: "Pending review", queued: "Queued to be sent", processing: "Being sent", submitted: "Being sent", confirming: "Being sent", paid: "Sent" }

export function RequestPayout({ available, pendingBalance = 0, min, max, methodMins = {}, methods, blocked, eta, feePolicy, fees, approval, instantUpTo = null, instantTypes = ["crypto_trc20"], prices = {}, autoPayoutOn = false, methodConfig, trigger }: RequestPayoutProps) {
  const router = useRouter()
  const ids = { amount: useId(), amountHelp: useId(), sendTo: useId() }
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [amount, setAmount] = useState("")
  const [touched, setTouched] = useState(false)
  const [methodId, setMethodId] = useState<number | null>(null)
  // methods that existed before "Add payout method" was opened from here, so the new one can be picked for them
  const [known, setKnown] = useState<number[] | null>(null)
  // One key per opening of the dialog: submitting twice can't pay twice.
  const [key, setKey] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<RequestedPayout | null>(null)
  const [pending, start] = useTransition()
  // After the form: the verification code, then the request is made.
  const [verifying, setVerifying] = useState(false)
  const codes = useActionCode()

  const live = methods.filter((m) => m.status !== "removed" && m.status !== "rejected")
  const ready = live.filter(usable)
  const most = cents(Math.min(available, max ?? Infinity))
  const fresh = known ? ready.find((m) => !known.includes(m.id)) : undefined
  const method = ready.find((m) => m.id === methodId) ?? fresh ?? ready.find((m) => m.isDefault) ?? ready[0] ?? null
  const held = live.find((m) => m.status === "active" && inHold(m))

  const belowMin = available < min
  const coin = cryptoSpec(method?.type)
  // The chosen method's own minimum counts when it is above the affiliate's.
  const floor = method ? methodMins[method.type] : undefined
  const floorBinds = !!floor && floor.usd != null && floor.usd > min
  const minNow = floorBinds ? floor.usd! : min
  const floorText = floor ? `${floor.text}${floor.usd != null && coin && !coin.usdPegged ? ` (about ${money(floor.usd)})` : ""}` : ""
  const { value, problem } = readAmount(amount, { min: minNow, max, available, minWhy: floorBinds ? `The minimum payout to ${floor.title} is ${floorText}.` : undefined })
  const valid = value != null && !problem
  // The same quote the server computes and stores — shown before anything is sent.
  const quote = method && valid ? quoteFee(value, method.type, { ...DEFAULT_PAYOUT_SETTINGS, feePolicy, fees: fees as typeof DEFAULT_PAYOUT_SETTINGS.fees }) : null
  // A crypto payout inside the limit is normally sent without waiting for review.
  const automatic = instantUpTo != null && !!coin && instantTypes.includes(coin.type)
  const instant = automatic && !(quote && quote.net > instantUpTo)
  const price = coin && !coin.usdPegged ? prices[coin.asset] : undefined
  const receive = !quote ? "—" : !coin ? money(quote.net) : coin.usdPegged ? `${quote.net.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${coin.asset}` : price ? `≈ ${formatAsset(quote.net / price, coin.asset, 6)}` : money(quote.net)

  const canSubmit = !blocked && !belowMin && !!method && valid && !pending
  // Shown under the trigger, so the page explains itself before the window is opened.
  const hint = blocked ?? (live.length === 0 ? "Add a payout method to request a payout." : ready.length === 0 ? (held ? `Your payout method is in its security hold until ${fmtWhen(held.holdUntil!)}.` : "You don't have an active payout method.") : belowMin ? `You need at least ${money(min)} available to request a payout.` : null)

  const openDialog = (preferMethodId?: number) => {
    setAmount(most >= min ? most.toFixed(2) : "")
    setTouched(false)
    setMethodId(preferMethodId != null && ready.some((m) => m.id === preferMethodId) ? preferMethodId : null)
    setKnown(null)
    setKey(newKey())
    setError(null)
    setDone(null)
    setVerifying(false)
    codes.reset()
    setOpen(true)
  }
  const onAmount = (text: string) => {
    setAmount(cleanAmount(text))
    setTouched(true)
    setError(null)
  }
  const send = (code: string | undefined) => {
    if (!method || value == null) return
    setError(null)
    start(async () => {
      try {
        const res = await requestPayoutNow({ amount: value, methodId: method.id, key, code })
        if (res.ok) {
          setDone(res.payout)
          router.refresh()
        } else {
          setError(res.error)
          codes.setCode("")
        }
      } catch {
        setError("We couldn't reach TradeLoop. Check your connection and try again — you won't be charged twice.")
      }
    })
  }
  const submit = async () => {
    setTouched(true)
    if (!canSubmit || !method || value == null) return
    if (verifying) {
      if (codes.satisfied) send(codes.value)
      return
    }
    // The form is right: now the code, asked for exactly this amount to this method.
    setError(null)
    setVerifying(true)
    const phase = await codes.request({ purpose: "payout", amount: value, methodId: method.id })
    // verification switched off: the request goes straight through
    if (phase === "off") {
      setVerifying(false)
      send(undefined)
    }
  }
  const back = () => {
    setVerifying(false)
    setError(null)
    codes.reset()
  }
  const addMethod = () => {
    setKnown(live.map((m) => m.id))
    setMethodId(null)
    setOpen(false)
    setAdding(true)
  }

  const quick = quickAmounts(most)
  const showError = touched && !!problem

  return (
    <>
      {trigger ? (
        trigger(openDialog, hint)
      ) : (
        <>
          <Button size="lg" onClick={() => openDialog()}>
            <Banknote className="size-4" aria-hidden /> Request payout
          </Button>
          {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
        </>
      )}

      <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
        {/* A sheet from the bottom on a phone, a compact centred window from sm up. */}
        <DialogContent className="top-auto bottom-0 left-0 flex max-h-[94svh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-b-none p-0 sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[min(47rem,94svh)] sm:max-w-[35rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-b-xl">
          {done ? (
            <Success payout={done} onClose={() => setOpen(false)} />
          ) : (
            <form
              className="flex min-h-0 flex-1 flex-col"
              noValidate
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              <header className="flex items-start gap-3 border-b px-5 pt-5 pb-4 pe-12">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Wallet className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <DialogTitle className="text-lg font-semibold tracking-tight">Request a payout</DialogTitle>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Manual request</span>
                  </div>
                  <DialogDescription className="mt-1 text-sm text-muted-foreground">
                    {belowMin ? (
                      <>
                        <span className="font-semibold tabular-nums text-foreground">{money(available)}</span> is available, but you need at least <span className="font-medium tabular-nums text-foreground">{money(min)}</span> to request a payout.
                      </>
                    ) : (
                      <>
                        <span className="font-semibold tabular-nums text-foreground">{money(available)}</span> is available to withdraw.
                      </>
                    )}
                    {pendingBalance > 0 && (
                      <span className="ms-1.5 inline-flex items-center gap-1 whitespace-nowrap text-xs">
                        <Hourglass className="size-3" aria-hidden /> {money(pendingBalance)} pending
                      </span>
                    )}
                  </DialogDescription>
                </div>
              </header>

              <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
                {error && (
                  <Callout tone="danger" icon={TriangleAlert} title="Unable to request payout" action={<Button type="submit" size="sm" variant="outline" disabled={pending}>Try again</Button>}>
                    {error}
                  </Callout>
                )}

                {verifying && method ? (
                  <>
                    <div className="rounded-xl border bg-muted/30">
                      <p className="px-3.5 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">You are requesting</p>
                      <dl className="px-3.5 pb-2 pt-1.5 text-sm">
                        <div className="flex items-center justify-between gap-3 py-1.5">
                          <dt className="text-muted-foreground">Amount</dt>
                          <dd className="tabular-nums">{quote ? money(quote.amount) : "—"}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-3 py-1.5">
                          <dt className="text-muted-foreground">{quote?.estimated ? "Estimated fee" : "Fee"}</dt>
                          <dd className="tabular-nums">{quote ? (quote.fee > 0 ? `− ${money(quote.fee)}` : money(0)) : "—"}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-3 py-1.5">
                          <dt className="text-muted-foreground">Send to</dt>
                          <dd className="min-w-0 truncate text-end">
                            {coin ? `${coin.asset} · ${coin.networkLabel}` : methodLabel(method.type)} · <span className="font-mono">{method.label}</span>
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-3 border-t py-2">
                          <dt className="font-semibold">You receive</dt>
                          <dd className="font-semibold tabular-nums text-[var(--gain)]">{receive}</dd>
                        </div>
                      </dl>
                    </div>
                    <CodeField flow={codes} disabled={pending} onResend={() => value != null && void codes.request({ purpose: "payout", amount: value, methodId: method.id, resend: codes.phase === "ready" })} />
                  </>
                ) : blocked ? (
                  <Callout tone="warning" icon={ShieldCheck} title="Payouts temporarily unavailable">
                    {blocked}
                  </Callout>
                ) : belowMin ? (
                  <Callout tone="info" icon={Info} title={`${money(min - available)} to go`}>
                    You need at least {money(min)} available to request a payout. Commissions become available once their holding period has passed.
                  </Callout>
                ) : (
                  <>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-baseline justify-between">
                        <label htmlFor={ids.amount} className="text-[13px] font-medium">
                          Amount
                        </label>
                        <span className="text-xs text-muted-foreground">USD</span>
                      </div>
                      <div className={cn("flex h-12 items-center rounded-lg border bg-background ps-3.5 pe-1.5 transition-shadow focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40", showError ? "border-[var(--loss)] focus-within:border-[var(--loss)] focus-within:ring-[var(--loss)]/25" : "border-input")}>
                        <span className="select-none text-lg font-semibold text-muted-foreground" aria-hidden>
                          $
                        </span>
                        <input
                          id={ids.amount}
                          value={amount}
                          onChange={(e) => onAmount(e.target.value)}
                          onBlur={() => setTouched(true)}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0.00"
                          aria-invalid={showError}
                          aria-describedby={ids.amountHelp}
                          className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-lg font-semibold tabular-nums tracking-tight outline-none placeholder:font-normal placeholder:text-muted-foreground/60"
                        />
                        <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={() => onAmount(most.toFixed(2))}>
                          Max
                        </Button>
                      </div>
                      <p id={ids.amountHelp} className={cn("text-xs", showError ? "text-[var(--loss)]" : "text-muted-foreground")} role={showError ? "alert" : undefined}>
                        {showError ? problem : `Minimum ${floorBinds ? `${floorText} for this method` : money(min)}${max != null ? ` · up to ${money(max)} per payout` : ""}`}
                      </p>
                      <div role="group" aria-label="Quick amounts" className="grid grid-cols-4 gap-2">
                        {quick.map(([name, v]) => {
                          const on = value === v && v > 0
                          return (
                            <button
                              key={name}
                              type="button"
                              aria-pressed={on}
                              disabled={v < minNow}
                              onClick={() => onAmount(v.toFixed(2))}
                              className={cn("flex flex-col items-center rounded-lg border px-1 py-1.5 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-45", on ? "border-primary bg-primary/8 text-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground")}
                            >
                              <span className="text-xs font-semibold">{name}</span>
                              <span className="text-[11px] tabular-nums">{money(v)}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <span id={ids.sendTo} className="text-[13px] font-medium">
                        Send to
                      </span>
                      {live.length === 0 ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-3.5 py-3">
                          <p className="text-sm text-muted-foreground">No payout method added.</p>
                          {methodConfig && methodConfig.methods.length > 0 && (
                            <Button type="button" size="sm" onClick={addMethod}>
                              <Plus className="size-4" aria-hidden /> Add payout method
                            </Button>
                          )}
                        </div>
                      ) : (
                        <MethodPicker methods={live} selected={method} onSelect={setMethodId} onAdd={addMethod} canAdd={!!methodConfig && methodConfig.methods.length > 0} labelId={ids.sendTo} mins={methodMins} />
                      )}
                      {floorBinds && most < minNow && (
                        <Callout tone="warning" icon={Info} title={`${floor.title} needs at least ${floor.text}`}>
                          You have {money(available)} available. A payout by this method starts at {floorText}
                          {live.length > 1 ? " — choose another method, or wait until your balance reaches it." : "."}
                        </Callout>
                      )}
                      {live.length > 0 && !method && (
                        <Callout tone="warning" icon={ShieldCheck} title={held ? "Wallet security hold" : "No active payout method"}>
                          {held ? `Your payout destination was changed recently. To protect your account it can be paid to from ${fmtWhen(held.holdUntil!)}.` : "None of your payout methods can be paid to right now. Enable one, or add another."}
                        </Callout>
                      )}
                    </div>

                    <div className="rounded-xl border bg-muted/30">
                      <p className="px-3.5 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Payout summary</p>
                      <dl className="px-3.5 pb-1 pt-1.5 text-sm">
                        <div className="flex items-center justify-between py-1.5">
                          <dt className="text-muted-foreground">Amount</dt>
                          <dd className="tabular-nums">{quote ? money(quote.amount) : "—"}</dd>
                        </div>
                        <div className="flex items-center justify-between py-1.5">
                          <dt className="text-muted-foreground">{quote?.estimated ? "Estimated fee" : "Fee"}</dt>
                          <dd className="tabular-nums">{quote ? (quote.fee > 0 ? `− ${money(quote.fee)}` : money(0)) : "—"}</dd>
                        </div>
                      </dl>
                      <div className="flex items-center justify-between gap-3 border-t px-3.5 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">You receive</p>
                          {method && (
                            <p className="truncate text-xs text-muted-foreground">
                              {coin ? `${coin.asset} · ${coin.networkLabel}` : methodLabel(method.type)} · <span className="font-mono">{method.label}</span>
                            </p>
                          )}
                        </div>
                        <p className={cn("shrink-0 text-lg font-semibold tabular-nums tracking-tight", quote ? "text-[var(--gain)]" : "text-muted-foreground")}>{receive}</p>
                      </div>
                      {coin && !coin.usdPegged && (
                        <p className="border-t px-3.5 py-2 text-xs text-muted-foreground">Your payout is {quote ? money(quote.net) : "set in US dollars"}; the exact amount of {coin.asset} follows the market price at the moment it is sent.</p>
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                      <p className="flex items-start gap-2">
                        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                        <span>
                          {instant
                            ? "Sent to your wallet automatically, usually within minutes of your request."
                            : automatic && coin && instantUpTo != null
                              ? `${coin.assetName} payouts above ${money(instantUpTo)} are reviewed before they're sent — usually ${eta}.`
                              : approval === "manual"
                                ? `Payouts are reviewed before they're sent — usually ${eta}.`
                                : `Your request goes straight to the payout queue — usually ${eta}.`}
                          {autoPayoutOn ? " This is a one-off request; your automatic payouts continue as usual." : ""}
                        </span>
                      </p>
                      {coin && (
                        <p className="flex items-start gap-2">
                          <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
                          <span>
                            Sent as {coin.asset} on {coin.networkLabel}. A transfer on this network can&apos;t be reversed — make sure the wallet above is still yours.
                          </span>
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>

              <footer className="flex shrink-0 gap-2 border-t bg-muted/40 px-5 py-3.5 sm:justify-end sm:rounded-b-xl">
                {verifying ? (
                  <Button type="button" variant="outline" size="lg" className="flex-1 sm:flex-none" onClick={back} disabled={pending}>
                    Back
                  </Button>
                ) : (
                  <Button type="button" variant="outline" size="lg" className="flex-1 sm:flex-none" onClick={() => setOpen(false)} disabled={pending}>
                    Cancel
                  </Button>
                )}
                <Button type="submit" size="lg" className="flex-[2] sm:min-w-44 sm:flex-none" disabled={!canSubmit || (verifying && !codes.satisfied)} aria-busy={pending}>
                  {pending ? (
                    <>
                      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Requesting…
                    </>
                  ) : verifying ? (
                    <>
                      <ShieldCheck className="size-4" aria-hidden /> Confirm payout
                    </>
                  ) : (
                    <>
                      <Send className="size-4" aria-hidden /> {valid ? `Request ${money(value)}` : "Request payout"}
                    </>
                  )}
                </Button>
              </footer>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {methodConfig && (
        <PayoutMethodDialog
          open={adding}
          onOpenChange={(next) => {
            setAdding(next)
            // Back to the request, with the new method picked once it arrives.
            if (!next) setOpen(true)
          }}
          {...methodConfig}
        />
      )}
    </>
  )
}

// --- After the request ----------------------------------------------------------

function Success({ payout, onClose }: { payout: RequestedPayout; onClose: () => void }) {
  const coin = cryptoSpec(payout.methodType)
  const rows: [string, React.ReactNode][] = [
    ["Payout ID", <span key="id" className="font-mono">PO-{payout.id}</span>],
    ["Amount", money(payout.amount)],
    ...(payout.fee > 0 ? ([["Fee", `− ${money(payout.fee)}`], ["You receive", money(payout.net)]] as [string, React.ReactNode][]) : []),
    ["Method", coin ? `${coin.asset} · ${coin.networkLabel}` : methodLabel(payout.methodType)],
    ["Destination", <span key="to" className="font-mono">{payout.methodLabel}</span>],
    ["Status", <StatusBadge key="s" status={payout.status} label={SUCCESS_STATUS[payout.status as PayoutStatus] ?? PAYOUT_STATUS_LABELS[payout.status as PayoutStatus]} className="normal-case" />],
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto px-5 pt-8 pb-5 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-[var(--gain)]/12 text-[var(--gain)] duration-300 animate-in fade-in zoom-in-75 motion-reduce:animate-none">
          <CircleCheck className="size-7" aria-hidden />
        </span>
        <div>
          <DialogTitle className="text-lg font-semibold tracking-tight">{payout.sending ? "Payout on its way" : "Payout requested"}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            {payout.sending ? `Your ${money(payout.amount)} payout was approved and is being sent to your wallet. We'll email you once the network confirms it.` : `Your ${money(payout.amount)} payout request has been submitted. We'll email you as it moves along.`}
          </DialogDescription>
        </div>
        <dl className="w-full divide-y rounded-xl border bg-muted/30 text-start text-sm">
          {rows.map(([label, node]) => (
            <div key={label} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 truncate text-end font-medium tabular-nums">{node}</dd>
            </div>
          ))}
        </dl>
      </div>
      <footer className="flex shrink-0 gap-2 border-t bg-muted/40 px-5 py-3.5 sm:justify-end sm:rounded-b-xl">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="flex-1 sm:flex-none"
          onClick={() => {
            onClose()
            // the request is the first row of the history, further down the page
            requestAnimationFrame(() => document.getElementById("payout-history")?.scrollIntoView({ behavior: "smooth", block: "start" }))
          }}
        >
          View payout
        </Button>
        <DialogClose render={<Button type="button" size="lg" className="flex-1 sm:min-w-28 sm:flex-none" />}>Done</DialogClose>
      </footer>
    </div>
  )
}
