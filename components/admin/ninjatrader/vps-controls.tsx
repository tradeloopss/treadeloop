"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { destroyVpsInstance, rebootVpsInstance, reconcileVpsInstance, revokeVpsInstanceAgent } from "@/app/actions/admin-vps"

// Per-instance admin actions for a managed VPS. All read-only toward the broker:
// Reconcile rebuilds the owner's journal; Reboot/Revoke/Destroy are environment
// lifecycle. None places an order.
export function VpsInstanceControls({ instanceId }: { instanceId: number }) {
  const [pending, startTransition] = useTransition()
  const run = (fn: (id: number) => Promise<{ ok: boolean; error?: string }>, done: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return
    startTransition(async () => {
      const res = await fn(instanceId)
      if (res.ok) toast.success(done)
      else toast.error(res.error ?? "That didn't work.")
    })
  }
  const btn = "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-60"
  return (
    <div className="flex justify-end gap-1.5">
      <button type="button" disabled={pending} className={btn} onClick={() => run(reconcileVpsInstance, "Reconcile started.")}>
        Reconcile
      </button>
      <button type="button" disabled={pending} className={btn} onClick={() => run(rebootVpsInstance, "Reboot requested.")}>
        Reboot
      </button>
      <button type="button" disabled={pending} className={btn} onClick={() => run(revokeVpsInstanceAgent, "Agent revoked.", "Revoke this VPS agent?\n\nIts next report is refused until re-provisioned. Trades already imported are kept.")}>
        Revoke
      </button>
      <button
        type="button"
        disabled={pending}
        className={cn(btn, "text-[var(--loss)]")}
        onClick={() => run(destroyVpsInstance, "VPS destroyed.", "Destroy this VPS instance?\n\nThe managed server is torn down and the agent revoked. Historical trades are preserved. This cannot be undone.")}
      >
        Destroy
      </button>
    </div>
  )
}
