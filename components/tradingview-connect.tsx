"use client"

import type React from "react"
import { useState, useTransition } from "react"
import Link from "next/link"
import {
  connectTradingView,
  disconnectTradingView,
  importTradingViewPaste,
  regenerateTradingViewWebhook,
  unpairTradingView,
  type TradingViewConnectionView,
  type TradingViewPairingView,
} from "@/app/actions/tradingview"
import { tradingviewAlertTemplate } from "@/lib/tradingview-alert"
import { tradingviewExportSnippet } from "@/lib/tradingview-export-snippet"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Plus, Copy, Unplug, Wifi, RefreshCw, Info, AlertCircle, ClipboardPaste, Lock, Puzzle, ChevronDown, ChevronUp, MonitorSmartphone, Star } from "lucide-react"
import { toast } from "sonner"
import { useIntlLocale, useT } from "@/components/locale-provider"

function CopyRow({ value, label, mono = true }: { value: string; label: string; mono?: boolean }) {
  const t = useT()
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex gap-2">
        {/* A URL and a JSON body read left to right whatever the page's
            direction is — mirrored, the braces and the address land in the
            wrong places and the start of the URL scrolls out of view. */}
        <pre dir="ltr" className={`min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted/50 px-3 py-2 text-start text-xs ${mono ? "font-mono" : ""}`}>{value}</pre>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          aria-label={t("Copy")}
          onClick={() =>
            navigator.clipboard.writeText(value).then(
              () => toast.success(t("Copied.")),
              () => toast.error(t("Could not copy — copy it manually")),
            )
          }
        >
          <Copy className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function ConnectForm({ onDone }: { onDone: () => void }) {
  const t = useT()
  const [name, setName] = useState("TradingView Paper")
  const [market, setMarket] = useState("stocks")
  const [startingBalance, setStartingBalance] = useState("")
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData()
    formData.set("name", name)
    formData.set("market", market)
    formData.set("startingBalance", startingBalance)
    startTransition(async () => {
      try {
        await connectTradingView(formData)
        toast.success(t("TradingView connected"))
        onDone()
      } catch (err) {
        toast.error(err instanceof Error ? t(err.message) : t("Could not connect"))
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="tv-name">{t("Account name")}</Label>
        <Input id="tv-name" value={name} onChange={(e) => setName(e.target.value)} required />
        <p className="text-xs text-muted-foreground">{t("What this paper account is called in your journal.")}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t("What you trade on it")}</Label>
          <Select value={market} onValueChange={(v) => v && setMarket(v)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="stocks">{t("Stocks")}</SelectItem>
              <SelectItem value="futures">{t("Futures")}</SelectItem>
              <SelectItem value="crypto">{t("Crypto")}</SelectItem>
              <SelectItem value="forex">{t("Forex")}</SelectItem>
              <SelectItem value="options">{t("Options")}</SelectItem>
              <SelectItem value="cfd">{t("CFD")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tv-balance">{t("Paper balance")}</Label>
          <Input id="tv-balance" type="number" step="any" placeholder={t("e.g. 100000")} value={startingBalance} onChange={(e) => setStartingBalance(e.target.value)} />
        </div>
      </div>
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        {t("Futures use the contract multiplier for the symbol; every other market counts one unit per contract.")}
      </p>
      <DialogFooter>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? t("Creating…") : t("Create webhook")}
        </Button>
      </DialogFooter>
    </form>
  )
}

function ConnectionRow({ connection }: { connection: TradingViewConnectionView }) {
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

  function onRegenerate() {
    startTransition(async () => {
      try {
        await regenerateTradingViewWebhook(connection.id)
        toast.success(t("New webhook URL created — update your TradingView alert"))
      } catch {
        toast.error(t("Could not create a new URL"))
      }
    })
  }

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{connection.name}</p>
          <p className="text-sm text-muted-foreground">
            {t(connection.market === "future_option" ? "Future options" : connection.market.charAt(0).toUpperCase() + connection.market.slice(1))}
          </p>
        </div>
        <Badge variant="outline">{t("TRADINGVIEW")}</Badge>
      </div>

      <CopyRow label={t("Webhook URL — paste into the alert's Notifications tab")} value={connection.webhookUrl} />
      <CopyRow label={t("Alert message — paste into the alert's Message box")} value={tradingviewAlertTemplate()} />

      <div className="rounded-md bg-accent/40 p-3 text-sm">
        {connection.lastEventAt ? (
          <>
            <p>
              {t("Last alert {time}", { time: new Date(connection.lastEventAt).toLocaleString(dateLocale) })}
              {" — "}
              {connection.eventCount === 1 ? t("1 alert received") : t("{n} alerts received", { n: connection.eventCount })}
              {connection.tradeCount > 0 && `, ${connection.tradeCount === 1 ? t("1 trade journaled") : t("{n} trades journaled", { n: connection.tradeCount })}`}
            </p>
            {connection.lastStatus === "error" && connection.lastError && (
              <p className="mt-1 flex items-start gap-1.5 text-[var(--loss)]">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                {t(connection.lastError)}
              </p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">{t("No alerts yet — TradingView will reach this URL the first time your alert fires.")}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onRegenerate} disabled={pending} variant="outline" size="sm">
          <RefreshCw className="size-4" /> {t("New URL")}
        </Button>
        <Button onClick={onDisconnect} disabled={pending} variant="outline" size="sm">
          <Unplug className="size-4" /> {t("Disconnect")}
        </Button>
      </div>
    </div>
  )
}


// Bringing trades in on a free TradingView plan. Every automatic route is
// paid — webhooks and strategy alerts need Essential, and so does the
// Trading Panel's own Export data… button — so what's left is the rows the
// trader can see. They copy them and paste them here.
function PasteImport({ accounts }: { accounts: { id: number; name: string }[] }) {
  const t = useT()
  const [pasted, setPasted] = useState("")
  const [accountId, setAccountId] = useState<string>("auto")
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    startTransition(async () => {
      try {
        const result = await importTradingViewPaste(pasted, accountId === "auto" ? null : Number(accountId))
        const into = t("into {account}", { account: result.accountName })
        if (result.imported > 0) {
          toast.success(
            `${result.imported === 1 ? t("1 trade imported") : t("{n} trades imported", { n: result.imported })} ${into}`,
          )
        } else {
          toast.success(t("Nothing new — those trades are already in your journal"))
        }
        if (result.skippedRows > 0) {
          toast.message(
            result.skippedRows === 1 ? t("1 row skipped (not a fill)") : t("{n} rows skipped (not fills)", { n: result.skippedRows }),
          )
        }
        setPasted("")
      } catch (err) {
        toast.error(err instanceof Error ? t(err.message) : t("Could not import those rows"))
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{t("Paste your trades")}</h3>
        <span className="rounded-full border border-[var(--gain)]/30 bg-[var(--gain)]/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--gain)] uppercase">
          {t("Works on the free plan")}
        </span>
      </div>
      <ol className="list-decimal space-y-1 ps-4 text-xs text-muted-foreground">
        <li>{t("In TradingView, open the Trading Panel and its History tab, then the Filled list.")}</li>
        <li>{t("Scroll it so every trade you want is on screen.")}</li>
        <li>{t("Open your browser console (F12 → Console), paste the line below and press Enter — it only reads that table and copies it to your clipboard.")}</li>
        <li>{t("Paste the result in the box below.")}</li>
      </ol>
      <CopyRow label={t("Copy-to-clipboard line")} value={tradingviewExportSnippet()} />
      <form onSubmit={onSubmit} className="space-y-2">
        <Textarea
          dir="ltr"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={5}
          className="font-mono text-xs"
          placeholder={t("Paste the copied rows here — keep the column headings")}
        />
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1 space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("Import into")}</Label>
            {/* Base UI reads the label to display from `items`; without it
                the trigger shows the raw value. */}
            <Select
              value={accountId}
              onValueChange={(v) => v && setAccountId(v)}
              items={{ auto: t("TradingView account (created if needed)"), ...Object.fromEntries(accounts.map((a) => [String(a.id), a.name])) }}
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t("TradingView account (created if needed)")}</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={pending || pasted.trim().length < 20}>
            <ClipboardPaste className="size-4" /> {pending ? t("Importing…") : t("Import trades")}
          </Button>
        </div>
      </form>
      <p className="text-xs text-muted-foreground">
        {t("Pasting the same range twice is safe — trades already journaled are skipped. A position still open is journaled once its closing fill is in the rows too.")}
      </p>
    </div>
  )
}

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
  const [open, setOpen] = useState(false)
  const [showOtherWays, setShowOtherWays] = useState(false)
  const extensionConnections = connections.filter((c) => c.kind === "extension")
  const webhookConnections = connections.filter((c) => c.kind === "webhook")
  const hasAutoSync = pairings.length > 0 || extensionConnections.length > 0
  // The paid-plan webhook only shows itself once someone has set one up;
  // otherwise it lives under "other ways in" with the paste route.
  const otherWaysOpen = showOtherWays || webhookConnections.length > 0

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
            <p className="text-sm text-muted-foreground">{t("No browser paired yet. Setup takes about a minute: install the TradeLoop extension, pair it, and open TradingView.")}</p>
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
          {t("Fills sync while TradingView is open in a paired browser and back-fill when it opens next; the account's size and balance are read from TradingView. Futures use the contract multiplier for the symbol.")}
        </p>
      </div>

      <div className="border-t pt-4">
        <button
          type="button"
          onClick={() => setShowOtherWays((v) => !v)}
          className="flex w-full items-center justify-between text-sm font-medium text-muted-foreground hover:text-foreground"
          aria-expanded={otherWaysOpen}
        >
          {t("Other ways to bring TradingView trades in")}
          {otherWaysOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>

        {otherWaysOpen && (
          <div className="mt-4 space-y-5">
            <PasteImport accounts={accounts} />

            <div className="space-y-3 border-t pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{t("Alert webhook")}</h3>
                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--chart-4)]/40 bg-[var(--chart-4)]/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--chart-4)] uppercase">
                    <Lock className="size-2.5" /> {t("Needs TradingView Essential")}
                  </span>
                </div>
                {isPro && (
                  <Dialog open={open} onOpenChange={setOpen}>
                    <DialogTrigger render={<Button size="sm" variant="outline"><Plus className="size-4" /> {t("Connect")}</Button>} />
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t("Connect TradingView")}</DialogTitle>
                        <DialogDescription>{t("We'll create a webhook URL for this paper account. Nothing is sent to TradingView — you paste the URL into an alert yourself.")}</DialogDescription>
                      </DialogHeader>
                      <ConnectForm onDone={() => setOpen(false)} />
                    </DialogContent>
                  </Dialog>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("On TradingView's Essential plan and above, an alert on your strategy can post every fill here as it happens — for strategies that place their own orders. Trades you place by hand don't fire alerts, which is what the extension is for.")}
              </p>

              {webhookConnections.length === 0 ? (
                <div className="flex h-24 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-center">
                  <Wifi className="size-5 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">{t("No TradingView webhooks yet.")}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {webhookConnections.map((c) => (
                    <ConnectionRow key={c.id} connection={c} />
                  ))}
                </div>
              )}

              {webhookConnections.length > 0 && (
                <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">{t("Setting up the alert in TradingView")}</p>
                  <ol className="list-decimal space-y-1 ps-4">
                    <li>{t("Open your strategy on a chart, then Add alert on <strategy> — an alert made from the chart instead of the strategy can't report fills.")}</li>
                    <li>{t("Under Settings, set the trigger to Order fills only.")}</li>
                    <li>{t("Paste the alert message above into the Message box, exactly as it is.")}</li>
                    <li>{t("On the Notifications tab, tick Webhook URL and paste the webhook URL above.")}</li>
                    <li>{t("Save. Every fill from then on lands in this account.")}</li>
                  </ol>
                  <p>{t("Webhook alerts also ask for two-factor authentication on your TradingView account.")}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
