"use client"

import { useState } from "react"
import { OctagonAlert, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { checkPayout, payoutAction, revealPayoutAccount, runAutoPayoutsNow, removePayoutMethodHold, savePayoutConfig, setPayoutControls, setPayoutMethodStatus, setPayoutPause, submitPayoutTransaction } from "@/app/actions/admin-affiliates"
import { cryptoSpec } from "@/lib/affiliates/crypto"
import { FREQUENCY_LABELS, PAYOUT_FREQUENCIES, adminPayoutActions, type AdminPayoutAction, type PayoutSettings } from "@/lib/affiliates/payout-engine"
import { PAYOUT_METHOD_LABELS, PAYOUT_METHOD_TYPES, methodLabel, money, type PayoutMethodType } from "@/lib/affiliates/types"
import { ConfirmButton } from "@/components/affiliate/confirm"
import { CopyButton } from "@/components/affiliate/copy"
import { selectClass } from "@/components/affiliate/ui"
import { useAction } from "@/components/affiliate/use-action"

const label = "flex flex-col gap-1.5 text-xs text-muted-foreground"

// --- Payout actions -----------------------------------------------------------

const DETAIL_LABELS: Record<string, string> = { email: "Email", holder: "Account holder", bankName: "Bank", account: "Account number", routing: "Routing number", accountType: "Account type", iban: "IBAN", swift: "SWIFT / BIC", address: "Wallet address", accountId: "Stripe account" }
const META_LABELS: Record<string, string> = { country: "Country", currency: "Currency", accountType: "Account type", network: "Network", standard: "Standard", asset: "Asset" }

// `hot`: an automatic sender has this payout. `via`: which one sends it (or would, for a payout an admin can hand over).
export type AdminPayout = { id: number; status: string; methodType: string; amount: number; net: number; fee: number; asset: string | null; name: string; hasHash: boolean; automated: boolean; hot?: boolean; via?: "exchange" | "wallet" | null }

// The "send it" window: shows where the money goes (decrypted, audit-logged),
// then records the result. A crypto payout takes a transaction hash and is
// completed by the chain; anything else is confirmed by the admin who sent it.
function PayDialog({ payout, open, onOpenChange }: { payout: AdminPayout; open: boolean; onOpenChange: (open: boolean) => void }) {
  // Only USDT on TRON can be paid by hand: its transaction is checked on-chain.
  const crypto = !!cryptoSpec(payout.methodType)?.verifiable
  const [account, setAccount] = useState<{ type: string; details: Record<string, string>; metadata: Record<string, string> } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [value, setValue] = useState("")
  const { pending, run } = useAction()

  if (open && !loaded) {
    setLoaded(true)
    setAccount(null)
    setError(null)
    void revealPayoutAccount(payout.id).then((res) => (res.ok ? setAccount({ type: res.type, details: res.details, metadata: res.metadata }) : setError(res.error)))
  }
  if (!open && loaded) setLoaded(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Pay {payout.name} — {money(payout.net)}
            {crypto ? " USDT" : ""}
          </DialogTitle>
          <DialogDescription>
            {payout.fee > 0 ? `${money(payout.amount)} requested, ${money(payout.fee)} fee — send ${money(payout.net)}. ` : ""}
            Viewing these account details is recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        {!account && !error && <div role="status" aria-label="Loading" className="h-28 animate-pulse rounded-lg bg-muted" />}
        {error && <p className="rounded-lg bg-[var(--loss)]/10 px-3 py-2 text-sm text-[var(--loss)]">{error}</p>}
        {account && (
          <dl className="divide-y rounded-lg border">
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <dt className="text-muted-foreground">Method</dt>
              <dd className="font-medium">{methodLabel(account.type)}</dd>
            </div>
            {Object.entries(account.details).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <dt className="shrink-0 text-muted-foreground">{DETAIL_LABELS[k] ?? k}</dt>
                <dd className="flex min-w-0 items-center gap-2">
                  <span className="break-all text-end font-mono text-xs">{v}</span>
                  <CopyButton value={v} iconOnly label={`Copy ${DETAIL_LABELS[k] ?? k}`} />
                </dd>
              </div>
            ))}
            {Object.entries(account.metadata)
              .filter(([k]) => META_LABELS[k] && !(k in account.details))
              .map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <dt className="text-muted-foreground">{META_LABELS[k]}</dt>
                  <dd className="text-end">{v}</dd>
                </div>
              ))}
          </dl>
        )}
        {account && crypto && (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              run(() => submitPayoutTransaction(payout.id, value), () => (onOpenChange(false), setValue("")))
            }}
          >
            <p className="rounded-lg border border-[var(--chart-4)]/40 bg-[var(--chart-4)]/8 px-3 py-2 text-xs">
              Send exactly <span className="font-semibold">{payout.net.toFixed(2)} USDT</span> on <span className="font-semibold">TRON (TRC-20)</span> to the wallet above, then paste the transaction hash. The payout is completed only when the network confirms a USDT transfer of at least that amount to that wallet.
            </p>
            <label className={label}>
              Transaction hash
              <Input value={value} onChange={(e) => setValue(e.target.value.trim())} maxLength={66} placeholder="64 hexadecimal characters" className="font-mono text-xs" autoComplete="off" spellCheck={false} required />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                Close
              </Button>
              <Button type="submit" disabled={pending || !/^[0-9a-fA-F]{64}$/.test(value)}>
                {pending ? "Checking the network…" : "Submit transaction"}
              </Button>
            </DialogFooter>
          </form>
        )}
        {account && !crypto && (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!window.confirm(`Confirm you have sent ${money(payout.net)} to ${payout.name}. This marks the payout as completed.`)) return
              run(() => payoutAction({ payoutId: payout.id, action: "mark_paid", reference: value }), () => (onOpenChange(false), setValue("")))
            }}
          >
            <label className={label}>
              Transaction reference (optional)
              <Input value={value} onChange={(e) => setValue(e.target.value)} maxLength={120} placeholder="PayPal / Wise / bank transfer ID" />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                Close
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "I've sent it — mark as paid"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Exactly the actions the payout's state allows (payout-engine.adminPayoutActions),
// which is also what the server enforces.
export function PayoutAdminActions({ payout, paused, canAutoSend = false, size = "sm" }: { payout: AdminPayout; paused: boolean; canAutoSend?: boolean; size?: "sm" | "xs" }) {
  const [paying, setPaying] = useState(false)
  const { pending, run } = useAction()
  const spec = cryptoSpec(payout.methodType)
  const viaExchange = payout.via === "exchange"
  const actions = adminPayoutActions({ status: payout.status, crypto: !!spec, automated: payout.automated, hasHash: payout.hasHash, hot: payout.hot, canAutoSend: canAutoSend && !!payout.via, verifiable: !!spec?.verifiable })
  const has = (a: AdminPayoutAction) => actions.includes(a)
  const act = (action: Exclude<AdminPayoutAction, "submit_tx" | "check">) => (reason: string) => payoutAction({ payoutId: payout.id, action, reason })
  if (actions.length === 0) return null
  // While paused nothing new is sent; stopping and recording stay available.
  const sending = paused ? "All payouts are paused" : undefined

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {has("approve") && (
        <ConfirmButton size={size} variant="default" disabled={paused} title={`Approve ${money(payout.amount)} to ${payout.name}?`} description={payout.automated ? "It's sent through the provider straight away." : "It moves to the queue, ready to be sent."} confirmLabel="Approve" action={act("approve")}>
          Approve
        </ConfirmButton>
      )}
      {has("send_auto") && (
        <ConfirmButton
          size={size}
          variant="default"
          disabled={paused}
          title={`Send ${money(payout.net)} in ${spec?.assetName ?? "crypto"} to ${payout.name} ${viaExchange ? "from the KuCoin account" : "from the payout wallet"}?`}
          description={viaExchange ? "KuCoin is asked to withdraw it now, and the payout completes when KuCoin confirms the withdrawal. Once requested it can't be recalled." : "The transfer is signed and broadcast now, and the payout completes when the TRON network confirms it. Once broadcast it can't be recalled."}
          confirmLabel={viaExchange ? "Send via KuCoin" : "Send from payout wallet"}
          action={act("send_auto")}
        >
          {viaExchange ? "Send via KuCoin" : "Send from wallet"}
        </ConfirmButton>
      )}
      {(has("mark_paid") || has("submit_tx")) && (
        <Button size={size} variant={has("approve") || has("send_auto") || payout.hot ? "outline" : "default"} disabled={paused} title={sending} onClick={() => setPaying(true)}>
          {payout.status === "submitted" ? "Replace hash" : payout.hot || has("send_auto") ? "Pay by hand…" : "Pay…"}
        </Button>
      )}
      {has("start") && (
        <Button size={size} variant="outline" disabled={pending || paused} title={sending} onClick={() => run(() => payoutAction({ payoutId: payout.id, action: "start" }))}>
          Processing
        </Button>
      )}
      {has("retry") && (
        <ConfirmButton
          size={size}
          variant={payout.hot ? "default" : "outline"}
          disabled={paused}
          title={payout.hot ? `Send this payout ${viaExchange ? "via KuCoin" : "from the payout wallet"} now?` : "Retry this payout?"}
          description={
            payout.hot
              ? "A new transfer is only made if no earlier one for this payout can still go through — so it can't be paid twice."
              : payout.automated
                ? "The provider is asked again with the same idempotency key, so a request that already went through can't pay twice."
                : "It goes back to the queue to be sent again."
          }
          confirmLabel={payout.hot ? "Send now" : "Retry"}
          action={act("retry")}
        >
          {payout.hot ? "Send now" : "Retry"}
        </ConfirmButton>
      )}
      {has("check") && (
        <Button size={size} variant="outline" disabled={pending} onClick={() => run(() => checkPayout(payout.id))}>
          Check now
        </Button>
      )}
      {has("release") && (
        <ConfirmButton size={size} disabled={paused} title="Release the hold?" description="The payout goes back to where it was before the hold." confirmLabel="Release" action={act("release")}>
          Release
        </ConfirmButton>
      )}
      {has("hold") && (
        <ConfirmButton size={size} title="Place this payout on hold?" description="The amount stays reserved and nothing is sent until you release it. The affiliate is told it's being reviewed." confirmLabel="Place on hold" reason={{ label: "Internal note (optional)" }} action={act("hold")}>
          Hold
        </ConfirmButton>
      )}
      {has("reject") && (
        <ConfirmButton size={size} variant="destructive" destructive title="Reject this payout?" description={`${money(payout.amount)} goes back to ${payout.name}'s available balance.`} confirmLabel="Reject" reason={{ label: "Reason (the affiliate sees this)", required: true }} action={act("reject")}>
          Reject
        </ConfirmButton>
      )}
      {has("cancel") && (
        <ConfirmButton size={size} variant="ghost" destructive title="Cancel this payout?" description={`Nothing is sent, and ${money(payout.amount)} goes back to ${payout.name}'s available balance.`} confirmLabel="Cancel payout" reason={{ label: "Reason (optional)" }} action={act("cancel")}>
          Cancel
        </ConfirmButton>
      )}
      {has("fail") && (
        <ConfirmButton size={size} variant="ghost" destructive title="Mark this payout as failed?" description={`Use this only when the money did NOT arrive and won't. ${money(payout.amount)} goes back to ${payout.name}'s available balance.`} confirmLabel="Mark failed" reason={{ label: "What went wrong (the affiliate sees this)", required: true }} action={act("fail")}>
          Failed
        </ConfirmButton>
      )}
      {has("reverse") && (
        <ConfirmButton size={size} variant="ghost" destructive title="Reverse this completed payout?" description={`For a payment that came back (returned, unclaimed, bounced). ${money(payout.amount)} goes back to ${payout.name}'s available balance.`} confirmLabel="Reverse" reason={{ label: "Why it came back (the affiliate sees this)", required: true }} action={act("reverse")}>
          Reverse
        </ConfirmButton>
      )}
      <PayDialog payout={payout} open={paying} onOpenChange={setPaying} />
    </div>
  )
}

// --- Emergency pause ----------------------------------------------------------

export function PausePanel({ paused, canManage }: { paused: boolean; canManage: boolean }) {
  return (
    <section className={`rounded-xl border p-5 ${paused ? "border-[var(--loss)]/50 bg-[var(--loss)]/6" : "bg-card"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3">
          <OctagonAlert className={`mt-0.5 size-5 shrink-0 ${paused ? "text-[var(--loss)]" : "text-muted-foreground"}`} aria-hidden />
          <div>
            <h2 className="text-sm font-semibold">{paused ? "ALL PAYOUTS ARE PAUSED" : "Emergency pause"}</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {paused
                ? "No payout is being created, approved or sent — automatic or manual. Payouts already submitted are still tracked to completion, and nothing was cancelled."
                : "Stops every new payout at once: no automatic payouts, no requests, no approvals. Payouts already submitted keep being tracked, and nothing is cancelled."}
            </p>
          </div>
        </div>
        {canManage &&
          (paused ? (
            <ConfirmButton variant="default" size="default" title="Resume payouts?" description="Nothing is sent in bulk. Requests reopen, and the next automatic run applies every normal check — threshold, limits, holds — to each affiliate." confirmLabel="Resume payouts" action={() => setPayoutPause(false)}>
              Resume payouts
            </ConfirmButton>
          ) : (
            <ConfirmButton variant="destructive" size="default" destructive title="PAUSE ALL PAYOUTS?" description="Every new payout stops immediately, for every affiliate. Transactions already submitted are not cancelled and keep being tracked. Balances are untouched." confirmLabel="Pause all payouts" reason={{ label: "Reason (for the audit log)" }} action={(reason) => setPayoutPause(true, reason)}>
              Pause all payouts
            </ConfirmButton>
          ))}
      </div>
    </section>
  )
}

export function RunAutoPayoutsButton({ disabled }: { disabled: boolean }) {
  return (
    <ConfirmButton size="default" disabled={disabled} title="Run automatic payouts now?" description="Runs the same worker the schedule runs: each opted-in affiliate is checked, and a payout is created only for those who pass every check. Running it twice in a period creates nothing new." confirmLabel="Run now" action={() => runAutoPayoutsNow()}>
      <Play className="size-3.5" aria-hidden /> Run now
    </ConfirmButton>
  )
}

// --- Global payout settings ---------------------------------------------------

type FormState = Omit<PayoutSettings, "maxPayout" | "dailyLimit" | "weeklyLimit" | "monthlyLimit" | "paused"> & { maxPayout: string; dailyLimit: string; weeklyLimit: string; monthlyLimit: string; minPayout: string }

export function PayoutSettingsForm({ settings, minPayout, stripeReady, walletReady, exchangeReady = false, canManage }: { settings: PayoutSettings; minPayout: number; stripeReady: boolean; walletReady: boolean; exchangeReady?: boolean; canManage: boolean }) {
  // Something that can send crypto with nobody in the loop.
  const senderReady = walletReady || exchangeReady
  const source = exchangeReady ? "the KuCoin account" : "the payout wallet"
  const text = (v: number | null) => (v == null ? "" : String(v))
  const [form, setForm] = useState<FormState>({ ...settings, maxPayout: text(settings.maxPayout), dailyLimit: text(settings.dailyLimit), weeklyLimit: text(settings.weeklyLimit), monthlyLimit: text(settings.monthlyLimit), minPayout: String(minPayout) })
  const { pending, run } = useAction()
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))
  const fee = (t: PayoutMethodType, k: "fixed" | "percent", v: string) => setForm((f) => ({ ...f, fees: { ...f.fees, [t]: { ...f.fees[t], [k]: v as unknown as number } } }))
  const toggleMethod = (t: PayoutMethodType, on: boolean) => setForm((f) => ({ ...f, methods: on ? PAYOUT_METHOD_TYPES.filter((m) => f.methods.includes(m) || m === t) : f.methods.filter((m) => m !== t) }))

  const submit = () => {
    if (form.cryptoAutoSend && !settings.cryptoAutoSend && !window.confirm(`Switch automatic crypto sending ON?\n\nCrypto payout requests up to $${form.cryptoAutoMax} (and $${form.cryptoAutoDaily} a day in total) will be sent from ${source} without anyone approving them. Keep only a working float there.`)) return
    const turningOn = form.autoPayouts && !settings.autoPayouts
    if (turningOn && !window.confirm("Switch automatic payouts ON for the program?\n\nPayouts will be created without a request for affiliates who opted in and pass every check. Balances that built up are NOT sent in bulk — each affiliate gets at most one payout per period, within the limits.")) return
    run(() => savePayoutConfig({ ...form }))
  }

  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <fieldset disabled={!canManage || pending} className="grid gap-6">
        <ul className="divide-y rounded-lg border">
          <li>
            <label className="flex cursor-pointer items-center justify-between gap-4 px-3 py-3">
              <span>
                <span className="block text-sm font-medium text-foreground">Automatic Payouts</span>
                <span className="block text-xs text-muted-foreground">The worker creates payouts for affiliates who switched them on. OFF stops it for everyone; each affiliate&apos;s own setting is kept.</span>
              </span>
              <input type="checkbox" role="switch" checked={form.autoPayouts} onChange={(e) => set("autoPayouts", e.target.checked)} className="size-4 shrink-0 accent-[var(--primary)]" />
            </label>
          </li>
        </ul>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className={label}>
            Mode
            <select value={form.approval} onChange={(e) => set("approval", e.target.value as PayoutSettings["approval"])} className={selectClass}>
              <option value="manual">Manual approval — an admin approves each payout</option>
              <option value="automatic">Automatic — straight to the queue</option>
            </select>
          </label>
          <label className={label}>
            Default frequency
            <select value={form.frequency} onChange={(e) => set("frequency", e.target.value as PayoutSettings["frequency"])} className={selectClass}>
              {PAYOUT_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABELS[f]}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Minimum payout (USD)
            <Input type="number" min={1} step="0.01" value={form.minPayout} onChange={(e) => set("minPayout", e.target.value)} required />
          </label>
          <label className={label}>
            Maximum per payout (USD)
            <Input type="number" min={1} step="0.01" value={form.maxPayout} onChange={(e) => set("maxPayout", e.target.value)} placeholder="No maximum" />
          </label>
          <label className={label}>
            Daily limit, whole program (USD)
            <Input type="number" min={1} step="0.01" value={form.dailyLimit} onChange={(e) => set("dailyLimit", e.target.value)} placeholder="No limit" />
          </label>
          <label className={label}>
            Weekly limit (USD)
            <Input type="number" min={1} step="0.01" value={form.weeklyLimit} onChange={(e) => set("weeklyLimit", e.target.value)} placeholder="No limit" />
          </label>
          <label className={label}>
            Monthly limit (USD)
            <Input type="number" min={1} step="0.01" value={form.monthlyLimit} onChange={(e) => set("monthlyLimit", e.target.value)} placeholder="No limit" />
          </label>
          <label className={label}>
            New-method security hold (hours)
            <Input type="number" min={0} max={720} step={1} value={form.methodHoldHours} onChange={(e) => set("methodHoldHours", e.target.value as unknown as number)} required />
            <span>How long a changed wallet/account waits before it can be paid. 0 = off.</span>
          </label>
        </div>

        <div>
          <h3 className="text-sm font-semibold">Automatic crypto sending</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Crypto requests inside these limits are approved by the rules and sent from {source} with nobody in the loop. Anything above the limit, a wallet added within the security hold, or an affiliate with an open risk signal still waits for you.
          </p>
          <ul className="mt-3 divide-y rounded-lg border">
            <li>
              <label className={`flex items-center justify-between gap-4 px-3 py-3 ${senderReady ? "cursor-pointer" : "opacity-60"}`}>
                <span>
                  <span className="block text-sm font-medium text-foreground">Send crypto payouts automatically</span>
                  <span className="block text-xs text-muted-foreground">{exchangeReady ? "Withdrawn by the KuCoin account below: USDT on TRON and Aptos, and Litecoin." : walletReady ? "USDT (TRC-20) only, signed and broadcast by the server from the payout wallet below." : "Needs the KuCoin account or the payout wallet to be connected first (see below)."}</span>
                </span>
                <input type="checkbox" role="switch" checked={form.cryptoAutoSend && senderReady} disabled={!senderReady} onChange={(e) => set("cryptoAutoSend", e.target.checked)} className="size-4 shrink-0 accent-[var(--primary)]" />
              </label>
            </li>
          </ul>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className={label}>
              Most per payout (USD)
              <Input type="number" min={1} step="0.01" value={form.cryptoAutoMax} onChange={(e) => set("cryptoAutoMax", e.target.value as unknown as number)} required />
              <span>Larger payouts wait for approval.</span>
            </label>
            <label className={label}>
              Most per day, all affiliates (USD)
              <Input type="number" min={1} step="0.01" value={form.cryptoAutoDaily} onChange={(e) => set("cryptoAutoDaily", e.target.value as unknown as number)} required />
              <span>The ceiling on what can leave unattended in a day.</span>
            </label>
            <label className={label}>
              Highest exchange fee (USD)
              <Input type="number" min={0.5} max={100} step="0.01" value={form.cryptoMaxFeeUsd} onChange={(e) => set("cryptoMaxFeeUsd", e.target.value as unknown as number)} required />
              <span>A withdrawal KuCoin would charge more for waits.</span>
            </label>
            <label className={label}>
              Payout wallet fee limit (TRX)
              <Input type="number" min={5} max={500} step={1} value={form.cryptoFeeLimitTrx} onChange={(e) => set("cryptoFeeLimitTrx", e.target.value as unknown as number)} required />
              <span>Only for the payout wallet: a transfer that would cost more waits.</span>
            </label>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold">Payout methods and fees</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Which methods affiliates can add, and what each costs. A fee is only deducted when the affiliate pays it — and they see amount, fee and net before requesting.</p>
          <label className={`${label} mt-3 max-w-sm`}>
            Who pays the fee
            <select value={form.feePolicy} onChange={(e) => set("feePolicy", e.target.value as PayoutSettings["feePolicy"])} className={selectClass}>
              <option value="platform">TradeLoop pays — affiliates receive the full amount</option>
              <option value="affiliate">The affiliate pays — the fee is deducted from the payout</option>
            </select>
          </label>
          <div className="mt-3 overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">Method</th>
                  <th className="px-3 py-2 text-start font-medium">Offered</th>
                  <th className="px-3 py-2 text-start font-medium">Fixed fee (USD)</th>
                  <th className="px-3 py-2 text-start font-medium">Plus %</th>
                  <th className="px-3 py-2 text-start font-medium">How it is sent</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {PAYOUT_METHOD_TYPES.map((t) => {
                  const coin = cryptoSpec(t)
                  const unavailable = (t === "stripe" && !stripeReady) || (!!coin && !coin.verifiable && !exchangeReady)
                  return (
                    <tr key={t}>
                      <td className="px-3 py-2 font-medium">{PAYOUT_METHOD_LABELS[t]}</td>
                      <td className="px-3 py-2">
                        <input aria-label={`Offer ${PAYOUT_METHOD_LABELS[t]}`} type="checkbox" role="switch" checked={form.methods.includes(t) && !unavailable} disabled={unavailable} onChange={(e) => toggleMethod(t, e.target.checked)} className="size-4 accent-[var(--primary)]" />
                      </td>
                      <td className="px-3 py-2">
                        <Input aria-label={`${PAYOUT_METHOD_LABELS[t]} fixed fee`} type="number" min={0} max={1000} step="0.01" value={form.fees[t].fixed} onChange={(e) => fee(t, "fixed", e.target.value)} className="w-24" disabled={form.feePolicy !== "affiliate"} />
                      </td>
                      <td className="px-3 py-2">
                        <Input aria-label={`${PAYOUT_METHOD_LABELS[t]} percent fee`} type="number" min={0} max={50} step="0.1" value={form.fees[t].percent} onChange={(e) => fee(t, "percent", e.target.value)} className="w-20" disabled={form.feePolicy !== "affiliate"} />
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {coin ? (
                          exchangeReady ? (
                            `By the KuCoin account — ${form.cryptoAutoSend ? "automatically inside the limits above, otherwise" : ""} when you approve it${coin.verifiable ? ", or by hand. Completed when KuCoin and the TRON network confirm it" : ". Completed when KuCoin confirms the withdrawal"}`
                          ) : !coin.verifiable ? (
                            "Not configured — needs the KuCoin account"
                          ) : form.cryptoAutoSend && walletReady ? (
                            "Automatically from the payout wallet (inside the limits above), otherwise by hand; completed when the TRON network confirms it"
                          ) : (
                            "By hand from your wallet; completed when the TRON network confirms the transaction"
                          )
                        ) : t === "stripe" ? (stripeReady ? "Automatically, by Stripe transfer" : "Not configured — needs STRIPE_CONNECT_SECRET_KEY") : "By hand; you confirm when it's sent"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </fieldset>
      {canManage && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save payout settings"}
          </Button>
          <p className="text-xs text-muted-foreground">Limits and switches are read by the worker at the moment it creates each payout, so a change applies from the very next one.</p>
        </div>
      )}
    </form>
  )
}

// --- Per-affiliate payout controls --------------------------------------------

export function PayoutControls({ affiliateId, name, controls, inherited }: { affiliateId: number; name: string; controls: { autoPayoutAllowed: boolean; manualPayoutAllowed: boolean; autoPayout: boolean; minOverride: number | null; maxOverride: number | null }; inherited: { min: number; max: number | null } }) {
  const [min, setMin] = useState(controls.minOverride == null ? "" : String(controls.minOverride))
  const [max, setMax] = useState(controls.maxOverride == null ? "" : String(controls.maxOverride))
  const { pending, run } = useAction()
  const dirty = min !== (controls.minOverride == null ? "" : String(controls.minOverride)) || max !== (controls.maxOverride == null ? "" : String(controls.maxOverride))

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border">
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
          <div>
            <p className="text-sm font-medium">Automatic Payouts {controls.autoPayoutAllowed ? "Enabled" : "Disabled"}</p>
            <p className="text-xs text-muted-foreground">
              {controls.autoPayoutAllowed ? (controls.autoPayout ? "The affiliate has switched them on." : "The affiliate hasn't switched them on.") : "The worker will not create a payout for this affiliate."}
            </p>
          </div>
          {controls.autoPayoutAllowed ? (
            <ConfirmButton
              variant="destructive"
              destructive
              title={`Disable automatic payouts for ${name}?`}
              description="From the very next run, no automatic payout is created for them. Nothing else changes: their balance stays available, payout methods stay on file, the account isn't suspended, commissions aren't reversed, completed payouts are unaffected, and they can still request a payout by hand (unless you switch that off too)."
              confirmLabel="Disable Automatic Payouts"
              reason={{ label: "Reason (the affiliate is told; also in the audit log)" }}
              action={(reason) => setPayoutControls(affiliateId, { autoPayoutAllowed: false }, reason)}
            >
              Disable Automatic Payouts
            </ConfirmButton>
          ) : (
            <ConfirmButton variant="default" title={`Enable automatic payouts for ${name}?`} description="They can switch automatic payouts back on. Every payout still passes the normal checks." confirmLabel="Enable Automatic Payouts" action={() => setPayoutControls(affiliateId, { autoPayoutAllowed: true })}>
              Enable Automatic Payouts
            </ConfirmButton>
          )}
        </div>
        <label className="flex cursor-pointer items-center justify-between gap-4 border-t px-3 py-3">
          <span>
            <span className="block text-sm font-medium">Manual payout requests</span>
            <span className="block text-xs text-muted-foreground">Whether they can request a payout themselves.</span>
          </span>
          <input type="checkbox" role="switch" checked={controls.manualPayoutAllowed} disabled={pending} onChange={(e) => run(() => setPayoutControls(affiliateId, { manualPayoutAllowed: e.target.checked }))} className="size-4 accent-[var(--primary)]" />
        </label>
      </div>
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          run(() => setPayoutControls(affiliateId, { minPayoutOverride: min === "" ? null : Number(min), maxPayoutOverride: max === "" ? null : Number(max) }))
        }}
      >
        <label className={label}>
          Minimum payout
          <Input type="number" min={0.01} step="0.01" value={min} onChange={(e) => setMin(e.target.value)} placeholder={`Inherited (${money(inherited.min)})`} />
        </label>
        <label className={label}>
          Maximum payout
          <Input type="number" min={0.01} step="0.01" value={max} onChange={(e) => setMax(e.target.value)} placeholder={inherited.max == null ? "Inherited (none)" : `Inherited (${money(inherited.max)})`} />
        </label>
        <div className="col-span-2">
          <Button type="submit" variant="outline" size="sm" disabled={pending || !dirty}>
            Save limits
          </Button>
        </div>
      </form>
    </div>
  )
}

// `held`: the method is inside its security hold (or too new to be sent to
// automatically) and an admin hasn't lifted that yet.
export function MethodAdminActions({ id, status, name, held = false }: { id: number; status: string; name: string; held?: boolean }) {
  if (status === "removed") return null
  if (status === "rejected" || status === "verification_required") {
    return (
      <ConfirmButton size="xs" title={`Restore ${name}?`} description="It becomes usable for payouts again." confirmLabel="Restore" action={() => setPayoutMethodStatus(id, "active")}>
        Restore
      </ConfirmButton>
    )
  }
  if (status !== "active" && status !== "disabled") return null
  return (
    <>
      {held && (
        <ConfirmButton size="xs" title={`Remove the security hold on ${name}?`} description="It can be paid to straight away, and automatic sending no longer waits for it to have been on file. Only do this if you're sure the affiliate added it themselves — the hold is what protects a hijacked account." confirmLabel="Remove hold" reason={{ label: "Reason (kept in the audit log)" }} action={(reason) => removePayoutMethodHold(id, reason)}>
          Remove hold
        </ConfirmButton>
      )}
    <ConfirmButton size="xs" variant="ghost" destructive title={`Reject ${name}?`} description="It can no longer be paid to, and the affiliate is told. Payouts already in progress to it are not changed — cancel or hold those separately." confirmLabel="Reject method" reason={{ label: "Reason (the affiliate sees this)" }} action={(reason) => setPayoutMethodStatus(id, "rejected", reason)}>
      Reject
    </ConfirmButton>
    </>
  )
}
