"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Plus, Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import { syncSummary } from "@/lib/copy/engine"
import { ago, copyStats, groupCopies, money, type GroupView } from "@/lib/copy/view"
import { NotEnough, Pill, Section, linkBtn, linkBtnPrimary, type PillTone } from "@/components/insights/ui"
import { ConnectAccountDialog, GroupWizard } from "./dialogs"
import { AlertList, CopyFeed } from "./history"
import { useCopy } from "./store"
import { GroupStatusPill, PageHead, Stat, isOnline } from "./ui"

const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA")

// Copies per day over the last week: a bar a day, the count in words for screen readers.
function WeekBars({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts)
  return (
    <div className="flex h-8 items-end gap-0.5" role="img" aria-label={`Copies per day over the last 7 days: ${counts.join(", ")}`}>
      {counts.map((n, i) => (
        <span key={i} className={cn("w-2 rounded-sm", n ? "bg-primary/70" : "bg-muted")} style={{ height: `${Math.max(12, (n / max) * 100)}%` }} />
      ))}
    </div>
  )
}

export function CopyDashboard() {
  const { state, account } = useCopy()
  const [dialog, setDialog] = useState<"wizard" | "connect" | null>(null)
  const today = new Date().toLocaleDateString("en-CA")
  const copies = useMemo(() => groupCopies(state.orders), [state.orders])
  const stats = copyStats(state.orders, today, dayOf)

  // every account that is part of a group, once
  const used = [...new Set(state.groups.flatMap((g) => [g.leaderAccountId, ...g.followers.map((f) => f.accountId)]))].map(account).filter((a) => !!a)
  const healthy = used.filter(isOnline).length
  const followers = state.groups.filter((g) => g.status === "active").flatMap((g) => g.followers.map((f) => ({ enabled: f.config.enabled, health: account(f.accountId)?.health ?? ("disconnected" as const), blocked: false })))
  const sync = syncSummary(followers)
  const openPnl = state.positions.filter((p) => used.some((a) => a!.id === p.accountId) && p.openPnl != null)
  const activeGroups = state.groups.filter((g) => g.status === "active").length
  const system: { label: string; tone: PillTone } = !state.liveData ? { label: "Degraded", tone: "warn" } : used.length > 0 && healthy === 0 ? { label: "Offline", tone: "bad" } : healthy < used.length || (sync.total > 0 && sync.synced < sync.total) ? { label: "Warning", tone: "warn" } : { label: "All systems operational", tone: "good" }

  const card = (g: GroupView) => {
    const orders = state.orders.filter((o) => o.groupId === g.id)
    const s = copyStats(orders, today, dayOf)
    const members = [g.leaderAccountId, ...g.followers.map((f) => f.accountId)].map(account)
    const pnl = members.reduce((sum, a) => sum + (a?.dayPnl ?? 0), 0)
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.now() - (6 - i) * 86_400_000).toLocaleDateString("en-CA")
      return new Set(orders.filter((o) => dayOf(o.createdAt) === d).map((o) => o.masterOrderId)).size
    })
    const limited = g.status === "active" && g.followers.some((f) => !f.config.enabled || !isOnline(account(f.accountId)))
    return (
      <li key={g.id} className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{g.name}</p>
            <p className="text-xs text-muted-foreground">
              Leader: {account(g.leaderAccountId)?.name ?? "—"} · {g.followers.length} {g.followers.length === 1 ? "follower" : "followers"}
            </p>
          </div>
          {limited ? <Pill tone="warn">Limited</Pill> : <GroupStatusPill status={g.status} />}
        </div>
        <div className="flex items-end justify-between gap-3">
          <dl className="grid flex-1 grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-[11px] text-muted-foreground">Day P&amp;L</dt>
              <dd className={cn("font-semibold tabular-nums", pnl > 0 && "text-[var(--gain)]", pnl < 0 && "text-[var(--loss)]")}>{money(pnl, true)}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted-foreground">Copies</dt>
              <dd className="font-semibold tabular-nums">{s.total}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted-foreground">Success</dt>
              <dd className="font-semibold tabular-nums">{s.successRate == null ? "—" : `${(s.successRate * 100).toFixed(1)}%`}</dd>
            </div>
          </dl>
          <WeekBars counts={week} />
        </div>
        <div className="mt-auto flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Last activity: {orders[0] ? ago(orders[0].createdAt) : "none yet"}</span>
          <Link href={`/copy-trading/cockpit?group=${g.id}`} className={linkBtnPrimary}>
            Open Cockpit
          </Link>
        </div>
      </li>
    )
  }

  return (
    <>
      <PageHead title="Copy Trading" subtitle="Monitor your copy trading activity in real time.">
        <button type="button" className={linkBtnPrimary} onClick={() => setDialog("wizard")}>
          <Plus className="size-3.5" /> Create Copy Group
        </button>
        <Link href="/copy-trading/risk-management" className={linkBtn}>
          <Settings className="size-3.5" /> Settings
        </Link>
      </PageHead>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Day P&L" value={money(used.reduce((s, a) => s + a!.dayPnl, 0), true)} tone={used.reduce((s, a) => s + a!.dayPnl, 0)} />
        <Stat label="Open P&L" value={money(openPnl.reduce((s, p) => s + p.openPnl!, 0), true)} tone={openPnl.reduce((s, p) => s + p.openPnl!, 0)} />
        <Stat label="Total balance" value={money(used.reduce((s, a) => s + (a!.balance ?? 0), 0))} />
        <Stat label="Active groups" value={activeGroups} sub={`of ${state.groups.length}`} />
        <Stat label="Connected accounts" value={`${healthy} / ${used.length}`} />
        <Stat label="Copies today" value={stats.today} sub={`${stats.todayFilled} filled`} />
        <Stat label="Success rate" value={stats.successRate == null ? "—" : `${(stats.successRate * 100).toFixed(1)}%`} sub={stats.total ? `${stats.filled} of ${stats.total}` : "No copies yet"} />
      </div>

      <Section title="Copy groups" description="Each group has one Leader and the accounts that copy it.">
        {state.accounts.length === 0 ? (
          <>
            <NotEnough title="No trading accounts connected yet.">Connect the account you trade on and the accounts that should copy it.</NotEnough>
            <div className="flex justify-center">
              <button type="button" className={linkBtnPrimary} onClick={() => setDialog("connect")}>
                Connect Account
              </button>
            </div>
          </>
        ) : state.groups.length === 0 ? (
          <>
            <NotEnough title="Create your first Copy Group.">Choose a Leader, the accounts that follow it, and how much each one copies.</NotEnough>
            <div className="flex justify-center">
              <button type="button" className={linkBtnPrimary} onClick={() => setDialog("wizard")}>
                <Plus className="size-3.5" /> Create Copy Group
              </button>
            </div>
          </>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{state.groups.map(card)}</ul>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,22rem)]">
        <Section title="Live activity" description="The Leader's orders, and what the followers did with each.">
          <CopyFeed copies={copies} limit={6} />
        </Section>
        <div className="space-y-4">
          <Section title="System status">
            <Pill tone={system.tone} className="w-fit">
              {system.label}
            </Pill>
            <dl className="divide-y text-sm">
              {[
                ["Copy engine", state.mode === "live" ? "Live" : "Simulation"],
                ["Leader data", state.liveData ? "Reading" : "Unavailable"],
                ["Background engine", !state.engine.background ? "Off" : !state.engine.lastRunAt ? "No signal yet" : Date.now() - new Date(state.engine.lastRunAt).getTime() > 120_000 ? `No signal for ${ago(state.engine.lastRunAt).replace(" ago", "")}` : "Running"],
                ["Account connections", used.length ? `${healthy}/${used.length} healthy` : "No accounts in a group"],
                ["Follower sync", sync.total ? `${Math.round((sync.synced / sync.total) * 100)}%` : "—"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 py-1.5">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">
              {state.engine.background && state.engine.lastRunAt && Date.now() - new Date(state.engine.lastRunAt).getTime() <= 120_000
                ? "The engine runs in the background every few seconds: your groups copy whether or not this page is open. A MetaTrader leader is re-read about every 15 seconds, a Rithmic leader about once a minute — that is how soon a new trade can be seen."
                : "The background engine isn't running right now, so groups copy only while a Copy Trading page is open."}
            </p>
          </Section>
          <Section title="Alerts" description="What happened, why, and what you can do.">
            <AlertList events={state.events} limit={5} problemsOnly />
          </Section>
        </div>
      </div>

      <GroupWizard open={dialog === "wizard"} onClose={() => setDialog(null)} />
      <ConnectAccountDialog open={dialog === "connect"} onClose={() => setDialog(null)} />
    </>
  )
}
