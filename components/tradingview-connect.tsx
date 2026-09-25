"use client"

import { useTransition } from "react"
import Link from "next/link"
import { unpairTradingView, type TradingViewPairingView } from "@/app/actions/tradingview"
import { Button } from "@/components/ui/button"
import { Unplug, Info, Lock, Puzzle, MonitorSmartphone } from "lucide-react"
import { toast } from "sonner"
import { useIntlLocale, useT } from "@/components/locale-provider"

// A browser the extension is paired in. Its check-ins tell whether it's
// still alive; the fills themselves are counted on the accounts below.
export function PairingRow({ pairing }: { pairing: TradingViewPairingView }) {
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

// TradingView's paper account can only be read by the trader's own logged-in
// browser, so sync runs through the TradeLoop extension: this is the setup
// panel (pair a browser, see paired ones). The paper accounts it finds show up
// in the Accounts page's connected-accounts panel.
export function TradingViewSetup({ pairings = [], isPro = true }: { pairings?: TradingViewPairingView[]; isPro?: boolean }) {
  const t = useT()
  const paired = pairings.length > 0

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("Pair your browser once and every paper trade syncs into the journal on its own. The TradeLoop extension reads your paper account in your own logged-in browser — nothing of your TradingView login is ever stored here.")}
      </p>

      {!isPro ? (
        <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <p>
            {t("Automatic sync into the journal is included with Pro.")}{" "}
            <Link href="/pricing" className="text-primary underline-offset-2 hover:underline">{t("See plans")}</Link>
          </p>
        </div>
      ) : (
        <>
          {/* A plain anchor, not a Link: the extension's content script only
              joins a page on a full load, so the pairing page must not be
              reached by a client-side navigation. */}
          <Button render={<a href="/extension/pair" />} nativeButton={false} className="h-11 w-full sm:w-auto" variant={paired ? "outline" : "default"}>
            <Puzzle className="size-4" /> {paired ? t("Pair another browser") : t("Set up automatic sync")}
          </Button>
          {paired ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">{t("Paired browsers")}</p>
              {pairings.map((p) => (
                <PairingRow key={p.id} pairing={p} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("Setup takes about a minute: install the TradeLoop extension in Chrome, Brave, Edge, Opera or Vivaldi, pair it, and open TradingView.")}</p>
          )}
        </>
      )}
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        {t("Paper trading only. Fills sync live while TradingView is open in a paired browser — trades placed on your phone are picked up the next time it's open.")}
      </p>
    </div>
  )
}
