"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Bell, BookOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { readEdgeAlerts, setEdgeNotify, unwatchEdge } from "@/app/actions/edge-lab"
import { conditionEntries, dimLabel, fmtExpectancy, fmtPf, fmtPct, type Conditions, type Stats } from "@/lib/edge/core"
import { STATUS_LABELS, type MonitorStatus, type MonitorView } from "@/lib/edge/monitor"
import { useAction } from "@/components/insights/client"
import { Pill, SampleTag, linkBtn, toneClass, type PillTone } from "@/components/insights/ui"
import { OpenEdge } from "./edge-sheet"

const TONE: Record<MonitorStatus, PillTone> = { healthy: "good", stable: "ok", weakening: "warn", degraded: "bad", insufficient: "none" }
const perTrade = (s: Stats) => (s.expR != null ? s.expR : s.expectancy)

export type MonitorCardRow = { id: number; name: string; conditions: Conditions; playbookId: number | null; notifyInApp: boolean; notifyEmail: boolean; since: string; view: MonitorView }

function Side({ label, stats }: { label: string; stats: Stats }) {
  return (
    <div className="rounded-lg bg-muted/50 p-2.5">
      <p className="flex items-center justify-between gap-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label} <SampleTag n={stats.n} />
      </p>
      <p className={cn("mt-1 text-base font-semibold tabular-nums", stats.n ? toneClass(perTrade(stats)) : "")}>{stats.n ? fmtExpectancy(stats) : "—"}</p>
      <p className="text-xs text-muted-foreground tabular-nums">{stats.n ? `PF ${fmtPf(stats)} · ${fmtPct(stats.winRate, 0)} wins` : "No trades yet"}</p>
    </div>
  )
}

// An edge being watched: how it did historically against its latest trades.
export function MonitorCard({ row }: { row: MonitorCardRow }) {
  const router = useRouter()
  const { pending, run } = useAction()
  const toggle = (key: "inApp" | "email", label: string, checked: boolean) => (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <input type="checkbox" className="size-3.5 accent-[var(--primary)]" checked={checked} disabled={pending} onChange={(e) => run(() => setEdgeNotify(row.id, { [key]: e.target.checked }), () => router.refresh())} />
      {label}
    </label>
  )
  return (
    <li className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{row.name}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {conditionEntries(row.conditions)
              .map(([k, v]) => `${dimLabel(k)}: ${v}`)
              .join(" · ")}
          </p>
        </div>
        <Pill tone={TONE[row.view.status]}>{STATUS_LABELS[row.view.status]}</Pill>
      </div>
      <p className="text-sm text-muted-foreground">{row.view.explanation}</p>
      <div className="grid grid-cols-2 gap-2">
        <Side label="Before" stats={row.view.historical} />
        <Side label="Latest" stats={row.view.recent} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-1 text-xs font-medium">
          <Bell className="size-3.5" aria-hidden /> Tell me when it changes:
        </span>
        {toggle("inApp", "In the app", row.notifyInApp)}
        {toggle("email", "By email", row.notifyEmail)}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <OpenEdge conditions={row.conditions} className={linkBtn}>
          Open
        </OpenEdge>
        {row.playbookId && (
          <Link href="/playbooks" className={linkBtn}>
            <BookOpen className="size-3.5" />
            Playbook
          </Link>
        )}
        <button type="button" disabled={pending} className={cn(linkBtn, "ms-auto text-muted-foreground")} onClick={() => window.confirm(`Stop watching “${row.name}”?`) && run(() => unwatchEdge(row.id), () => router.refresh())}>
          Stop watching
        </button>
      </div>
    </li>
  )
}

export type AlertRow = { id: number; title: string; body: string; kind: string; at: string; unread: boolean }

export function AlertList({ alerts }: { alerts: AlertRow[] }) {
  const router = useRouter()
  const { pending, run } = useAction()
  const unread = alerts.filter((a) => a.unread).length
  if (!alerts.length) return <p className="text-sm text-muted-foreground">No alerts. You are told here when a watched edge weakens, degrades or recovers.</p>
  return (
    <div className="space-y-2">
      {unread > 0 && (
        <button type="button" disabled={pending} className={linkBtn} onClick={() => run(readEdgeAlerts, () => router.refresh())}>
          Mark {unread} as read
        </button>
      )}
      <ul className="divide-y">
        {alerts.map((a) => (
          <li key={a.id} className="flex gap-2.5 py-2.5">
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", a.unread ? "bg-primary" : "bg-transparent")} aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {a.title}
                {a.unread && <span className="sr-only"> (unread)</span>}
              </p>
              <p className="text-sm text-muted-foreground">{a.body}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{new Date(a.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
