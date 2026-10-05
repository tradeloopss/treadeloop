"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Crown, Plus, Power, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { cancelCopyOrders, deleteCopyGroup, disableAllFollowers, flattenCopyGroup, removeCopyContract, saveCopyRules, setCopyFollowerEnabled, setCopyGroupActive } from "@/app/actions/copy-trading"
import { formatQuantity, resolveFollowerSymbol } from "@/lib/copy/contracts"
import { riskStatus, syncSummary, type CopyRules, type FollowerConfig } from "@/lib/copy/engine"
import { copyStats, groupCopies, money, price, type AccountView, type FollowerView, type PositionView } from "@/lib/copy/view"
import { Sheet, useAction } from "@/components/insights/client"
import { NotEnough, Pill, Section, linkBtn, linkBtnPrimary, type PillTone } from "@/components/insights/ui"
import { AccountDrawer, ChangeLeaderDialog, ContractDialog, GroupWizard, RulesEditor } from "./dialogs"
import { AlertList, CopyFeed, HistoryTable } from "./history"
import { useCopy } from "./store"
import { ConfirmDialog, GroupSelect, GroupStatusPill, HealthPill, PageHead, Stat, Toggle, dangerBtn, isOnline } from "./ui"

// The Cockpit: one group, live. Who leads, who follows, what each holds, and
// whether every follower is in step — with the controls to stop it all.

const TONE: Record<"good" | "warn" | "bad" | "none", PillTone> = { good: "good", warn: "warn", bad: "bad", none: "none" }
const ratioOf = (c: FollowerConfig) => (c.sizingMode === "same" ? "1x" : c.sizingMode === "percentage" ? `${formatQuantity((c.percentage ?? 100) / 100)}x` : c.sizingMode === "multiplier" ? `${formatQuantity(c.multiplier ?? 1)}x` : c.sizingMode === "risk" ? `Risk ${formatQuantity(c.riskPercentage ?? 1)}%` : c.sizingMode === "fixed" ? `Fixed ${formatQuantity(c.fixedQuantity ?? 1)}` : "By size")
const tone = (v: number | null | undefined) => (v == null || v === 0 ? "" : v > 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA")

type Row = { account: AccountView | undefined; accountId: number; follower: FollowerView | null; positions: PositionView[] }

export function Cockpit() {
  const { state, group, account, refresh } = useCopy()
  const router = useRouter()
  const { pending, run } = useAction()
  const [dialog, setDialog] = useState<"contract" | "leader" | "rules" | "disable" | "cancel" | "flatten" | "delete" | "wizard" | null>(null)
  const [manage, setManage] = useState<number | null>(null)
  const [rules, setRules] = useState<CopyRules | null>(null)
  const [tab, setTab] = useState<"live" | "history" | "errors">("live")
  const after = async () => {
    await refresh()
    router.refresh()
  }
  const orders = useMemo(() => (group ? state.orders.filter((o) => o.groupId === group.id) : []), [state.orders, group])
  const copies = useMemo(() => groupCopies(orders), [orders])

  if (!group)
    return (
      <>
        <PageHead title="Cockpit" subtitle="Control and monitor your copy trading group in real time." />
        <NotEnough title="Create your first Copy Group.">A group has one Leader and one or more Followers. Once it exists, this is where you watch and control it.</NotEnough>
        <div className="flex justify-center">
          <button type="button" className={linkBtnPrimary} onClick={() => setDialog("wizard")}>
            <Plus className="size-3.5" /> Create Copy Group
          </button>
        </div>
        <GroupWizard open={dialog === "wizard"} onClose={() => setDialog(null)} />
      </>
    )

  const symbols = new Set(group.contracts.map((c) => c.symbol))
  const mine = (accountId: number) => state.positions.filter((p) => p.accountId === accountId && (p.simulated ? p.groupId === group.id : true))
  const rows: Row[] = [{ accountId: group.leaderAccountId, account: account(group.leaderAccountId), follower: null, positions: mine(group.leaderAccountId) }, ...group.followers.map((f) => ({ accountId: f.accountId, account: account(f.accountId), follower: f, positions: mine(f.accountId) }))]
  const followers = rows.slice(1)
  const sync = syncSummary(followers.map((r) => ({ enabled: r.follower!.config.enabled, health: r.account?.health ?? "disconnected", blocked: !!r.account && riskStatus(r.follower!.config, { equity: r.account.equity, dayPnl: r.account.dayPnl, openNotional: 0, openQuantity: 0, connected: isOnline(r.account) }, group.limits.respectPropSync ? r.account.propSync : undefined).status === "blocked" && r.follower!.config.enabled && isOnline(r.account) })))
  const today = new Date().toLocaleDateString("en-CA")
  const stats = copyStats(orders, today, dayOf)
  const openPnl = rows.flatMap((r) => r.positions).filter((p) => p.openPnl != null)
  const active = group.status === "active"

  const cells = (r: Row) => {
    const p = r.positions.find((x) => symbols.has(x.symbol.toUpperCase())) ?? r.positions[0]
    // what this account's own broker calls each thing the group trades
    const traded = [...new Set([...group.contracts.map((x) => x.symbol), ...rows[0].positions.map((x) => x.symbol)])]
    const crossed = r.follower ? traded.map((s) => ({ s, to: resolveFollowerSymbol(s, r.follower!.mappings, r.account?.symbols ?? []) })).filter((x) => x.to.symbol !== x.s) : []
    const cross = crossed.length ? crossed.map((x) => `${x.s}→${x.to.symbol}${x.to.via === "auto" ? " (auto)" : ""}`).join(", ") : "Same"
    return { p, more: r.positions.length - (p ? 1 : 0), symbol: p?.symbol ?? group.contracts[0]?.symbol ?? "—", cross }
  }

  return (
    <>
      <PageHead title="Cockpit" subtitle="Control and monitor your copy trading group in real time.">
        <GroupSelect />
        <button type="button" disabled={pending} className={active ? linkBtn : linkBtnPrimary} onClick={() => run(() => setCopyGroupActive(group.id, !active), async () => (toast.success(active ? "Copying paused." : "Group activated."), await after()))}>
          <Power className="size-3.5" /> {active ? "Pause" : "Activate"}
        </button>
      </PageHead>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={linkBtn} onClick={() => setDialog("contract")}>
          <Plus className="size-3.5" /> Contract
        </button>
        {group.contracts.map((c) => (
          <span key={c.symbol} className="inline-flex h-8 items-center gap-1 rounded-md border bg-muted/40 ps-2.5 pe-1 text-sm font-semibold" title={`${c.name}${c.expiration ? ` · expires ${c.expiration}` : ""}`}>
            {c.symbol}
            <button type="button" disabled={pending} aria-label={`Remove ${c.symbol}`} className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => run(() => removeCopyContract(group.id, c.symbol), after)}>
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        {group.contracts.length === 0 && <span className="text-sm text-muted-foreground">{group.rules.symbolScope === "all" ? "Copying all symbols." : "Import a contract to start copying trades."}</span>}
        <span className="ms-auto flex flex-wrap gap-2">
          <button type="button" className={linkBtn} onClick={() => (setRules(group.rules), setDialog("rules"))}>
            Copy rules
          </button>
          <button type="button" className={linkBtn} onClick={() => setDialog("leader")}>
            Change Leader
          </button>
          <button type="button" className={linkBtn} onClick={() => setDialog("disable")}>
            Disable All
          </button>
          <button type="button" className={linkBtn} onClick={() => setDialog("cancel")}>
            Cancel Orders
          </button>
          <button type="button" className={dangerBtn} onClick={() => setDialog("flatten")}>
            Flatten All
          </button>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Day P&L" value={money(rows.reduce((s, r) => s + (r.account?.dayPnl ?? 0), 0), true)} tone={rows.reduce((s, r) => s + (r.account?.dayPnl ?? 0), 0)} />
        <Stat label="Open P&L" value={openPnl.length ? money(openPnl.reduce((s, p) => s + p.openPnl!, 0), true) : money(0, true)} tone={openPnl.reduce((s, p) => s + p.openPnl!, 0)} />
        <Stat label="Total balance" value={money(rows.reduce((s, r) => s + (r.account?.balance ?? 0), 0))} />
        <Stat label="Open positions" value={rows.reduce((s, r) => s + r.positions.length, 0)} />
        <Stat label="Copies today" value={`${stats.todayFilled} / ${stats.today}`} sub="filled / sent" />
        <Stat label="Sync status" value={`${sync.synced} / ${sync.total}`} sub={sync.total === 0 ? "No followers" : sync.synced === sync.total ? "All in step" : "Some followers aren't copying"} tone={sync.tone === "good" ? 1 : sync.tone === "none" ? null : -1} />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-foreground/10">
        <span className="font-semibold">{group.name}</span>
        <span className="text-muted-foreground">
          Leader: <span className="font-medium text-foreground">{rows[0].account?.name ?? "—"}</span>
        </span>
        <span className="text-muted-foreground">
          Followers: <span className="font-medium text-foreground">{followers.length}</span>
        </span>
        <GroupStatusPill status={group.status} />
        <Pill tone={TONE[sync.tone]}>
          {sync.synced}/{sync.total} synced
        </Pill>
        {state.mode === "simulation" && <span className="rounded border px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase">Simulation</span>}
      </div>

      {/* the heart of the Cockpit: a table where there is room, cards on a phone */}
      <Section title="Leader and followers" description="Each follower's Sync switch is its own: turning one off leaves the others copying.">
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[54rem] text-[13px]">
            <thead>
              <tr className="border-b text-[11px] tracking-wide text-muted-foreground uppercase">
                {["Sync", "Account", "Connection", "Balance", "Symbol", "Position", "Entry", "Current", "Day P&L", "Open P&L", "Ratio", "Cross", ""].map((h, i) => (
                  <th key={i} scope="col" className={cn("py-2 font-medium", i < 3 || i === 4 || i > 9 ? "text-start" : "text-end", i > 0 && "ps-2.5")}>
                    {h || <span className="sr-only">Manage</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const c = cells(r)
                const leader = !r.follower
                return (
                  <tr key={r.accountId} className={cn(leader && "bg-amber-500/[0.06]")}>
                    <td className="py-2.5">
                      {leader ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-600 uppercase dark:text-amber-400">
                          <Crown className="size-3" aria-hidden /> Leader
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <Toggle checked={r.follower!.config.enabled} disabled={pending} label={`Sync ${r.account?.name ?? "follower"}`} onChange={(v) => run(() => setCopyFollowerEnabled(group.id, r.accountId, v), async () => (toast.success(v ? "Follower enabled." : "Follower disabled."), await after()))} />
                          <span className="text-xs text-muted-foreground">{r.follower!.config.enabled ? "Synced" : "Disabled"}</span>
                        </span>
                      )}
                    </td>
                    <th scope="row" className="max-w-44 truncate py-2.5 ps-2.5 text-start font-semibold">
                      {r.account?.name ?? "Deleted account"}
                      <span className="block text-xs font-normal text-muted-foreground">{r.account?.platform}</span>
                    </th>
                    <td className="py-2.5 ps-2.5">{r.account ? <HealthPill health={r.account.health} /> : "—"}</td>
                    <td className="py-2.5 ps-2.5 text-end tabular-nums">{money(r.account?.balance)}</td>
                    <td className="py-2.5 ps-2.5 font-medium">{c.symbol}</td>
                    <td className={cn("py-2.5 ps-2.5 text-end font-semibold tabular-nums", c.p && (c.p.side === "long" ? "text-[var(--gain)]" : "text-[var(--loss)]"))}>
                      {c.p ? `${c.p.side === "long" ? "+" : "−"}${formatQuantity(c.p.quantity)}` : "—"}
                      {c.p?.simulated && <span className="ms-1 text-[10px] font-semibold text-muted-foreground uppercase">sim</span>}
                      {c.more > 0 && <span className="ms-1 text-xs font-normal text-muted-foreground">+{c.more}</span>}
                    </td>
                    <td className="py-2.5 ps-2.5 text-end tabular-nums">{price(c.p?.entry)}</td>
                    <td className="py-2.5 ps-2.5 text-end tabular-nums">{price(c.p?.current)}</td>
                    <td className={cn("py-2.5 ps-2.5 text-end tabular-nums", tone(r.account?.dayPnl))}>{money(r.account?.dayPnl ?? 0, true)}</td>
                    <td className={cn("py-2.5 ps-2.5 text-end tabular-nums", tone(c.p?.openPnl))}>{money(c.p?.openPnl ?? 0, true)}</td>
                    <td className="py-2.5 ps-2.5 tabular-nums">{leader ? "—" : ratioOf(r.follower!.config)}</td>
                    <td className="max-w-28 truncate py-2.5 ps-2.5 text-xs" title={leader ? undefined : c.cross}>
                      {leader ? "—" : c.cross}
                    </td>
                    <td className="py-2.5 ps-2.5 text-end">
                      <button type="button" className={cn(linkBtn, "h-7 text-xs")} onClick={() => setManage(r.accountId)}>
                        Manage
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:hidden">
          {rows.map((r) => {
            const c = cells(r)
            const leader = !r.follower
            return (
              <li key={r.accountId} className={cn("space-y-2.5 rounded-xl border p-3", leader && "border-amber-500/40 bg-amber-500/[0.06]")}>
                <div className="flex items-center justify-between gap-2">
                  <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                    {leader && <Crown className="size-4 shrink-0 text-amber-500" aria-label="Leader" />}
                    <span className="truncate uppercase">{r.account?.name ?? "Deleted account"}</span>
                  </p>
                  {leader ? <span className="text-[10px] font-semibold tracking-wide text-amber-600 uppercase dark:text-amber-400">Leader</span> : <Toggle checked={r.follower!.config.enabled} disabled={pending} label={`Sync ${r.account?.name ?? "follower"}`} onChange={(v) => run(() => setCopyFollowerEnabled(group.id, r.accountId, v), after)} />}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {r.account && <HealthPill health={r.account.health} />}
                  {!leader && <span className="text-xs text-muted-foreground">{r.follower!.config.enabled ? "● Synced" : "○ Disabled"}</span>}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                  {[
                    ["Balance", money(r.account?.balance)],
                    ["Symbol", c.symbol],
                    ["Position", c.p ? `${c.p.side === "long" ? "+" : "−"}${formatQuantity(c.p.quantity)}${c.p.simulated ? " (sim)" : ""}` : "—"],
                    ["Ratio", leader ? "—" : ratioOf(r.follower!.config)],
                    ["Day P&L", money(r.account?.dayPnl ?? 0, true)],
                    ["Open P&L", money(c.p?.openPnl ?? 0, true)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-2">
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="font-medium tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>
                <button type="button" className={cn(linkBtn, "w-full")} onClick={() => setManage(r.accountId)}>
                  Manage
                </button>
              </li>
            )
          })}
        </ul>
        {followers.length === 0 && (
          <p className="text-sm text-muted-foreground">
            This group has no followers.{" "}
            <Link href={`/copy-trading/risk-management?group=${group.id}`} className="font-medium text-primary hover:underline">
              Add one in Risk Management
            </Link>
            .
          </p>
        )}
      </Section>

      <Section
        title={
          <div role="tablist" aria-label="Group activity" className="flex gap-1 rounded-lg border bg-background p-0.5 text-sm">
            {(
              [
                ["live", "Live copies"],
                ["history", "Trade history"],
                ["errors", "Activity & errors"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("rounded-md px-2.5 py-1 font-medium", tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                {label}
              </button>
            ))}
          </div>
        }
      >
        {tab === "live" && <CopyFeed copies={copies} limit={8} detailed />}
        {tab === "history" && <HistoryTable orders={orders} />}
        {tab === "errors" && <AlertList events={state.events.filter((e) => e.groupId === group.id)} limit={30} />}
      </Section>

      <div className="flex justify-end">
        <button type="button" disabled={active} title={active ? "Pause the group first" : undefined} className={cn(linkBtn, "text-muted-foreground")} onClick={() => setDialog("delete")}>
          Delete this group
        </button>
      </div>

      <ContractDialog open={dialog === "contract"} onClose={() => setDialog(null)} group={group} />
      <ChangeLeaderDialog open={dialog === "leader"} onClose={() => setDialog(null)} group={group} />
      <AccountDrawer accountId={manage} onClose={() => setManage(null)} />
      <Sheet
        open={dialog === "rules"}
        onClose={() => setDialog(null)}
        title="Copy rules"
        description={`What “${group.name}” copies, and when.`}
        footer={
          <button type="button" disabled={pending || !rules} className={linkBtnPrimary} onClick={() => run(() => saveCopyRules(group.id, rules), async () => (toast.success("Copy rules saved."), setDialog(null), await after()))}>
            {pending ? "Saving…" : "Save rules"}
          </button>
        }
      >
        {rules && <RulesEditor value={rules} onChange={setRules} />}
      </Sheet>

      <ConfirmDialog open={dialog === "disable"} onClose={() => setDialog(null)} title="Disable all followers?" action="Disable All" pending={pending} onConfirm={() => run(() => disableAllFollowers(group.id), async () => (toast.success("All followers disabled."), setDialog(null), await after()))}>
        <p>New trades on the Leader stop being copied to every follower of “{group.name}”, and the group is paused.</p>
        <p>Positions that are already open are not closed.</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === "cancel"} onClose={() => setDialog(null)} title="Cancel pending copy orders?" action="Cancel Orders" pending={pending} onConfirm={() => run(() => cancelCopyOrders(group.id), async (res) => (toast.success(`${res.cancelled} pending ${res.cancelled === 1 ? "order" : "orders"} cancelled.`), setDialog(null), await after()))}>
        <p>Copy orders that haven&apos;t reached a broker yet are withdrawn.</p>
        <p>An order already working at a broker can&apos;t be withdrawn from here: cancel it in the Trade Manager or on the broker&apos;s platform.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "flatten"}
        onClose={() => setDialog(null)}
        title="Flatten All"
        action="Flatten All"
        danger
        word="FLATTEN"
        pending={pending}
        onConfirm={(typed) => run(() => flattenCopyGroup(group.id, typed), async (res) => ((res.failed ? toast.error : toast.success)(`${res.closed} ${res.closed === 1 ? "position" : "positions"} closed${res.failed ? `, ${res.failed} could not be closed` : ""}.`), setDialog(null), await after()))}
      >
        <p>
          Closes every position the followers of “{group.name}” hold through Copy Trading, pauses the group and switches every follower off. <span className="font-semibold text-foreground">This cannot be undone.</span>
        </p>
        <p>{state.mode === "live" ? "Close orders are sent to the brokers at market." : "This group is in simulation: the simulated positions are closed, and nothing is sent to a broker."} The Leader&apos;s own positions are not touched.</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === "delete"} onClose={() => setDialog(null)} title={`Delete “${group.name}”?`} action="Delete group" danger pending={pending} onConfirm={() => run(() => deleteCopyGroup(group.id), async () => (toast.success("Group deleted."), setDialog(null), router.replace("/copy-trading/cockpit"), await after()))}>
        <p>Its followers, contracts and rules are removed. What it copied stays in the history.</p>
      </ConfirmDialog>
    </>
  )
}
