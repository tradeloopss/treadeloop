"use client"

import { cn } from "@/lib/utils"
import { Panel, PanelHead } from "@/components/replay/shared"
import { fmtSigned } from "@/lib/replay/calc"
import type { ReplayActivityItem, ReplayTrade } from "@/lib/replay/types"

function ago(unix: number, now: number): string {
  const s = Math.max(0, now - unix)
  if (s < 60) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  return `${Math.round(m / 60)}h ago`
}

const DOT: Record<ReplayActivityItem["tone"], string> = {
  gain: "bg-[var(--gain)]",
  loss: "bg-[var(--loss)]",
  warning: "bg-amber-500",
  neutral: "bg-primary",
}

export function RecentActivity({ items, now }: { items: ReplayActivityItem[]; now: number }) {
  return (
    <Panel>
      <PanelHead title="Recent Activity" />
      <div className="p-4">
        {items.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Your replay actions will show here.</p>
        ) : (
          <ul className="space-y-3">
            {items.slice(0, 6).map((a) => (
              <li key={a.id} className="flex items-start gap-2.5">
                <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", DOT[a.tone])} />
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-foreground">{a.text}</p>
                  <p className="text-[11px] text-muted-foreground">{ago(a.at, now)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}

export function SessionTimeline({ startUnix, endUnix, trades }: { startUnix: number; endUnix: number; trades: ReplayTrade[] }) {
  const closed = trades.filter((t) => t.status === "closed" && t.exitTime != null)
  const hhmm = (u: number) => new Date(u * 1000).toISOString().slice(11, 16)
  const nodes = [
    { key: "start", label: "Session Start", time: startUnix, pnl: null as number | null },
    ...closed.map((t, i) => ({ key: t.id, label: `Trade ${i + 1}`, time: t.exitTime!, pnl: t.pnl ?? 0 })),
    { key: "end", label: "Session End", time: endUnix, pnl: null },
  ]
  return (
    <Panel>
      <PanelHead title="Replay Session Timeline" />
      <div className="overflow-x-auto p-4">
        <div className="relative flex min-w-[520px] items-start justify-between gap-2">
          <span className="absolute inset-x-3 top-[7px] h-px bg-border" aria-hidden />
          {nodes.map((n) => (
            <div key={n.key} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
              <span
                className={cn(
                  "z-10 size-3.5 rounded-full border-2 border-background",
                  n.pnl == null ? "bg-primary" : n.pnl >= 0 ? "bg-[var(--gain)]" : "bg-[var(--loss)]",
                )}
              />
              <span className="mt-1.5 text-[11px] font-medium text-foreground">{n.label}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{hhmm(n.time)}</span>
              {n.pnl != null && (
                <span className={cn("text-[11px] font-semibold tabular-nums", n.pnl >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")}>{fmtSigned(n.pnl)}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  )
}
