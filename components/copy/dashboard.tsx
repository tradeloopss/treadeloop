"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, ArrowUpDown, ChevronRight, Layers, Plus, Settings, ShieldCheck, SlidersHorizontal, Target } from "lucide-react"
import { cn } from "@/lib/utils"
import { saveCopyRules } from "@/app/actions/copy-trading"
import { syncSummary, type CopyRules } from "@/lib/copy/engine"
import { ago, copyStats, groupCopies, money, sizingSummary, type GroupView } from "@/lib/copy/view"
import { Sheet, useAction } from "@/components/insights/client"
import { NotEnough, Pill, Section, linkBtn, linkBtnPrimary, type PillTone } from "@/components/insights/ui"
import { AccountDrawer, ConnectAccountDialog, ContractDialog, GroupWizard, RulesEditor } from "./dialogs"
import { AlertList, CopyFeed } from "./history"
import { useCopy } from "./store"
import { AccountCard, GroupSelect, GroupStatusPill, PageHead, Stat, isOnline } from "./ui"

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
  const { state, group, account, refresh } = useCopy()
  const router = useRouter()
  const { pending, run } = useAction()
  const [dialog, setDialog] = useState<"wizard" | "connect" | "contract" | null>(null)
  const [manage, setManage] = useState<number | null>(null)
  // the phone's settings screens: one thing each
  const [setting, setSetting] = useState<"symbols" | "protection" | null>(null)
  const [rules, setRules] = useState<CopyRules | null>(null)
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
  const engineOn = state.engine.background && !!state.engine.lastRunAt && Date.now() - new Date(state.engine.lastRunAt).getTime() <= 120_000
  const fast = used.length > 0 && used.every((a) => a!.lane === "fast")

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
            <p className="mt-0.5 truncate text-xs text-muted-foreground">Contracts: {g.contracts.length ? g.contracts.map((c) => c.symbol).join(", ") : g.rules.symbolScope === "all" ? "all symbols" : "none imported"}</p>
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
              <dt className="text-[11px] text-muted-foreground">Sync success</dt>
              <dd className="font-semibold tabular-nums">{s.successRate == null ? "—" : `${(s.successRate * 100).toFixed(1)}%`}</dd>
            </div>
          </dl>
          <WeekBars counts={week} />
        </div>
        <div className="mt-auto flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Last activity: {orders[0] ? ago(orders[0].createdAt) : "none yet"}</span>
          <Link href={`/copy-trading/cockpit?group=${g.id}`} className={cn(linkBtnPrimary, "max-md:h-11")}>
            Open Cockpit
          </Link>
        </div>
      </li>
    )
  }

  // the phone's Copy Settings: what the selected group does, each row its own screen
  const protection = group ? (group.rules.stopLoss && group.rules.takeProfit ? "Copy" : group.rules.stopLoss ? "Stop loss only" : group.rules.takeProfit ? "Take profit only" : "Off") : "—"
  const limitsOn = group ? group.limits.respectPropSync || group.followers.some((f) => f.config.maxPositionSize != null || f.config.maxDailyLoss != null || f.config.maxExposure != null) : false
  const settingRow = "flex min-h-14 w-full items-center gap-3 px-3.5 text-start text-sm transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
  const rowBody = (Icon: typeof Layers, label: string, value: string) => (
    <>
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 font-medium">{label}</span>
      <span className="shrink-0 text-muted-foreground">{value}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </>
  )

  return (
    <>
      <div className="hidden md:block">
        <PageHead title="Copy Dashboard" subtitle="Monitor your copy trading activity in real time.">
          <button type="button" className={linkBtnPrimary} onClick={() => setDialog("wizard")}>
            <Plus className="size-3.5" /> Create Group
          </button>
          <Link href="/copy-trading/risk-management" className={linkBtn}>
            <Settings className="size-3.5" /> Settings
          </Link>
        </PageHead>
      </div>

      {/* ------------------------------------------------------------ phone: accounts first, then how they copy */}
      <div className="space-y-5 md:hidden">
        <div className="flex items-center gap-2">
          <Link href="/dashboard" aria-label="Back to Home" className="-ms-2 flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
            <ArrowLeft className="size-5" />
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold tracking-tight">Copy Trading</h1>
          <Link href="/copy-trading/risk-management" aria-label="Risk settings" className="-me-2 flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
            <SlidersHorizontal className="size-5" />
          </Link>
        </div>

        <section aria-labelledby="my-accounts" className="space-y-2.5">
          <div>
            <h2 id="my-accounts" className="text-base font-semibold">
              My Accounts
            </h2>
            <p className="text-sm text-muted-foreground">Copy your trading activity across your accounts.</p>
          </div>
          {state.accounts.length === 0 ? (
            <p className="rounded-2xl border border-dashed p-4 text-center text-sm text-muted-foreground">No trading accounts connected yet.</p>
          ) : (
            <ul className="space-y-2">
              {state.accounts.map((a) => (
                <li key={a.id}>
                  <AccountCard account={a} onOpen={() => setManage(a.id)} />
                </li>
              ))}
            </ul>
          )}
          <Link href="/copy-trading/connection" className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary/10 text-sm font-semibold text-primary transition-colors hover:bg-primary/15">
            <Plus className="size-4" /> Add / Manage Accounts
          </Link>
        </section>

        {group && (
          <section aria-labelledby="copy-settings" className="space-y-2.5">
            <div>
              <h2 id="copy-settings" className="text-base font-semibold">
                Copy Settings
              </h2>
              <p className="text-sm text-muted-foreground">Control how your accounts copy trades.</p>
            </div>
            {state.groups.length > 1 && <GroupSelect className="[&>select]:h-11 [&>select]:w-full [&>select]:max-w-none" />}
            <div className="divide-y overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
              <Link href={`/copy-trading/risk-management?group=${group.id}`} className={settingRow}>
                {rowBody(ArrowUpDown, "Lot Size", sizingSummary(group))}
              </Link>
              <button type="button" className={settingRow} onClick={() => (setRules(group.rules), setSetting("symbols"))}>
                {rowBody(Layers, "Symbols", group.rules.symbolScope === "all" ? "All" : `${group.contracts.length} selected`)}
              </button>
              <button type="button" className={settingRow} onClick={() => (setRules(group.rules), setSetting("protection"))}>
                {rowBody(Target, "Stop Loss / Take Profit", protection)}
              </button>
              <Link href={`/copy-trading/risk-management?group=${group.id}`} className={settingRow}>
                {rowBody(ShieldCheck, "Risk Management", limitsOn ? "Enabled" : "No limits")}
              </Link>
            </div>
          </section>
        )}
        <button type="button" className={cn(linkBtnPrimary, "h-12 w-full")} onClick={() => setDialog("wizard")}>
          <Plus className="size-4" /> Create Group
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Day P&L" value={money(used.reduce((s, a) => s + a!.dayPnl, 0), true)} tone={used.reduce((s, a) => s + a!.dayPnl, 0)} />
        <Stat label="Open P&L" value={money(openPnl.reduce((s, p) => s + p.openPnl!, 0), true)} tone={openPnl.reduce((s, p) => s + p.openPnl!, 0)} />
        <Stat label="Total balance" value={money(used.reduce((s, a) => s + (a!.balance ?? 0), 0))} />
        <Stat label="Active groups" value={activeGroups} sub={`of ${state.groups.length}`} />
        <Stat label="Connected accounts" value={`${healthy} / ${used.length}`} />
        <Stat label="Copies today" value={stats.today} sub={`${stats.todayFilled} filled`} />
        <Stat label="Sync success" value={stats.successRate == null ? "—" : `${(stats.successRate * 100).toFixed(1)}%`} sub={stats.total ? `${stats.filled} of ${stats.total}` : "No copies yet"} />
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
                ["Copy engine", state.mode === "live" ? (engineOn ? "Connected" : "Live, not running") : "Simulation"],
                ["Leader data", state.liveData ? "Reading" : "Unavailable"],
                ["Background engine", !state.engine.background ? "Off" : !state.engine.lastRunAt ? "No signal yet" : !engineOn ? `No signal for ${ago(state.engine.lastRunAt).replace(" ago", "")}` : "Running"],
                ["Accounts", used.length ? `${healthy}/${used.length} healthy` : "No accounts in a group"],
                ["Sync", sync.total ? `${Math.round((sync.synced / sync.total) * 100)}%` : "—"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 py-1.5">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">
              {!engineOn
                ? "The background engine isn't running right now, so groups copy only while a Copy Trading page is open."
                : fast
                  ? "Your groups copy whether or not this page is open. Every account in them is on the fast lane: a Leader's trade is seen within milliseconds and sent at once."
                  : "Your groups copy whether or not this page is open. An account on the fast lane is copied within milliseconds; one on the standard lane is read about every 30 seconds (a Rithmic leader about once a minute). The Cockpit shows which is which."}
            </p>
          </Section>
          <Section title="Alerts" description="What happened, why, and what you can do.">
            <AlertList events={state.events} limit={5} problemsOnly />
          </Section>
        </div>
      </div>

      <GroupWizard open={dialog === "wizard"} onClose={() => setDialog(null)} />
      <ConnectAccountDialog open={dialog === "connect"} onClose={() => setDialog(null)} />
      <AccountDrawer accountId={manage} onClose={() => setManage(null)} />
      {group && <ContractDialog open={dialog === "contract"} onClose={() => setDialog(null)} group={group} />}
      {group && (
        <Sheet
          open={setting != null}
          onClose={() => setSetting(null)}
          title={setting === "symbols" ? "Symbols" : "Stop Loss / Take Profit"}
          description={setting === "symbols" ? `Which of the Leader's trades “${group.name}” copies.` : `Whether “${group.name}” copies the Leader's stop and target.`}
          footer={
            <button
              type="button"
              disabled={pending || !rules}
              className={cn(linkBtnPrimary, "h-11 flex-1")}
              onClick={() =>
                run(
                  () => saveCopyRules(group.id, rules),
                  async () => {
                    toast.success("Saved.")
                    setSetting(null)
                    await refresh()
                    router.refresh()
                  },
                )
              }
            >
              {pending ? "Saving…" : "Save"}
            </button>
          }
        >
          {rules && setting && <RulesEditor value={rules} onChange={setRules} only={setting} />}
          {setting === "symbols" && rules?.symbolScope === "selected" && (
            <div className="space-y-2">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Contracts</p>
              <p className="text-sm">{group.contracts.length ? group.contracts.map((c) => c.symbol).join(", ") : "None imported yet."}</p>
              <button type="button" className={cn(linkBtn, "h-11 w-full")} onClick={() => (setSetting(null), setDialog("contract"))}>
                <Plus className="size-4" /> Import a contract
              </button>
            </div>
          )}
        </Sheet>
      )}
    </>
  )
}
