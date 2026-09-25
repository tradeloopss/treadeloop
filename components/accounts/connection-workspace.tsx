"use client"

import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { AlertCircle, CheckCircle2, FileUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useT } from "@/components/locale-provider"
import { ConnectForm, type RithmicConnected } from "@/components/rithmic-connect"
import { ConnectFlow, type MetaTraderStage } from "@/components/metatrader-connect"
import { TradingViewSetup } from "@/components/tradingview-connect"
import { BrokerImport, type ImportSummary } from "@/components/broker-import"
import { LiveSyncUpgradeBanner } from "@/components/live-sync-upgrade-banner"
import type { TradingViewPairingView } from "@/app/actions/tradingview"
import { ConnectionStepper } from "@/components/accounts/connection-stepper"
import { PlatformCard, type PlatformBadge } from "@/components/accounts/platform-card"
import type { PlatformId } from "@/components/accounts/types"

// What the hub asks the workspace to show; `nonce` re-applies the same
// request (e.g. "Connect another account" pressed twice).
export interface WorkspaceSelection {
  platform: PlatformId | null
  initial?: { server?: string; login?: string }
  nonce: number
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
  description: string
  badge: PlatformBadge
  icon: React.ReactNode
  live: boolean // needs Pro
  disabled?: boolean
}

const PLATFORMS: PlatformDef[] = [
  { id: "rithmic", name: "Rithmic", description: "Futures prop firms — Apex, Bulenox, Tradeify & more.", badge: "live", icon: <Logo src="/brokers/sm/rithmic.png" />, live: true },
  { id: "mt5", name: "MetaTrader 5", description: "Forex & CFD brokers, read-only investor password.", badge: "live", icon: <Logo src="/brokers/sm/metatrader.png" />, live: true },
  { id: "tradingview", name: "TradingView", description: "Paper trading via the TradeLoop extension.", badge: "paper", icon: <Logo src="/brokers/sm/tradingview.png" dark="/brokers/sm/tradingview-dark.png" />, live: true },
  { id: "mt4", name: "MetaTrader 4", description: "Accounts queue until MT4 sync goes live.", badge: "setup", icon: <Logo src="/brokers/sm/metatrader.png" />, live: true },
  { id: "file", name: "File import", description: "Tradovate, NinjaTrader, TradingView & MT reports.", badge: "file", icon: <TintIcon><FileUp className="size-5" /></TintIcon>, live: false },
  { id: "topstep", name: "Topstep", description: "Direct Topstep sync is on the way.", badge: "soon", icon: <Logo src="/brokers/sm/topstep.png" />, live: true, disabled: true },
]

const CONNECT_COPY: Record<PlatformId, { title: string; description: string }> = {
  rithmic: { title: "Connect your Rithmic account", description: "Pick your prop firm, then sign in with your Rithmic login. Every account under it is added and synced." },
  mt5: { title: "Connect your MetaTrader 5 account", description: "Use the investor (read-only) password from your broker or prop firm — never your trading password." },
  mt4: { title: "Connect your MetaTrader 4 account", description: "Use the investor (read-only) password. MT4 accounts wait in a queue until MT4 sync is live, then connect by themselves." },
  tradingview: { title: "Connect TradingView paper trading", description: "Pair the TradeLoop browser extension once; paper trades then sync on their own." },
  file: { title: "Import a file", description: "Upload an export from your platform. Accounts in the file are created automatically, and re-importing never duplicates trades." },
  topstep: { title: "Topstep", description: "" },
}

export function ConnectionWorkspace({
  selection,
  onSelect,
  onClose,
  isPro,
  pairings,
  importAccounts,
}: {
  selection: WorkspaceSelection
  onSelect: (platform: PlatformId) => void
  onClose: () => void
  isPro: boolean
  pairings: TradingViewPairingView[]
  importAccounts: { id: number; name: string }[]
}) {
  const t = useT()
  const router = useRouter()
  const rootRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [mtStage, setMtStage] = useState<MetaTraderStage>("form")
  const [attempt, setAttempt] = useState(0)

  const platform = selection.platform
  const def = PLATFORMS.find((p) => p.id === platform) ?? null

  // Every opened flow starts fresh.
  useEffect(() => {
    setOutcome(null)
    setMtStage("form")
    setAttempt(0)
  }, [platform, selection.nonce])

  // "Add account" / "Connect another account" bring the platform grid into
  // view (a platform itself opens in a window, so there's nothing to scroll).
  useEffect(() => {
    if (selection.nonce > 0 && !selection.platform) {
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      headingRef.current?.focus({ preventScroll: true })
    }
  }, [selection.nonce, selection.platform])

  const onMtStage = useCallback((stage: MetaTraderStage) => setMtStage(stage), [])

  const isMt = platform === "mt5" || platform === "mt4"
  const inVerify = outcome != null || (isMt && mtStage !== "form")
  const step: 1 | 2 | 3 = !platform ? 1 : inVerify ? 3 : 2
  const completed = (outcome != null && outcome.ok) || (isMt && mtStage === "done")

  function done() {
    onClose()
    router.refresh()
  }

  const locked = def != null && def.live && !isPro

  // The window for the chosen platform: its own form, or the result.
  let body: React.ReactNode = null
  if (def) {
    if (locked) {
      body = (
        <LiveSyncUpgradeBanner
          title={t("{platform} sync", { platform: t(def.name) })}
          description={t("Connect once and every trade lands in your journal automatically — no files needed. Live sync is included with Pro.")}
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
              <Button className="h-11" variant="outline" onClick={onClose}>
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
          key={`${def.id}-${selection.nonce}`}
          lockPlatform
          initial={{ platform: def.id, server: selection.initial?.server, login: selection.initial?.login }}
          onStage={onMtStage}
          onDone={done}
          onBack={onClose}
        />
      )
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
  const copy = def ? CONNECT_COPY[def.id] : null

  return (
    <section
      ref={rootRef}
      aria-label={t("Connect a trading account")}
      className="@container/ws scroll-mt-4 rounded-2xl border bg-card p-4 shadow-[0_1px_2px_rgba(20,21,42,0.03)] @[640px]/page:p-5"
    >
      {/* Step label, heading and intro, then the steps; the platforms below. */}
      <p className="text-[11px] font-bold tracking-[0.7px] text-primary uppercase">{t("Step {n} of 3", { n: 1 })}</p>
      <h2 ref={headingRef} tabIndex={-1} className="mt-1.5 text-lg leading-7 font-semibold tracking-[-0.3px] text-foreground outline-none @[560px]/ws:text-xl">
        {t("Connect a trading account")}
      </h2>
      <p className="mt-1 max-w-[620px] text-[13px] leading-5 text-muted-foreground @[560px]/ws:text-sm">
        {t("Select a platform to get started. Live connections keep your journal in sync automatically, while file imports let you bring in historical trades.")}
      </p>
      <div className="mt-4">
        <ConnectionStepper current={1} fill />
      </div>
      <h3 className="mt-6 text-sm font-semibold text-foreground @[560px]/ws:text-[15px]">{t("Choose your platform")}</h3>
      <div className="mt-3 grid grid-cols-1 gap-2.5 @[520px]/ws:grid-cols-2 @[520px]/ws:gap-3 @[880px]/ws:grid-cols-3">
        {PLATFORMS.map((p) => (
          <PlatformCard
            key={p.id}
            icon={p.icon}
            name={t(p.name)}
            description={t(p.description)}
            badge={p.badge}
            pro={p.live && !p.disabled && !isPro}
            selected={p.id === platform}
            disabled={p.disabled}
            onSelect={() => onSelect(p.id)}
          />
        ))}
      </div>

      {/* The chosen platform's details open in a window over the page. */}
      <Dialog open={def != null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className={cn("max-h-[calc(100svh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-xl", def?.id === "rithmic" && !outcome && !locked && "sm:max-w-3xl")}>
          {def && copy && (
            <div className="@container/ws p-5 sm:p-6">
              <DialogHeader className="flex-row items-center gap-3 pe-8 text-start">
                <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px]">{def.icon}</span>
                <div className="min-w-0">
                  <DialogTitle className="text-lg leading-6 font-semibold">{t(copy.title)}</DialogTitle>
                  {copy.description && <DialogDescription className="mt-0.5 text-[13px]">{t(copy.description)}</DialogDescription>}
                </div>
              </DialogHeader>
              <div className="mt-4 mb-5 flex flex-col items-start gap-2.5 border-y py-3 @[480px]/ws:flex-row @[480px]/ws:items-center @[480px]/ws:gap-5">
                <p className="text-[11px] font-bold tracking-[0.7px] whitespace-nowrap text-primary uppercase">{t("Step {n} of 3", { n: step })}</p>
                <ConnectionStepper current={step} completed={completed} />
              </div>
              <div key={outcome ? "result" : "form"} className="animate-in fade-in-0 duration-200 ease-out motion-reduce:animate-none">
                {body}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
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
    <div className="space-y-5" role={tone === "error" ? "alert" : "status"}>
      <div className="flex flex-col items-center gap-2 text-center">
        <span className={cn("flex size-11 items-center justify-center rounded-full", tone === "success" ? "bg-gain/10 text-gain" : "bg-loss/10 text-loss")}>
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
