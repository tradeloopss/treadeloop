"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { getTradingViewPairingStatus } from "@/app/actions/tradingview"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { CheckCircle2, Copy, Download, ExternalLink, Loader2, Puzzle } from "lucide-react"
import { toast } from "sonner"
import { useT } from "@/components/locale-provider"

// The extension's content script looks for this element on the pairing page
// (extension/pair.js), reads the code off it, checks in with the server, and
// then fires "tradeloop:paired" on the document so the page can flip without
// waiting for the next poll.
export const PAIRING_ELEMENT_ID = "tradeloop-pairing"

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-[var(--gain)] text-white" : "bg-primary/10 text-primary"}`}>
        {done ? <CheckCircle2 className="size-4" /> : n}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-medium">{title}</p>
        {children}
      </div>
    </div>
  )
}

export function TradingViewPair({
  pairingId,
  token,
  storeUrl,
  downloadPath,
}: {
  pairingId: number
  token: string
  storeUrl: string | null
  downloadPath: string
}) {
  const t = useT()
  const [paired, setPaired] = useState(false)
  const [label, setLabel] = useState<string | null>(null)
  const [showCode, setShowCode] = useState(false)

  useEffect(() => {
    if (paired) return
    let stopped = false
    const onPaired = () => {
      if (!stopped) setPaired(true)
    }
    // The extension may have checked in before this effect attached — and
    // the page may have re-rendered since, so the mark it leaves is checked
    // on every tick rather than only on mount.
    const marked = () => document.getElementById(PAIRING_ELEMENT_ID)?.dataset.paired === "true"
    if (marked()) onPaired()
    document.addEventListener("tradeloop:paired", onPaired)
    // The event is the fast path; the poll catches a check-in from a popup
    // where the code was pasted by hand.
    const timer = setInterval(async () => {
      if (marked()) onPaired()
      try {
        const status = await getTradingViewPairingStatus(pairingId)
        if (status.paired && !stopped) {
          setLabel(status.label)
          setPaired(true)
        }
      } catch (err) {
        // Try again on the next tick.
        console.debug("[TradeLoop] pairing check failed", err)
      }
    }, 3000)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener("tradeloop:paired", onPaired)
    }
  }, [paired, pairingId])

  // The browser's name only reaches the journal on the extension's check-in,
  // so when the extension tells the page directly it still has to be asked
  // for. Its own effect, because the one above tears itself down the moment
  // pairing succeeds.
  useEffect(() => {
    if (!paired || label != null) return
    let stopped = false
    getTradingViewPairingStatus(pairingId)
      .then((status) => !stopped && setLabel(status.label))
      .catch(() => {})
    return () => {
      stopped = true
    }
  }, [paired, label, pairingId])

  return (
    <Card className="max-w-2xl space-y-6 p-5">
      {/* Read by the extension, invisible to the trader. */}
      <div id={PAIRING_ELEMENT_ID} data-token={token} data-pairing-id={pairingId} hidden />

      <p className="text-sm text-muted-foreground">
        {t("Your TradingView paper account lives on TradingView's servers, and only your own logged-in browser is allowed to read it. The TradeLoop extension does the reading there: whenever TradingView is open, it picks up your new fills and sends them to this journal. Your TradingView password and login never leave your computer.")}
      </p>

      <Step n={1} title={t("Install the TradeLoop extension")} done={paired}>
        {storeUrl ? (
          <Button render={<a href={storeUrl} target="_blank" rel="noreferrer" />} variant="outline" size="sm">
            <Puzzle className="size-4" /> {t("Add to Chrome")} <ExternalLink className="size-3.5" />
          </Button>
        ) : (
          <div className="space-y-2 text-sm text-muted-foreground">
            <Button render={<a href={downloadPath} download />} variant="outline" size="sm">
              <Download className="size-4" /> {t("Download the extension")}
            </Button>
            <ol className="list-decimal space-y-1 ps-4 text-xs">
              <li>{t("Unzip the download into a folder you'll keep.")}</li>
              <li>
                {t("In Chrome, Edge or Brave open")} <code dir="ltr" className="rounded bg-muted px-1 font-mono">chrome://extensions</code> {t("and turn on Developer mode (top corner).")}
              </li>
              <li>{t("Click Load unpacked and pick that folder.")}</li>
            </ol>
          </div>
        )}
      </Step>

      <Step n={2} title={paired ? t("Paired") : t("Pair this browser")} done={paired}>
        {paired ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {label ? t("{browser} is now syncing your TradingView paper trades.", { browser: label }) : t("This browser is now syncing your TradingView paper trades.")}{" "}
              {t("Open TradingView and trade as usual — fills reach the journal within a minute, and anything you traded before pairing is brought in the first time TradingView is open.")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button render={<a href="https://www.tradingview.com/chart/" target="_blank" rel="noreferrer" />} size="sm">
                {t("Open TradingView")} <ExternalLink className="size-3.5" />
              </Button>
              <Button render={<Link href="/add-trade" />} variant="outline" size="sm">
                {t("Back to Broker Sync")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("Waiting for the extension… once it's installed, it picks the pairing up from this page by itself.")}
            </p>
            <button type="button" onClick={() => setShowCode((v) => !v)} className="text-xs text-primary underline-offset-2 hover:underline">
              {showCode ? t("Hide the pairing code") : t("Installed it and nothing happened? Pair with a code instead")}
            </button>
            {showCode && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("Open the extension's popup and paste this code")}</Label>
                <div className="flex gap-2">
                  <pre dir="ltr" className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted/50 px-3 py-2 text-start font-mono text-xs">{token}</pre>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    aria-label={t("Copy")}
                    onClick={() =>
                      navigator.clipboard.writeText(token).then(
                        () => toast.success(t("Copied.")),
                        () => toast.error(t("Could not copy — copy it manually")),
                      )
                    }
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t("The code lets that browser add trades to your journal and nothing else. Unpair it any time from Broker Sync.")}</p>
              </div>
            )}
          </div>
        )}
      </Step>
    </Card>
  )
}
