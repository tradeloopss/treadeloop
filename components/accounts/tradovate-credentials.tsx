"use client"

import type React from "react"
import { useEffect, useRef, useState, useTransition } from "react"
import { CheckCircle2, Info, Loader2, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useT } from "@/components/locale-provider"
import { connectTradovateCredentials, getTradovateCredentialConnections } from "@/app/actions/ninjatrader"

// Tradovate through NinjaTrader on the VPS — the credentials path, like
// MetaTrader. The trader enters their Tradovate login once; the VPS logs it in
// through NinjaTrader and syncs on its own. The password never comes back to
// the browser; it's stored encrypted and used only on the VPS.
//
// Duplicated from lib/ninjatrader/credentials.ts (a server module) so this
// client component doesn't pull in server-only deps.
const CONNECTION_KINDS = [
  { kind: "Apex", label: "Apex Trader Funding" },
  { kind: "Tradeify", label: "Tradeify" },
  { kind: "MyFundedFutures", label: "My Funded Futures" },
  { kind: "TakeProfitTrader", label: "Take Profit Trader" },
  { kind: "BluSky", label: "BluSky Trading" },
  { kind: "Tradovate", label: "Tradovate (direct)" },
]

export type TradovateCredentialsState = "form" | "connecting" | "connected"

export function TradovateCredentials({ onDone, onFile, onState }: { onDone: () => void; onFile: () => void; onState?: (s: TradovateCredentialsState) => void }) {
  const t = useT()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [kind, setKind] = useState(CONNECTION_KINDS[0].kind)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [connectionId, setConnectionId] = useState<number | null>(null)
  const [status, setStatus] = useState<string>("pending")
  const [online, setOnline] = useState(false)
  const alive = useRef(true)

  const state: TradovateCredentialsState = connectionId == null ? "form" : online || status === "connected" ? "connected" : "connecting"
  useEffect(() => onState?.(state), [state, onState])

  // Once submitted, watch this login until the VPS has it connected.
  useEffect(() => {
    if (connectionId == null) return
    alive.current = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = async () => {
      const r = await getTradovateCredentialConnections().catch(() => null)
      if (!alive.current) return
      if (r?.ok) {
        const row = r.value.find((c) => c.id === connectionId)
        if (row) {
          setStatus(row.status)
          setOnline(row.online)
          if (row.status === "reauth" || row.status === "error") setError(row.statusMessage ?? t("Tradovate rejected this login. Check the username and password and try again."))
        }
      }
      timer = setTimeout(poll, 3000)
    }
    void poll()
    return () => {
      alive.current = false
      if (timer) clearTimeout(timer)
    }
  }, [connectionId, t])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const r = await connectTradovateCredentials({ username: username.trim(), password, connectionKind: kind })
      if (!r.ok) {
        setError(r.error)
        return
      }
      setPassword("")
      setStatus("pending")
      setOnline(false)
      setConnectionId(r.value.id)
    })
  }

  if (connectionId != null && (state === "connected" || status === "reauth" || status === "error")) {
    const failed = status === "reauth" || status === "error"
    return (
      <div className="space-y-4">
        <div className={cn("flex items-start gap-3 rounded-xl border p-4", failed ? "border-loss/30 bg-loss/5" : "border-gain/30 bg-gain/5")}>
          {failed ? <Info className="mt-0.5 size-5 shrink-0 text-loss" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-gain" aria-hidden />}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{failed ? t("Couldn't connect this login") : t("Tradovate is connected")}</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {failed ? (error ?? t("Check the username and password and try again.")) : t("Your accounts appear on the Accounts page in a moment, and new fills sync on their own — no need to keep anything open.")}
            </p>
          </div>
        </div>
        {failed ? (
          <Button variant="outline" className="h-11 w-full" onClick={() => setConnectionId(null)}>
            {t("Try again")}
          </Button>
        ) : (
          <Button className="h-11 w-full font-semibold hover:bg-primary/90" onClick={onDone}>
            {t("Done")}
          </Button>
        )}
      </div>
    )
  }

  if (connectionId != null) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2.5 rounded-lg bg-primary/5 px-3 py-3 text-[13px] text-foreground" role="status">
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
          {t("Connecting your Tradovate account on our server… this can take a minute and finishes on its own.")}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{t("You can close this window — the connection keeps going, and your accounts show up on the Accounts page when they're ready.")}</p>
        <Button variant="outline" className="h-11 w-full" onClick={onDone}>
          {t("Close")}
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-[13px] leading-5 text-muted-foreground">
        {t("Enter your Tradovate login. We connect it on our server through NinjaTrader and sync your fills automatically — you don't need NinjaTrader or your PC.")}
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="tv-kind">{t("Which account")}</Label>
        <select
          id="tv-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="flex h-11 w-full rounded-lg border border-input bg-background px-3 text-sm ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {CONNECTION_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tv-user">{t("Tradovate username")}</Label>
        <Input id="tv-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={t("Your Tradovate login")} className="h-11" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tv-pass">{t("Tradovate password")}</Label>
        <Input id="tv-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" placeholder={t("Your Tradovate password")} className="h-11" />
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-loss/10 px-3 py-2.5 text-[13px] text-loss">
          {t(error)}
        </p>
      )}

      <p className="flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t("Your password is stored encrypted and used only to connect your account through NinjaTrader on our server, so syncing can continue. It's never shown in the app and never used to place, change or cancel orders.")}
      </p>

      <Button type="submit" disabled={pending || !username.trim() || !password} className="h-11 w-full font-semibold hover:bg-primary/90">
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {pending ? t("Connecting…") : t("Connect Tradovate")}
      </Button>

      <button type="button" onClick={onFile} className="text-[13px] font-medium text-primary hover:underline">
        {t("Prefer to import a CSV instead?")}
      </button>
    </form>
  )
}