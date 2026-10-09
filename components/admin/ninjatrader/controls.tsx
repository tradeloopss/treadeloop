"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { forceReconcileNinjatraderDevice, pauseNinjatraderConnection, retryNinjatraderConnection, revokeNinjatraderDevice, setNinjatraderKillSwitch } from "@/app/actions/admin-ninjatrader"

// The NinjaTrader integration kill switch. On = the integration runs (subject
// to config); Off = no new connections or syncs. Never touches other providers.
export function NinjatraderKillSwitch({ disabled }: { disabled: boolean }) {
  const [pending, startTransition] = useTransition()
  const set = (nextDisabled: boolean) => {
    if (nextDisabled === disabled) return
    if (nextDisabled && !window.confirm("Turn the NinjaTrader integration OFF?\n\nNo new NinjaTrader connections or syncs will run. Existing accounts and trades are kept, and MT4/MT5 copy trading is unaffected.")) return
    startTransition(async () => {
      const res = await setNinjatraderKillSwitch(nextDisabled)
      if (res.ok) toast.success(nextDisabled ? "NinjaTrader integration turned off." : "NinjaTrader integration turned on.")
      else toast.error(res.error)
    })
  }
  const options: [boolean, string, string][] = [
    [false, "On", "New connections and syncs run when the integration is configured."],
    [true, "Off", "No new NinjaTrader connections or syncs. Other providers are unaffected."],
  ]
  return (
    <div role="radiogroup" aria-label="NinjaTrader integration" className="grid gap-2 sm:grid-cols-2">
      {options.map(([value, label, text]) => {
        const on = value === disabled
        return (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={pending}
            onClick={() => set(value)}
            className={cn("rounded-lg border p-3 text-start transition-colors disabled:opacity-60", on ? (value ? "border-[var(--loss)] bg-[var(--loss)]/5 ring-1 ring-[var(--loss)]" : "border-primary bg-primary/5 ring-1 ring-primary") : "hover:bg-muted/60")}
          >
            <span className="block text-sm font-medium">{label}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{text}</span>
          </button>
        )
      })}
    </div>
  )
}

// Per-connection Retry / Pause. Both are read-only and idempotent: Retry makes
// the connection due for a fresh read; Pause stops it syncing without
// disconnecting. Neither sends an order.
export function NinjatraderConnectionControls({ connectionId }: { connectionId: number }) {
  const [pending, startTransition] = useTransition()
  const run = (fn: (id: number) => Promise<{ ok: boolean; error?: string }>, done: string) =>
    startTransition(async () => {
      const res = await fn(connectionId)
      if (res.ok) toast.success(done)
      else toast.error(res.error ?? "That didn't work.")
    })
  const btn = "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-60"
  return (
    <div className="flex justify-end gap-1.5">
      <button type="button" disabled={pending} className={btn} onClick={() => run(retryNinjatraderConnection, "Sync retried.")}>
        Retry
      </button>
      <button type="button" disabled={pending} className={btn} onClick={() => run(pauseNinjatraderConnection, "Sync paused.")}>
        Pause
      </button>
    </div>
  )
}

// Per-device admin actions: Reconcile rebuilds the owner's journal (idempotent),
// Revoke stops that add-on at once (its next post is refused). Neither places an
// order or affects other providers.
export function NinjatraderDeviceControls({ deviceId, revoked }: { deviceId: number; revoked: boolean }) {
  const [pending, startTransition] = useTransition()
  const run = (fn: (id: number) => Promise<{ ok: boolean; error?: string }>, done: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return
    startTransition(async () => {
      const res = await fn(deviceId)
      if (res.ok) toast.success(done)
      else toast.error(res.error ?? "That didn't work.")
    })
  }
  const btn = "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-60"
  return (
    <div className="flex justify-end gap-1.5">
      <button type="button" disabled={pending} className={btn} onClick={() => run(forceReconcileNinjatraderDevice, "Reconcile started.")}>
        Reconcile
      </button>
      {!revoked && (
        <button
          type="button"
          disabled={pending}
          className={cn(btn, "text-[var(--loss)]")}
          onClick={() => run(revokeNinjatraderDevice, "Device revoked.", "Revoke this add-on?\n\nIts next sync is refused and the trader must download or pair a new one. Trades already imported are kept.")}
        >
          Revoke
        </button>
      )}
    </div>
  )
}
