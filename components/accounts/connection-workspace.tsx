"use client"

import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { AlertCircle, ArrowLeft, CandlestickChart, CheckCircle2, FileUp, LineChart } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
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

function Logo({ src }: { src: string }) {
  return <Image src={src} alt="" width={44} height={44} className="size-full object-cover" />
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
  { id: "rithmic", name: "Rithmic", description: "Futures prop firms on Rithmic — Apex, Bulenox, Tradeify & more. Syncs every minute.", badge: "live", icon: <Logo src="/brokers/sm/rithmic.png" />, live: true },
  { id: "mt5", name: "MetaTrader 5", description: "Forex & CFD brokers and prop firms, with your read-only investor password.", badge: "live", icon: <TintIcon><CandlestickChart className="size-5" /></TintIcon>, live: true },
  { id: "mt4", name: "MetaTrader 4", description: "MT4 accounts are queued until MT4 sync is live on our sync server.", badge: "setup", icon: <TintIcon><span className="text-[11px] font-bold">MT4</span></TintIcon>, live: true },
  { id: "tradingview", name: "TradingView", description: "Paper trading, synced by the TradeLoop browser extension.", badge: "paper", icon: <TintIcon><LineChart className="size-5" /></TintIcon>, live: true },
  { id: "file", name: "File import", description: "Tradovate, NinjaTrader, TradingView or MetaTrader report files.", badge: "file", icon: <TintIcon><FileUp className="size-5" /></TintIcon>, live: false },
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
  isPro,
  pairings,
  importAccounts,
}: {
  selection: WorkspaceSelection
  onSelect: (platform: PlatformId | null) => void
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

  // A new request from the hub (a platform card, "Connect another account",
  // "Reconnect") starts that flow fresh and brings it into view.
  useEffect(() => {
    setOutcome(null)
    setMtStage("form")
    if (selection.nonce > 0) {
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      headingRef.current?.focus({ preventScroll: true })
    }
  }, [selection.nonce])

  const onMtStage = useCallback((stage: MetaTraderStage) => setMtStage(stage), [])

  const isMt = platform === "mt5" || platform === "mt4"
  const inVerify = outcome != null || (isMt && mtStage !== "form")
  const step: 1 | 2 | 3 = !platform ? 1 : inVerify ? 3 : 2
  const completed = (outcome != null && outcome.ok) || (isMt && mtStage === "done")

  function done() {
    onSelect(null)
    router.refresh()
  }

  const locked = def != null && def.live && !isPro

  let content: React.ReactNode
  if (!platform || !def) {
    content = (
      <>
        <p className="text-[11px] font-bold tracking-[0.7px] text-primary uppercase">{t("Step {n} of 3", { n: 1 })}</p>
        <h2 ref={headingRef} tabIndex={-1} className="mt-1.5 text-2xl leading-[30px] font-semibold tracking-[-0.5px] text-foreground outline-none @[480px]/ws:text-[28px] @[480px]/ws:leading-[34px] @[860px]/ws:text-[30px] @[860px]/ws:leading-9">
          {t("Connect a trading account")}
        </h2>
        <p className="mt-2 max-w-[600px] text-sm text-muted-foreground">
          {t("Select your trading platform to get started. Live connections keep your journal in sync on their own; file imports cover everything else.")}
        </p>
        <h3 className="mt-8 text-base font-semibold text-foreground">{t("Choose your platform")}</h3>
        <div className="@container/grid mt-4 grid grid-cols-1 gap-3 @[560px]/content:grid-cols-2">
          {PLATFORMS.map((p) => (
            <PlatformCard
              key={p.id}
              icon={p.icon}
              name={t(p.name)}
              description={t(p.description)}
              badge={p.badge}
              pro={p.live && !p.disabled && !isPro}
              disabled={p.disabled}
              onSelect={() => onSelect(p.id)}
            />
          ))}
        </div>
      </>
    )
  } else {
    const copy = CONNECT_COPY[def.id]
    let body: React.ReactNode
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
              <Button className="h-11" variant="outline" onClick={() => onSelect(null)}>
                {t("Back")}
              </Button>
            </div>
          }
        />
      )
    } else if (outcome?.kind === "file") {
      const s = outcome.summary
      body = (
        <Result
          tone="success"
          title={s.imported > 0 ? t("Trades imported") : t("Already up to date")}
          lines={[
            s.imported === 1 ? t("Imported 1 trade from {source}", { source: s.source }) : t("Imported {n} trades from {source}", { n: s.imported, source: s.source }),
            ...(s.skippedRows > 0 ? [s.skippedRows === 1 ? t("Skipped 1 unreadable row") : t("Skipped {n} unreadable rows", { n: s.skippedRows })] : []),
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
          onBack={() => onSelect(null)}
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

    content = (
      <>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="-ms-2 inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <ArrowLeft className="size-4" /> {t("Back")}
        </button>
        <div className="mt-3 flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[10px]">{def.icon}</span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold tracking-[0.7px] text-primary uppercase">{t("Step {n} of 3", { n: step })}</p>
            <h2 ref={headingRef} tabIndex={-1} className="text-xl leading-7 font-semibold tracking-[-0.3px] text-foreground outline-none @[860px]/ws:text-2xl">
              {t(copy.title)}
            </h2>
          </div>
        </div>
        {copy.description && <p className="mt-2 max-w-[600px] text-sm text-muted-foreground">{t(copy.description)}</p>}
        <div className="mt-6 max-w-[640px]">{body}</div>
      </>
    )
  }

  return (
    <section
      ref={rootRef}
      aria-label={t("Connect a trading account")}
      className="@container/ws scroll-mt-4 rounded-[14px] border bg-card shadow-[0_1px_2px_rgba(20,21,42,0.03)]"
    >
      <div className="@[680px]/ws:grid @[680px]/ws:grid-cols-[195px_minmax(0,1fr)] @[860px]/ws:grid-cols-[225px_minmax(0,1fr)]">
        <aside className="hidden border-e p-5 @[680px]/ws:block @[860px]/ws:p-6">
          <p className="text-lg leading-[23px] font-semibold tracking-[-0.2px] text-foreground">{t("Connect your trading account")}</p>
          <p className="mt-2 text-[13px] leading-[19px] text-muted-foreground">{t("Link your broker or platform to import trades automatically and start journaling.")}</p>
          <div className="mt-8">
            <ConnectionStepper current={step} completed={completed} orientation="vertical" />
          </div>
        </aside>
        <div className="@container/content min-w-0 p-4 @[480px]/ws:p-6 @[860px]/ws:p-8">
          <div className="mb-6 @[680px]/ws:hidden">
            <ConnectionStepper current={step} completed={completed} orientation="horizontal" />
          </div>
          <div key={`${platform ?? "choose"}-${outcome ? "result" : "form"}`} className="animate-in fade-in-0 duration-200 ease-out motion-reduce:animate-none">
            {content}
          </div>
        </div>
      </div>
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
