"use client"

import { useEffect, useState } from "react"
import { AlertCircle, Check, CheckCircle2, ExternalLink, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useT } from "@/components/locale-provider"
import { getTradovateConnection } from "@/app/actions/tradovate"
import type { TradovateConnectionView } from "@/lib/tradovate/connections"

// Tradovate in the Add account window.
//
// TradovateConnect — what syncs, and "Connect Tradovate": a form POST to
// /api/integrations/tradovate/connect, which sends the browser to Tradovate's
// own sign-in page (OAuth). TradeLoop never sees the Tradovate password.
//
// TradovateProgress — after Tradovate sends the user back: follows the first
// sync through its stages (the sync worker does the work in the background)
// until it's complete, then shows what was found.

const SYNCS = ["Orders", "Executions", "Positions", "P&L", "Trading history"]

export function TradovateConnect({ mock, error }: { mock: boolean; error: string | null }) {
  const t = useT()
  const [submitting, setSubmitting] = useState(false)
  return (
    <form method="POST" action="/api/integrations/tradovate/connect" onSubmit={() => setSubmitting(true)} className="space-y-5">
      {error && (
        <p role="alert" className="flex gap-2 rounded-lg bg-loss/10 px-3 py-2.5 text-[13px] text-loss">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t(error)}
        </p>
      )}
      <div>
        <p className="text-sm font-semibold text-foreground">{t("Automatically syncs")}</p>
        <ul className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2">
          {SYNCS.map((s) => (
            <li key={s} className="flex items-center gap-2 text-[13px] text-foreground">
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-gain/15 text-gain">
                <Check className="size-2.5" strokeWidth={3} aria-hidden />
              </span>
              {t(s)}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[13px] leading-5 text-muted-foreground">
        {mock
          ? t("Development mode: this connects a mock Tradovate login with sample accounts and trades — nothing is sent to Tradovate.")
          : t("You'll sign in on Tradovate's own page and approve read access. Every account under that login is added, and new fills appear within seconds.")}
      </p>
      <Button type="submit" disabled={submitting} className="h-11 w-full font-semibold hover:bg-primary/90">
        {submitting ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
        {submitting ? t("Opening Tradovate…") : mock ? t("Connect Tradovate (mock data)") : t("Connect Tradovate")}
      </Button>
    </form>
  )
}

const STAGES: { id: string; label: string }[] = [
  { id: "authenticated", label: "Authenticated" },
  { id: "finding_accounts", label: "Finding accounts…" },
  { id: "importing_orders", label: "Importing orders…" },
  { id: "importing_executions", label: "Importing executions…" },
  { id: "building_trades", label: "Building trades…" },
  { id: "calculating_pnl", label: "Calculating P&L…" },
  { id: "complete", label: "Sync complete" },
]

export type TradovateProgressState = "running" | "complete" | "error"

export function TradovateProgress({ connectionId, onDone, onRetry, onState }: { connectionId: number; onDone: () => void; onRetry: () => void; onState?: (s: TradovateProgressState) => void }) {
  const t = useT()
  const [view, setView] = useState<TradovateConnectionView | null>(null)
  const [missing, setMissing] = useState(false)
  const [startedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())

  const failed = view != null && (view.status === "reauth" || view.status === "error" || view.syncStage === "error")
  const complete = view != null && !failed && view.syncStage === "complete"

  useEffect(() => {
    if (complete || failed) return
    let alive = true
    const poll = async () => {
      const v = await getTradovateConnection(connectionId).catch(() => null)
      if (!alive) return
      if (v) setView(v)
      else setMissing(true)
      setNow(Date.now())
    }
    void poll()
    const id = setInterval(poll, 1_500)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [connectionId, complete, failed])

  useEffect(() => {
    onState?.(complete ? "complete" : failed ? "error" : "running")
  }, [complete, failed, onState])

  if (missing) {
    return <p className="text-sm text-muted-foreground">{t("That connection wasn't found.")}</p>
  }
  if (failed) {
    return (
      <div role="alert" className="space-y-4 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-loss/10 text-loss">
          <AlertCircle className="size-6" />
        </span>
        <p className="text-base font-semibold text-foreground">{t("Sync couldn't be completed")}</p>
        <p className="text-sm text-muted-foreground">{t(view?.statusMessage || view?.lastSyncError || "Something went wrong talking to Tradovate.")}</p>
        <Button className="h-11 w-full hover:bg-primary/90" onClick={onRetry}>
          {t("Try again")}
        </Button>
      </div>
    )
  }

  const current = Math.max(0, STAGES.findIndex((s) => s.id === (view?.syncStage ?? "authenticated")))
  const slow = !complete && now - startedAt > 60_000
  if (complete && view) {
    const executions = view.accounts.reduce((n, a) => n + a.executions, 0)
    return (
      <div role="status" className="space-y-5">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-gain/10 text-gain">
            <CheckCircle2 className="size-6" />
          </span>
          <p className="text-base font-semibold text-foreground">{t("Tradovate connected")}</p>
          <p className="text-sm text-muted-foreground">
            {view.accounts.length === 1 ? t("1 account") : t("{n} accounts", { n: view.accounts.length })} · {executions === 1 ? t("1 execution imported") : t("{n} executions imported", { n: executions })}
          </p>
          <p className="text-sm text-muted-foreground">{t("New trades will appear automatically.")}</p>
        </div>
        {view.accounts.length > 0 && (
          <ul className="divide-y rounded-xl border">
            {view.accounts.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                <span className="min-w-0 truncate font-medium text-foreground">{a.accountName}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {a.environment === "live" ? t("Live") : t("Demo")} · {a.executions === 1 ? t("1 execution") : t("{n} executions", { n: a.executions })}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Button className="h-11 w-full hover:bg-primary/90" onClick={onDone}>
          {t("Done")}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <ol className="space-y-2.5" aria-label={t("Sync progress")}>
        <li className="flex items-center gap-2.5 text-sm text-foreground">
          <StageIcon state="done" /> {t("Connecting")}
        </li>
        {STAGES.map((s, i) => {
          const state = i < current ? "done" : i === current ? (s.id === "authenticated" ? "done" : "active") : "upcoming"
          return (
            <li key={s.id} aria-current={state === "active" ? "step" : undefined} className={cn("flex items-center gap-2.5 text-sm", state === "upcoming" ? "text-muted-foreground" : "text-foreground")}>
              <StageIcon state={state} /> {t(s.label)}
            </li>
          )
        })}
      </ol>
      {slow && (
        <p className="rounded-lg bg-muted px-3 py-2.5 text-xs leading-[18px] text-muted-foreground">
          {t("This is taking longer than usual. Your first sync keeps running in the background — you can close this window and your trades will appear when it's done.")}
        </p>
      )}
    </div>
  )
}

function StageIcon({ state }: { state: "done" | "active" | "upcoming" }) {
  if (state === "done")
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-gain/15 text-gain">
        <Check className="size-3" strokeWidth={3} aria-hidden />
      </span>
    )
  if (state === "active") return <Loader2 className="size-5 shrink-0 animate-spin text-primary [animation-duration:900ms]" aria-hidden />
  return <span aria-hidden className="size-5 shrink-0 rounded-full border" />
}
