"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowLeftRight, Info, Landmark, ShieldCheck, TriangleAlert, Wallet } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { connectStripe, savePayoutMethod } from "@/app/actions/affiliate"
import { bankScheme, validateMethod } from "@/lib/affiliates/method-validation"
import { USDT_LOGO, USDT_TRC20_LOGO } from "@/lib/affiliates/coin-logos"
import { cryptoSpec } from "@/lib/affiliates/crypto"
import { maskAddress } from "@/lib/affiliates/tron"
import { PAYOUT_CURRENCIES, PAYOUT_METHOD_BLURBS, PAYOUT_METHOD_LABELS, type PayoutMethodType } from "@/lib/affiliates/types"
import { CodePrompt } from "./action-code"
import { selectClass } from "./ui"

// --- Method marks ---------------------------------------------------------------
// The coins carry their own logos; the rest are small monogram tiles in the
// method's colour. USDT on TRON is the Tether coin with the TRON mark on its
// corner; USDT on Aptos is the plain Tether coin (lib/affiliates/coin-logos).

// eslint-disable-next-line @next/next/no-img-element
const logo = (src: string, className?: string) => <img src={src} alt="" width={96} height={96} className={cn("block size-full object-contain", className)} />

// The Litecoin mark (glyph from the public-domain cryptocurrency-icons set, CC0).
const litecoin = (
  <svg viewBox="0 0 32 32" className="size-full" aria-hidden>
    <circle cx="16" cy="16" r="16" fill="#345d9d" />
    <path fill="#fff" fillRule="evenodd" d="M10.427 19.214L9 19.768l.688-2.759 1.444-.58L13.213 8h5.129l-1.519 6.196 1.41-.571-.68 2.75-1.427.571-.848 3.483H23L22.127 24H9.252z" />
  </svg>
)

const MARKS: Record<PayoutMethodType, { className: string; node: React.ReactNode }> = {
  paypal: { className: "bg-[#003087] text-white", node: <span className="text-[15px] font-black italic leading-none">P</span> },
  wise: { className: "bg-[#9fe870] text-[#163300]", node: <ArrowLeftRight className="size-4" aria-hidden /> },
  bank: { className: "bg-muted text-foreground", node: <Landmark className="size-4" aria-hidden /> },
  stripe: { className: "bg-[#635bff] text-white", node: <span className="text-[15px] font-bold leading-none">S</span> },
  // that file has a ring around the coin: scaled so the coin itself matches the plain one
  crypto_trc20: { className: "", node: logo(USDT_TRC20_LOGO, "scale-[1.16]") },
  crypto_aptos: { className: "", node: logo(USDT_LOGO) },
  crypto_ltc: { className: "", node: litecoin },
}

export function MethodMark({ type, className }: { type: string; className?: string }) {
  const mark = MARKS[type as PayoutMethodType] ?? { className: "bg-muted text-foreground", node: <Wallet className="size-4" aria-hidden /> }
  return (
    <span aria-hidden className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", mark.className, className)}>
      {mark.node}
    </span>
  )
}

// --- Form pieces ----------------------------------------------------------------

function Field({ label, error, hint, required, children }: { label: string; error?: string | null; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-foreground">
      <span>
        {label}
        {required && <span className="ms-0.5 text-[var(--loss)]" aria-hidden> *</span>}
      </span>
      {children}
      {error ? (
        <span role="alert" className="font-normal text-[var(--loss)]">
          {error}
        </span>
      ) : hint ? (
        <span className="font-normal text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  )
}

function Choice<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-2">
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={cn("flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition-colors", value === v ? "border-primary bg-primary/8 font-medium" : "border-input hover:bg-muted")}>
          <span className={cn("flex size-3.5 items-center justify-center rounded-full border", value === v ? "border-primary" : "border-muted-foreground/50")}>{value === v && <span className="size-1.5 rounded-full bg-primary" />}</span>
          {text}
        </button>
      ))}
    </div>
  )
}

type Countries = { code: string; name: string }[]
// What the last step answers with: Stripe hands back where to go, the others a message.
type Saved = { ok: true; url?: string; message?: string } | { ok: false; error: string }
type Form = Record<string, string>

function CountryCurrency({ form, set, countries, errors }: { form: Form; set: (k: string, v: string) => void; countries: Countries; errors: Record<string, string> }) {
  return (
    <>
      <Field label="Country" required error={errors.country}>
        <select value={form.country ?? ""} onChange={(e) => set("country", e.target.value)} className={selectClass} autoComplete="country">
          <option value="">Choose…</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Currency" required error={errors.currency} hint="The currency your account receives in. Payouts are calculated in USD.">
        <select value={form.currency ?? ""} onChange={(e) => set("currency", e.target.value)} className={selectClass}>
          <option value="">Choose…</option>
          {PAYOUT_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
    </>
  )
}

const Note = ({ children }: { children: React.ReactNode }) => (
  <div className="flex gap-2.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs text-muted-foreground">
    <Info className="mt-px size-4 shrink-0 text-primary" aria-hidden />
    <div>{children}</div>
  </div>
)

// --- The dialog -----------------------------------------------------------------

export function PayoutMethodDialog({
  open,
  onOpenChange,
  methods,
  countries,
  defaultCountry,
  holdHours,
  hasMethod,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The methods the program offers, in display order.
  methods: PayoutMethodType[]
  countries: Countries
  defaultCountry: string
  // > 0 when adding to an account that already has a method means a security hold.
  holdHours: number
  hasMethod: boolean
}) {
  const [type, setType] = useState<PayoutMethodType>(methods[0] ?? "paypal")
  const blank = useMemo<Form>(() => ({ country: defaultCountry, currency: "USD", accountType: "personal", bankAccountType: "checking" }), [defaultCountry])
  const [form, setForm] = useState<Form>(blank)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [confirmNetwork, setConfirmNetwork] = useState(false)
  // Crypto has a second step: look at the address once more before saving.
  const [confirming, setConfirming] = useState(false)
  const [tail, setTail] = useState("")
  const [redirecting, setRedirecting] = useState(false)
  // The last step of every path: a verification code, then the method is
  // saved (or, for Stripe, its own pages are opened).
  const [verifying, setVerifying] = useState<null | "save" | "stripe">(null)
  const router = useRouter()
  const pending = verifying != null

  const set = (k: string, v: string) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => (e[k] ? { ...e, [k]: "" } : e))
  }
  const reset = (next: PayoutMethodType = type) => {
    setType(next)
    setForm(blank)
    setErrors({})
    setConfirmNetwork(false)
    setConfirming(false)
    setTail("")
  }
  const close = (next: boolean) => {
    if (!next) reset(methods[0] ?? "paypal")
    onOpenChange(next)
  }

  // A crypto method is a fixed asset on a fixed network; its own rules check the address.
  const coin = cryptoSpec(type)
  const address = coin ? coin.normalize(form.address) : ""
  const addressProblem = coin && address ? coin.addressProblem(address) : null
  const scheme = bankScheme(form.country ?? "")

  // What gets sent. The server validates it again from scratch.
  const payload = (): Record<string, unknown> => {
    if (type === "paypal") return { email: form.email, accountType: form.accountType, country: form.country, currency: form.currency }
    if (type === "wise") return { email: form.email, holder: form.holder, country: form.country, currency: form.currency }
    if (type === "bank") return { holder: form.holder, country: form.country, currency: form.currency, bankName: form.bankName, routing: form.routing, account: form.account, accountType: form.bankAccountType, iban: form.iban, swift: form.swift }
    return { nickname: form.nickname, address, network: coin?.network, asset: coin?.asset, confirmNetwork, confirmTail: tail }
  }

  function submit() {
    // Same rules as the server, for an answer without a round trip. For crypto
    // the re-typed tail is only asked for on the confirmation step.
    const check = validateMethod(type, coin && !confirming ? { ...payload(), confirmTail: address.slice(-6) } : payload())
    if (!check.ok) {
      setErrors({ [check.field ?? "form"]: check.error })
      return
    }
    if (coin && !confirming) {
      setConfirming(true)
      return
    }
    setVerifying("save")
  }

  const label = PAYOUT_METHOD_LABELS[type]
  const canSubmit = coin ? (confirming ? tail.length === 6 : !!address && !addressProblem && confirmNetwork) : type !== "stripe"

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        {/* A full-screen sheet on a phone, a centred two-column window from sm up. */}
        <DialogContent className="left-0 top-0 flex h-svh max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[min(44rem,92svh)] sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl">
          <header className="flex items-start gap-3 border-b px-5 py-4 pe-12">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Wallet className="size-5" aria-hidden />
            </span>
            <div>
              <DialogTitle className="text-base font-semibold">{confirming ? "Confirm Wallet Address" : "Add Payout Method"}</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-muted-foreground">{confirming ? "One last look before it's saved — crypto payments can't be undone." : "Choose a payout method and provide the necessary details to receive your earnings."}</DialogDescription>
            </div>
          </header>

          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            {confirming ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="mx-auto flex max-w-md flex-col gap-4">
                  <p className="text-sm text-muted-foreground">You are adding:</p>
                  <div className="flex items-center gap-3 rounded-xl border px-4 py-3.5">
                    <MethodMark type={type} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{coin?.summary}</p>
                      <p className="font-mono text-sm text-muted-foreground">Wallet: {maskAddress(address)}</p>
                    </div>
                  </div>
                  <p className="text-sm">
                    Make sure this address is correct. {coin?.assetName} sent to a wrong address, or to a wallet that doesn&apos;t support {coin?.standard}, is lost for good.
                  </p>
                  <Field label="Type the last 6 characters of the wallet address" required error={errors.confirmTail} hint="Check them against your wallet app, not this screen.">
                    <Input value={tail} onChange={(e) => (setTail(e.target.value.trim().slice(0, 6)), setErrors({}))} maxLength={6} autoComplete="off" autoCapitalize="off" spellCheck={false} className="font-mono tracking-widest" autoFocus aria-invalid={!!errors.confirmTail} />
                  </Field>
                  {errors.form && <p role="alert" className="text-sm text-[var(--loss)]">{errors.form}</p>}
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto sm:grid sm:grid-cols-[15.5rem_1fr] sm:overflow-hidden">
                {/* Method picker: a scrolling strip on a phone, a column from sm up */}
                <div role="radiogroup" aria-label="Payout method" className="flex shrink-0 gap-2 overflow-x-auto border-b p-3 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-e sm:p-4">
                  {methods.map((m) => {
                    const selected = m === type
                    return (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => reset(m)}
                        className={cn("flex w-44 shrink-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-start transition-colors sm:w-auto", selected ? "border-primary bg-primary/6 ring-1 ring-primary" : "hover:bg-muted/60")}
                      >
                        <span className={cn("hidden size-4 shrink-0 items-center justify-center rounded-full border sm:flex", selected ? "border-primary" : "border-muted-foreground/40")}>{selected && <span className="size-2 rounded-full bg-primary" />}</span>
                        <MethodMark type={m} className="size-8" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{cryptoSpec(m)?.title ?? PAYOUT_METHOD_LABELS[m]}</span>
                          <span className="block truncate text-xs text-muted-foreground">{PAYOUT_METHOD_BLURBS[m].tagline}</span>
                          <span className="block truncate text-xs text-muted-foreground">{cryptoSpec(m) ? PAYOUT_METHOD_BLURBS[m].timing : `(${PAYOUT_METHOD_BLURBS[m].timing})`}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>

                <div className="min-w-0 shrink-0 p-4 sm:overflow-y-auto sm:p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <MethodMark type={type} />
                    <div>
                      <p className="text-sm font-semibold">{coin?.title ?? label}</p>
                      <p className="text-xs text-muted-foreground">
                        {type === "paypal" && "Get paid directly to your PayPal account."}
                        {type === "wise" && "Get paid to your Wise account."}
                        {type === "bank" && "Get paid by transfer to your bank account."}
                        {type === "stripe" && "Get paid through your own Stripe account."}
                        {coin && `Get paid in ${coin.assetName} on the ${coin.networkLabel} network.`}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-4">
                    {type === "paypal" && (
                      <>
                        <Field label="Email Address" required error={errors.email} hint="This must be the email of a verified PayPal account.">
                          <Input type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} placeholder="you@yourname.com" autoComplete="email" aria-invalid={!!errors.email} autoFocus />
                        </Field>
                        <Field label="Account Type" required error={errors.accountType}>
                          <Choice label="Account type" value={form.accountType ?? "personal"} onChange={(v) => set("accountType", v)} options={[["personal", "Personal"], ["business", "Business"]]} />
                        </Field>
                        <CountryCurrency form={form} set={set} countries={countries} errors={errors} />
                        <Note>Your PayPal account must be verified and able to receive payments.</Note>
                      </>
                    )}

                    {type === "wise" && (
                      <>
                        <Field label="Wise account email" required error={errors.email}>
                          <Input type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} placeholder="you@yourname.com" autoComplete="email" aria-invalid={!!errors.email} autoFocus />
                        </Field>
                        <Field label="Account holder name" required error={errors.holder} hint="Exactly as it appears on your Wise account.">
                          <Input value={form.holder ?? ""} onChange={(e) => set("holder", e.target.value)} maxLength={80} autoComplete="name" aria-invalid={!!errors.holder} />
                        </Field>
                        <CountryCurrency form={form} set={set} countries={countries} errors={errors} />
                      </>
                    )}

                    {type === "bank" && (
                      <>
                        <Field label="Account holder name" required error={errors.holder} hint="Exactly as it appears on the bank account.">
                          <Input value={form.holder ?? ""} onChange={(e) => set("holder", e.target.value)} maxLength={80} autoComplete="name" aria-invalid={!!errors.holder} autoFocus />
                        </Field>
                        <CountryCurrency form={form} set={set} countries={countries} errors={errors} />
                        {/* Only the fields this country's banks use */}
                        {!form.country ? (
                          <Note>Choose the bank&apos;s country to see the account details it needs.</Note>
                        ) : scheme === "us" ? (
                          <>
                            <Field label="Routing number (ABA)" required error={errors.routing}>
                              <Input value={form.routing ?? ""} onChange={(e) => set("routing", e.target.value)} inputMode="numeric" maxLength={9} autoComplete="off" aria-invalid={!!errors.routing} />
                            </Field>
                            <Field label="Account number" required error={errors.account}>
                              <Input value={form.account ?? ""} onChange={(e) => set("account", e.target.value)} inputMode="numeric" maxLength={17} autoComplete="off" aria-invalid={!!errors.account} />
                            </Field>
                            <Field label="Account type" required>
                              <Choice label="Bank account type" value={form.bankAccountType ?? "checking"} onChange={(v) => set("bankAccountType", v)} options={[["checking", "Checking"], ["savings", "Savings"]]} />
                            </Field>
                          </>
                        ) : scheme === "iban" ? (
                          <>
                            <Field label="IBAN" required error={errors.iban}>
                              <Input value={form.iban ?? ""} onChange={(e) => set("iban", e.target.value)} maxLength={42} autoComplete="off" autoCapitalize="characters" spellCheck={false} className="font-mono" aria-invalid={!!errors.iban} />
                            </Field>
                            <Field label="SWIFT / BIC" error={errors.swift} hint="Optional for most transfers inside the same region.">
                              <Input value={form.swift ?? ""} onChange={(e) => set("swift", e.target.value)} maxLength={11} autoComplete="off" autoCapitalize="characters" spellCheck={false} className="font-mono" aria-invalid={!!errors.swift} />
                            </Field>
                          </>
                        ) : (
                          <>
                            <Field label="Account number" required error={errors.account}>
                              <Input value={form.account ?? ""} onChange={(e) => set("account", e.target.value)} maxLength={34} autoComplete="off" aria-invalid={!!errors.account} />
                            </Field>
                            <Field label="SWIFT / BIC" required error={errors.swift}>
                              <Input value={form.swift ?? ""} onChange={(e) => set("swift", e.target.value)} maxLength={11} autoComplete="off" autoCapitalize="characters" spellCheck={false} className="font-mono" aria-invalid={!!errors.swift} />
                            </Field>
                          </>
                        )}
                        {form.country && (
                          <Field label="Bank name" required={scheme === "swift"} error={errors.bankName}>
                            <Input value={form.bankName ?? ""} onChange={(e) => set("bankName", e.target.value)} maxLength={80} autoComplete="off" aria-invalid={!!errors.bankName} />
                          </Field>
                        )}
                      </>
                    )}

                    {type === "stripe" && (
                      <>
                        <Note>
                          Stripe collects and verifies your bank details on its own secure pages — TradeLoop never sees them. You&apos;ll come back here when you&apos;re done, and the account becomes usable once Stripe has approved it.
                        </Note>
                        <ul className="divide-y rounded-lg border text-sm">
                          {[
                            ["Not connected", "Nothing set up yet."],
                            ["Onboarding", "Stripe still needs some details from you."],
                            ["Connected", "Ready to receive payouts."],
                            ["Restricted", "Stripe needs something more before it can pay you."],
                          ].map(([state, text]) => (
                            <li key={state} className="flex items-baseline justify-between gap-3 px-3 py-2">
                              <span className="font-medium">{state}</span>
                              <span className="text-end text-xs text-muted-foreground">{text}</span>
                            </li>
                          ))}
                        </ul>
                        {redirecting ? (
                          <div role="status" aria-label="Opening Stripe" className="flex flex-col gap-2">
                            <div className="h-9 animate-pulse rounded-lg bg-muted" />
                            <div className="h-9 animate-pulse rounded-lg bg-muted" />
                          </div>
                        ) : (
                          <Button type="button" onClick={() => setVerifying("stripe")}>
                            Continue to Stripe
                          </Button>
                        )}
                      </>
                    )}

                    {coin && (
                      <>
                        <Field label="Wallet Label" hint="Only you see this.">
                          <Input value={form.nickname ?? ""} onChange={(e) => set("nickname", e.target.value)} maxLength={40} placeholder={`Main ${coin.asset} Wallet`} autoFocus />
                        </Field>
                        <Field label="Wallet Address" required error={errors.address ?? (address.length >= coin.minLength && addressProblem ? coin.invalidMessage : null)}>
                          <Input value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} placeholder={coin.placeholder} maxLength={coin.maxLength} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} className="font-mono" aria-invalid={!!errors.address || (address.length >= coin.minLength && !!addressProblem)} />
                        </Field>
                        <div className="grid gap-4 sm:grid-cols-2">
                          {/* Fixed, not choosable: this method is one asset on one network and nothing else. */}
                          <Field label="Network">
                            <Input value={coin.networkLabel} readOnly disabled aria-readonly />
                          </Field>
                          <Field label="Currency">
                            <Input value={coin.asset} readOnly disabled aria-readonly />
                          </Field>
                        </div>
                        <div className="rounded-lg border border-[var(--chart-4)]/40 bg-[var(--chart-4)]/8 px-3.5 py-3">
                          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--chart-4)]">
                            <TriangleAlert className="size-4" aria-hidden /> Important
                          </p>
                          {coin.warnings.map((line, i) => (
                            <p key={line} className={i === 0 ? "mt-2 text-sm" : "mt-1.5 text-sm"}>
                              {line}
                            </p>
                          ))}
                        </div>
                        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                          <input type="checkbox" checked={confirmNetwork} onChange={(e) => (setConfirmNetwork(e.target.checked), setErrors({}))} className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" aria-invalid={!!errors.confirmNetwork} />
                          <span>{coin.confirmLabel}</span>
                        </label>
                        {errors.confirmNetwork && <p role="alert" className="-mt-2 text-xs text-[var(--loss)]">{errors.confirmNetwork}</p>}
                      </>
                    )}

                    {errors.form && <p role="alert" className="text-sm text-[var(--loss)]">{errors.form}</p>}
                    {hasMethod && holdHours > 0 && type !== "stripe" && <Note>Because your account already has a payout method, the new one can be paid to after a {holdHours}-hour security hold. We&apos;ll email you about the change.</Note>}
                  </div>
                </div>
              </div>
            )}

            {/* Stays in reach at the bottom of the sheet on a phone */}
            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-muted/40 px-5 py-3.5 sm:rounded-b-xl">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div>
                  <p className="text-xs font-medium">Secure payout information</p>
                  <p className="text-xs text-muted-foreground">Account details are encrypted and only shown masked.</p>
                </div>
              </div>
              <div className="flex w-full gap-2 sm:w-auto">
                {confirming ? (
                  <Button type="button" variant="outline" size="lg" className="flex-1 sm:flex-none" onClick={() => (setConfirming(false), setTail(""), setErrors({}))} disabled={pending}>
                    <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /> Back
                  </Button>
                ) : (
                  <Button type="button" variant="outline" size="lg" className="flex-1 sm:flex-none" onClick={() => close(false)} disabled={pending}>
                    Cancel
                  </Button>
                )}
                {type !== "stripe" && (
                  <Button type="submit" size="lg" className="flex-1 sm:flex-none" disabled={pending || !canSubmit}>
                    {confirming ? "Confirm & Add" : "Add Payout Method"}
                  </Button>
                )}
              </div>
            </footer>
          </form>
        </DialogContent>
      </Dialog>
      <CodePrompt
        open={verifying != null}
        onOpenChange={(next) => !next && setVerifying(null)}
        request={{ purpose: "method", type }}
        description={verifying === "stripe" ? "Confirm it's you before continuing to Stripe, where your bank details are entered." : `Confirm it's you to add ${coin?.title ?? label} as a payout method.`}
        confirmLabel={verifying === "stripe" ? "Continue to Stripe" : "Add Payout Method"}
        pendingLabel={verifying === "stripe" ? "Opening Stripe…" : "Adding…"}
        action={(code): Promise<Saved> => (verifying === "stripe" ? connectStripe(code) : savePayoutMethod(type, payload(), code))}
        onDone={(res) => {
          if (res.url) {
            setRedirecting(true)
            window.location.href = res.url
            return
          }
          setVerifying(null)
          if (res.message) toast.success(res.message)
          router.refresh()
          close(false)
        }}
      />
    </>
  )
}
