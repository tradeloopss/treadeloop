"use client"

import type React from "react"
import { useState } from "react"
import { Crown, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { HEALTH_LABELS, type Health } from "@/lib/copy/engine"
import { ROLE_LABELS, ago, type AccountView, type GroupView, type Role } from "@/lib/copy/view"
import { Pill, fieldClass, linkBtn, type PillTone } from "@/components/insights/ui"
import { useCopy } from "./store"

// The small pieces every Copy Trading page uses. A state is always a word and
// an icon as well as a colour.

export function PageHead({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{title}</h2>
        <p className="mt-0.5 text-sm">{subtitle}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: number | null }) {
  return (
    <div className="rounded-xl bg-card p-3.5 ring-1 ring-foreground/10">
      <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tracking-tight tabular-nums", tone != null && tone > 0 && "text-[var(--gain)]", tone != null && tone < 0 && "text-[var(--loss)]")}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

const HEALTH_TONE: Record<Health, PillTone> = { connected: "good", syncing: "ok", warning: "warn", disconnected: "bad", auth: "bad" }
export function HealthPill({ health }: { health: Health }) {
  return <Pill tone={HEALTH_TONE[health]}>{HEALTH_LABELS[health]}</Pill>
}
export const isOnline = (a: AccountView | undefined) => !!a && (a.health === "connected" || a.health === "syncing" || a.health === "warning")

export function RolePill({ role }: { role: Role }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase", role === "leader" ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400" : role === "follower" ? "border-primary/40 bg-primary/10 text-primary" : role === "both" ? "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400" : "text-muted-foreground")}>
      {role === "leader" && <Crown className="size-3" aria-hidden />}
      {ROLE_LABELS[role]}
    </span>
  )
}

const GROUP_STATUS: Record<GroupView["status"], { label: string; tone: PillTone }> = { active: { label: "Copying", tone: "good" }, paused: { label: "Paused", tone: "warn" }, draft: { label: "Draft", tone: "none" } }
export function GroupStatusPill({ status }: { status: GroupView["status"] }) {
  return <Pill tone={GROUP_STATUS[status].tone}>{GROUP_STATUS[status].label}</Pill>
}

// A connection's heartbeat: when it last answered. Latency is shown only when
// a connection reports it — it is never estimated.
export function Heartbeat({ account }: { account: AccountView }) {
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {account.latencyMs != null && <>{account.latencyMs}ms · </>}
      {account.linked ? `Last sync ${ago(account.lastSyncAt)}` : "Not linked to a broker"}
    </span>
  )
}

export function GroupSelect({ className }: { className?: string }) {
  const { state, group, selectGroup } = useCopy()
  if (!group) return null
  return (
    <label className={cn("flex items-center gap-2", className)}>
      <span className="sr-only">Copy group</span>
      <select className={cn(fieldClass, "h-9 w-auto max-w-[16rem] font-medium")} value={group.id} onChange={(e) => selectGroup(Number(e.target.value))}>
        {state.groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
            {g.status !== "active" ? ` (${GROUP_STATUS[g.status].label.toLowerCase()})` : ""}
          </option>
        ))}
      </select>
    </label>
  )
}

// A confirmation for anything that can't be taken back. With `word`, the
// button stays off until the trader has typed it.
export function ConfirmDialog({ open, onClose, title, children, action, danger, word, pending, onConfirm }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; action: string; danger?: boolean; word?: string; pending?: boolean; onConfirm: (typed: string) => void }) {
  const [typed, setTyped] = useState("")
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return
        setTyped("")
        onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {danger && <TriangleAlert className="size-4 text-[var(--loss)]" aria-hidden />}
            {title}
          </DialogTitle>
          <DialogDescription render={<div />} className="space-y-2 text-sm text-muted-foreground">
            {children}
          </DialogDescription>
        </DialogHeader>
        {word && (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Type {word} to confirm
            <input className={fieldClass} value={typed} autoComplete="off" autoCapitalize="characters" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
          </label>
        )}
        <DialogFooter>
          <button type="button" className={linkBtn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={pending || (!!word && typed !== word)} onClick={() => onConfirm(typed)} className={cn("inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-semibold text-white transition-colors disabled:pointer-events-none disabled:opacity-50", danger ? "bg-[var(--loss)] hover:bg-[var(--loss)]/90" : "bg-primary hover:bg-primary/90")}>
            {pending ? "Working…" : action}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:opacity-50", checked ? "bg-[var(--gain)]" : "bg-muted-foreground/30")}>
      <span className={cn("inline-block size-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  )
}

export const dangerBtn = "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--loss)]/50 bg-[var(--loss)]/10 px-3 text-sm font-semibold text-[var(--loss)] transition-colors hover:bg-[var(--loss)]/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
