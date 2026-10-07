"use client"

import type React from "react"
import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, ArrowRight, Bitcoin, CandlestickChart, Check, LayoutGrid, Layers, LineChart, ShieldCheck, SlidersHorizontal, Users, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { helpHref } from "@/lib/urls"
import { setCopyAccountRole } from "@/app/actions/copy-trading"
import { ConnectFlow } from "@/components/metatrader-connect"
import { ConnectForm } from "@/components/rithmic-connect"
import { BrandMark } from "@/components/brand-mark"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { IntegrationBadge, SafeMode } from "@/components/compliance/safe-mode"
import type { ProviderProfile } from "@/lib/compliance/engine"
import { ROLE_LABELS, money, type Role } from "@/lib/copy/view"
import { useAction } from "@/components/insights/client"
import { linkBtn, linkBtnPrimary } from "@/components/insights/ui"
import { useCopy } from "./store"
import { HealthPill, Heartbeat } from "./ui"

// Connect Account, Copy Trading's own: the platform, TradeLoop's connection
// form for it (the same ones as on the Accounts page), a check that the account
// came through, and what it will be used for.
//
// What a card says is what the connection does. A broker or prop firm with
// rules of its own (lib/compliance) is listed from its rules profile, never by
// name here: whether it can be connected, on what terms, and the way its own
// copier offers.

type Category = "forex" | "futures" | "crypto"
type Card = {
  key: string
  name: string
  description: string
  tags: string[]
  category: Category
  logo: React.ReactNode
  action: string
  recommended?: boolean
  provider?: ProviderProfile
}

// `dark` swaps in a variant in dark mode (a black mark would vanish on a dark card).
function Logo({ src, dark }: { src: string; dark?: string }) {
  return (
    <>
      <Image src={src} alt="" width={56} height={56} className={cn("size-full object-cover", dark && "dark:hidden")} />
      {dark && <Image src={dark} alt="" width={56} height={56} className="hidden size-full object-cover dark:block" />}
    </>
  )
}
// A provider TradeLoop ships no logo for: its initials on a tile.
function Initials({ name }: { name: string }) {
  const letters = (name.match(/[A-Z]/g) ?? [name[0] ?? "?"]).slice(0, 2).join("")
  return <span className="flex size-full items-center justify-center bg-gradient-to-br from-violet-500 to-indigo-600 text-lg font-bold text-white">{letters}</span>
}

const PLATFORMS: Card[] = [
  { key: "mt5", name: "MetaTrader 5", description: "Forex, CFDs and more, with the read-only investor password. Receives copied orders once its trading password is added.", tags: ["Forex", "CFDs", "Indices", "Commodities"], category: "forex", logo: <Logo src="/brokers/sm/metatrader.png" />, action: "Connect", recommended: true },
  { key: "mt4", name: "MetaTrader 4", description: "The classic Forex platform, with the read-only investor password. Can lead a group; can't receive orders yet.", tags: ["Forex", "CFDs", "Indices", "Commodities"], category: "forex", logo: <Logo src="/brokers/sm/metatrader.png" />, action: "Connect" },
  { key: "rithmic", name: "Rithmic", description: "Futures prop firms, on your Rithmic login. Can lead a group; can't receive orders yet.", tags: ["Futures", "Options"], category: "futures", logo: <Logo src="/brokers/sm/rithmic.png" />, action: "Connect" },
  { key: "tradingview", name: "TradingView", description: "Paper trading, through the TradeLoop browser extension. Paired on the Accounts page.", tags: ["Stocks", "Forex", "Crypto", "Indices"], category: "crypto", logo: <Logo src="/brokers/sm/tradingview.png" dark="/brokers/sm/tradingview-dark.png" />, action: "Setup guide" },
  { key: "tradovate", name: "Tradovate", description: "Futures, through NinjaTrader with the TradeLoop add-on. Set up on the Accounts page; can lead a group.", tags: ["Futures"], category: "futures", logo: <Logo src="/brokers/sm/tradovate.png" />, action: "Connect" },
]

const CATEGORIES: { key: "all" | Category; label: string; icon: typeof LayoutGrid }[] = [
  { key: "all", label: "All Platforms", icon: LayoutGrid },
  { key: "forex", label: "Forex & CFDs", icon: LineChart },
  { key: "futures", label: "Futures", icon: CandlestickChart },
  { key: "crypto", label: "Crypto", icon: Bitcoin },
]

const STEPS = ["Platform", "Login", "Confirm"]
const ROLES: Role[] = ["leader", "follower", "both"]

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-start" aria-label="Connection steps">
      {STEPS.map((label, i) => {
        const state = i + 1 < current ? "done" : i + 1 === current ? "active" : "upcoming"
        return (
          <li key={label} aria-current={state === "active" ? "step" : undefined} className="flex items-start">
            {i > 0 && <span aria-hidden className={cn("mt-3.5 h-px w-8 sm:w-16", state === "upcoming" ? "bg-border" : "bg-primary")} />}
            <span className="flex w-16 flex-col items-center gap-1.5">
              <span className={cn("flex size-7 items-center justify-center rounded-full text-xs font-semibold", state === "active" && "bg-primary text-primary-foreground ring-4 ring-primary/20", state === "done" && "bg-primary text-primary-foreground", state === "upcoming" && "border bg-card text-muted-foreground")}>
                {state === "done" ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <span className={cn("text-xs font-medium", state === "upcoming" ? "text-muted-foreground" : "text-foreground")}>{label}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// The right-hand panel: what Copy Trading is, in a picture made of the platforms it joins.
function Showcase() {
  const tile = "absolute flex size-14 items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-card shadow-lg shadow-primary/20"
  return (
    <aside className="hidden w-64 shrink-0 flex-col rounded-2xl border bg-gradient-to-b from-primary/[0.07] to-transparent p-5 xl:flex">
      <h3 className="text-2xl leading-tight font-bold tracking-tight">
        Copy Trades Across <span className="bg-gradient-to-r from-primary to-fuchsia-500 bg-clip-text text-transparent">All Your Accounts</span>
      </h3>
      <p className="mt-3 text-sm text-muted-foreground">One platform. Multiple brokers. Total control.</p>
      <div className="relative mx-auto my-6 size-48" aria-hidden>
        <span className="absolute inset-4 rounded-full bg-primary/25 blur-2xl" />
        <span className="absolute inset-3 rounded-full border border-primary/40" />
        <span className={cn(tile, "top-1 left-6 -rotate-6")}>
          <Logo src="/brokers/sm/metatrader.png" />
        </span>
        <span className={cn(tile, "top-6 right-2 rotate-6")}>
          <Logo src="/brokers/sm/tradingview.png" dark="/brokers/sm/tradingview-dark.png" />
        </span>
        <span className={cn(tile, "top-[4.5rem] left-1 rotate-3")}>
          <Logo src="/brokers/sm/tradovate.png" />
        </span>
        <span className={cn(tile, "top-[5.5rem] right-6 -rotate-3")}>
          <Logo src="/brokers/sm/rithmic.png" />
        </span>
        <span className="absolute bottom-0 left-1/2 flex size-16 -translate-x-1/2 items-center justify-center rounded-2xl border border-primary/50 bg-card shadow-xl shadow-primary/30">
          <BrandMark className="size-9" />
        </span>
      </div>
      <ul className="mt-auto space-y-3 rounded-xl border bg-card/60 p-4 text-sm">
        {[
          [ShieldCheck, "Secure Connection"],
          [Zap, "Real-Time Copying"],
          [SlidersHorizontal, "Full Trade Control"],
          [Layers, "Multi-Platform Support"],
        ].map(([Icon, label]) => {
          const I = Icon as typeof ShieldCheck
          return (
            <li key={label as string} className="flex items-center gap-3">
              <I className="size-4 shrink-0 text-primary" aria-hidden />
              {label as string}
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

// Only what the code does: MetaTrader syncs on the investor password, which
// cannot trade, and a saved password is encrypted (lib/crypto) and read by the
// sync server alone. It is stored: this never says otherwise.
function SecurityNote({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card/60 p-4", className)}>
      <ShieldCheck className="size-6 text-primary" aria-hidden />
      <p className="mt-2 text-sm font-semibold">Your security matters</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">MetaTrader connects with the investor password, which can read an account and can never trade on it. A saved password is encrypted and used only by our sync server.</p>
      <a href={helpHref("/connecting-accounts/metatrader")} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
        Learn more <ArrowRight className="size-3.5" aria-hidden />
      </a>
    </div>
  )
}

export function ConnectAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, refresh } = useCopy()
  const router = useRouter()
  const { pending, run } = useAction()
  const [step, setStep] = useState(0)
  const [category, setCategory] = useState<"all" | Category>("all")
  const [platform, setPlatform] = useState<string | null>(null)
  const [before, setBefore] = useState<number[]>([])
  const [role, setRole] = useState<Role>("follower")
  // A provider with rules of its own (lib/compliance): what it allows is shown
  // first, with the ways to use it. `relay`: the account being connected is the
  // one the provider's own copier copies to. `direct`: it is the provider's.
  const [provider, setProvider] = useState<ProviderProfile | null>(null)
  const [relay, setRelay] = useState<ProviderProfile | null>(null)
  const [direct, setDirect] = useState<ProviderProfile | null>(null)
  const [checking, setChecking] = useState(false)
  const account = state.accounts.filter((a) => !before.includes(a.id))[0]

  const cards: Card[] = [
    ...PLATFORMS,
    ...state.providers.map((p): Card => ({
      key: `provider:${p.provider}`,
      name: p.name,
      description: p.connectable
        ? `Connects through MetaTrader 5, read-only${p.risk ? `, at your own risk: ${p.name} does not permit access from a server` : ""}. See what its rules allow first.`
        : `TradeLoop doesn't connect to ${p.name} accounts. See what its rules allow${p.ownCopier ? ", and the way round" : ""}.`,
      tags: ["MetaTrader 5", "Prop firm"],
      category: "forex",
      logo: <Initials name={p.name} />,
      action: p.connectable ? "Connect" : "See how",
      provider: p,
    })),
  ]
  const shown = cards.filter((c) => category === "all" || c.category === category)
  const count = (key: "all" | Category) => (key === "all" ? cards.length : cards.filter((c) => c.category === key).length)

  const reset = () => {
    setStep(0)
    setPlatform(null)
    setProvider(null)
    setRelay(null)
    setDirect(null)
  }
  const close = () => {
    onClose()
    reset()
    setCategory("all")
  }
  const check = async () => {
    setChecking(true)
    await refresh()
    router.refresh()
    setChecking(false)
  }
  const connected = async () => {
    setStep(2)
    await check()
  }
  const choose = (card: Card) => {
    setBefore(state.accounts.map((a) => a.id))
    setRelay(null)
    setDirect(null)
    setProvider(card.provider ?? null)
    setPlatform(card.provider ? null : card.key)
    setStep(1)
  }
  const chosen = cards.find((c) => c.key === (provider ? `provider:${provider.provider}` : (direct ?? relay) ? `provider:${(direct ?? relay)!.provider}` : platform))
  const outward = (p: ProviderProfile) => !!p.ownCopier && p.lines.some((l) => l.key === "toExternal" && l.allowed)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[94svh] gap-0 overflow-y-auto p-0 sm:max-w-[min(72rem,calc(100%-2rem))]">
        <header className="flex min-w-0 flex-wrap items-start gap-x-6 gap-y-4 border-b p-5 pe-12 sm:p-6 sm:pe-14">
          <span className="hidden size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary sm:flex">
            <Users className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 basis-64">
            <DialogTitle className="text-xl font-bold tracking-tight sm:text-2xl">Connect Account</DialogTitle>
            <DialogDescription className="mt-1 max-w-xl text-sm">Link your trading account to start copy trading. Choose your platform and follow the connection steps.</DialogDescription>
          </div>
          <Stepper current={step === 0 ? 1 : step === 1 ? 2 : 3} />
        </header>

        <div className="flex min-w-0 flex-col gap-4 p-4 sm:p-6 lg:flex-row">
          {/* ------------------------------------------------ left: the kinds of platform, or the one chosen */}
          <nav className="flex min-w-0 shrink-0 flex-col gap-4 lg:w-60" aria-label="Platforms">
            {step === 0 ? (
              <ul className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:p-0">
                {CATEGORIES.map((c) => (
                  <li key={c.key} className="shrink-0">
                    <button
                      type="button"
                      aria-pressed={category === c.key}
                      onClick={() => setCategory(c.key)}
                      className={cn(
                        "flex h-11 w-full items-center gap-2.5 rounded-xl border px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:h-12",
                        category === c.key ? "border-primary/60 bg-primary/10 text-foreground" : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                      )}
                    >
                      <c.icon className="size-4 shrink-0" aria-hidden />
                      <span className="flex-1 text-start">{c.label}</span>
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">{count(c.key)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-xl border bg-card/60 p-4">
                {chosen && (
                  <div className="flex items-center gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border">{chosen.logo}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{chosen.name}</p>
                      <p className="text-xs text-muted-foreground">{relay ? "Relay account" : STEPS[step === 1 ? 1 : 2]}</p>
                    </div>
                  </div>
                )}
                {step === 1 && (
                  <button type="button" className={cn(linkBtn, "mt-3 w-full")} onClick={reset}>
                    <ArrowLeft className="size-3.5" aria-hidden /> All platforms
                  </button>
                )}
              </div>
            )}
            <SecurityNote className="mt-auto hidden lg:block" />
          </nav>

          {/* ------------------------------------------------ middle: the platforms, then the steps */}
          <div className="min-w-0 flex-1">
            {step === 0 && (
              <>
                <ul className="space-y-3">
                  {shown.map((c) => (
                    <li key={c.key}>
                      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border bg-card p-4 transition-colors", c.recommended ? "border-primary/60 ring-1 ring-primary/40" : "hover:border-primary/40")}>
                        <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border">{c.logo}</span>
                        <div className="min-w-0 flex-1 basis-44">
                          <p className="flex flex-wrap items-center gap-2 text-base font-semibold">
                            {c.name}
                            {c.recommended && <span className="rounded-md bg-[var(--gain)]/15 px-1.5 py-0.5 text-[11px] font-semibold text-[var(--gain)]">Recommended</span>}
                            {c.provider && <IntegrationBadge status={c.provider.status} label={c.provider.statusLabel} />}
                          </p>
                          <p className="mt-0.5 text-sm text-muted-foreground">{c.description}</p>
                          <p className="mt-2 flex flex-wrap gap-1.5">
                            {c.tags.map((t) => (
                              <span key={t} className="rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                {t}
                              </span>
                            ))}
                          </p>
                        </div>
                        <button type="button" onClick={() => choose(c)} className={cn(c.recommended ? linkBtnPrimary : linkBtn, "h-10 w-full shrink-0 px-4 sm:w-auto")}>
                          {c.action} <ArrowRight className="size-4" aria-hidden />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  A CSV import or a manual account is added on the{" "}
                  <Link href="/accounts" className="font-medium text-primary hover:underline">
                    Accounts page
                  </Link>
                  . It can&apos;t be copied from or to.
                </p>
                <SecurityNote className="mt-4 lg:hidden" />
              </>
            )}

            {step === 1 && (
              <div className="space-y-3">
                {provider && (
                  <div className="space-y-3 text-sm">
                    <SafeMode profile={provider} />
                    {provider.ownCopier && provider.lines.some((l) => l.key === "ownToOwn" && l.allowed) && (
                      <div className="rounded-xl border p-3">
                        <p className="font-medium">Between your own {provider.name} accounts</p>
                        <p className="mt-1 text-muted-foreground">Use {provider.ownCopier.name}. TradeLoop takes no part in it.</p>
                      </div>
                    )}
                    {outward(provider) && (
                      <div className="rounded-xl border p-3">
                        <p className="font-medium">Inside {provider.name}&apos;s rules: a relay account</p>
                        <ol className="mt-1 list-decimal space-y-1 ps-5 text-muted-foreground">
                          <li>
                            In {provider.ownCopier!.name}, add an ordinary broker account as a Follower of your {provider.name} account. That is your relay account.
                          </li>
                          <li>Connect the relay account here.</li>
                          <li>Make it the Leader of a Copy Group. Your other accounts follow it.</li>
                        </ol>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {provider.guide && (
                        <a href={helpHref(provider.guide)} target="_blank" rel="noreferrer" className={linkBtn}>
                          Read the guide
                        </a>
                      )}
                      {provider.connectable && (
                        <button type="button" className={outward(provider) ? linkBtn : linkBtnPrimary} onClick={() => (setDirect(provider), setRole("leader"), setProvider(null), setPlatform("mt5"))}>
                          Connect the {provider.name} account{provider.risk ? " at my own risk" : ""}
                        </button>
                      )}
                      {outward(provider) && (
                        <button type="button" className={linkBtnPrimary} onClick={() => (setRelay(provider), setRole("leader"), setProvider(null), setPlatform("mt5"))}>
                          Connect the relay account
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {relay && platform === "mt5" && (
                  <p className="rounded-xl border border-primary/30 bg-primary/5 p-2.5 text-xs">
                    The relay account: the broker account {relay.ownCopier?.name ?? `${relay.name}'s copier`} copies to. Not the {relay.name} account itself.
                  </p>
                )}
                {direct && platform === "mt5" && (
                  <p className="rounded-xl border border-primary/30 bg-primary/5 p-2.5 text-xs">
                    Your {direct.name} account: enter its server exactly as MetaTrader shows it, and its investor (read-only) password. Never the main password.
                  </p>
                )}
                {/* TradeLoop's own connection forms: the same ones as on the Accounts page */}
                {(platform === "mt5" || platform === "mt4") && <ConnectFlow initial={{ platform }} lockPlatform onDone={connected} onBack={reset} />}
                {platform === "rithmic" && <ConnectForm onDone={connected} />}
                {(platform === "tradingview" || platform === "tradovate") && (
                  <div className="rounded-xl border border-dashed p-4 text-sm">
                    <p>{platform === "tradingview" ? "TradingView is paired from the Accounts page, with the TradeLoop browser extension." : "Tradovate is set up on the Accounts page: NinjaTrader with the TradeLoop add-on."}</p>
                    <p className="mt-1 text-muted-foreground">Once the account is there it appears on the Connection page, ready to be given a role.</p>
                    <Link href={platform === "tradingview" ? "/accounts?connect=tradingview" : "/accounts"} className={cn(linkBtnPrimary, "mt-3")}>
                      Open Accounts
                    </Link>
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                {account ? (
                  <div className="rounded-xl border p-4">
                    <p className="text-sm font-semibold">{account.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {account.platform} · {money(account.balance)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <HealthPill health={account.health} />
                      <Heartbeat account={account} />
                    </div>
                    {account.health === "syncing" && <p className="mt-2 text-xs text-muted-foreground">The first sync is still running. You can carry on; the status updates by itself.</p>}
                    {(account.health === "disconnected" || account.health === "auth") && <p className="mt-2 text-xs text-[var(--loss)]">{account.healthNote ?? "The connection didn't come up."} Check the login details on the Accounts page.</p>}
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">The new account hasn&apos;t appeared yet. A first sync can take a minute.</p>
                )}
                <div className="flex justify-end gap-2">
                  <button type="button" disabled={checking} className={linkBtn} onClick={check}>
                    {checking ? "Checking…" : "Test again"}
                  </button>
                  <button type="button" disabled={!account} className={linkBtnPrimary} onClick={() => setStep(3)}>
                    Next
                  </button>
                </div>
              </div>
            )}

            {step === 3 && account && (
              <div className="space-y-3">
                {relay && <p className="rounded-xl border border-primary/30 bg-primary/5 p-2.5 text-xs">A relay account leads: it receives your {relay.name} trades, and your other accounts copy it.</p>}
                {direct && <p className="rounded-xl border border-primary/30 bg-primary/5 p-2.5 text-xs">A {direct.name} account can only lead: nothing is copied into it, and TradeLoop places no orders on it.</p>}
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-medium">What is {account.name} for?</legend>
                  {ROLES.map((r) => (
                    <label key={r} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm", role === r && "border-primary bg-primary/5")}>
                      <input type="radio" name="role" className="mt-0.5 size-4 accent-[var(--primary)]" checked={role === r} onChange={() => setRole(r)} />
                      <span>
                        <span className="block font-medium">{ROLE_LABELS[r]}</span>
                        <span className="block text-xs text-muted-foreground">{r === "leader" ? "Other accounts copy what it trades." : r === "follower" ? "It copies a Leader, within its own risk limits." : "It can lead one group and follow another."}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <p className="text-xs text-muted-foreground">A role isn&apos;t permanent: an account can be a Leader in one Copy Group and a Follower in another.</p>
                <div className="flex justify-end">
                  <button type="button" disabled={pending} className={linkBtnPrimary} onClick={() => run(() => setCopyAccountRole(account.id, role), async () => (toast.success("Account connected."), await refresh(), setStep(4)))}>
                    {pending ? "Saving…" : "Next"}
                  </button>
                </div>
              </div>
            )}

            {step === 4 && account && (
              <div className="rounded-xl border p-6 text-center">
                <Check className="mx-auto size-6 text-[var(--gain)]" aria-hidden />
                <p className="mt-2 text-base font-semibold">{account.name} is ready.</p>
                <p className="mt-1 text-sm text-muted-foreground">Add it to a Copy Group to start using it as a {ROLE_LABELS[role].toLowerCase()}.</p>
                <button type="button" className={cn(linkBtnPrimary, "mt-4")} onClick={close}>
                  Done
                </button>
              </div>
            )}
          </div>

          {/* ------------------------------------------------ right: what it is all for */}
          {step === 0 && <Showcase />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
