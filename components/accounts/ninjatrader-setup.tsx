"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { CheckCircle2, Copy, Download, FileUp, Info, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useT } from "@/components/locale-provider"
import { getNinjaTraderStatus } from "@/app/actions/ninjatrader"
import type { NinjaTraderView } from "@/lib/ninjatrader/connections"

// Tradovate through NinjaTrader 8, in the Add account window. Prop-firm
// Tradovate accounts connect to NinjaTrader with the trader's own login; the
// TradeLoop add-on (a single .cs file with the trader's sync key in it) reads
// their executions there and sends them here. No Tradovate API or password
// is involved. This panel walks through the three steps and then waits for
// the add-on's first check-in.

export type NinjaTraderSetupState = "setup" | "waiting" | "connected"

const ADDONS_FOLDER = "Documents\\NinjaTrader 8\\bin\\Custom\\AddOns"
const POLL_MS = 3000

export function NinjaTraderSetup({ onDone, onFile, onState }: { onDone: () => void; onFile: () => void; onState?: (s: NinjaTraderSetupState) => void }) {
  const t = useT()
  const [view, setView] = useState<NinjaTraderView | null>(null)
  const [downloadedAt, setDownloadedAt] = useState<number | null>(null)
  const alive = useRef(true)

  // An add-on that has checked in recently — or, after a download, since then.
  const connected =
    view != null &&
    view.devices.some((d) => d.online && d.lastSeenAt != null && (downloadedAt == null || Date.parse(d.lastSeenAt) >= downloadedAt - 5_000))
  const state: NinjaTraderSetupState = connected ? "connected" : downloadedAt != null ? "waiting" : "setup"

  useEffect(() => {
    onState?.(state)
  }, [state, onState])

  useEffect(() => {
    alive.current = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = async () => {
      const r = await getNinjaTraderStatus().catch(() => null)
      if (!alive.current) return
      if (r?.ok) setView(r.value)
      timer = setTimeout(poll, POLL_MS)
    }
    void poll()
    return () => {
      alive.current = false
      if (timer) clearTimeout(timer)
    }
  }, [])

  const syncing = view?.accounts.filter((a) => a.enabled) ?? []

  if (connected) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-gain/30 bg-gain/5 p-4">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-gain" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{t("NinjaTrader is connected")}</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {syncing.length === 0
                ? t("The add-on is running. Your accounts appear here once NinjaTrader connects to them.")
                : syncing.length === 1
                  ? t("1 account syncing — new fills arrive within seconds while NinjaTrader is open.")
                  : t("{n} accounts syncing — new fills arrive within seconds while NinjaTrader is open.", { n: syncing.length })}
            </p>
          </div>
        </div>
        {syncing.length > 0 && (
          <ul className="divide-y rounded-xl border">
            {syncing.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                <span className="min-w-0 truncate font-medium text-foreground">{a.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {a.planLimited ? t("Over your plan's account limit") : a.executions === 1 ? t("1 fill") : t("{n} fills", { n: a.executions })}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Button className="h-11 w-full font-semibold hover:bg-primary/90" onClick={onDone}>
          {t("Done")}
        </Button>
      </div>
    )
  }

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(ADDONS_FOLDER)
      toast.success(t("Folder path copied"))
    } catch {
      toast.error(t("Couldn't copy — select the path and copy it instead."))
    }
  }

  return (
    <div className="space-y-5">
      <ol className="space-y-4">
        <Step n={1} title={t("Connect your Tradovate account in NinjaTrader 8")}>
          {t("In NinjaTrader: Connections → Configure → add the NinjaTrader connection with the Tradovate login from your prop firm, then connect. Your password stays in NinjaTrader.")}
        </Step>
        <Step n={2} title={t("Download the TradeLoop add-on")}>
          <form method="POST" action="/api/ninjatrader/addon" onSubmit={() => setDownloadedAt(Date.now())} className="mt-2">
            <Button type="submit" variant={downloadedAt ? "outline" : "default"} className="h-10 font-semibold">
              <Download className="size-4" />
              {downloadedAt ? t("Download again") : t("Download add-on")}
            </Button>
          </form>
          <span className="mt-1.5 block text-xs">{t("TradeLoopSync.cs holds your personal sync key — keep the file to yourself.")}</span>
        </Step>
        <Step n={3} title={t("Install it")}>
          {t("Move the file into this folder, then in NinjaTrader choose New → NinjaScript Editor and press F5 (or restart NinjaTrader):")}
          <span className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-[12px] text-foreground" dir="ltr">
              {ADDONS_FOLDER}
            </code>
            <Button type="button" variant="outline" size="icon" className="size-8 shrink-0" onClick={copyPath} aria-label={t("Copy folder path")}>
              <Copy className="size-3.5" />
            </Button>
          </span>
        </Step>
      </ol>

      <div className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px]", state === "waiting" ? "bg-primary/5 text-foreground" : "bg-muted/50 text-muted-foreground")} role="status">
        {state === "waiting" ? <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden /> : <Info className="size-4 shrink-0" aria-hidden />}
        {state === "waiting"
          ? t("Waiting for NinjaTrader… this updates by itself once the add-on is running.")
          : t("This window will show your accounts as soon as the add-on checks in.")}
      </div>

      <p className="text-xs leading-5 text-muted-foreground">
        {t("Fills sync within seconds while NinjaTrader is open. Trades placed in Tradovate's web or mobile app come in the next time NinjaTrader connects, as long as NinjaTrader lists them under Executions.")}
      </p>
      <button type="button" onClick={onFile} className="flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline">
        <FileUp className="size-3.5" />
        {t("No NinjaTrader? Import a Tradovate CSV instead")}
      </button>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{n}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <div className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{children}</div>
      </div>
    </li>
  )
}
