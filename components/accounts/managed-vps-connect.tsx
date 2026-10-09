"use client"

import { useEffect, useRef, useState } from "react"
import { CheckCircle2, FileUp, Loader2, RefreshCw, Server, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

// The managed-VPS onboarding (gated by the managed_vps feature). The client
// installs nothing locally: TradeLoop prepares a Windows VPS running NinjaTrader
// + the add-on, the client authenticates their account once on that prepared
// environment, and sync runs on its own. Read-only. No broker password is ever
// entered into TradeLoop. Under a mock provider this previews the flow and says
// so — it never claims a real VPS exists.

type Layer = "online" | "offline" | "unknown"
interface Health {
  vps: Layer
  agent: Layer
  ninjaTrader: Layer
  broker: Layer
  tradeloop: Layer
}
interface Instance {
  id: number
  status: string
  simulated: boolean
  region: string | null
  provisioningProgress: { done: number; total: number }
  health: Health
  lastHeartbeatAt: string | null
  lastError: string | null
}

const POLL_MS = 3000
const STEP_LABELS = ["Creating secure Windows environment", "Installing NinjaTrader", "Installing TradeLoop Sync", "Configuring connection", "Checking health"]

export function ManagedVpsConnect({ onDone, onFile }: { onDone: () => void; onFile: () => void }) {
  const [instance, setInstance] = useState<Instance | null>(null)
  const [starting, setStarting] = useState(false)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)

  const load = async () => {
    const r = await fetch("/api/vps/status").then((x) => x.json()).catch(() => null)
    if (alive.current && r?.ok) setInstance(r.instance)
  }

  useEffect(() => {
    alive.current = true
    void load()
    const t = setInterval(load, POLL_MS)
    return () => {
      alive.current = false
      clearInterval(t)
    }
  }, [])

  const start = async () => {
    setStarting(true)
    const r = await fetch("/api/vps/provision", { method: "POST" }).then((x) => x.json()).catch(() => null)
    setStarting(false)
    if (r?.ok) void load()
    else toast.error(r?.error || "Couldn't start your managed environment.")
  }

  const act = async (path: string, done: string) => {
    setBusy(true)
    const r = await fetch(path, { method: "POST" }).then((x) => x.json()).catch(() => null)
    setBusy(false)
    if (r?.ok) {
      toast.success(done)
      void load()
    } else toast.error(r?.error || "That didn't work.")
  }

  // Not started yet.
  if (!instance) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border p-4">
          <Server className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-foreground">TradeLoop will prepare your managed trading environment</p>
            <p className="mt-0.5 text-muted-foreground">A Windows VPS running NinjaTrader 8 and TradeLoop Sync — you install nothing on your own computer. You authenticate your account once on the prepared environment; TradeLoop never stores your broker password.</p>
          </div>
        </div>
        <Button className="h-11 w-full font-semibold" disabled={starting} onClick={start}>
          {starting ? <Loader2 className="size-4 animate-spin" /> : null}
          {starting ? "Starting…" : "Connect"}
        </Button>
        <button type="button" onClick={onFile} className="flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline">
          <FileUp className="size-3.5" /> Import a Tradovate CSV instead
        </button>
      </div>
    )
  }

  const provisioning = ["provisioning", "installing", "configuring"].includes(instance.status)
  const connected = instance.status === "connected"
  const awaitingAuth = instance.status === "awaiting_auth" || instance.status === "ready"

  return (
    <div className="space-y-4">
      {instance.simulated && (
        <p className="rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Simulated environment — no VPS provider is configured on this deployment, so this previews the flow. No real server is created, and nothing is reported as connected unless it truly is.
        </p>
      )}

      {provisioning && (
        <div className="space-y-2.5">
          <p className="text-sm font-semibold text-foreground">Preparing your environment…</p>
          <ul className="space-y-1.5 text-[13px]">
            {STEP_LABELS.map((label, i) => {
              const done = instance.provisioningProgress.done > i + 3 // steps 0-2 are server/windows; labels map loosely
              const current = !done
              return (
                <li key={label} className="flex items-center gap-2">
                  {done ? <CheckCircle2 className="size-4 text-[var(--gain)]" /> : current ? <Loader2 className="size-4 animate-spin text-primary" /> : <span className="size-4" />}
                  <span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {awaitingAuth && (
        <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-foreground">Authenticate your account</p>
            <p className="mt-0.5 text-muted-foreground">Your environment is ready. Sign into your Tradovate account once inside NinjaTrader on the prepared VPS. TradeLoop never asks for or stores your password — you enter it only in NinjaTrader on the managed machine.</p>
          </div>
        </div>
      )}

      {connected && (
        <div className="flex items-start gap-3 rounded-xl border border-[var(--gain)]/30 bg-[var(--gain)]/5 p-4">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[var(--gain)]" aria-hidden />
          <p className="text-sm font-semibold text-foreground">Connected — your trades sync automatically.</p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-2 rounded-xl border p-3 text-sm">
        <StatusRow label="VPS" layer={instance.health.vps} />
        <StatusRow label="Agent" layer={instance.health.agent} />
        <StatusRow label="NinjaTrader" layer={instance.health.ninjaTrader} />
        <StatusRow label="Broker" layer={instance.health.broker} />
        <StatusRow label="TradeLoop Sync" layer={instance.health.tradeloop} />
      </dl>

      {instance.lastError && <p className="text-xs text-[var(--loss)]">{instance.lastError}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="h-9" disabled={busy} onClick={() => act("/api/vps/reconcile", "Reconcile started.")}>
          <RefreshCw className="size-3.5" /> Reconcile
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-9" disabled={busy} onClick={() => act("/api/vps/reconnect", "Reconnect requested.")}>
          Reconnect
        </Button>
      </div>

      <Button className="h-11 w-full font-semibold" onClick={onDone}>
        Done
      </Button>
    </div>
  )
}

function StatusRow({ label, layer }: { label: string; layer: Layer }) {
  const tone = layer === "online" ? "text-[var(--gain)]" : layer === "offline" ? "text-[var(--loss)]" : "text-muted-foreground"
  const text = layer === "online" ? "Connected" : layer === "offline" ? "Offline" : "Unknown"
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("font-medium", tone)}>{text}</dd>
    </div>
  )
}
