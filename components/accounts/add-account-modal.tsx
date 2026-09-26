"use client"

import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, FileUp, Info, Lock, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useT } from "@/components/locale-provider"
import { ConnectForm, type RithmicConnected } from "@/components/rithmic-connect"
import { ConnectFlow, type MetaTraderStage } from "@/components/metatrader-connect"
import { TradingViewSetup } from "@/components/tradingview-connect"
import { BrokerImport, type ImportSummary } from "@/components/broker-import"
import { LiveSyncUpgradeBanner } from "@/components/live-sync-upgrade-banner"
import type { TradingViewPairingView } from "@/app/actions/tradingview"
import { ConnectionStepper } from "@/components/accounts/connection-stepper"
import { TradovateConnect, TradovateProgress, type TradovateProgressState } from "@/components/accounts/tradovate-connect"
import { NinjaTraderSetup, type NinjaTraderSetupState } from "@/components/accounts/ninjatrader-setup"
import { TradovateCredentials, type TradovateCredentialsState } from "@/components/accounts/tradovate-credentials"
import { Badge, PlatformCard, type PlatformBadge } from "@/components/accounts/platform-card"
import type { PlatformId } from "@/components/accounts/types"
import type { PlanUsage } from "@/lib/plan-allowance"

// The Add account window: every way of adding an account starts here
// ("+ Add account", "Connect another account", Reconnect, /accounts?connect=).
//
// Step 1 — choose: the platforms on the left, the chosen one's details on the
// right (what it syncs, what you'll need, how your details are kept) with
// Continue. Step 2 — connect: that platform's own form on the left, same
// guide on the right. Step 3 — the result (success / error), still here.
// One column on phones, with Continue pinned to the bottom.

// What the page asks the window to open with; `nonce` restarts it.
export interface AddAccountRequest {
  platform: PlatformId | null // skip the choice: straight to connecting
  initial?: { server?: string; login?: string } // Reconnect
  tradovateConnectionId?: number | null // back from Tradovate's sign-in: show that first sync
  nonce: number
}

// Whether Tradovate can be connected on this deployment (TRADOVATE_MODE and
// credentials — lib/tradovate/config), and what the sign-in redirect said.
export interface TradovateSetup {
  enabled: boolean // official Tradovate OAuth is configured (TRADOVATE_MODE)
  mock: boolean
  connectionId: number | null
  error: string | null
  // The VPS NinjaTrader relay is configured, so Tradovate can be connected with
  // credentials (like MetaTrader). When off, the PC add-on setup is shown.
  ninjaVps: boolean
}

type Outcome =
  | { kind: "rithmic"; ok: true; result: RithmicConnected }
  | { kind: "rithmic"; ok: false; message: string }
  | { kind: "file"; ok: true; summary: ImportSummary }

function TintIcon({ children }: { children: React.ReactNode }) {
  return <span className="flex size-full items-center justify-center bg-primary/10 text-primary">{children}</span>
}

// `dark` swaps in a variant in dark mode (TradingView's black tile would
// disappear on a dark card).
function Logo({ src, dark }: { src: string; dark?: string }) {
  return (
    <>
      <Image src={src} alt="" width={44} height={44} className={cn("size-full object-cover", dark && "dark:hidden")} />
      {dark && <Image src={dark} alt="" width={44} height={44} className="hidden size-full object-cover dark:block" />}
    </>
  )
}

interface PlatformDef {
  id: PlatformId
  name: string
  card: string // the grid card's two-line description
  badge: PlatformBadge
  icon: React.ReactNode
  live: boolean // syncs by itself (Pro; on Essential, MetaTrader only)
  soon?: boolean // not connectable yet
  keywords: string // extra search terms
  about: string
  needs: string[]
  // How the details it asks for are kept — only what's true of each.
  security: string | null
}

// The platforms TradeLoop connects today. The security lines are exact:
// Rithmic and MetaTrader passwords are stored encrypted (lib/crypto,
// AES-256-GCM) because syncing needs them; MetaTrader only ever gets the
// read-only investor password; TradingView pairing stores nothing of the
// TradingView login; a file needs no login at all.
const PLATFORMS: PlatformDef[] = [
  {
    id: "rithmic",
    name: "Rithmic",
    card: "Futures prop firms, live sync",
    badge: "live",
    icon: <Logo src="/brokers/sm/rithmic.png" />,
    live: true,
    keywords: "futures prop firm apex bulenox tradeify topstep lucid",
    about: "Connect your Rithmic login once — every account under it is added, and new fills sync automatically.",
    needs: ["Your Rithmic username and password (from your prop firm)", "Which prop firm or Rithmic system it's with"],
    security: "Your Rithmic password is saved encrypted (AES-256) so syncing can continue, and is only used to read your fills — TradeLoop never places or changes orders.",
  },
  {
    id: "mt5",
    name: "MetaTrader 5",
    card: "Forex & CFDs, live sync",
    badge: "live",
    icon: <Logo src="/brokers/sm/metatrader.png" />,
    live: true,
    keywords: "mt5 forex cfd ftmo exness fundednext broker prop",
    about: "Connect with your account number and investor password — new trades and your balance sync about every minute.",
    needs: ["Your account number (login)", "The investor (read-only) password", "Your broker's server name, e.g. FTMO-Server3"],
    security: "Only the investor (read-only) password is used — it can view the account but can't place trades. It's saved encrypted so syncing can continue.",
  },
  {
    id: "mt4",
    name: "MetaTrader 4",
    card: "Forex & CFDs, live sync",
    badge: "live",
    icon: <Logo src="/brokers/sm/metatrader.png" />,
    live: true,
    keywords: "mt4 forex cfd ftmo exness broker prop",
    about: "Connect with your account number and investor password — new trades and your balance sync about every minute.",
    needs: ["Your account number (login)", "The investor (read-only) password", "Your broker's server name, e.g. Exness-Real6"],
    security: "Only the investor (read-only) password is used — it can view the account but can't place trades. It's saved encrypted so syncing can continue.",
  },
  {
    id: "tradingview",
    name: "TradingView",
    card: "Paper trading, via our extension",
    badge: "paper",
    icon: <Logo src="/brokers/sm/tradingview.png" dark="/brokers/sm/tradingview-dark.png" />,
    live: true,
    keywords: "paper trading extension chrome",
    about: "Pair the TradeLoop browser extension once — paper trades then sync on their own while TradingView is open.",
    needs: ["Chrome, Edge, Brave, Opera or Vivaldi", "The TradeLoop browser extension", "A TradingView paper trading account"],
    security: "Pairing stores nothing of your TradingView login — the extension reads your paper account in your own signed-in browser.",
  },
  {
    id: "file",
    name: "File import",
    card: "Import trade history from files",
    badge: "file",
    icon: (
      <TintIcon>
        <FileUp className="size-5" />
      </TintIcon>
    ),
    live: false,
    keywords: "csv html report tradovate ninjatrader metatrader tradingview upload",
    about: "Upload an export from your platform — accounts in the file are created automatically, and re-importing never duplicates trades.",
    needs: ["An export from Tradovate, NinjaTrader, TradingView or MetaTrader"],
    security: "The file is read once to import your trades — no login or password needed.",
  },
  // Tradovate through NinjaTrader 8 (the TradeLoop add-on). Replaced by
  // TRADOVATE_LIVE below when Tradovate's own API is configured.
  {
    id: "tradovate",
    name: "Tradovate",
    card: "Futures, live sync via NinjaTrader",
    badge: "live",
    icon: <Logo src="/brokers/sm/tradovate.png" />,
    live: true,
    keywords: "futures prop apex tradeify mffu myfundedfutures takeprofit ninjatrader nt8 add-on addon",
    about: "Connect your Tradovate account in NinjaTrader 8 and add the TradeLoop add-on — every fill lands in your journal within seconds while NinjaTrader is open.",
    needs: ["NinjaTrader 8 on a Windows PC, with your Tradovate account connected", "The TradeLoop add-on — a one-file download"],
    security: "Your Tradovate password stays in NinjaTrader — TradeLoop never sees it. The add-on only reads your fills and balances and sends them here; it can't place, change or cancel orders.",
  },
]

// Tradovate through NinjaTrader on the VPS (credentials path — like
// MetaTrader): the trader enters their login, we run it on our server.
const TRADOVATE_CREDENTIALS: PlatformDef = {
  id: "tradovate",
  name: "Tradovate",
  card: "Futures, live sync with your login",
  badge: "live",
  icon: <Logo src="/brokers/sm/tradovate.png" />,
  live: true,
  keywords: "futures prop apex tradeify mffu myfundedfutures takeprofit credentials login",
  about: "Enter your Tradovate login once — we connect it on our server and sync your fills automatically. No NinjaTrader or PC of your own needed.",
  needs: ["Your Tradovate username and password (from your prop firm)", "Which prop firm the login is with"],
  security: "Your password is stored encrypted and used only to connect your account on our server, so syncing can continue — never to place or change orders. It's never shown in the app.",
}

// Tradovate when TRADOVATE_MODE and its credentials are set: official OAuth,
// so the security note is exact — TradeLoop never sees the Tradovate password,
// keeps only an encrypted access token, and only reads.
const TRADOVATE_LIVE: PlatformDef = {
  id: "tradovate",
  name: "Tradovate",
  card: "Futures & options, live sync",
  badge: "live",
  icon: <Logo src="/brokers/sm/tradovate.png" />,
  live: true,
  keywords: "futures options prop apex topstep takeprofit",
  about: "Sign in with Tradovate once — every account under that login is added, and new fills appear within seconds.",
  needs: ["Your Tradovate login — entered on Tradovate's own sign-in page, never here", "The accounts you want to journal, under that login"],
  security: "You sign in on Tradovate's own page, so TradeLoop never sees your Tradovate password. We keep an encrypted access token that's only used to read your accounts, orders and fills — never to place or change orders.",
}

const CONNECT_COPY: Record<PlatformId, { title: string; description: string }> = {
  rithmic: { title: "Connect your Rithmic account", description: "Pick your prop firm, then sign in with your Rithmic login. Every account under it is added and synced." },
  mt5: { title: "Connect your MetaTrader 5 account", description: "Use the investor (read-only) password from your broker or prop firm — never your trading password." },
  mt4: { title: "Connect your MetaTrader 4 account", description: "Use the investor (read-only) password from your broker or prop firm — never your trading password." },
  tradingview: { title: "Connect TradingView paper trading", description: "Pair the TradeLoop browser extension once; paper trades then sync on their own." },
  file: { title: "Import a file", description: "Upload an export from your platform. Accounts in the file are created automatically, and re-importing never duplicates trades." },
  tradovate: { title: "Sync Tradovate through NinjaTrader", description: "Three steps, about two minutes. After that, fills sync on their own whenever NinjaTrader is open." },
}

const TRADOVATE_OAUTH_COPY = { title: "Connect Tradovate", description: "Sign in on Tradovate's own page; your accounts then sync on their own." }
const TRADOVATE_CREDENTIALS_COPY = { title: "Connect Tradovate", description: "Enter your login once — it syncs from our server, like MetaTrader. Nothing to keep open." }

// Why the viewer's plan can't connect this platform, or null if it can.
// Essential's one live sync is MetaTrader (lib/plan-allowance.ts): available
// while its MetaTrader slot and an account slot are free. Any other live sync
// needs Pro.
type Lock = "pro" | "metatrader" | "accounts"

function lockFor(p: PlatformDef, isPro: boolean, usage: PlanUsage | null): Lock | null {
  if (isPro || !p.live || p.soon) return null
  if (p.id !== "mt5" && p.id !== "mt4") return "pro"
  if (!usage) return null
  if (usage.metatrader >= usage.metatraderLimit) return "metatrader"
  if (usage.accounts >= usage.accountLimit) return "accounts"
  return null
}

export function AddAccountModal({
  open,
  request,
  onOpenChange,
  isPro,
  usage,
  pairings,
  importAccounts,
  tradovate,
}: {
  open: boolean
  request: AddAccountRequest
  onOpenChange: (open: boolean) => void
  isPro: boolean
  usage: PlanUsage | null
  pairings: TradingViewPairingView[]
  importAccounts: { id: number; name: string }[]
  tradovate: TradovateSetup
}) {
  const t = useT()
  const router = useRouter()
  const [selected, setSelected] = useState<PlatformId>(request.platform ?? "rithmic")
  const [stage, setStage] = useState<"choose" | "connect">(request.platform ? "connect" : "choose")
  const [query, setQuery] = useState("")
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [mtStage, setMtStage] = useState<MetaTraderStage>("form")
  const [attempt, setAttempt] = useState(0)
  // Focus lands on the window's heading when it opens — not the close button,
  // and not the search box (which would pop the keyboard on phones).
  const headingRef = useRef<HTMLDivElement>(null)

  // Every opening starts fresh, on the platform it was opened for (if any).
  useEffect(() => {
    setSelected(request.platform ?? "rithmic")
    setStage(request.platform != null ? "connect" : "choose")
    setQuery("")
    setOutcome(null)
    setMtStage("form")
    setAttempt(0)
    setNtState("setup")
    setTvCredState("form")
  }, [request.nonce, request.platform])

  const onMtStage = useCallback((stage: MetaTraderStage) => setMtStage(stage), [])

  const tradovateDef = tradovate.enabled ? TRADOVATE_LIVE : tradovate.ninjaVps ? TRADOVATE_CREDENTIALS : null
  const platforms = useMemo(() => (tradovateDef ? PLATFORMS.map((p) => (p.id === "tradovate" ? tradovateDef : p)) : PLATFORMS), [tradovateDef])
  const def = platforms.find((p) => p.id === selected) ?? platforms[0]
  // Back from Tradovate's sign-in: this window follows that connection's first sync.
  const tradovateProgressId = def.id === "tradovate" && stage === "connect" ? (request.tradovateConnectionId ?? null) : null
  const [tradovateState, setTradovateState] = useState<TradovateProgressState>("running")
  // Tradovate through NinjaTrader: waiting for, then connected to, the add-on.
  const [ntState, setNtState] = useState<NinjaTraderSetupState>("setup")
  const [tvCredState, setTvCredState] = useState<TradovateCredentialsState>("form")
  // Tradovate without the official OAuth: credentials (VPS relay) when it's
  // configured, otherwise the PC add-on.
  const viaCredentials = def.id === "tradovate" && !tradovate.enabled && tradovate.ninjaVps
  const viaNinjaTrader = def.id === "tradovate" && !tradovate.enabled && !tradovate.ninjaVps && stage === "connect"
  const isMt = def.id === "mt5" || def.id === "mt4"
  // Reconnecting an account you already have is always allowed (the server
  // checks it's the same login).
  const reconnecting = request.initial?.login != null && request.platform === def.id
  const lock = reconnecting ? null : lockFor(def, isPro, usage)

  const inVerify = outcome != null || (isMt && mtStage !== "form") || tradovateProgressId != null || (viaNinjaTrader && ntState !== "setup") || (viaCredentials && stage === "connect" && tvCredState !== "form")
  const step: 1 | 2 | 3 = stage === "choose" ? 1 : inVerify ? 3 : 2
  const completed = (outcome != null && outcome.ok) || (isMt && mtStage === "done") || (tradovateProgressId != null && tradovateState === "complete") || (viaNinjaTrader && ntState === "connected") || (viaCredentials && tvCredState === "connected")

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return platforms
    return platforms.filter((p) => `${p.name} ${p.card} ${p.keywords}`.toLowerCase().includes(q))
  }, [query, platforms])

  function goConnect(id: PlatformId = def.id) {
    const target = platforms.find((p) => p.id === id)
    if (!target || target.soon) return
    setSelected(id)
    setOutcome(null)
    setMtStage("form")
    setStage("connect")
  }

  function done() {
    onOpenChange(false)
    router.refresh()
  }

  // --------------------------------------------------------------- step 2+
  let body: React.ReactNode = null
  if (stage === "connect") {
    if (lock) {
      body = (
        <LiveSyncUpgradeBanner
          title={t("{platform} sync", { platform: t(def.name) })}
          description={lockMessage(t, lock, def, usage)}
        />
      )
    } else if (outcome?.kind === "rithmic" && outcome.ok) {
      const r = outcome.result
      body = (
        <Result
          tone="success"
          title={t("Account connected")}
          lines={[
            r.accounts === 1 ? t("Rithmic connected — 1 account") : t("Rithmic connected — {n} accounts", { n: r.accounts }),
            r.trades === 0 ? t("No past trades found in the last 2 years") : r.trades === 1 ? t("1 past trade imported") : t("{n} past trades imported", { n: r.trades }),
            t("Your trades are now syncing automatically."),
          ]}
          meta={r.diagnostic ? `${t("Rithmic fills")} — ${r.diagnostic}` : undefined}
          actions={
            <Button className="h-11 w-full hover:bg-primary/90" onClick={done}>
              {t("Done")}
            </Button>
          }
        />
      )
    } else if (outcome?.kind === "rithmic" && !outcome.ok) {
      body = (
        <Result
          tone="error"
          title={t("Connection couldn't be completed")}
          lines={[outcome.message]}
          actions={
            <div className="flex gap-2">
              <Button
                className="h-11 flex-1 hover:bg-primary/90"
                onClick={() => {
                  setOutcome(null)
                  setAttempt((a) => a + 1)
                }}
              >
                {t("Try again")}
              </Button>
              <Button className="h-11" variant="outline" onClick={() => setStage("choose")}>
                {t("Back")}
              </Button>
            </div>
          }
        />
      )
    } else if (outcome?.kind === "file") {
      const summary = outcome.summary
      body = (
        <Result
          tone="success"
          title={summary.imported > 0 ? t("Trades imported") : t("Already up to date")}
          lines={[
            summary.imported === 1 ? t("Imported 1 trade from {source}", { source: summary.source }) : t("Imported {n} trades from {source}", { n: summary.imported, source: summary.source }),
            ...(summary.skippedRows > 0 ? [summary.skippedRows === 1 ? t("Skipped 1 unreadable row") : t("Skipped {n} unreadable rows", { n: summary.skippedRows })] : []),
            t("Re-importing the same file later is safe — trades already on file are skipped."),
          ]}
          actions={
            <div className="flex gap-2">
              <Button className="h-11 flex-1 hover:bg-primary/90" onClick={done}>
                {t("Done")}
              </Button>
              <Button className="h-11" variant="outline" onClick={() => setOutcome(null)}>
                {t("Import another file")}
              </Button>
            </div>
          }
        />
      )
    } else if (def.id === "rithmic") {
      body = (
        <ConnectForm
          key={attempt}
          onDone={done}
          onConnected={(result) => {
            setOutcome({ kind: "rithmic", ok: true, result })
            router.refresh()
          }}
          onFailed={(message) => setOutcome({ kind: "rithmic", ok: false, message })}
        />
      )
    } else if (isMt) {
      body = (
        <ConnectFlow
          key={`${def.id}-${request.nonce}`}
          lockPlatform
          initial={{ platform: def.id, server: reconnecting ? request.initial?.server : undefined, login: reconnecting ? request.initial?.login : undefined }}
          onStage={onMtStage}
          onDone={done}
          onBack={() => setStage("choose")}
        />
      )
    } else if (def.id === "tradovate" && tradovate.enabled) {
      body =
        tradovateProgressId != null ? (
          <TradovateProgress
            connectionId={tradovateProgressId}
            onDone={done}
            onRetry={() => setStage("choose")}
            onState={setTradovateState}
          />
        ) : (
          <TradovateConnect mock={tradovate.mock} error={tradovate.error} />
        )
    } else if (def.id === "tradovate" && tradovate.ninjaVps) {
      body = <TradovateCredentials onDone={done} onFile={() => goConnect("file")} onState={setTvCredState} />
    } else if (def.id === "tradovate") {
      body = <NinjaTraderSetup onDone={done} onFile={() => goConnect("file")} onState={setNtState} />
    } else if (def.id === "tradingview") {
      body = <TradingViewSetup pairings={pairings} isPro={isPro} />
    } else {
      body = (
        <BrokerImport
          bare
          accounts={importAccounts}
          onImported={(summary) => {
            setOutcome({ kind: "file", ok: true, summary })
            router.refresh()
          }}
        />
      )
    }
  }
  const copy =
    def.id === "tradovate" && tradovate.enabled
      ? TRADOVATE_OAUTH_COPY
      : def.id === "tradovate" && tradovate.ninjaVps
        ? TRADOVATE_CREDENTIALS_COPY
        : CONNECT_COPY[def.id]

  // ------------------------------------------------------- the main action
  const action =
    def.soon ? (
      <Button className="h-11 w-full font-semibold hover:bg-primary/90" onClick={() => goConnect("file")}>
        <FileUp className="size-4" /> {t("Import a Tradovate file")}
      </Button>
    ) : lock ? (
      <Button className="h-11 w-full font-semibold hover:bg-primary/90" nativeButton={false} render={<Link href="/pricing" />}>
        <Lock className="size-4" /> {t("Upgrade to Pro")}
      </Button>
    ) : (
      <Button className="h-11 w-full font-semibold hover:bg-primary/90" onClick={() => goConnect()}>
        {t("Continue")} <ArrowRight className="size-4" />
      </Button>
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        initialFocus={headingRef}
        className="flex max-h-[calc(100svh-1rem)] w-[calc(100vw-1rem)] max-w-[880px] flex-col gap-0 overflow-hidden rounded-2xl p-0 shadow-[0_20px_60px_rgba(20,18,40,0.18)] duration-150 sm:max-h-[85vh] sm:w-[calc(100vw-3rem)] sm:max-w-[880px]"
      >
        <div className="@container/modal relative flex min-h-0 flex-1 flex-col">
          <DialogClose
            render={
              <Button variant="ghost" size="icon" className="absolute top-3 right-3 z-10 size-9 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("Close")} />
            }
          >
            <X className="size-[18px]" />
          </DialogClose>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto @[720px]/modal:flex-row @[720px]/modal:overflow-hidden">
            {/* ---------------- left: choose / connect ---------------- */}
            <section className="@container/choose min-w-0 p-5 @[720px]/modal:flex-1 @[720px]/modal:overflow-y-auto @[720px]/modal:p-7">
              {/* Phones: the steps lead the window. */}
              <p className="mb-3 pe-10 text-[11px] font-bold tracking-[0.7px] text-primary uppercase @[720px]/modal:hidden">{t("Step {n} of 3", { n: step })}</p>
              <ConnectionStepper current={step} completed={completed} className="mb-6 @[720px]/modal:hidden" />

              {stage === "choose" ? (
                <div key="choose" className="animate-in fade-in-0 duration-150 motion-reduce:animate-none">
                  <div ref={headingRef} tabIndex={-1} className="outline-none">
                  <p className="text-[11px] font-bold tracking-[0.7px] text-primary uppercase">{t("Add account")}</p>
                  <DialogTitle className="mt-1.5 text-2xl leading-8 font-bold tracking-[-0.4px] text-foreground">{t("Choose your platform")}</DialogTitle>
                  <DialogDescription className="mt-1.5 max-w-[420px] text-sm leading-[21px] text-muted-foreground">
                    {t("Select the trading platform you want to connect. We support live connections and file imports for historical trades.")}
                  </DialogDescription>
                  </div>

                  <label className="relative mt-5 block">
                    <span className="sr-only">{t("Search platforms")}</span>
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t("Search platforms…")}
                      className="h-10 w-full rounded-lg border bg-card ps-9 pe-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                    />
                  </label>

                  {shown.length === 0 ? (
                    <p className="mt-4 rounded-xl border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
                      {t("No platform matches “{q}”. Try file import — it reads exports from most platforms.", { q: query.trim() })}
                    </p>
                  ) : (
                    <div className="mt-4 grid grid-cols-1 gap-3 @[440px]/choose:grid-cols-2">
                      {shown.map((p) => (
                        <PlatformCard
                          key={p.id}
                          icon={p.icon}
                          name={t(p.name)}
                          description={t(p.card)}
                          pro={lockFor(p, isPro, usage) != null}
                          soon={p.soon}
                          selected={p.id === selected}
                          onSelect={() => setSelected(p.id)}
                          onOpen={() => goConnect(p.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div key="connect" ref={headingRef} tabIndex={-1} className="animate-in fade-in-0 outline-none duration-150 motion-reduce:animate-none">
                  {!reconnecting && (
                    <button
                      type="button"
                      onClick={() => setStage("choose")}
                      className="-ms-1 mb-4 inline-flex h-9 items-center gap-1.5 rounded-md px-1 text-[13px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <ArrowLeft className="size-4" /> {t("All platforms")}
                    </button>
                  )}
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px]">{def.icon}</span>
                    <div className="min-w-0">
                      <DialogTitle className="text-lg leading-6 font-semibold text-foreground">{t(copy.title)}</DialogTitle>
                      {copy.description && <DialogDescription className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{t(copy.description)}</DialogDescription>}
                    </div>
                  </div>
                  <div key={outcome ? "result" : "form"} className="@container/ws mt-5 animate-in fade-in-0 duration-200 ease-out motion-reduce:animate-none">
                    {body}
                  </div>
                </div>
              )}
            </section>

            {/* ---------------- right: steps & the chosen platform ---------------- */}
            <aside className="flex flex-col border-t bg-muted/40 @[720px]/modal:w-[340px] @[720px]/modal:shrink-0 @[720px]/modal:overflow-y-auto @[720px]/modal:border-t-0 @[720px]/modal:border-s">
              <div className="flex-1 p-5 @[720px]/modal:p-6 @[720px]/modal:pt-7">
                <div className="hidden @[720px]/modal:block">
                  <p className="text-[11px] font-bold tracking-[0.7px] text-primary uppercase">{t("Step {n} of 3", { n: step })}</p>
                  <ConnectionStepper current={step} completed={completed} className="mt-3 pe-1" />
                </div>

                <div className="@[720px]/modal:mt-7">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px]">{def.icon}</span>
                    <p className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{t(def.name)}</p>
                    <Badge kind={def.badge} />
                  </div>
                  <p className="mt-3 text-[13px] leading-5 text-muted-foreground">{t(def.about)}</p>

                  {lock && (
                    <p className="mt-3 flex gap-2 rounded-lg border border-primary/20 bg-primary/[0.05] px-3 py-2.5 text-xs leading-[18px] text-foreground">
                      <Lock className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                      {lockMessage(t, lock, def, usage)}
                    </p>
                  )}

                  <h3 className="mt-5 text-sm font-semibold text-foreground">{t("What you'll need")}</h3>
                  <ul className="mt-2.5 space-y-2">
                    {def.needs.map((n) => (
                      <li key={n} className="flex gap-2.5 text-[13px] leading-5 text-foreground">
                        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Check className="size-2.5" strokeWidth={3} aria-hidden />
                        </span>
                        {t(n)}
                      </li>
                    ))}
                  </ul>

                  {def.security && (
                    <p className="mt-5 flex gap-2.5 rounded-xl border bg-card px-3.5 py-3 text-xs leading-[18px] text-muted-foreground">
                      <Info className="mt-px size-4 shrink-0 text-primary" aria-hidden />
                      {t(def.security)}
                    </p>
                  )}
                </div>
              </div>
              {stage === "choose" && <div className="hidden px-6 pb-6 @[720px]/modal:block">{action}</div>}
            </aside>
          </div>

          {/* Phones: the main action stays in reach below the scrolling content. */}
          {stage === "choose" && <div className="border-t bg-card p-4 @[720px]/modal:hidden">{action}</div>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function lockMessage(t: ReturnType<typeof useT>, lock: Lock, def: PlatformDef, usage: PlanUsage | null) {
  return lock === "metatrader"
    ? t("Essential includes live sync for 1 MetaTrader account, and yours is in use. Disconnect it to connect a different one, or upgrade to Pro to sync as many as you like.")
    : lock === "accounts"
      ? t("Essential includes up to {n} trading accounts, and you have {n}. Remove one to connect this account, or upgrade to Pro for unlimited accounts.", { n: usage?.accountLimit ?? 0 })
      : t("{platform} sync is included with Pro; Essential includes live sync for one MetaTrader account.", { platform: t(def.name) })
}

function Result({
  tone,
  title,
  lines,
  meta,
  actions,
}: {
  tone: "success" | "error"
  title: string
  lines: string[]
  meta?: string
  actions: React.ReactNode
}) {
  const t = useT()
  return (
    <div className="space-y-5 py-2" role={tone === "error" ? "alert" : "status"}>
      <div className="flex flex-col items-center gap-2 text-center">
        <span className={cn("flex size-12 items-center justify-center rounded-full", tone === "success" ? "bg-gain/10 text-gain" : "bg-loss/10 text-loss")}>
          {tone === "success" ? <CheckCircle2 className="size-6" /> : <AlertCircle className="size-6" />}
        </span>
        <p className="text-base font-semibold text-foreground">{title}</p>
        {lines.map((line, i) => (
          <p key={i} className="max-w-md text-sm text-muted-foreground">
            {line}
          </p>
        ))}
      </div>
      {actions}
      {meta && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">{t("Technical details")}</summary>
          <p className="mt-1 break-words">{meta}</p>
        </details>
      )}
    </div>
  )
}
