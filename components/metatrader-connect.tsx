"use client"

import type React from "react"
import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { connectMetaTrader, getMetaTraderConnection, type MetaTraderConnectionView } from "@/app/actions/metatrader"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AlertCircle, CheckCircle2, Clock, KeyRound, Loader2, ShieldCheck } from "lucide-react"
import { useIntlLocale, useT } from "@/components/locale-provider"

export type Connection = MetaTraderConnectionView

// Where the flow is, so a host (the Accounts page stepper) can follow along.
export type MetaTraderStage = "form" | "verifying" | "queued" | "done" | "error"

const HISTORY_OPTIONS = [
  { value: "all", label: "All available history" },
  { value: "1y", label: "Last 1 year" },
  { value: "90d", label: "Last 90 days" },
  { value: "30d", label: "Last 30 days" },
]

function money(n: number | null | undefined, currency: string | null | undefined, locale: string) {
  if (n == null) return "—"
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(n)
  } catch {
    return n.toFixed(2)
  }
}

// Form → "logging in" → connected / queued / failed. The sync server's worker
// does the actual login (worker/mt5); this only watches the connection row.
export function ConnectFlow({
  initial,
  lockPlatform,
  onDone,
  onBack,
  onStage,
}: {
  initial?: { server?: string; login?: string; platform?: string }
  // The platform was already chosen (a platform card): no MT5/MT4 switch.
  lockPlatform?: boolean
  onDone: () => void
  onBack?: () => void
  onStage?: (stage: MetaTraderStage) => void
}) {
  const t = useT()
  const router = useRouter()
  const dateLocale = useIntlLocale()
  const [pending, startTransition] = useTransition()
  const [platform, setPlatform] = useState<"mt5" | "mt4">(initial?.platform === "mt4" ? "mt4" : "mt5")
  const [history, setHistory] = useState("all")
  const [error, setError] = useState<string | null>(null)
  const [watching, setWatching] = useState<{ id: number; startedAt: number } | null>(null)
  const [result, setResult] = useState<MetaTraderConnectionView | null>(null)

  useEffect(() => {
    if (!watching) return
    let stopped = false
    const poll = async () => {
      const row = await getMetaTraderConnection(watching.id).catch(() => null)
      if (stopped || !row) return
      setResult(row)
      if (row.status === "connected" && row.accountId != null) {
        router.refresh()
        return
      }
      if (row.status === "error") return
      setTimeout(poll, 2_000)
    }
    poll()
    return () => {
      stopped = true
    }
  }, [watching, router])

  const status = result?.status ?? "pending"
  const stage: MetaTraderStage = !watching
    ? "form"
    : status === "error"
      ? "error"
      : status === "connected" && result?.accountId != null
        ? "done"
        : status === "pending" && result?.statusMessage
          ? "queued"
          : "verifying"
  useEffect(() => {
    onStage?.(stage)
  }, [stage, onStage])

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    formData.set("platform", platform)
    formData.set("history", history)
    startTransition(async () => {
      const res = await connectMetaTrader(formData).catch(() => ({ ok: false as const, error: "Could not connect" }))
      if (!res.ok) {
        setError(t(res.error))
        return
      }
      setResult(null)
      setWatching({ id: res.id, startedAt: Date.now() })
    })
  }

  if (watching) {
    if (stage === "error") {
      return (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-loss/40 bg-loss/10 p-4 text-sm">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-loss" />
            <div className="space-y-1">
              <p className="font-semibold">{t("Connection couldn't be completed")}</p>
              <p className="text-muted-foreground">{result?.statusMessage ? t(result.statusMessage) : t("We couldn't authenticate this account. Check your credentials and try again.")}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button className="h-11 flex-1" onClick={() => setWatching(null)}>
              {t("Try again")}
            </Button>
            {onBack && (
              <Button className="h-11" variant="outline" onClick={onBack}>
                {t("Back")}
              </Button>
            )}
          </div>
        </div>
      )
    }
    if (status === "connected") {
      const imported = result?.accountId != null
      return (
        <div className="space-y-5">
          <div className="flex flex-col items-center gap-2 text-center">
            {imported ? (
              <span className="flex size-11 items-center justify-center rounded-full bg-gain/10 text-gain">
                <CheckCircle2 className="size-6" />
              </span>
            ) : (
              <Loader2 className="size-7 animate-spin text-primary" />
            )}
            <p className="text-base font-semibold">{imported ? t("Account connected") : t("Importing your trade history…")}</p>
            <p className="text-sm text-muted-foreground">
              {result?.brokerName ?? result?.server} · {result?.login} · {result?.platform === "mt4" ? "MetaTrader 4" : "MetaTrader 5"}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-lg border p-3 text-center">
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground">{t("Balance")}</p>
              <p className="truncate text-sm font-semibold tabular-nums">{money(result?.balance, result?.currency, dateLocale)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground">{t("Equity")}</p>
              <p className="truncate text-sm font-semibold tabular-nums">{money(result?.equity, result?.currency, dateLocale)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground">{t("Open positions")}</p>
              <p className="truncate text-sm font-semibold tabular-nums">{result?.openPositions ?? "—"}</p>
            </div>
          </div>
          {imported && <p className="text-center text-sm text-muted-foreground">{t("Your trades are now syncing automatically.")}</p>}
          <Button className="h-11 w-full" onClick={onDone} disabled={!imported}>
            {t("Done")}
          </Button>
        </div>
      )
    }
    // The worker says this account is waiting for a terminal (e.g. MT4 still
    // being set up): no point spinning — say so and let them close.
    if (stage === "queued") {
      return (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border bg-muted/50 p-4 text-sm">
            <Clock className="mt-0.5 size-5 shrink-0 text-primary" />
            <p>{t(result!.statusMessage!)}</p>
          </div>
          <Button className="h-11 w-full" onClick={onDone}>
            {t("Close")}
          </Button>
        </div>
      )
    }
    const slow = Date.now() - watching.startedAt > 90_000
    return (
      <div className="space-y-3 py-4 text-center" role="status">
        <Loader2 className="mx-auto size-7 animate-spin text-primary" />
        <p className="font-semibold">{t("Connecting…")}</p>
        <p className="text-sm text-muted-foreground">
          {slow
            ? t("Still working — the first login to a broker can take a couple of minutes. You can close this; it keeps going in the background.")
            : t("Securely checking your account with your read-only password. This usually takes 10–30 seconds.")}
        </p>
        {slow && (
          <Button variant="outline" className="h-11 w-full" onClick={onDone}>
            {t("Close")}
          </Button>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <fieldset disabled={pending} className="space-y-4">
        {!lockPlatform && (
          <div role="radiogroup" aria-label={t("Platform")} className="grid grid-cols-2 gap-1 rounded-lg border p-1">
            {(["mt5", "mt4"] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={platform === p}
                onClick={() => setPlatform(p)}
                className={cn(
                  "rounded-md py-1.5 text-sm font-semibold transition-colors",
                  platform === p ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p === "mt5" ? "MetaTrader 5" : "MetaTrader 4"}
              </button>
            ))}
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="mt-server" className="text-xs font-semibold">{t("Server")}</Label>
          <Input id="mt-server" name="server" defaultValue={initial?.server} placeholder={platform === "mt5" ? t("e.g. FTMO-Server3") : t("e.g. Exness-Real6")} autoComplete="off" required className="h-10" />
          <p className="text-xs text-muted-foreground">{t("Exactly as shown in MetaTrader → File → Login to Trade Account.")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="mt-login" className="text-xs font-semibold">{t("Account number")}</Label>
            <Input id="mt-login" name="login" inputMode="numeric" defaultValue={initial?.login} autoComplete="off" required className="h-10" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mt-password" className="text-xs font-semibold">{t("Investor password")}</Label>
            <Input id="mt-password" name="investorPassword" type="password" autoComplete="off" required className="h-10" />
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-semibold">{t("Import history")}</Label>
          <Select value={history} onValueChange={(v) => v && setHistory(v)}>
            <SelectTrigger className="h-10 w-full">
              <SelectValue>{(v: string) => t(HISTORY_OPTIONS.find((o) => o.value === v)?.label ?? v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {HISTORY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {t(o.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </fieldset>
      <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-gain" />
        <p>{t("The investor password is read-only: it can see your trades but can never place or close one. It's stored encrypted and used only by our sync server.")}</p>
      </div>
      {error && (
        <p className="flex items-start gap-1.5 text-sm text-loss" role="alert">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-11 w-full">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
        {pending ? t("Connecting…") : t("Connect")}
      </Button>
    </form>
  )
}
