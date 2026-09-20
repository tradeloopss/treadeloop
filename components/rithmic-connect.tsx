"use client"

import type React from "react"
import { useEffect, useState, useTransition } from "react"
import { connectRithmic, disconnectRithmic, syncRithmic, listAvailableRithmicSystems } from "@/app/actions/rithmic"
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { Plus, RefreshCw, Unplug, Wifi } from "lucide-react"
import { useIntlLocale, useT } from "@/components/locale-provider"

// Matches lib/rithmic-client.ts's PRODUCTION_RITHMIC_GATEWAY / TEST_RITHMIC_GATEWAY
// — duplicated here since that module pulls in server-only deps (ws,
// node:fs) that can't be imported into a client component. The production
// gateway hosts every real, live prop firm on Rithmic's network — querying
// it returns the actual current list (Apex, Bulenox, Tradeify, ...), not a
// hardcoded guess. "Other" falls back to a manual gateway for firms not on
// it (or this app's own test/sim account, which lives on a separate network).
const PRODUCTION_GATEWAY = "wss://rprotocol.rithmic.com:443"
const TEST_GATEWAY = "wss://rituz00100.rithmic.com:443"
const CUSTOM = "__custom__"

export function ConnectForm({ onDone, initialFirmHint }: { onDone: () => void; initialFirmHint?: string }) {
  const t = useT()
  const [systems, setSystems] = useState<string[]>([])
  const [loadingSystems, setLoadingSystems] = useState(true)
  const [systemChoice, setSystemChoice] = useState("")
  const [customGateway, setCustomGateway] = useState(TEST_GATEWAY)
  const [customSystemName, setCustomSystemName] = useState("")
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    listAvailableRithmicSystems(PRODUCTION_GATEWAY)
      .then((list) => {
        setSystems(list)
        if (initialFirmHint) {
          const hint = initialFirmHint.toLowerCase()
          const match = list.find((s) => s.toLowerCase().includes(hint) || hint.includes(s.toLowerCase()))
          if (match) setSystemChoice(match)
        }
      })
      .catch(() => toast.error(t("Could not load the list of prop firms from Rithmic")))
      .finally(() => setLoadingSystems(false))
    // Only run once on mount — initialFirmHint is a one-time seed, not a live binding.
  }, [])

  const isCustom = systemChoice === CUSTOM
  const gatewayUri = isCustom ? customGateway.trim() : PRODUCTION_GATEWAY
  const systemName = isCustom ? customSystemName.trim() : systemChoice
  const canSubmit = !!systemName && !!gatewayUri

  function onConnect(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    formData.set("gatewayUri", gatewayUri)
    formData.set("systemName", systemName)
    startTransition(async () => {
      try {
        const result = await connectRithmic(formData)
        if (result.ok) {
          const acct = result.accounts === 1 ? t("Rithmic connected — 1 account") : t("Rithmic connected — {n} accounts", { n: result.accounts })
          const trades = result.trades === 0 ? t("no past trades found in the last 2 years") : result.trades === 1 ? t("1 past trade imported") : t("{n} past trades imported", { n: result.trades })
          toast.success(`${acct}, ${trades}`)
          onDone()
        } else {
          toast.error(t(result.error))
        }
      } catch {
        // A rejected promise here means the request itself failed (e.g. it
        // ran past the function's time limit) rather than a handled error.
        toast.error(t("Connecting took too long — Rithmic may be slow or unreachable right now. Please try again in a moment."))
      }
    })
  }

  return (
    <form onSubmit={onConnect} className="space-y-3">
      <div className="space-y-1.5">
        <Label>{t("Prop firm / broker")}</Label>
        <Select value={systemChoice} onValueChange={(v) => v && setSystemChoice(v)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={loadingSystems ? t("Loading…") : t("Select your prop firm")} />
          </SelectTrigger>
          <SelectContent>
            {systems.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
            <SelectItem value={CUSTOM}>{t("Other (custom gateway)…")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t("Not listed? Pick “Other” and enter your gateway directly.")}</p>
      </div>

      {isCustom && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="rithmic-gateway">{t("Gateway address")}</Label>
            <Input
              id="rithmic-gateway"
              value={customGateway}
              onChange={(e) => setCustomGateway(e.target.value)}
              required
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">{t("From your prop firm's connection_params.txt.")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rithmic-system-custom">{t("System name")}</Label>
            <Input
              id="rithmic-system-custom"
              value={customSystemName}
              onChange={(e) => setCustomSystemName(e.target.value)}
              required
              autoComplete="off"
              placeholder={t("e.g. Rithmic Test")}
            />
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="rithmic-login">{t("Username")}</Label>
        <Input id="rithmic-login" name="login" required autoComplete="off" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rithmic-password">{t("Password")}</Label>
        <Input id="rithmic-password" name="password" type="password" required autoComplete="off" />
      </div>
      <Button type="submit" disabled={pending || !canSubmit} className="w-full">
        {pending ? t("Connecting…") : t("Connect")}
      </Button>
    </form>
  )
}

export type RithmicConnection = {
  id: number
  login: string
  systemName: string
  rithmicAccountId: string
  accountName: string
  lastSyncedAt: Date | null
  lastSyncStatus: string | null
  lastSyncError: string | null
  lastSyncCount: number | null
}

function ConnectionRow({ connection }: { connection: RithmicConnection }) {
  const t = useT()
  const dateLocale = useIntlLocale()
  const [pending, startTransition] = useTransition()
  const [syncing, startSync] = useTransition()

  function onSync() {
    startSync(async () => {
      try {
        const result = await syncRithmic(connection.id)
        toast.success(result.imported > 0 ? (result.imported === 1 ? t("Imported 1 trade") : t("Imported {n} trades", { n: result.imported })) : t("Already up to date"))
      } catch (err) {
        toast.error(err instanceof Error ? t(err.message) : t("Sync failed"))
      }
    })
  }

  function onDisconnect() {
    startTransition(async () => {
      try {
        await disconnectRithmic(connection.id)
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
          <p className="font-medium">{connection.accountName}</p>
          <p className="text-sm text-muted-foreground">{connection.rithmicAccountId} · {connection.systemName}</p>
        </div>
        <Badge variant="outline">RITHMIC</Badge>
      </div>

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

export function RithmicConnect({ connections }: { connections: RithmicConnection[] }) {
  const t = useT()
  const [open, setOpen] = useState(false)

  return (
    <Card className="max-w-2xl space-y-4 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium">{t("Rithmic (live)")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Connects directly to your Rithmic account — every account under that login syncs automatically.")}
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button size="sm"><Plus className="size-4" /> {t("Connect")}</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("Connect Rithmic")}</DialogTitle>
              <DialogDescription>
                {t("Use your Rithmic trading login. Every account found under it is added and synced.")}
              </DialogDescription>
            </DialogHeader>
            <ConnectForm onDone={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {connections.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-center">
          <Wifi className="size-6 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{t("No Rithmic accounts connected yet.")}</p>
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
