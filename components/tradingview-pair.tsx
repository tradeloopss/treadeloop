"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { getTradingViewPairingStatus } from "@/app/actions/tradingview"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { CheckCircle2, Copy, Download, ExternalLink, Loader2, Puzzle, Smartphone } from "lucide-react"
import { toast } from "sonner"
import { useT } from "@/components/locale-provider"

// The extension's content script looks for this element on the pairing page
// (extension/pair.js), reads the code off it, checks in with the server, and
// then fires "tradeloop:paired" on the document so the page can flip without
// waiting for the next poll.
export const PAIRING_ELEMENT_ID = "tradeloop-pairing"

// Which Chromium browser this is, for the name on the install button and the
// address of its extensions page. Brave hides itself from the user agent, so
// it's asked directly; the rest are in the brand list or the UA string.
function detectBrowser(): { name: string; scheme: string } {
  const nav = navigator as Navigator & {
    brave?: { isBrave?: () => Promise<boolean> }
    userAgentData?: { brands?: { brand: string }[] }
  }
  if (nav.brave) return { name: "Brave", scheme: "brave" }
  const brands = nav.userAgentData?.brands?.map((b) => b.brand).join(" ") ?? ""
  const ua = navigator.userAgent
  const has = (needle: string) => brands.includes(needle) || ua.includes(needle)
  if (has("Edg")) return { name: "Edge", scheme: "edge" }
  if (has("Opera") || has("OPR")) return { name: "Opera", scheme: "opera" }
  if (has("Vivaldi")) return { name: "Vivaldi", scheme: "vivaldi" }
  return { name: "Chrome", scheme: "chrome" }
}

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
  bookmarklet,
}: {
  pairingId: number
  token: string
  storeUrl: string | null
  downloadPath: string
  bookmarklet: string
}) {
  const t = useT()
  const [paired, setPaired] = useState(false)
  const [label, setLabel] = useState<string | null>(null)
  const [showCode, setShowCode] = useState(false)
  const [showPhone, setShowPhone] = useState(false)
  // Every Chromium browser runs the extension, but each keeps its extensions
  // page at its own address and likes being called by its own name. Resolved
  // on the client, so the server render stays the same for everyone.
  const [browser, setBrowser] = useState<{ name: string; scheme: string }>({ name: "Chrome", scheme: "chrome" })
  useEffect(() => setBrowser(detectBrowser()), [])
  const browserName = browser.name
  const extensionsUrl = `${browser.scheme}://extensions`

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
            <Puzzle className="size-4" /> {t("Add to {browser}", { browser: browserName })} <ExternalLink className="size-3.5" />
          </Button>
        ) : (
          <div className="space-y-2 text-sm text-muted-foreground">
            <Button render={<a href={downloadPath} download />} variant="outline" size="sm">
              <Download className="size-4" /> {t("Download the extension")}
            </Button>
            <ol className="list-decimal space-y-1 ps-4 text-xs">
              <li>{t("Unzip the download into a folder you'll keep.")}</li>
              <li>
                {t("Open your browser's extensions page —")}{" "}
                <code dir="ltr" className="rounded bg-muted px-1 font-mono">{extensionsUrl}</code>{" "}
                {t("— and turn on Developer mode (top corner).")}
              </li>
              <li>{t("Click Load unpacked and pick that folder.")}</li>
            </ol>
            <p className="text-xs">{t("Works in Chrome, Brave, Edge, Opera and Vivaldi. Phones don't run extensions, but they don't need to: pair one computer and the trades you place on your phone are picked up there.")}</p>
          </div>
        )}
      </Step>

      <Step n={2} title={paired ? t("Paired") : t("Pair this browser")} done={paired}>
        {paired ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {label ? t("{browser} is now syncing your TradingView paper trades.", { browser: label }) : t("This browser is now syncing your TradingView paper trades.")}{" "}
              {t("Open TradingView and trade as usual — fills reach the journal within a minute. Trades placed on your phone, or before you paired, are brought in the next time TradingView is open in this browser, so you only need one paired browser anywhere.")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button render={<a href="https://www.tradingview.com/chart/" target="_blank" rel="noreferrer" />} size="sm">
                {t("Open TradingView")} <ExternalLink className="size-3.5" />
              </Button>
              <Button render={<Link href="/accounts" />} variant="outline" size="sm">
                {t("Back to Accounts")}
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

      {/* Phones and tablets can't run an extension. This does the same read
          from inside the trader's own logged-in TradingView tab, on a tap —
          no install, no password. */}
      <div className="border-t pt-5">
        <button
          type="button"
          onClick={() => setShowPhone((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium text-foreground"
          aria-expanded={showPhone}
        >
          <Smartphone className="size-4 text-muted-foreground" />
          {t("On a phone or tablet? No install needed")}
        </button>
        {showPhone && (
          <div className="mt-3 space-y-3 text-sm text-muted-foreground">
            <p>
              {t("Trades you place in the TradingView phone app are saved on TradingView's servers, so a browser signed into your account can pull them in — the app itself can't be read (phones don't let one app see another), but its trades aren't stuck there.")}
            </p>
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="font-medium text-foreground">{t("Automatic, on the phone itself")}</p>
              <p className="mt-1 text-xs">
                {t("A few phone browsers run extensions. Install the TradeLoop extension in one, open TradingView in it, and it syncs on its own — including everything you trade in the app.")}
              </p>
              <ul className="mt-1 list-disc space-y-0.5 ps-4 text-xs">
                <li>{t("Android: Kiwi Browser or Firefox")}</li>
                <li>{t("iPhone: Orion browser (installs Chrome & Firefox extensions)")}</li>
              </ul>
            </div>
            <p className="text-xs font-medium text-foreground">{t("Or, no install — the one-tap bookmark:")}</p>
            <ol className="list-decimal space-y-2 ps-4">
              <li>
                {/* The bookmarklet is never navigated to — it's dragged or
                    long-pressed into the bookmarks bar — so the href is inert
                    and the button copies it for a phone that can't drag. */}
                {t("Copy the bookmark below, then in your browser add a new bookmark and paste it as the address.")}
                <div className="mt-2 flex gap-2">
                  <pre dir="ltr" className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted/50 px-3 py-2 text-start font-mono text-[11px]">
                    {bookmarklet.slice(0, 48)}…
                  </pre>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    aria-label={t("Copy")}
                    onClick={() =>
                      navigator.clipboard.writeText(bookmarklet).then(
                        () => toast.success(t("Bookmark copied — paste it as a new bookmark's address")),
                        () => toast.error(t("Could not copy — copy it manually")),
                      )
                    }
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
                <p className="mt-1 text-xs">
                  {t("On a computer you can drag this straight to the bookmarks bar:")}{" "}
                  {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                  <a href={bookmarklet} onClick={(e) => e.preventDefault()} className="font-medium text-primary underline-offset-2 hover:underline">
                    {t("TradeLoop sync")}
                  </a>
                </p>
              </li>
              <li>{t("Name it \"TradeLoop sync\" and save.")}</li>
              <li>{t("Open TradingView, sign in, and place your trades as usual.")}</li>
              <li>{t("Tap the bookmark whenever you want your journal caught up — it takes a second and tells you what it added.")}</li>
            </ol>
            <p className="text-xs">
              {t("This is the whole reason there's no \"connect with your TradingView password\" here: TradingView has no way to read a paper account from our servers, so the reading has to happen in your own signed-in browser. The bookmark does exactly that and nothing else.")}
            </p>
          </div>
        )}
      </div>
    </Card>
  )
}
