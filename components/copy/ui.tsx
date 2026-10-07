"use client"

import type React from "react"
import { useEffect, useState } from "react"
import { ChevronRight, Crown, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { ContractSpec } from "@/lib/copy/contracts"
import { HEALTH_LABELS, type Health } from "@/lib/copy/engine"
import { marketStatus, type MarketState } from "@/lib/copy/market"
import { ROLE_LABELS, ago, copyStatus, type AccountView, type GroupView, type Role } from "@/lib/copy/view"
import { Pill, fieldClass, linkBtn, type PillTone } from "@/components/insights/ui"
import { useCopy } from "./store"

// The small pieces every Copy Trading page uses. A state is always a word and
// an icon as well as a colour.

export function PageHead({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

// How many positions are open in the contract the Cockpit is showing. Live: it
// is counted from the brokers' own lists on every refresh.
export function RunningBadge({ count, symbol, className }: { count: number; symbol: string | null; className?: string }) {
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex h-9 items-center gap-2 rounded-full border bg-card px-3.5 text-sm font-semibold shadow-sm", count > 0 ? "border-primary/40" : "", className)}>
      <span className={cn("size-2 rounded-full", count > 0 ? "animate-pulse bg-[var(--gain)]" : "bg-muted-foreground/40")} aria-hidden />
      <span className="tabular-nums">
        {count} {count === 1 ? "Position" : "Positions"} Running
      </span>
      {symbol && (
        <>
          <span className="text-muted-foreground" aria-hidden>
            ·
          </span>
          <span className="font-medium text-muted-foreground">{symbol}</span>
        </>
      )}
    </span>
  )
}

const MARKET_DOT: Record<MarketState, string> = { open: "bg-[var(--gain)]", closed: "bg-[var(--loss)]", pre: "bg-[var(--warning)]", post: "bg-[var(--warning)]", unknown: "bg-muted-foreground/50" }
// The selected contract's market, by its regular hours, with the exchange's own clock ticking.
export function MarketStatus({ spec, className }: { spec: Pick<ContractSpec, "type"> | null; className?: string }) {
  // the clock is the browser's: drawn after the page is in it, so the server's second never shows
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  const m = marketStatus(spec, now ?? new Date(0))
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-muted-foreground", className)} title={`${m.note ? `${m.note}. ` : ""}From the market's regular hours: exchange holidays aren't included.`}>
      <span className={cn("size-2 rounded-full", MARKET_DOT[m.state])} aria-hidden />
      <span className="text-foreground">{m.label}</span>
      {now && (
        <>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            {m.clock} {m.zone}
          </span>
        </>
      )}
    </span>
  )
}

// A platform's mark: its initials on its colour. Not the vendor's logo.
const PLATFORM_TILE: { test: RegExp; text: string; cls: string }[] = [
  { test: /metatrader 5/i, text: "MT5", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  { test: /metatrader 4/i, text: "MT4", cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  { test: /rithmic/i, text: "R", cls: "bg-lime-500/15 text-lime-700 dark:text-lime-400" },
  { test: /tradovate|ninja/i, text: "TV", cls: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  { test: /tradingview/i, text: "TV", cls: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400" },
]
export function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const tile = PLATFORM_TILE.find((p) => p.test.test(platform)) ?? { text: platform.slice(0, 1).toUpperCase() || "?", cls: "bg-muted text-muted-foreground" }
  return (
    <span aria-hidden className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold tracking-tight", tile.cls, className)}>
      {tile.text}
    </span>
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
// (a group its accounts' providers object to is said to be blocked, whatever else it is: lib/compliance)
export function GroupStatusPill({ status, blocked }: { status: GroupView["status"]; blocked?: boolean }) {
  if (blocked) return <Pill tone="bad">Compliance blocked</Pill>
  return <Pill tone={GROUP_STATUS[status].tone}>{GROUP_STATUS[status].label}</Pill>
}

// Why a group can't copy as it is set up: what its accounts' providers have
// against it (lib/compliance), account by account. Nothing when there is nothing.
export function ComplianceNotice({ group, className }: { group: GroupView; className?: string }) {
  const { account } = useCopy()
  if (!group.compliance.length) return null
  return (
    <div role="alert" className={cn("rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-sm", className)}>
      <p className="font-semibold">Copying unavailable: the provider&apos;s rules don&apos;t allow this group as it is set up.</p>
      <ul className="mt-1 space-y-0.5">
        {group.compliance.map((p) => (
          <li key={`${p.accountId}${p.reasonCode}`}>
            <span className="font-medium">{account(p.accountId)?.name ?? "Account"}:</span> {p.message}
          </li>
        ))}
      </ul>
    </div>
  )
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

// One account as a card you can tap: what it is, and whether it is copying.
export function AccountCard({ account, onOpen }: { account: AccountView; onOpen: () => void }) {
  const { state } = useCopy()
  const status = copyStatus(account, state.groups)
  return (
    <button type="button" onClick={onOpen} className="flex min-h-16 w-full items-center gap-3 rounded-2xl bg-card p-3 text-start ring-1 ring-foreground/10 transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <PlatformIcon platform={account.platform} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-sm font-semibold">{account.name}</span>
          {(account.role === "leader" || account.role === "both") && <Crown className="size-3.5 shrink-0 text-amber-500" aria-label="Leader" />}
        </span>
        <span className="block truncate text-xs text-muted-foreground tabular-nums">
          {account.login ? `#${account.login} · ` : ""}
          {account.platform}
        </span>
      </span>
      <Pill tone={status.tone} className="shrink-0">
        {status.label}
      </Pill>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
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
export function ConfirmDialog({ open, onClose, title, children, action, danger, word, pending, disabled, onConfirm }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; action: string; danger?: boolean; word?: string; pending?: boolean; disabled?: boolean; onConfirm: (typed: string) => void }) {
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
          <button type="button" disabled={pending || disabled || (!!word && typed !== word)} onClick={() => onConfirm(typed)} className={cn("inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-semibold text-white transition-colors disabled:pointer-events-none disabled:opacity-50", danger ? "bg-[var(--loss)] hover:bg-[var(--loss)]/90" : "bg-primary hover:bg-primary/90")}>
            {pending ? "Working…" : action}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:opacity-50", checked ? "bg-primary" : "bg-muted-foreground/30")}>
      <span className={cn("inline-block size-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  )
}

// The one action that closes positions: solid red, nothing else on the page looks like it.
export const dangerBtn = "inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[var(--loss)] px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--loss)]/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
