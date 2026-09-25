"use client"

import { useEffect, useState } from "react"
import { useT } from "@/components/locale-provider"

// "12s ago" / "5 min ago" that stays true: re-renders on a light tick instead
// of refetching. Returns null for a missing date.
export function useRelativeTime(tickMs = 10_000) {
  const t = useT()
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), tickMs)
    return () => clearInterval(id)
  }, [tickMs])
  return (date: Date | string | null | undefined): string | null => {
    if (!date) return null
    // Before mount there's no stable "now" to compare against (server and
    // browser clocks differ), so render nothing rather than mismatch.
    if (now == null) return ""
    const s = Math.max(0, Math.round((now - new Date(date).getTime()) / 1000))
    if (s < 60) return t("{n}s ago", { n: s })
    const m = Math.round(s / 60)
    if (m < 60) return m === 1 ? t("1 minute ago") : t("{n} minutes ago", { n: m })
    const h = Math.round(m / 60)
    if (h < 48) return h === 1 ? t("1 hour ago") : t("{n} hours ago", { n: h })
    return t("{n} days ago", { n: Math.round(h / 24) })
  }
}
