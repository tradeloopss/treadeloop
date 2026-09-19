"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { dismissImport, forceRithmicSync, resyncAllRithmic, retryImport, revokeGrant, setAnnouncementActive, type ActionResult } from "@/app/actions/admin"

export function ForceSyncButton({ connectionId }: { connectionId: number }) {
  const [pending, startTransition] = useTransition()
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await forceRithmicSync(connectionId)
          if (result.ok) toast.success(result.message ?? "Synced.")
          else toast.error(result.error)
        })
      }
    >
      <RefreshCw className={pending ? "size-3.5 animate-spin" : "size-3.5"} /> {pending ? "Syncing…" : "Sync now"}
    </Button>
  )
}

export function RevokeGrantButton({ subscriptionId }: { subscriptionId: number }) {
  const [pending, startTransition] = useTransition()
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        if (!confirm("End this granted plan now?")) return
        startTransition(async () => {
          const result = await revokeGrant(subscriptionId)
          if (result.ok) toast.success("Grant revoked.")
          else toast.error(result.error)
        })
      }}
    >
      Revoke
    </Button>
  )
}

export function AnnouncementToggle({ id, active }: { id: number; active: boolean }) {
  const [pending, startTransition] = useTransition()
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setAnnouncementActive(id, !active)
          if (!result.ok) toast.error(result.error)
        })
      }
    >
      {active ? "Turn off" : "Turn on"}
    </Button>
  )
}

// A button that runs one admin action and reports the result as a toast.
function ActionButton({ label, busyLabel, action, confirmText, variant = "outline" }: { label: string; busyLabel?: string; action: () => Promise<ActionResult>; confirmText?: string; variant?: "outline" | "default" | "ghost" }) {
  const [pending, startTransition] = useTransition()
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={pending}
      onClick={() => {
        if (confirmText && !confirm(confirmText)) return
        startTransition(async () => {
          const result = await action()
          if (result.ok) toast.success(result.message ?? "Done.")
          else toast.error(result.error)
        })
      }}
    >
      {pending ? (busyLabel ?? label) : label}
    </Button>
  )
}

export function RetryImportButton({ importId }: { importId: number }) {
  return <ActionButton label="Retry" busyLabel="Retrying…" action={() => retryImport(importId)} confirmText="Re-run this import with the current parser, into the user's account?" />
}

export function DismissImportButton({ importId }: { importId: number }) {
  return <ActionButton label="Dismiss" variant="ghost" action={() => dismissImport(importId)} />
}

export function ResyncAllButton() {
  return <ActionButton label="Re-sync all Rithmic" busyLabel="Starting…" variant="default" action={() => resyncAllRithmic()} confirmText="Sync every Rithmic connection now?" />
}
