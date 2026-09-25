"use client"

import type React from "react"
import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  connectMetaTrader,
  disconnectMetaTrader,
  getMetaTraderConnection,
  getMetaTraderConnections,
  syncMetaTraderNow,
  type MetaTraderConnectionView,
} from "@/app/actions/metatrader"
import { brokerLogo } from "@/lib/broker-logos"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { toast } from "sonner"
import { AlertCircle, CheckCircle2, KeyRound, Loader2, Plus, RefreshCw, ShieldCheck, Unplug, Wifi } from "lucide-react"
import { useIntlLocale, useT } from "@/components/locale-provider"

export type Connection = MetaTraderConnectionView

const HISTORY_OPTIONS = [
  { value: "all", label: "All available history" },
  { value: "1y", label: "Last 1 year" },
  { value: "90d", label: "Last 90 days" },
  { value: "30d", label: "Last 30 days" },
]

// A clock that ticks so "synced 12s ago" stays true without a refetch.
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function useAgo() {
  const t = useT()
  const now = useNow(5_000)
  return (date: Date | null) => {
    if (!date) return null
    const s = Math.max(0, Math.round((now - new Date(date).getTime()) / 1000))
    if (s < 60) return t("{n}s ago", { n: s })
    const m = Math.round(s / 60)
    if (m < 60) return t("{n}m ago", { n: m })
    return t("{n}h ago", { n: Math.round(m / 60) })
  }
}

function money(n: number | null, currency: string | null, locale: string) {
  if (n == null) return "—"
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(n)
  } catch {
    return n.toFixed(2)
  }
}

// Form → "logging in" → done/failed, all in the one dialog. The worker on the
// sync server does the actual login; this just watches the connection row.
function ConnectFlow({ initial, onDone }: { initial?: { server: string; login: string; platform: string }; onDone: () => void }) {
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
    const status = result?.status ?? "pending"
    if (status === "error") {
      return (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-[var(--loss)]/40 bg-[var(--loss)]/10 p-3 text-sm">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--loss)]" />
            <p>{result?.statusMessage ? t(result.statusMessage) : t("MetaTrader rejected the login.")}</p>
          </div>
          <Button className="w-full" variant="outline" onClick={() => setWatching(null)}>
            {t("Try again")}
          </Button>
        </div>
      )
    }
    if (status === "connected") {
      const imported = result?.accountId != null
      return (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-[var(--gain)]/40 bg-[var(--gain)]/10 p-3 text-sm">
            {imported ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--gain)]" /> : <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />}
            <div className="space-y-1">
              <p className="font-medium">{t("Connected to {broker}", { broker: result?.brokerName ?? result?.server ?? "MetaTrader" })}</p>
              <p className="text-muted-foreground">
                {t("Balance {balance}", { balance: money(result?.balance ?? null, result?.currency ?? null, dateLocale) })}
                {" · "}
                {imported ? t("History imported — new trades sync automatically every minute.") : t("Importing your trade history…")}
              </p>
            </div>
          </div>
          <Button className="w-full" onClick={onDone} disabled={!imported}>
            {t("Done")}
          </Button>
        </div>
      )
    }
    const slow = Date.now() - watching.startedAt > 90_000
    return (
      <div className="space-y-3 py-2 text-center">
        <Loader2 className="mx-auto size-7 animate-spin text-primary" />
        <p className="font-medium">{t("Logging in to your MetaTrader account…")}</p>
        <p className="text-sm text-muted-foreground">
          {slow
            ? t("Still working — the first login to a broker can take a couple of minutes. You can close this; it keeps going in the background.")
            : t("Our sync server is connecting with your read-only password. This usually takes 10–30 seconds.")}
        </p>
        {slow && (
          <Button variant="outline" className="w-full" onClick={onDone}>
            {t("Close")}
          </Button>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
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
      <div className="space-y-1.5">
        <Label htmlFor="mt-server">{t("Server")}</Label>
        <Input id="mt-server" name="server" defaultValue={initial?.server} placeholder={platform === "mt5" ? t("e.g. FTMO-Server3") : t("e.g. Exness-Real6")} autoComplete="off" required />
        <p className="text-xs text-muted-foreground">{t("Exactly as shown in MetaTrader → File → Login to Trade Account.")}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="mt-login">{t("Account number")}</Label>
          <Input id="mt-login" name="login" inputMode="numeric" defaultValue={initial?.login} autoComplete="off" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mt-password">{t("Investor password")}</Label>
          <Input id="mt-password" name="investorPassword" type="password" autoComplete="off" required />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>{t("Import history")}</Label>
        <Select value={history} onValueChange={(v) => v && setHistory(v)}>
          <SelectTrigger className="w-full">
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
      <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--gain)]" />
        <p>{t("The investor password is read-only: it can see your trades but can never place or close one. It's stored encrypted and used only by our sync server.")}</p>
      </div>
      {error && <p className="text-sm text-[var(--loss)]">{error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
        {t("Connect")}
      </Button>
    </form>
  )
}

function StatusBadge({ status }: { status: string }) {
  const t = useT()
  if (status === "connected")
    return (
      <Badge variant="outline" className="gap-1.5 border-[var(--gain)]/40 text-[var(--gain)]">
        <span className="size-1.5 rounded-full bg-[var(--gain)]" /> {t("Connected")}
      </Badge>
    )
  if (status === "error")
    return (
      <Badge variant="outline" className="gap-1.5 border-[var(--loss)]/40 text-[var(--loss)]">
        <AlertCircle className="size-3" /> {t("Needs attention")}
      </Badge>
    )
  return (
    <Badge variant="outline" className="gap-1.5">
      <Loader2 className="size-3 animate-spin" /> {t("Connecting")}
    </Badge>
  )
}

function ConnectionRow({ connection, onReconnect }: { connection: Connection; onReconnect: (c: Connection) => void }) {
  const t = useT()
  const router = useRouter()
  const dateLocale = useIntlLocale()
  const ago = useAgo()
  const [disconnecting, startDisconnect] = useTransition()
  const [syncing, startSync] = useTransition()
  const logo = brokerLogo(connection.brokerName)
  const title = connection.brokerName ?? connection.server

  function onSync() {
    startSync(async () => {
      await syncMetaTraderNow(connection.id)
      toast.success(t("Syncing — new trades will appear in a few seconds"))
    })
  }

  function onDisconnect() {
    startDisconnect(async () => {
      const res = await disconnectMetaTrader(connection.id).catch(() => ({ ok: false }))
      if (res.ok) {
        toast.success(t("Disconnected"))
        router.refresh()
      } else toast.error(t("Could not disconnect"))
    })
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="size-9 shrink-0 rounded-md object-contain" />
          ) : (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-sm font-semibold text-primary">{title.slice(0, 1).toUpperCase()}</span>
          )}
          <div className="min-w-0">
            <p className="truncate font-medium">
              {title} · {connection.login}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {connection.server} · {connection.platform.toUpperCase()}
            </p>
          </div>
        </div>
        <StatusBadge status={connection.status} />
      </div>

      {connection.status === "connected" && (
        <div className="grid grid-cols-3 gap-2 text-sm">
          <Stat label={t("Balance")} value={money(connection.balance, connection.currency, dateLocale)} />
          <Stat label={t("Equity")} value={money(connection.equity, connection.currency, dateLocale)} />
          <Stat label={t("Open positions")} value={connection.openPositions == null ? "—" : String(connection.openPositions)} />
        </div>
      )}

      <div className={cn("rounded-md p-3 text-sm", connection.status === "error" ? "bg-[var(--loss)]/10" : "bg-accent/40")}>
        {connection.status === "error" ? (
          <p className="text-[var(--loss)]">{connection.statusMessage ? t(connection.statusMessage) : t("MetaTrader rejected the login.")}</p>
        ) : connection.status === "pending" ? (
          <p className="text-muted-foreground">{t("Logging in from our sync server…")}</p>
        ) : (
          <p className="text-muted-foreground">
            {connection.lastSyncedAt ? t("Synced {ago} · updates automatically every minute", { ago: ago(connection.lastSyncedAt) ?? "" }) : t("Waiting for the first sync…")}
            {connection.lastSyncStatus === "error" && connection.lastSyncError && <span className="mt-1 block text-[var(--loss)]">{t(connection.lastSyncError)}</span>}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        {connection.status === "error" ? (
          <Button onClick={() => onReconnect(connection)} className="flex-1">
            <KeyRound className="size-4" /> {t("Reconnect")}
          </Button>
        ) : (
          <Button onClick={onSync} disabled={syncing || connection.status !== "connected"} className="flex-1">
            <RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} />
            {t("Sync now")}
          </Button>
        )}
        <Button onClick={onDisconnect} disabled={disconnecting} variant="outline">
          <Unplug className="size-4" /> {t("Disconnect")}
        </Button>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border px-3 py-2">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="truncate font-medium tabular-nums">{value}</p>
    </div>
  )
}

export function MetaTraderConnect({ connections: initialConnections }: { connections: Connection[] }) {
  const t = useT()
  const [connections, setConnections] = useState(initialConnections)
  const [open, setOpen] = useState(false)
  const [reconnect, setReconnect] = useState<{ server: string; login: string; platform: string } | undefined>()
  const [flowKey, setFlowKey] = useState(0)

  useEffect(() => setConnections(initialConnections), [initialConnections])

  // Keep balances, statuses and "synced …" fresh while the card is on screen;
  // faster while any account is still logging in.
  const connectionsRef = useRef(connections)
  connectionsRef.current = connections
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      const fresh = await getMetaTraderConnections().catch(() => null)
      if (stopped) return
      if (fresh) setConnections(fresh)
      const busy = (fresh ?? connectionsRef.current).some((c) => c.status === "pending")
      timer = setTimeout(tick, busy ? 3_000 : 20_000)
    }
    timer = setTimeout(tick, 20_000)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [])

  function openDialog(initial?: { server: string; login: string; platform: string }) {
    setReconnect(initial)
    setFlowKey((k) => k + 1)
    setOpen(true)
  }

  return (
    <Card className="max-w-2xl space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">{t("MetaTrader 4 & 5")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("Connect with your investor (read-only) password — every trade syncs into your journal automatically.")}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button size="sm" onClick={() => openDialog()}><Plus className="size-4" /> {t("Add account")}</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("Connect MetaTrader")}</DialogTitle>
              <DialogDescription>{t("Use the investor password from your broker or prop firm — never your trading password.")}</DialogDescription>
            </DialogHeader>
            <ConnectFlow key={flowKey} initial={reconnect} onDone={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {connections.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-center">
          <Wifi className="size-6 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{t("No MetaTrader accounts connected yet.")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {connections.map((c) => (
            <ConnectionRow key={c.id} connection={c} onReconnect={(conn) => openDialog({ server: conn.server, login: conn.login, platform: conn.platform })} />
          ))}
        </div>
      )}
    </Card>
  )
}
