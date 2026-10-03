"use client"

import { useState } from "react"
import Link from "next/link"
import { LifeBuoy, PlugZap, ShieldAlert, UserPlus, Wallet, type LucideIcon } from "lucide-react"
import type { ActivityCategory, ActivityItem } from "@/lib/admin/command-center"
import { ACTIVITY_LABELS, Card, CardLink, StatusPill } from "@/components/admin/command/cards"
import { TONE_ICON, timeLabel, type Tone } from "@/components/admin/command/tones"
import { cn } from "@/lib/utils"

const ICONS: Record<ActivityCategory, { icon: LucideIcon; tone: Tone }> = {
  users: { icon: UserPlus, tone: "primary" },
  payments: { icon: Wallet, tone: "success" },
  support: { icon: LifeBuoy, tone: "info" },
  trading: { icon: PlugZap, tone: "warning" },
  security: { icon: ShieldAlert, tone: "danger" },
}

// The latest events across the platform, newest first. The filter offers only
// the kinds this admin's role can see (and that have something to show).
export function RecentActivity({ items, categories, className, limit = 7, viewAll = "/admin/activity" }: { items: ActivityItem[]; categories: ActivityCategory[]; className?: string; limit?: number; viewAll?: string | null }) {
  const [filter, setFilter] = useState<ActivityCategory | "all">("all")
  const shown = (filter === "all" ? items : items.filter((i) => i.category === filter)).slice(0, limit)
  const tabs = categories.filter((c) => items.some((i) => i.category === c))

  return (
    <Card title="Recent activity" action={viewAll ? <CardLink href={viewAll}>View all</CardLink> : undefined} className={className}>
      {tabs.length > 1 && (
        <div className="-mx-1 mb-2 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="group" aria-label="Show">
          {(["all", ...tabs] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setFilter(c)}
              aria-pressed={filter === c}
              className={cn(
                "h-7 shrink-0 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                filter === c ? "border-primary/30 bg-primary/10 text-primary dark:bg-primary/15" : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {c === "all" ? "All" : ACTIVITY_LABELS[c]}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="flex flex-1 items-center justify-center rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ol className="-mx-2 flex flex-col">
          {shown.map((item) => {
            const { icon: Icon, tone } = ICONS[item.category]
            return (
              <li key={item.key}>
                <Link href={item.href} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", TONE_ICON[tone])} aria-hidden>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 block text-[13px] leading-snug font-medium">{item.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <time dateTime={item.at} className="text-[11px] text-muted-foreground tabular-nums" suppressHydrationWarning>
                      {timeLabel(item.at)}
                    </time>
                    {item.status && <StatusPill status={item.status} />}
                  </span>
                </Link>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}
