"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useT } from "@/components/locale-provider"

// Shared save action for the settings form pages: runs the async save, toasts,
// and refreshes the route so server-derived UI (e.g. header pills) updates.
export function SaveButton<T>({
  getValue,
  save,
  dirty = true,
  label,
}: {
  getValue: () => T
  save: (value: T) => Promise<void>
  dirty?: boolean
  label?: string
}) {
  const t = useT()
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onSave() {
    setBusy(true)
    try {
      await save(getValue())
      toast.success(t("Saved"))
      router.refresh()
    } catch {
      toast.error(t("Could not save changes"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex justify-end">
      <Button size="sm" onClick={onSave} disabled={busy || !dirty}>
        {busy ? t("Saving…") : label ?? t("Save changes")}
      </Button>
    </div>
  )
}
