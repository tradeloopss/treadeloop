"use client"

import type React from "react"
import { useEffect, useRef, useState, useTransition } from "react"
import { connectMetaTrader, disconnectMetaTrader, searchMetaTraderServers, syncMetaTrader } from "@/app/actions/metatrader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
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
import { toast } from "sonner"
import { Plus, RefreshCw, Unplug, Loader2, Wifi } from "lucide-react"
import { useIntlLocale, useT } from "@/components/locale-provider"

type BrokerServer = { broker: string; server: string }

// Searches broker servers as the user types (debounced) and offers matches
// as a convenience — but the field is a normal free-text input underneath,
// so typing the exact server name and connecting works even without picking
// a suggestion (important since the search itself depends on an external
// API that can be temporarily rate-limited).
function ServerSearch({
  platform,
  value,
  onChange,
}: {
  platform: "mt4" | "mt5"
  value: string
  onChange: (server: string) => void
}) {
  const t = useT()
  const [results, setResults] = useState<BrokerServer[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (value.trim().length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    timeoutRef.current = setTimeout(async () => {
      try {
        const found = await searchMetaTraderServers(value, platform)
        setResults(found)
        setOpen(found.length > 0)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 400)
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, platform])

  function select(server: string) {
    onChange(server)
    setResults([])
    setOpen(false)
  }

  return (
    <div className="relative space-y-1.5">
      <Label htmlFor="server">{t("Broker server")}</Label>
      <div className="relative">
        <Input
          id="server"
          name="server"
          value={value}
          placeholder={t("e.g. Exness-MT5Real6 — search or type the exact name")}
          autoComplete="off"
          required
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {searching && <Loader2 className="absolute end-2 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-20 max-h-64 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
          {results.slice(0, 50).map((r) => (
            <button
              key={r.server}
              type="button"
              onMouseDown={() => select(r.server)}
              className="flex w-full flex-col items-start px-3 py-2 text-start text-sm hover:bg-accent"
            >
              <span className="font-medium">{r.server}</span>
              <span className="text-xs text-muted-foreground">{r.broker}</span>
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {t("Matches appear as you type — or just type the exact server name if you already know it.")}
      </p>
    </div>
  )
}

function ConnectForm({ onDone }: { onDone: () => void }) {
  const t = useT()
  const [platform, setPlatform] = useState<"mt4" | "mt5">("mt5")
  const [server, setServer] = useState("")
  const [pending, startTransition] = useTransition()

  function onConnect(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    formData.set("platform", platform)
    startTransition(async () => {
      try {
        await connectMetaTrader(formData)
        toast.success(t("MetaTrader connected"))
        onDone()
      } catch (err) {
        toast.error(err instanceof Error ? t(err.message) : t("Could not connect"))
      }
    })
  }

  return (
    <form onSubmit={onConnect} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="login">{t("MT login")}</Label>
          <Input id="login" name="login" required autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label>{t("Platform")}</Label>
          <Select
            value={platform}
            onValueChange={(v) => {
              if (!v) return
              setPlatform(v as "mt4" | "mt5")
              setServer("")
            }}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mt5">MT5</SelectItem>
              <SelectItem value="mt4">MT4</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="investorPassword">{t("Investor password")}</Label>
        <Input id="investorPassword" name="investorPassword" type="password" required autoComplete="off" />
      </div>
      <ServerSearch key={platform} platform={platform} value={server} onChange={setServer} />
      <Button type="submit" disabled={pending || !server} className="w-full">
        {pending ? t("Connecting…") : t("Connect")}
      </Button>
    </form>
  )
}

export type Connection = {
  id: number
  login: string
  server: string
  platform: string
  tokenExpiresAt: Date | null
  lastSyncedAt: Date | null
  lastSyncStatus: string | null
  lastSyncError: string | null
  lastSyncCount: number | null
}

function ConnectionRow({ connection }: { connection: Connection }) {
  const t = useT()
  const dateLocale = useIntlLocale()
  const [pending, startTransition] = useTransition()
  const [syncing, startSync] = useTransition()

  function onSync() {
    startSync(async () => {
      try {
        const result = await syncMetaTrader(connection.id)
        toast.success(result.imported > 0 ? (result.imported === 1 ? t("Imported 1 trade") : t("Imported {n} trades", { n: result.imported })) : t("Already up to date"))
      } catch (err) {
        toast.error(err instanceof Error ? t(err.message) : t("Sync failed"))
      }
    })
  }

  function onDisconnect() {
    startTransition(async () => {
      try {
        await disconnectMetaTrader(connection.id)
        toast.success(t("Disconnected"))
      } catch {
        toast.error(t("Could not disconnect"))
      }
    })
  }

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">{connection.login}</p>
          <p className="text-sm text-muted-foreground">{connection.server}</p>
        </div>
        <Badge variant="outline">{connection.platform.toUpperCase()}</Badge>
      </div>

      {connection.tokenExpiresAt && (
        <p className="text-xs text-muted-foreground">
          {t("Read-only access expires {date} — reconnect after that to keep syncing.", { date: new Date(connection.tokenExpiresAt).toLocaleDateString(dateLocale) })}
        </p>
      )}

      <div className="rounded-md bg-accent/40 p-3 text-sm">
        {connection.lastSyncedAt ? (
          <>
            <p>
              {t("Last synced {time}", { time: new Date(connection.lastSyncedAt).toLocaleString(dateLocale) })}
              {connection.lastSyncStatus === "ok" && connection.lastSyncCount != null && (
                <> — {connection.lastSyncCount === 1 ? t("imported 1 trade") : t("imported {n} trades", { n: connection.lastSyncCount })}</>
              )}
            </p>
            {connection.lastSyncStatus === "error" && (
              <p className="mt-1 text-[var(--loss)]">{connection.lastSyncError}</p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">{t("Not synced yet — click “Sync now” to pull your trade history.")}</p>
        )}
      </div>

      <div className="flex gap-2">
        <Button onClick={onSync} disabled={syncing} className="flex-1">
          <RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} />
          {syncing ? t("Syncing…") : t("Sync now")}
        </Button>
        <Button onClick={onDisconnect} disabled={pending} variant="outline">
          <Unplug className="size-4" /> {t("Disconnect")}
        </Button>
      </div>
    </div>
  )
}

export function MetaTraderConnect({ connections }: { connections: Connection[] }) {
  const t = useT()
  const [open, setOpen] = useState(false)

  return (
    <Card className="max-w-2xl space-y-4 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium">{t("MetaTrader (live)")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Connect as many accounts as you trade — each syncs independently.")}
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button size="sm"><Plus className="size-4" /> {t("Add account")}</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("Connect MetaTrader")}</DialogTitle>
              <DialogDescription>
                {t("Use your")} <span className="font-medium text-foreground">{t("investor password")}</span> {t("— never your trading password. Only a read-only connection scoped to this one account is stored.")}
              </DialogDescription>
            </DialogHeader>
            <ConnectForm onDone={() => setOpen(false)} />
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
            <ConnectionRow key={c.id} connection={c} />
          ))}
        </div>
      )}
    </Card>
  )
}
