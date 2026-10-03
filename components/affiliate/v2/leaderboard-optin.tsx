"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { setLeaderboardVisibility } from "@/app/actions/affiliate-v2"
import { cn } from "@/lib/utils"

// Off by default. On: the leaderboard shows this affiliate's first name and
// last initial, customers and earnings — nothing else, and nothing about any customer.
export function LeaderboardOptIn({ on: initial, name }: { on: boolean; name: string }) {
  const router = useRouter()
  const [on, setOn] = useState(initial)
  const [pending, start] = useTransition()
  const toggle = () =>
    start(async () => {
      const next = !on
      const res = await setLeaderboardVisibility(next).catch(() => ({ ok: false as const, error: "That didn't go through. Try again." }))
      if (!res.ok) return void toast.error(res.error)
      setOn(next)
      toast.success(next ? "You're on the leaderboard." : "You're no longer shown on the leaderboard.")
      router.refresh()
    })
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm font-semibold">Show me on the leaderboard</span>
        <span className="block text-xs text-muted-foreground">
          As <span className="font-medium text-foreground">{name}</span>, with your customers and earnings. Never anything about your customers.
        </span>
      </span>
      <input type="checkbox" role="switch" checked={on} onChange={toggle} disabled={pending} className="peer sr-only" />
      <span aria-hidden className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50", on ? "bg-gradient-to-r from-[var(--v2-violet)] to-[var(--v2-blue)]" : "bg-muted-foreground/30", pending && "opacity-60")}>
        <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-[22px] rtl:-translate-x-[22px]" : "translate-x-0.5 rtl:-translate-x-0.5")} />
      </span>
    </label>
  )
}
