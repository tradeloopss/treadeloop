"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { forceRithmicSync, revokeGrant, setAnnouncementActive } from "@/app/actions/admin"

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
