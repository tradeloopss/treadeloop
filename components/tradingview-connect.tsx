"use client"

import { useTransition } from "react"
import {
  disconnectTradingView,
  unpairTradingView,
  type TradingViewConnectionView,
  type TradingViewPairingView,
} from "@/app/actions/tradingview"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Unplug, Info, AlertCircle, Lock, Puzzle, MonitorSmartphone, Star } from "lucide-react"
import { toast } from "sonner"
import { useIntlLocale, useT } from "@/components/locale-provider"

// A browser the extension is paired in. Its check-ins tell whether it's
// still alive; the fills themselves are counted on the accounts below.
function PairingRow({ pairing }: { pairing: TradingViewPairingView }) {
  const t = useT()
  const dateLocale = useIntlLocale()
  const [pending, startTransition] = useTransition()
  const staleAfterMs = 10 * 60 * 1000
  const seen = pairing.lastSeenAt ? new Date(pairing.lastSeenAt) : null
  const live = seen != null && Date.now() - seen.getTime() < staleAfterMs

  function onUnpair() {
    startTransition(async () => {
      try {
        await unpairTradingView(pairing.id)
        toast.success(t("Browser unpaired"))
      } catch {
        toast.error(t("Could not unpair"))
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
      <div className="flex min-w-0 items-center gap-3">
        <MonitorSmartphone className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 text-sm">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {pairing.label ?? t("Paired browser")}
            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold tracking-wide uppercase ${live ? "text-[var(--gain)]" : "text-muted-foreground"}`}>
              <span className={`size-1.5 rounded-full ${live ? "bg-[var(--gain)]" : "bg-muted-foreground/50"}`} />
              {live ? t("Online") : t("Idle")}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            {seen ? t("Last seen {time}", { time: seen.toLocaleString(dateLocale) }) : t("Not seen yet")}
            {pairing.lastStatus === "error" && pairing.lastError && <span className="text-[var(--loss)]"> — {t(pairing.lastError)}</span>}
          </p>
        </div>
      </div>
      <Button onClick={onUnpair} disabled={pending} variant="ghost" size="sm" className="text-muted-foreground">
        <Unplug className="size-4" /> {t("Unpair")}
      </Button>
    </div>
  )
}

// One TradingView paper account the extension has found.
function ExtensionAccountRow({ connection }: { connection: TradingViewConnectionView }) {
  const t = useT()
  const dateLocale = useIntlLocale()
  const [pending, startTransition] = useTransition()

  function onDisconnect() {
    startTransition(async () => {
      try {
        await disconnectTradingView(connection.id)
        toast.success(t("Disconnected"))
      } catch {
        toast.error(t("Could not disconnect"))
      }
    })
  }

  const balance =
    connection.currentBalance != null
      ? new Intl.NumberFormat(dateLocale, { style: "currency", currency: connection.currency, maximumFractionDigits: 0 }).format(connection.currentBalance)
      : null

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0 text-sm">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {connection.name}
          <Badge variant="outline">{t("PAPER")}</Badge>
        </p>
        <p className="text-xs text-muted-foreground">
          {balance && <>{t("Balance {amount}", { amount: balance })} · </>}
          {connection.tradeCount === 1 ? t("1 trade journaled") : t("{n} trades journaled", { n: connection.tradeCount })}
          {connection.lastEventAt && <> · {t("Last fill {time}", { time: new Date(connection.lastEventAt).toLocaleString(dateLocale) })}</>}
        </p>
        {connection.lastStatus === "error" && connection.lastError && (
          <p className="mt-1 flex items-start gap-1.5 text-xs text-[var(--loss)]">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            {t(connection.lastError)}
          </p>
        )}
      </div>
      <Button onClick={onDisconnect} disabled={pending} variant="ghost" size="sm" className="text-muted-foreground">
        <Unplug className="size-4" /> {t("Disconnect")}
      </Button>
    </div>
  )
}

export function TradingViewConnect({
  connections,
  pairings = [],
  accounts = [],
  isPro = true,
}: {
  connections: TradingViewConnectionView[]
  pairings?: TradingViewPairingView[]
  accounts?: { id: number; name: string }[]
  isPro?: boolean
}) {
  const t = useT()
  const extensionConnections = connections.filter((c) => c.kind === "extension")
  const hasAutoSync = pairings.length > 0 || extensionConnections.length > 0

  return (
    <Card className="max-w-2xl space-y-5 p-5">
      <div>
        <h2 className="font-medium">{t("TradingView")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Pair your browser once and every paper trade syncs into the journal on its own, the way a Rithmic connection does. TradingView's paper account can only be read by your own logged-in browser, so the TradeLoop extension does the reading there — nothing of your TradingView login is ever stored here.")}
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{t("Automatic sync")}</h3>
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--gain)]/30 bg-[var(--gain)]/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--gain)] uppercase">
              <Star className="size-2.5 fill-current" /> {t("Recommended")}
            </span>
            <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
              {t("Any TradingView plan")}
            </span>
          </div>
          {isPro && (
            // A plain anchor, not a Link: the extension's content script only
            // joins a page on a full load, so the pairing page must not be
            // reached by a client-side navigation.
            <Button render={<a href="/extension/pair" />} size="sm" variant={hasAutoSync ? "outline" : "default"}>
              <Puzzle className="size-4" /> {hasAutoSync ? t("Pair another browser") : t("Set up automatic sync")}
            </Button>
          )}
        </div>

        {!isPro ? (
          <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            <Lock className="mt-0.5 size-4 shrink-0" />
            <p>
              {t("Automatic sync into the journal is included with Pro.")}{" "}
              <Link href="/pricing" className="text-primary underline-offset-2 hover:underline">{t("See plans")}</Link>
            </p>
          </div>
        ) : !hasAutoSync ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-6 text-center">
            <Puzzle className="size-5 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t("No browser paired yet. Setup takes about a minute: install the TradeLoop extension in Chrome, Brave, Edge, Opera or Vivaldi, pair it, and open TradingView.")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {pairings.map((p) => (
              <PairingRow key={p.id} pairing={p} />
            ))}
            {extensionConnections.map((c) => (
              <ExtensionAccountRow key={c.id} connection={c} />
            ))}
            {extensionConnections.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("Paired — your paper accounts appear here the first time TradingView is open in that browser.")}</p>
            )}
          </div>
        )}
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {t("Trades you place on your phone or tablet count too — the paper account lives on TradingView's servers, so any paired browser picks them up the next time it's open. Fills sync live while TradingView is open; the account's size and balance are read from TradingView, and futures use the contract multiplier for the symbol.")}
        </p>
      </div>
    </Card>
  )
}
