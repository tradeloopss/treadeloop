"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Eye, Pencil, Play, Pause, Square, Copy, Trash2, MoreHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { publishDrop, pauseDrop, resumeDrop, endDrop, duplicateDrop, deleteDrop } from "@/app/actions/admin-cases"
import type { AdminDropRow } from "@/lib/cases/queries"

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  draft: "bg-muted text-muted-foreground",
  paused: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  ended: "bg-muted text-muted-foreground line-through",
}

export function DropsTable({ drops, canManage }: { drops: AdminDropRow[]; canManage: boolean }) {
  if (drops.length === 0) {
    return <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">No drops yet. Create your first Cases Drop.</div>
  }
  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-xl border md:block">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">Drop</th>
              <th className="px-3 py-2.5 text-start font-medium">Status</th>
              <th className="px-3 py-2.5 text-end font-medium">Cases</th>
              <th className="px-3 py-2.5 text-end font-medium">Claimed</th>
              <th className="px-3 py-2.5 text-end font-medium">Left</th>
              <th className="px-3 py-2.5 text-start font-medium">Window</th>
              <th className="px-3 py-2.5 text-end font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {drops.map((d) => (
              <tr key={d.id} className="hover:bg-muted/30">
                <td className="px-4 py-3">
                  <Link href={`/admin/cases/${d.id}`} className="font-medium hover:underline">{d.name}</Link>
                </td>
                <td className="px-3 py-3"><StatusBadge status={d.status} /></td>
                <td className="px-3 py-3 text-end tabular-nums">{d.totalCases}</td>
                <td className="px-3 py-3 text-end tabular-nums">{d.claimedCases}</td>
                <td className="px-3 py-3 text-end tabular-nums">{d.remaining}</td>
                <td className="px-3 py-3 text-xs text-muted-foreground">{fmtWindow(d.startAt, d.endAt)}</td>
                <td className="px-3 py-3">
                  <RowActions drop={d} canManage={canManage} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {drops.map((d) => (
          <div key={d.id} className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <Link href={`/admin/cases/${d.id}`} className="font-semibold hover:underline">{d.name}</Link>
              <StatusBadge status={d.status} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-muted/50 p-2"><p className="font-bold">{d.totalCases}</p><p className="text-muted-foreground">Total</p></div>
              <div className="rounded-lg bg-muted/50 p-2"><p className="font-bold">{d.claimedCases}</p><p className="text-muted-foreground">Claimed</p></div>
              <div className="rounded-lg bg-muted/50 p-2"><p className="font-bold">{d.remaining}</p><p className="text-muted-foreground">Left</p></div>
            </div>
            <div className="mt-3"><RowActions drop={d} canManage={canManage} /></div>
          </div>
        ))}
      </div>
    </>
  )
}

function StatusBadge({ status }: { status: string }) {
  return <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-semibold capitalize", STATUS_STYLES[status] ?? "bg-muted text-muted-foreground")}>{status}</span>
}

export function RowActions({ drop, canManage }: { drop: AdminDropRow; canManage: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return
    start(async () => {
      const res = await fn()
      if (!res.ok && res.error) alert(res.error)
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Link href={`/admin/cases/${drop.id}`} className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" title="View">
        <Eye className="size-4" />
      </Link>
      {canManage && (
        <>
          <Link href={`/admin/cases/${drop.id}/edit`} className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" title="Edit">
            <Pencil className="size-4" />
          </Link>
          <div className="relative">
            <button type="button" onClick={() => setOpen((o) => !o)} disabled={pending} className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50" aria-label="More">
              <MoreHorizontal className="size-4" />
            </button>
            {open && (
              <>
                <button type="button" className="fixed inset-0 z-10 cursor-default" aria-hidden onClick={() => setOpen(false)} />
                <div className="absolute end-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border bg-popover p-1 shadow-lg">
                  {drop.status === "draft" && <MenuItem icon={Play} label="Publish" onClick={() => run(() => publishDrop(drop.id))} />}
                  {drop.status === "active" && <MenuItem icon={Pause} label="Pause" onClick={() => run(() => pauseDrop(drop.id))} />}
                  {drop.status === "paused" && <MenuItem icon={Play} label="Resume" onClick={() => run(() => resumeDrop(drop.id))} />}
                  {(drop.status === "active" || drop.status === "paused") && <MenuItem icon={Square} label="End drop" onClick={() => run(() => endDrop(drop.id), "End this drop? Users will no longer be able to claim.")} />}
                  <MenuItem icon={Copy} label="Duplicate" onClick={() => run(() => duplicateDrop(drop.id))} />
                  <MenuItem icon={Trash2} label="Delete" danger onClick={() => run(() => deleteDrop(drop.id), "Delete this drop and all its claims? This cannot be undone.")} />
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: typeof Play; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-start text-sm hover:bg-accent", danger && "text-destructive hover:bg-destructive/10")}>
      <Icon className="size-3.5" /> {label}
    </button>
  )
}

function fmtWindow(start: Date | null, end: Date | null) {
  const f = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  if (!start && !end) return "—"
  return `${start ? f(new Date(start)) : "—"} → ${end ? f(new Date(end)) : "—"}`
}
