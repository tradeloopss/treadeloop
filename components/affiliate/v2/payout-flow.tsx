"use client"

import type React from "react"
import { createContext, useCallback, useContext, useEffect, useId, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowRight, Banknote, Check, ChevronRight, CircleCheck, ExternalLink, Info, LifeBuoy, Loader2, Plus, ShieldCheck, TriangleAlert, type LucideIcon } from "lucide-react"
import { cancelPayoutRequest, requestPayoutNow, type RequestedPayout } from "@/app/actions/affiliate"
import { CodeField, useActionCode } from "@/components/affiliate/action-code"
import { MethodMark, PayoutMethodDialog } from "@/components/affiliate/payout-method-dialog"
import type { PayoutView } from "@/components/affiliate/payouts"
import type { RequestPayoutProps } from "@/components/affiliate/request-payout-dialog"
import { useAction } from "@/components/affiliate/use-action"
import { cryptoSpec, explorerTxUrl, formatAsset } from "@/lib/affiliates/crypto"
import { DEFAULT_PAYOUT_SETTINGS, affiliateCanCancel, payoutInFlight, quoteFee } from "@/lib/affiliates/payout-engine"
import { cents, cleanAmount, describeMethod, fmtWhen, inHold, methodUnavailable, newKey, quickAmounts, readAmount, usable } from "@/lib/affiliates/payout-form"
import { maskTxHash } from "@/lib/affiliates/tron"
import { methodLabel, money } from "@/lib/affiliates/types"
import { payoutRef } from "@/lib/affiliates/v2/wallet"
import { affiliateHref } from "@/lib/urls"
import { cn } from "@/lib/utils"
import { MethodSummary } from "./payout-methods"
import { DetailRows, Sheet, sheetBtn, sheetBtnDanger, sheetBtnQuiet } from "./sheet"
import { CardLink, EmptyState, StatusChip, fmtDate } from "./ui"

// The Payout page: asking for money, and following what was asked for. Choose a
// saved method, enter an amount, see exactly what arrives, confirm. Every figure
// shown here is worked out again by the server when the request is made
// (app/actions/affiliate → payouts.createPayout) — this form decides nothing.

const methodName = (type: string) => cryptoSpec(type)?.asset ?? methodLabel(type)
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })

type Tone = "warning" | "danger" | "info"
const TONES: Record<Tone, string> = { warning: "border-warning/35 bg-warning/[0.08]", danger: "border-loss/30 bg-loss/[0.06]", info: "border-border bg-muted/40" }
const ICON_TONES: Record<Tone, string> = { warning: "text-warning", danger: "text-loss", info: "text-muted-foreground" }

function Notice({ tone, icon: Icon, title, children, action }: { tone: Tone; icon: LucideIcon; title?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div role={tone === "info" ? "status" : "alert"} className={cn("flex gap-3 rounded-2xl border px-4 py-3.5", TONES[tone])}>
      <Icon className={cn("mt-0.5 size-[18px] shrink-0", ICON_TONES[tone])} aria-hidden />
      <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
        {title && <p className="text-sm font-semibold">{title}</p>}
        <div className="text-muted-foreground">{children}</div>
        {action && <div className="mt-2.5">{action}</div>}
      </div>
    </div>
  )
}

// --- Payout details ---------------------------------------------------------------------

type DetailsConfig = { eta: string; instantTypes: string[]; instantUpTo: number | null }
const OpenPayout = createContext<(id: number, fallback?: PayoutView) => void>(() => {})
export const usePayoutDetails = () => useContext(OpenPayout)

// What the status means for the affiliate, in a sentence.
const EXPLAIN: Record<string, string> = {
  pending: "Waiting for review. You can cancel this request until it's approved.",
  on_hold: "On hold while our team reviews it. The amount stays reserved for this payout.",
  queued: "Approved and on its way to your payout method. We'll email you when it's complete.",
  processing: "On its way to your payout method. We'll email you when it's complete.",
  submitted: "On its way to your payout method. We'll email you when it's complete.",
  confirming: "Sent — waiting for the network to confirm it. We'll email you when it's complete.",
  retry_required: "The first attempt didn't go through, so it's being sent again. You don't need to do anything.",
  paid: "Sent to your payout method.",
  failed: "This payout didn't go through. The amount is back in your available balance.",
  rejected: "This request was declined. The amount is back in your available balance.",
  cancelled: "This request was cancelled. The amount is back in your available balance.",
  reversed: "This payout was reversed. The amount is back in your available balance.",
}

// Holds the Payout Details sheet for the whole page, so the history and the
// request form's "View Payout" open the same one. `initialId` = ?payout=12.
export function PayoutDetailsProvider({ payouts, eta, instantTypes, instantUpTo, supportHref, methodsHref, initialId = null, children }: DetailsConfig & { payouts: PayoutView[]; supportHref: string; methodsHref: string; initialId?: number | null; children: React.ReactNode }) {
  const [open, setOpen] = useState<{ id: number; fallback?: PayoutView } | null>(initialId != null ? { id: initialId } : null)
  const show = useCallback((id: number, fallback?: PayoutView) => setOpen({ id, fallback }), [])
  const payout = open ? (payouts.find((p) => p.id === open.id) ?? open.fallback ?? null) : null
  return (
    <OpenPayout.Provider value={show}>
      {children}
      <PayoutDetailsSheet payout={payout} onClose={() => setOpen(null)} eta={eta} instantTypes={instantTypes} instantUpTo={instantUpTo} supportHref={supportHref} methodsHref={methodsHref} />
    </OpenPayout.Provider>
  )
}

function PayoutDetailsSheet({ payout: p, onClose, eta, instantTypes, instantUpTo, supportHref, methodsHref }: DetailsConfig & { payout: PayoutView | null; onClose: () => void; supportHref: string; methodsHref: string }) {
  const [cancelling, setCancelling] = useState(false)
  const { pending, run } = useAction()
  useEffect(() => setCancelling(false), [p?.id])
  const coin = cryptoSpec(p?.methodType)
  const link = p ? explorerTxUrl(p.network, p.transactionHash) : null
  const inFlight = !!p && payoutInFlight(p.status)
  const failed = !!p && ["failed", "rejected", "reversed"].includes(p.status)
  const ended = failed || p?.status === "cancelled"
  const instant = !!p && instantUpTo != null && instantTypes.includes(p.methodType) && p.net <= instantUpTo
  const close = () => {
    if (pending) return
    setCancelling(false)
    onClose()
  }

  return (
    <Sheet
      open={!!p}
      onOpenChange={(next) => !next && close()}
      locked={pending}
      title={cancelling ? "Cancel this payout request?" : "Payout Details"}
      description={p ? (cancelling ? `${money(p.amount)} goes back to your available balance.` : `${payoutRef(p.id)} · Requested ${fmtDate(p.requestedAt)}`) : undefined}
      footer={
        !p ? undefined : cancelling ? (
          <>
            <button type="button" className={sheetBtnQuiet} onClick={() => setCancelling(false)} disabled={pending}>
              Keep Request
            </button>
            <button type="button" className={sheetBtnDanger} disabled={pending} onClick={() => run(() => cancelPayoutRequest(p.id), () => (setCancelling(false), onClose()))}>
              {pending && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />} {pending ? "Cancelling…" : "Cancel Request"}
            </button>
          </>
        ) : affiliateCanCancel(p.status) ? (
          <>
            <button type="button" className={cn(sheetBtn, "border border-loss/35 text-loss hover:bg-loss/[0.07]")} onClick={() => setCancelling(true)}>
              Cancel Request
            </button>
            <button type="button" className={sheetBtnQuiet} onClick={close}>
              Close
            </button>
          </>
        ) : failed ? (
          <>
            <Link href={affiliateHref(supportHref)} className={sheetBtnQuiet}>
              <LifeBuoy className="size-4" aria-hidden /> Contact Support
            </Link>
            <button type="button" className={cn(sheetBtn, "v2-btn")} onClick={close}>
              Close
            </button>
          </>
        ) : undefined
      }
    >
      {p && !cancelling && (
        <>
          <div className="flex flex-col items-center gap-2 rounded-2xl border bg-background/40 px-4 py-5 text-center">
            <span className="flex size-11 items-center justify-center rounded-xl border bg-background/60">
              <MethodMark type={p.methodType} className="size-7" />
            </span>
            <p className="text-3xl leading-none font-bold tracking-tight tabular-nums">{money(p.amount)}</p>
            <StatusChip status={p.status} kind="payout" />
            <p className="max-w-xs text-[13px] text-muted-foreground">{EXPLAIN[p.status] ?? ""}</p>
          </div>

          {failed && (
            <Notice tone="danger" icon={TriangleAlert} title={p.failureReason ? "Why it didn't go through" : undefined}>
              {p.failureReason && <p className="text-foreground/85">{p.failureReason}</p>}
              <p className={cn(p.failureReason && "mt-1")}>
                Check your{" "}
                <Link href={affiliateHref(methodsHref)} className="font-medium text-primary hover:underline">
                  payout methods
                </Link>
                , then request the payout again. If it keeps happening, contact affiliate support.
              </p>
            </Notice>
          )}

          <DetailRows
            rows={[
              { label: "Status", value: <StatusChip status={p.status} kind="payout" /> },
              { label: "Amount", value: money(p.amount) },
              // A payout that didn't happen charged no fee and delivered nothing.
              !ended && { label: "Fee", value: p.fee > 0 ? `− ${money(p.fee)}` : money(0) },
              !ended && { label: p.status === "paid" ? "You received" : "You receive", value: <span className={cn(p.status === "paid" && "text-gain")}>{money(p.net)}</span>, strong: true },
              { label: "Method", value: coin ? `${coin.asset} · ${coin.networkLabel}` : methodLabel(p.methodType) },
              { label: "Destination", value: <span className="font-mono">{p.methodLabel}</span> },
              { label: "Requested", value: fmtDateTime(p.requestedAt) },
              p.mode === "automatic" && { label: "Type", value: "Automatic payout" },
              inFlight && p.status !== "on_hold" && { label: "Estimated arrival", value: instant ? "Usually within minutes" : `Usually ${eta}` },
              p.completedAt && { label: "Completed", value: fmtDateTime(p.completedAt) },
              { label: "Payout ID", value: <span className="font-mono">{payoutRef(p.id)}</span>, copy: { value: payoutRef(p.id), label: "Copy payout ID", done: "Payout ID copied" } },
              p.transactionHash && {
                label: "Transaction hash",
                value: link ? (
                  <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-primary hover:underline">
                    {maskTxHash(p.transactionHash)} <ExternalLink className="size-3" aria-hidden />
                  </a>
                ) : (
                  <span className="font-mono">{maskTxHash(p.transactionHash)}</span>
                ),
                copy: { value: p.transactionHash, label: "Copy transaction hash", done: "Transaction hash copied" },
              },
            ]}
          />
        </>
      )}
      {p && cancelling && (
        <DetailRows
          rows={[
            { label: "Amount", value: money(p.amount), strong: true },
            { label: "Method", value: methodName(p.methodType) },
            { label: "Destination", value: <span className="font-mono">{p.methodLabel}</span> },
            { label: "Payout ID", value: <span className="font-mono">{payoutRef(p.id)}</span> },
          ]}
        />
      )}
    </Sheet>
  )
}

// --- Payout history ---------------------------------------------------------------------

export function PayoutHistoryList({ payouts, limit }: { payouts: PayoutView[]; limit?: number }) {
  const open = usePayoutDetails()
  if (payouts.length === 0) {
    return (
      <EmptyState icon={Banknote} title="No payouts yet" className="py-8">
        Your payout requests will appear here.
      </EmptyState>
    )
  }
  return (
    <ul className="flex flex-col gap-2">
      {(limit ? payouts.slice(0, limit) : payouts).map((p) => (
        <li key={p.id}>
          <button type="button" onClick={() => open(p.id)} aria-label={`Payout ${payoutRef(p.id)}, ${money(p.amount)}: details`} className="group flex w-full items-center gap-3 rounded-2xl border bg-background/30 p-3 text-start transition-colors hover:border-primary/45 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none active:scale-[0.995]">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background/60">
              <MethodMark type={p.methodType} className="size-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold tabular-nums">{money(p.amount)}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {fmtDate(p.requestedAt)} · {methodName(p.methodType)}
                {p.mode === "automatic" ? " · Automatic" : ""}
              </span>
            </span>
            <StatusChip status={p.status} kind="payout" />
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}

// --- The request ------------------------------------------------------------------------

// One window, three steps: where the money goes, how much, and what arrives.
const STEPS = ["Method", "Amount", "Summary"] as const
type StepN = 1 | 2 | 3

// Where the form is. A finished step can be gone back to; a later one is only
// reached by finishing the one before it.
function Stepper({ step, onGo }: { step: StepN; onGo: (n: StepN) => void }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Payout request steps">
      {STEPS.map((label, i) => {
        const n = (i + 1) as StepN
        const done = n < step
        const current = n === step
        return (
          <li key={label} className={cn("flex min-w-0 items-center gap-2", i < STEPS.length - 1 && "flex-1")}>
            <button
              type="button"
              disabled={!done}
              onClick={() => onGo(n)}
              aria-current={current ? "step" : undefined}
              aria-label={`Step ${n}: ${label}${done ? " (done — go back)" : current ? " (current)" : ""}`}
              className="flex shrink-0 items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60 enabled:cursor-pointer"
            >
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors motion-reduce:transition-none", done || current ? "v2-nav-active" : "border bg-muted/60 text-muted-foreground")} aria-hidden>
                {done ? <Check className="size-3.5 stroke-[3]" /> : n}
              </span>
              <span className={cn("text-[13px] font-semibold", current ? "text-foreground" : "text-muted-foreground", !current && "max-[359px]:hidden")}>{label}</span>
            </button>
            {i < STEPS.length - 1 && <span aria-hidden className={cn("h-0.5 min-w-3 flex-1 rounded-full", done ? "v2-bar" : "bg-border")} />}
          </li>
        )
      })}
    </ol>
  )
}

function StepHead({ n, title, action }: { n: StepN; title: string; action?: React.ReactNode }) {
  return (
    <header className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Step {n} of 3</p>
        <h2 className="text-[17px] leading-tight font-semibold tracking-tight">{title}</h2>
      </div>
      {action}
    </header>
  )
}

const nextBtn = "v2-btn inline-flex h-[52px] min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl px-4 text-[15px] font-semibold focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55"
const backBtn = "inline-flex h-[52px] shrink-0 items-center justify-center gap-1.5 rounded-2xl border bg-card/60 px-4 text-[15px] font-semibold transition-colors hover:border-primary/45 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"

export function PayoutFlow({ request, top, aside, manageHref, back, inFlightId = null }: { request: RequestPayoutProps; top?: React.ReactNode; aside?: React.ReactNode; manageHref: string; back: { href: string; label: string }; inFlightId?: number | null }) {
  const { available, min, max, methodMins = {}, methods, blocked, eta, feePolicy, fees, approval, instantUpTo = null, instantTypes = ["crypto_trc20"], prices = {}, autoPayoutOn = false, methodConfig } = request
  const router = useRouter()
  const openPayout = usePayoutDetails()
  const ids = { amount: useId(), help: useId(), method: useId() }
  const [amount, setAmount] = useState("")
  const [touched, setTouched] = useState(false)
  const [methodId, setMethodId] = useState<number | null>(null)
  // methods that existed before "Add New Method" was opened, so the new one can be picked for them
  const [known, setKnown] = useState<number[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // One key per amount + method: confirming twice, or retrying, can't pay twice.
  const [key, setKey] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<RequestedPayout | null>(null)
  const [pending, start] = useTransition()
  // the step last asked for (the one shown is worked out from it, below)
  const [at, setAt] = useState<StepN>(1)
  // the verification code the Confirm Payout sheet asks for
  const codes = useActionCode()

  const live = methods.filter((m) => m.status !== "removed" && m.status !== "rejected")
  const ready = live.filter((m) => usable(m))
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
  const automatic = instantUpTo != null && !!coin && instantTypes.includes(coin.type)
  const instant = automatic && !(quote && quote.net > instantUpTo)
  const price = coin && !coin.usdPegged ? prices[coin.asset] : undefined
  const receive = !quote ? "—" : !coin ? money(quote.net) : coin.usdPegged ? `${quote.net.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${coin.asset}` : price ? `≈ ${formatAsset(quote.net / price, coin.asset, 6)}` : money(quote.net)

  const locked = !!blocked || belowMin
  const canSubmit = !locked && !!method && valid && !pending
  const showError = touched && !!problem && !locked
  const arrival = instant
    ? "Sent to your wallet automatically, usually within minutes of your request."
    : automatic && coin && instantUpTo != null
      ? `${coin.assetName} payouts above ${money(instantUpTo)} are reviewed before they're sent — usually ${eta}.`
      : approval === "manual"
        ? `Payouts are reviewed before they're sent — usually ${eta}.`
        : `Your request goes straight to the payout queue — usually ${eta}.`

  const onAmount = (text: string) => {
    setAmount(cleanAmount(text))
    setTouched(true)
    setKey("")
    setError(null)
  }
  const pick = (id: number) => {
    setMethodId(id)
    setKey("")
    setError(null)
  }
  const addMethod = () => {
    setKnown(live.map((m) => m.id))
    setMethodId(null)
    setAdding(true)
  }
  const review = () => {
    setTouched(true)
    if (!canSubmit) return
    if (!key) setKey(newKey())
    setError(null)
    setDone(null)
    setConfirming(true)
    // for exactly this amount to this method — emailed, unless the account uses an authenticator
    if (method && value != null) void codes.request({ purpose: "payout", amount: value, methodId: method.id })
  }
  const resend = () => {
    if (method && value != null) void codes.request({ purpose: "payout", amount: value, methodId: method.id, resend: codes.phase === "ready" })
  }
  const confirm = () => {
    if (!method || value == null || pending || !codes.satisfied) return
    setError(null)
    start(async () => {
      try {
        const res = await requestPayoutNow({ amount: value, methodId: method.id, key, code: codes.value })
        if (res.ok) {
          setDone(res.payout)
          setAmount("")
          setTouched(false)
          setKey("")
          setAt(1)
          router.refresh()
        } else {
          setError(res.error)
          codes.setCode("")
        }
      } catch {
        setError("We couldn't reach TradeLoop. Check your connection and try again — you won't be paid twice.")
      }
    })
  }
  const closeSheet = () => {
    if (pending) return
    setConfirming(false)
    setDone(null)
    setError(null)
    codes.reset()
  }
  const viewPayout = (p: RequestedPayout) => {
    closeSheet()
    openPayout(p.id, { id: p.id, amount: p.amount, fee: p.fee, net: p.net, methodType: p.methodType, methodLabel: p.methodLabel, status: p.status, mode: "manual", network: p.network, asset: p.asset, transactionHash: null, failureReason: null, requestedAt: new Date().toISOString(), completedAt: null })
  }

  const quick = quickAmounts(most)
  // A method comes before the amount, and a valid amount before the summary —
  // whatever was last shown, the window never sits on a step it can't stand on.
  const step: StepN = locked || !method ? 1 : at === 3 && !valid ? 2 : at
  const choose = (id: number) => {
    pick(id)
    setAt(2)
  }
  const toSummary = () => {
    setTouched(true)
    if (valid) setAt(3)
  }

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] lg:items-start lg:gap-5">
        <div className="flex min-w-0 flex-col gap-4 lg:gap-5">
          {top}

          {blocked ? (
            <Notice
              tone="warning"
              icon={ShieldCheck}
              title={inFlightId != null ? "You have a payout in progress" : "Payouts temporarily unavailable"}
              action={
                inFlightId != null ? (
                  <button type="button" onClick={() => openPayout(inFlightId)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-card/70 px-3 text-[13px] font-semibold text-foreground transition-colors hover:border-primary/45 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
                    View Payout <ArrowRight className="size-3.5" aria-hidden />
                  </button>
                ) : undefined
              }
            >
              {inFlightId != null ? "You can request another one once it's complete." : blocked}
            </Notice>
          ) : belowMin ? (
            <Notice tone="info" icon={Info} title={`${money(min - available)} to go`}>
              You need at least {money(min)} available to request a payout. Commissions become available once their holding period has passed.
            </Notice>
          ) : null}

          {/* The request, in one window: method → amount → summary. */}
          <section aria-label="Request a payout" className="v2-card flex min-w-0 flex-col">
            <div className="border-b px-4 py-3.5 sm:px-5">
              <Stepper step={step} onGo={setAt} />
            </div>

            <div key={step} className="v2-fade-up flex min-w-0 flex-col px-4 pt-4 pb-4 sm:px-5 sm:pb-5">
              {step === 1 && (
                <>
                  <StepHead n={1} title="Choose Payout Method" action={live.length > 0 ? <CardLink href={manageHref}>Manage</CardLink> : undefined} />
                  {live.length === 0 ? (
                    <div className="flex flex-col items-center gap-1 rounded-2xl border border-dashed px-4 py-6 text-center">
                      <p className="text-sm font-semibold">No payout methods yet</p>
                      <p className="text-sm text-muted-foreground">Add a payout method to receive your earnings.</p>
                    </div>
                  ) : (
                    // While nothing can be requested the choices are shown but switched off; adding a method still works.
                    <div role="radiogroup" aria-label="Payout method" id={ids.method} className={cn("flex flex-col gap-2", locked && "opacity-60")}>
                      {live.map((m) => {
                        const why = methodUnavailable(m)
                        const on = method?.id === m.id
                        return (
                          <button
                            key={m.id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            disabled={!!why || locked}
                            title={why ?? undefined}
                            onClick={() => choose(m.id)}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-2xl border p-3 text-start transition-all focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none active:scale-[0.995] motion-reduce:transition-none",
                              on ? "border-primary bg-primary/[0.07] shadow-[0_0_0_1px_var(--primary)]" : "bg-background/30 hover:border-primary/45",
                              (why || locked) && "cursor-not-allowed hover:border-border",
                              why && !locked && "opacity-60"
                            )}
                          >
                            <MethodSummary method={m} />
                            <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")} aria-hidden>
                              {on && <Check className="size-3 stroke-[3]" />}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {live.length > 0 && !method && (
                    <p className="mt-2 text-xs text-[color-mix(in_oklch,var(--warning),black_18%)] dark:text-warning">{held ? `Your payout destination was changed recently. To protect your account it can be paid to from ${fmtWhen(held.holdUntil!)}.` : "None of your payout methods can be paid to right now. Enable one, or add another."}</p>
                  )}
                  {methodConfig && methodConfig.methods.length > 0 && (
                    <button type="button" onClick={addMethod} className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/45 text-sm font-semibold text-primary transition-colors hover:bg-primary/[0.07] focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
                      <Plus className="size-4" aria-hidden /> Add New Method
                    </button>
                  )}
                  <div className="mt-4 flex">
                    <button type="button" onClick={() => setAt(2)} disabled={!method || locked} className={nextBtn}>
                      Continue <ArrowRight className="size-5" aria-hidden />
                    </button>
                  </div>
                </>
              )}

              {step === 2 && method && (
                <form
                  noValidate
                  className="flex min-w-0 flex-col"
                  onSubmit={(e) => {
                    e.preventDefault()
                    toSummary()
                  }}
                >
                  <StepHead n={2} title="Enter Amount" />
                  <button type="button" onClick={() => setAt(1)} aria-label={`Sending to ${describeMethod(method).name}, ${method.label}. Change payout method`} className="mb-3 flex w-full items-center gap-3 rounded-2xl border bg-background/30 p-2.5 text-start transition-colors hover:border-primary/45 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
                    <MethodSummary method={method} />
                    <span className="shrink-0 pe-1 text-xs font-semibold text-primary">Change</span>
                  </button>
                  <label htmlFor={ids.amount} className="sr-only">
                    Amount in US dollars
                  </label>
                  <div className={cn("flex h-16 items-center rounded-2xl border bg-background/50 ps-4 pe-3 transition-shadow focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40", showError ? "border-loss focus-within:border-loss focus-within:ring-loss/25" : "border-input")}>
                    <span className="text-2xl font-semibold text-muted-foreground select-none" aria-hidden>
                      $
                    </span>
                    <input
                      id={ids.amount}
                      value={amount}
                      onChange={(e) => onAmount(e.target.value)}
                      onBlur={() => amount && setTouched(true)}
                      inputMode="decimal"
                      autoComplete="off"
                      autoFocus
                      placeholder="0.00"
                      aria-invalid={showError}
                      aria-describedby={ids.help}
                      className="h-full min-w-0 flex-1 bg-transparent px-2 text-[28px] font-bold tracking-tight tabular-nums outline-none placeholder:font-semibold placeholder:text-muted-foreground/50"
                    />
                    <span className="text-xs font-semibold text-muted-foreground">USD</span>
                  </div>
                  <div role="group" aria-label="Quick amounts" className="mt-3 grid grid-cols-4 gap-2">
                    {quick.map(([name, v]) => {
                      const on = value === v && v > 0
                      return (
                        <button
                          key={name}
                          type="button"
                          aria-pressed={on}
                          disabled={v < minNow || v <= 0}
                          onClick={() => onAmount(v.toFixed(2))}
                          className={cn("h-11 rounded-xl border text-sm font-semibold transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-95 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none", on ? "v2-nav-active border-transparent" : "bg-card/60 text-muted-foreground hover:border-primary/45 hover:text-foreground")}
                        >
                          {name}
                        </button>
                      )
                    })}
                  </div>
                  <div id={ids.help} className="mt-3 flex flex-col gap-1 text-xs">
                    {showError && (
                      <p role="alert" className="flex items-center gap-1.5 font-medium text-loss">
                        <TriangleAlert className="size-3.5 shrink-0" aria-hidden /> {problem}
                      </p>
                    )}
                    <p className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 text-muted-foreground">
                      <span>
                        Minimum: <span className="font-semibold text-foreground tabular-nums">{floorBinds ? floorText : money(min)}</span>
                        {max != null && (
                          <>
                            {" "}
                            · Maximum: <span className="font-semibold text-foreground tabular-nums">{money(max)}</span>
                          </>
                        )}
                      </span>
                      <span>
                        Available: <span className="font-semibold text-foreground tabular-nums">{money(available)}</span>
                      </span>
                    </p>
                  </div>
                  <div className="mt-4 flex gap-2.5">
                    <button type="button" onClick={() => setAt(1)} className={backBtn}>
                      <ArrowLeft className="size-4" aria-hidden /> Back
                    </button>
                    <button type="submit" disabled={!valid} className={nextBtn}>
                      Continue <ArrowRight className="size-5" aria-hidden />
                    </button>
                  </div>
                </form>
              )}

              {step === 3 && method && (
                <>
                  <StepHead n={3} title="Payout Summary" />
                  <div className="flex items-center gap-3 rounded-2xl border bg-background/30 p-2.5">
                    <MethodSummary method={method} />
                  </div>
                  <dl className="mt-3 text-sm">
                    <div className="flex items-center justify-between py-1.5">
                      <dt className="text-muted-foreground">Payout amount</dt>
                      <dd className="font-medium tabular-nums">{quote ? money(quote.amount) : "—"}</dd>
                    </div>
                    <div className="flex items-center justify-between py-1.5">
                      <dt className="text-muted-foreground">{quote?.estimated ? "Estimated fee" : "Fee"}</dt>
                      <dd className="font-medium tabular-nums">{quote ? (quote.fee > 0 ? `− ${money(quote.fee)}` : money(0)) : "—"}</dd>
                    </div>
                  </dl>
                  <div className="mt-1.5 flex items-end justify-between gap-3 border-t pt-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">You receive</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {methodName(method.type)} · {method.label}
                      </p>
                    </div>
                    <p className={cn("shrink-0 text-2xl leading-none font-bold tracking-tight tabular-nums", quote ? "text-gain" : "text-muted-foreground")} aria-live="polite">
                      {receive}
                    </p>
                  </div>
                  {coin && !coin.usdPegged && <p className="mt-2 text-xs text-muted-foreground">Your payout is {quote ? money(quote.net) : "set in US dollars"}; the exact amount of {coin.asset} follows the market price at the moment it is sent.</p>}
                  <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                    <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                    <span>
                      {arrival}
                      {autoPayoutOn ? " This is a one-off request; your automatic payouts continue as usual." : ""}
                    </span>
                  </p>
                  <div className="mt-4 flex gap-2.5">
                    <button type="button" onClick={() => setAt(2)} className={backBtn}>
                      <ArrowLeft className="size-4" aria-hidden /> Back
                    </button>
                    <button type="button" onClick={review} disabled={!canSubmit} className={nextBtn}>
                      <span className="truncate">Submit Payout Request</span> <ArrowRight className="size-5 shrink-0" aria-hidden />
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>

        {aside && <div className="flex min-w-0 flex-col gap-4 lg:gap-5">{aside}</div>}
      </div>

      {methodConfig && <PayoutMethodDialog open={adding} onOpenChange={setAdding} {...methodConfig} />}

      <Sheet
        open={confirming}
        onOpenChange={(next) => !next && closeSheet()}
        locked={pending}
        title={done ? "Payout Request Submitted" : "Confirm Payout"}
        description={done ? (done.sending ? `Your ${money(done.amount)} payout was approved and is being sent. We'll email you once it's confirmed.` : `Your ${money(done.amount)} request is in. We'll email you as it moves along.`) : codes.phase === "off" ? "Check the details before you submit. This can't be changed afterwards." : "Check the details, then enter your verification code to submit."}
        footer={
          done ? (
            <>
              <Link href={affiliateHref(back.href)} className={sheetBtnQuiet}>
                {back.label}
              </Link>
              <button type="button" className={cn(sheetBtn, "v2-btn")} onClick={() => viewPayout(done)}>
                View Payout
              </button>
            </>
          ) : (
            <>
              <button type="button" className={sheetBtnQuiet} onClick={closeSheet} disabled={pending}>
                Cancel
              </button>
              <button type="button" className={cn(sheetBtn, "v2-btn flex-[1.6]")} onClick={confirm} disabled={pending || !method || value == null || !codes.satisfied} aria-busy={pending}>
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Submitting…
                  </>
                ) : error ? (
                  "Try Again"
                ) : (
                  "Confirm Payout"
                )}
              </button>
            </>
          )
        }
      >
        {done ? (
          <>
            <div className="flex flex-col items-center gap-3 pt-1 text-center">
              <span className="flex size-16 items-center justify-center rounded-full bg-gain/12 text-gain duration-300 animate-in fade-in zoom-in-50 motion-reduce:animate-none">
                <CircleCheck className="size-8" aria-hidden />
              </span>
              <p className="text-3xl leading-none font-bold tracking-tight tabular-nums">{money(done.net)}</p>
              <StatusChip status={done.status} kind="payout" />
            </div>
            <DetailRows
              rows={[
                { label: "Amount", value: money(done.amount) },
                done.fee > 0 && { label: "Fee", value: `− ${money(done.fee)}` },
                { label: "You receive", value: money(done.net), strong: true },
                { label: "Method", value: methodName(done.methodType) },
                { label: "Destination", value: <span className="font-mono">{done.methodLabel}</span> },
                { label: "Payout ID", value: <span className="font-mono">{payoutRef(done.id)}</span>, copy: { value: payoutRef(done.id), label: "Copy payout ID", done: "Payout ID copied" } },
              ]}
            />
          </>
        ) : (
          method &&
          quote && (
            <>
              {error && (
                <Notice tone="danger" icon={TriangleAlert} title="Unable to request payout">
                  <span className="text-foreground/85">{error}</span>
                </Notice>
              )}
              <div className="flex items-center gap-3 rounded-2xl border bg-background/40 p-3.5">
                <MethodSummary method={method} />
              </div>
              <DetailRows
                rows={[
                  { label: "Amount", value: money(quote.amount) },
                  { label: "Method", value: coin ? `${coin.asset} · ${coin.networkLabel}` : methodLabel(method.type) },
                  { label: "Destination", value: <span className="font-mono">{method.label}</span> },
                  { label: quote.estimated ? "Estimated fee" : "Fee", value: quote.fee > 0 ? `− ${money(quote.fee)}` : money(0) },
                  { label: "You receive", value: <span className="text-gain">{receive}</span>, strong: true },
                ]}
              />
              <CodeField flow={codes} disabled={pending} onResend={resend} onEnter={confirm} className="rounded-2xl border bg-background/40 p-3.5" />
              <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                <p className="flex items-start gap-2">
                  <Info className="mt-px size-3.5 shrink-0" aria-hidden /> {arrival}
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
          )
        )}
      </Sheet>
    </>
  )
}
