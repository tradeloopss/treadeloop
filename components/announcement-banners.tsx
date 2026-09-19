"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Info, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"

const DISMISSED_KEY = "dismissedAnnouncements"

// Live announcements from the admin panel. Dismissing one hides it on this
// browser only (it's a convenience, not state anyone else needs).
export function AnnouncementBanners({ items }: { items: { id: number; message: string; level: string }[] }) {
  const t = useT()
  const [dismissed, setDismissed] = useState<number[] | null>(null)

  useEffect(() => {
    try {
      setDismissed(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]"))
    } catch {
      setDismissed([])
    }
  }, [])

  // Wait for localStorage so a dismissed banner doesn't flash on load.
  if (dismissed === null) return null
  const visible = items.filter((a) => !dismissed.includes(a.id))
  if (visible.length === 0) return null

  function dismiss(id: number) {
    const next = [...(dismissed ?? []), id]
    setDismissed(next)
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next.slice(-50)))
    } catch {
      // storage unavailable — it just reappears next visit
    }
  }

  return (
    <div className="space-y-px">
      {visible.map((a) => {
        const warning = a.level === "warning"
        const Icon = warning ? AlertTriangle : Info
        return (
          <div
            key={a.id}
            role="status"
            className={cn(
              "flex items-start gap-3 px-4 py-2.5 text-sm sm:px-6",
              warning ? "bg-[var(--chart-4)]/15" : "bg-primary/10"
            )}
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", warning ? "text-[var(--chart-4)]" : "text-primary")} aria-hidden="true" />
            <p className="flex-1">{a.message}</p>
            <button type="button" onClick={() => dismiss(a.id)} className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label={t("Dismiss announcement")}>
              <X className="size-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
