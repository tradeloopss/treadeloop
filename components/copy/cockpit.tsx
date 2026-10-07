"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { ArrowDownRight, ArrowUpRight, Ban, ChevronDown, ChevronRight, CircleX, Crown, HeartPulse, MoreHorizontal, Plus, Power, RefreshCw, Repeat2, Settings2, ShieldAlert, Trash2, TriangleAlert, X, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cancelCopyOrders, deleteCopyGroup, disableAllFollowers, flattenCopyPositions, removeCopyContract, saveCopyRules, setCopyFollowerEnabled, setCopyGroupActive } from "@/app/actions/copy-trading"
import { formatQuantity, specFor } from "@/lib/copy/contracts"
import { riskStatus, syncSummary, type CopyRules, type FollowerConfig } from "@/lib/copy/engine"
import { ago, cockpitContracts, copyStats, groupCopies, groupScope, money, netPosition, price, symbolCounts, symbolScope, type AccountView, type PositionView, type ScopeRow } from "@/lib/copy/view"
import { Sheet, useAction } from "@/components/insights/client"
import { NotEnough, Pill, linkBtn, linkBtnPrimary, type PillTone } from "@/components/insights/ui"
import { AccountDrawer, ChangeLeaderDialog, ContractDialog, GroupWizard, RulesEditor } from "./dialogs"
import { ActivityFeed, AlertList, OrderHistory } from "./history"
import { useCopy } from "./store"
import { ConfirmDialog, GroupSelect, GroupStatusPill, MarketStatus, PageHead, PlatformIcon, RolePill, RunningBadge, Toggle, dangerBtn, isOnline } from "./ui"

// The Cockpit: one group, one contract, live. Who leads, who follows, what
// each holds of the contract in front of you, and the controls to stop it.
//
// The table is about the selected contract: the positions counted, the rows'
// figures, a row's own Flatten, and Cancel all orders. Flatten All is not: it
// closes everything the group's accounts hold, in every symbol, the Leader's
// included. Which positions either means comes from symbolScope / groupScope,
// the same functions the server closes with, so the number on a Flatten
// button is the number closed.

const ratioOf = (c: FollowerConfig) => (c.sizingMode === "same" ? "1x" : c.sizingMode === "percentage" ? `${formatQuantity((c.percentage ?? 100) / 100)}x` : c.sizingMode === "multiplier" ? `${formatQuantity(c.multiplier ?? 1)}x` : c.sizingMode === "risk" ? `${formatQuantity(c.riskPercentage ?? 1)}% risk` : c.sizingMode === "fixed" ? `Fixed ${formatQuantity(c.fixedQuantity ?? 1)}` : "By size")
const tone = (v: number | null | undefined) => (v == null || v === 0 ? "" : v > 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA")
// an account id as a terminal shows it: the end of it
const shortId = (login: string | null | undefined) => (!login ? "—" : login.length > 9 ? `…${login.slice(-8)}` : login)

const HEALTH: Record<AccountView["health"], { label: string; tone: PillTone; dot: string }> = {
  connected: { label: "Healthy", tone: "good", dot: "bg-[var(--gain)]" },
  syncing: { label: "Syncing", tone: "ok", dot: "bg-[var(--gain)]" },
  warning: { label: "Degraded", tone: "warn", dot: "bg-[var(--warning)]" },
  disconnected: { label: "Offline", tone: "bad", dot: "bg-[var(--loss)]" },
  auth: { label: "Sign-in needed", tone: "bad", dot: "bg-[var(--loss)]" },
}

type Row = ScopeRow & { account: AccountView | undefined; net: ReturnType<typeof netPosition>; risk: ReturnType<typeof riskStatus> | null }
type Dialog = "contract" | "leader" | "rules" | "disable" | "cancel" | "flatten" | "flattenContract" | "delete" | "wizard" | "alerts" | null

function SideLabel({ side }: { side: "long" | "short" | null }) {
  if (!side) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn("inline-flex items-center gap-1 font-medium", side === "long" ? "text-[var(--gain)]" : "text-[var(--loss)]")}>
      {side === "long" ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
      {side === "long" ? "Long" : "Short"}
    </span>
  )
}

export function Cockpit() {
  const { state, group, account, refresh, refreshing } = useCopy()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const { pending, run } = useAction()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [manage, setManage] = useState<number | null>(null)
  const [flattenOne, setFlattenOne] = useState<number | null>(null)
  const [openRow, setOpenRow] = useState<number | null>(null)
  const [rules, setRules] = useState<CopyRules | null>(null)
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

  // the contract in front: the one in the address, else the first tab
  const tabs = cockpitContracts(group, state.positions)
  const contract = tabs.find((t) => t.symbol === params.get("contract"))?.symbol ?? tabs[0]?.symbol ?? null
  const selectContract = (symbol: string) => {
    const p = new URLSearchParams(params.toString())
    p.set("contract", symbol)
    router.replace(`${pathname}?${p.toString()}`, { scroll: false })
  }
  const spec = contract ? (group.contracts.find((c) => c.symbol === contract) ?? specFor(contract)) : null

  const scope: ScopeRow[] = contract ? symbolScope(group, state.accounts, state.positions, contract) : [{ accountId: group.leaderAccountId, leader: true, follower: null, symbol: "—", via: "same", positions: [] }, ...group.followers.map((f) => ({ accountId: f.accountId, leader: false, follower: f, symbol: "—", via: "same" as const, positions: [] }))]
  const rows: Row[] = scope.map((r) => {
    const a = account(r.accountId)
    return { ...r, account: a, net: netPosition(r.positions), risk: r.follower && a ? riskStatus(r.follower.config, { equity: a.equity, dayPnl: a.dayPnl, openNotional: 0, openQuantity: 0, connected: isOnline(a) }, group.limits.respectPropSync ? a.propSync : undefined) : null }
  })
  const followers = rows.slice(1)
  const active = group.status === "active"
  const running = rows.reduce((n, r) => n + r.positions.length, 0)
  const dayPnl = rows.reduce((s, r) => s + (r.account?.dayPnl ?? 0), 0)
  const openPnl = rows.reduce((s, r) => s + (r.net.openPnl ?? 0), 0)
  const balance = rows.reduce((s, r) => s + (r.account?.balance ?? 0), 0)
  const sync = syncSummary(followers.map((r) => ({ enabled: r.follower!.config.enabled, health: r.account?.health ?? "disconnected", blocked: !!r.account && isOnline(r.account) && r.follower!.config.enabled && r.risk?.status === "blocked" })))
  const stats = copyStats(orders, new Date().toLocaleDateString("en-CA"), dayOf)
  const problems = state.events.filter((e) => e.groupId === group.id && e.unread && (e.level === "error" || e.level === "warning"))

  // what a Flatten can't close from here, said before it is pressed
  const cantClose = (positions: PositionView[], a: AccountView | undefined): string | null => {
    if (!positions.some((p) => !p.simulated)) return null
    if (state.mode !== "live") return "Simulation mode: no order is sent to a broker."
    return a?.canExecute ? null : (a?.executionNote ?? "This account can't receive orders from TradeLoop.")
  }
  const blocker = (r: Row) => cantClose(r.positions, r.account)
  const live = (positions: PositionView[]) => positions.filter((p) => !p.simulated).length
  // the selected contract only
  const blocked = rows.filter((r) => blocker(r))
  // the number on a button is the number that will be closed
  const closable = running - blocked.reduce((n, r) => n + live(r.positions), 0)
  const one = flattenOne != null ? rows.find((r) => r.accountId === flattenOne) : undefined
  // Flatten All: everything the group's accounts hold, in every symbol, the Leader's included
  const everything = groupScope(group, state.positions)
    .map((r) => ({ ...r, account: account(r.accountId) }))
    .filter((r) => r.positions.length > 0)
  const allOpen = everything.reduce((n, r) => n + r.positions.length, 0)
  const allBlocked = everything.filter((r) => cantClose(r.positions, r.account))
  const allClosable = allOpen - allBlocked.reduce((n, r) => n + live(r.positions), 0)

  const flattened = (what: string) => (res: { total: number; closed: number; requested: number; skipped: { name: string; reason: string }[] }) => {
    const done = res.closed + res.requested
    const of = what ? `${what} ` : ""
    if (done > 0) toast.success(`${done} ${of}${done === 1 ? "position" : "positions"} flattened`, { description: res.requested ? "Close orders are with the broker: each position shows as closed once the broker confirms." : undefined })
    else if (!res.skipped.length) toast.message(`No open ${of}positions to flatten.`)
    for (const s of res.skipped) toast.warning(`${s.name} was not closed`, { description: s.reason })
  }
  const flattenAll = () => {
    if (allOpen === 0) return void toast.message("No open positions to flatten.")
    setDialog("flatten")
  }
  const flattenContract = () => {
    if (!contract) return
    if (running === 0) return void toast.message(`No open ${contract} positions to flatten.`)
    setDialog("flattenContract")
  }
  const toggle = (r: Row, v: boolean) => run(() => setCopyFollowerEnabled(group.id, r.accountId, v), async () => (toast.success(v ? "Follower enabled." : "Follower disabled. Its open positions stay open."), await after()))
  const cross = (r: Row) => (r.leader ? "—" : contract ? `${r.symbol}${r.via === "auto" ? " (auto)" : ""}` : "—")

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button" aria-label="More group actions" className={cn(linkBtn, "w-8 px-0")} />}>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={() => (setRules(group.rules), setDialog("rules"))}>
          <Settings2 className="size-4" /> Copy rules
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={`/copy-trading/risk-management?group=${group.id}`} />}>
          <ShieldAlert className="size-4" /> Risk Management
        </DropdownMenuItem>
        <DropdownMenuItem disabled={pending} onClick={() => run(() => setCopyGroupActive(group.id, !active), async () => (toast.success(active ? "Copying paused." : "Group activated."), await after()))}>
          <Power className="size-4" /> {active ? "Pause copying" : "Activate group"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!contract} onClick={flattenContract}>
          <CircleX className="size-4" /> Flatten {contract ?? "this contract"} only
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={active} onClick={() => setDialog("delete")}>
          <Trash2 className="size-4" /> {active ? "Delete group (pause it first)" : "Delete group"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
  const contractTabs = (
    <>
      {tabs.map((t) => {
        const on = t.symbol === contract
        return (
          <span key={t.symbol} className={cn("inline-flex h-8 shrink-0 items-center rounded-md border text-sm font-semibold transition-colors", on ? "border-primary/60 bg-primary/10 text-primary" : "bg-background text-foreground hover:bg-muted")}>
            <button type="button" aria-pressed={on} onClick={() => selectContract(t.symbol)} className={cn("h-full rounded-md ps-2.5", t.imported ? "pe-1" : "pe-2.5")} title={t.imported ? undefined : "Open on the Leader now. Import it to keep the tab."}>
              {t.symbol}
            </button>
            {t.imported && (
              <button type="button" disabled={pending} aria-label={`Remove ${t.symbol}`} className="me-0.5 flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => run(() => removeCopyContract(group.id, t.symbol), after)}>
                <X className="size-3.5" />
              </button>
            )}
          </span>
        )
      })}
      {tabs.length === 0 && <span className="text-sm text-muted-foreground">{group.rules.symbolScope === "all" ? "Copying all symbols. A tab appears when the Leader trades." : "Import a contract to start copying trades."}</span>}
    </>
  )

  return (
    <>
      {/* ------------------------------------------------------------ desktop: the terminal */}
      <div className="hidden space-y-3 lg:block">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">Cockpit</h1>
            <GroupSelect />
            <GroupStatusPill status={group.status} />
          </div>
          <RunningBadge count={running} symbol={contract} />
          <MarketStatus spec={spec} className="justify-self-end" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={linkBtnPrimary} onClick={() => setDialog("contract")}>
            <Plus className="size-3.5" /> Contract
          </button>
          {contractTabs}
          <span className="ms-auto flex flex-wrap items-center gap-2">
            <button type="button" aria-label="Refresh" disabled={refreshing} className={cn(linkBtn, "w-8 px-0")} onClick={() => void refresh()}>
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            </button>
            <button type="button" className={linkBtn} onClick={() => setDialog("leader")}>
              <Crown className="size-3.5" /> Change leader
            </button>
            <button type="button" className={linkBtn} onClick={() => setDialog("disable")}>
              <Ban className="size-3.5" /> Disable all followers
            </button>
            <button type="button" disabled={!contract} className={linkBtn} onClick={() => setDialog("cancel")}>
              <CircleX className="size-3.5" /> Cancel all orders
            </button>
            <button type="button" className={dangerBtn} onClick={flattenAll} title="Close every open position on every account of this group, the Leader's included">
              Flatten all
            </button>
            {menu}
          </span>
        </div>

        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          {[
            ["Total Day PnL", money(dayPnl, true), tone(dayPnl)],
            ["Total Open PnL", money(openPnl, true), tone(openPnl)],
            ["Total Balance", money(balance), ""],
          ].map(([k, v, cls]) => (
            <div key={k} className="flex items-baseline gap-1.5">
              <dt className="text-muted-foreground">{k}:</dt>
              <dd className={cn("font-semibold tabular-nums", cls)}>{v}</dd>
            </div>
          ))}
          <div className="ms-auto flex items-baseline gap-x-5">
            <div className="flex items-baseline gap-1.5" title="Follower orders filled today / copied today">
              <dt className="text-muted-foreground">Copies today:</dt>
              <dd className="font-semibold tabular-nums">
                {stats.todayFilled}/{stats.today}
              </dd>
            </div>
            <div className="flex items-baseline gap-1.5" title={sync.total === 0 ? "No followers" : sync.synced === sync.total ? "Every follower is copying" : "Some followers aren't copying"}>
              <dt className="text-muted-foreground">Sync:</dt>
              <dd className={cn("font-semibold tabular-nums", sync.tone === "good" ? "text-[var(--gain)]" : sync.tone === "none" ? "" : "text-[var(--warning)]")}>
                {sync.synced}/{sync.total}
              </dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-muted-foreground">Open Positions:</dt>
              <dd className="font-semibold tabular-nums">{running}</dd>
            </div>
          </div>
        </dl>

        {problems.length > 0 && (
          <button type="button" onClick={() => setDialog("alerts")} className="flex w-full items-center gap-2 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-3 py-2 text-start text-sm">
            <TriangleAlert className="size-4 shrink-0 text-[var(--warning)]" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-semibold">{problems[0].title}</span>
              {problems[0].body && <span className="text-muted-foreground"> · {problems[0].body}</span>}
            </span>
            <span className="shrink-0 font-medium text-primary">{problems.length > 1 ? `View all ${problems.length}` : "View"}</span>
          </button>
        )}

        <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
          <table className="w-full min-w-[58rem] text-[13px]">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                {["Follow", "ID", "Connection", "Account", "Symbol", "Side", "Balance", "Avg. Price", "Day PnL", "Open PnL", "Qty", "Ratio", "Cross", "Actions"].map((h, i) => (
                  <th key={h} scope="col" className={cn("px-2 py-2.5 font-medium whitespace-nowrap first:ps-3 last:pe-3", (i >= 6 && i <= 10) || i === 13 ? "text-end" : "text-start", i === 1 && "hidden min-[1500px]:table-cell")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const a = r.account
                const cant = blocker(r)
                const h = a ? HEALTH[a.health] : HEALTH.disconnected
                return (
                  <tr key={r.accountId} className={cn("hover:bg-muted/40", r.leader && "bg-amber-500/[0.06]")}>
                    <td className="py-2 ps-3 pe-2">
                      {r.leader ? <Crown className="size-4 text-amber-500" aria-label="Leader" /> : <Toggle checked={r.follower!.config.enabled} disabled={pending} label={`Follow with ${a?.name ?? "this account"}`} onChange={(v) => toggle(r, v)} />}
                    </td>
                    <td className="hidden px-2 py-2 font-mono text-xs whitespace-nowrap text-muted-foreground min-[1500px]:table-cell" title={a?.login ?? undefined}>
                      {shortId(a?.login)}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5" title={a ? `${h.label}${a.healthNote && a.health !== "connected" ? `: ${a.healthNote}` : ""} · last heartbeat ${ago(a.heartbeatAt)}` : undefined}>
                        <span className={cn("size-1.5 rounded-full", h.dot)} aria-hidden />
                        {a?.platform ?? "—"}
                        <span className="sr-only">{h.label}</span>
                      </span>
                      {a && active && a.lane === "fast" && (
                        <span className="ms-1.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-primary" title={`The sync server keeps a terminal open for this account: a trade on it is seen within milliseconds and an order is sent at once.${a.pingMs != null ? ` Its broker answers in about ${a.pingMs}ms from our server.` : ""}`}>
                          <Zap className="size-3" aria-hidden />
                          {a.pingMs != null ? `${a.pingMs}ms` : "Fast"}
                        </span>
                      )}
                    </td>
                    <th scope="row" className="max-w-48 px-2 py-2 text-start font-semibold">
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 truncate">{a?.name ?? "Deleted account"}</span>
                        {r.risk && r.follower!.config.enabled && r.risk.status !== "healthy" && <TriangleAlert className={cn("size-3.5 shrink-0", r.risk.status === "blocked" ? "text-[var(--loss)]" : "text-[var(--warning)]")} aria-label={r.risk.note} />}
                      </span>
                      {/* where the ID has no column of its own, it sits under the name */}
                      <span className="block truncate font-mono text-[11px] font-normal text-muted-foreground min-[1500px]:hidden">
                        {r.leader ? "Leader · " : ""}
                        {shortId(a?.login)}
                      </span>
                    </th>
                    <td className="px-2 py-2 font-medium whitespace-nowrap">{r.symbol}</td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <SideLabel side={r.net.side} />
                      {r.net.simulated && <span className="ms-1 text-[10px] font-semibold text-muted-foreground uppercase">sim</span>}
                    </td>
                    <td className="px-2 py-2 text-end tabular-nums">{money(a?.balance)}</td>
                    <td className="px-2 py-2 text-end tabular-nums">{price(r.net.avgPrice)}</td>
                    <td className={cn("px-2 py-2 text-end tabular-nums", tone(a?.dayPnl))}>{money(a?.dayPnl ?? 0, true)}</td>
                    <td className={cn("px-2 py-2 text-end tabular-nums", tone(r.net.openPnl))}>{r.net.tickets ? money(r.net.openPnl ?? 0, true) : "—"}</td>
                    <td className="px-2 py-2 text-end font-semibold tabular-nums" title={r.net.tickets > 1 ? `${r.net.tickets} positions` : undefined}>
                      {r.net.tickets ? formatQuantity(r.net.quantity) : "—"}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">{r.leader ? <span className="text-muted-foreground">—</span> : <span className="inline-flex h-6 items-center rounded-md border px-1.5 text-xs font-medium tabular-nums">{ratioOf(r.follower!.config)}</span>}</td>
                    <td className="max-w-28 truncate px-2 py-2 text-xs whitespace-nowrap" title={r.leader ? undefined : r.via === "mapping" ? "Your symbol mapping" : r.via === "auto" ? "This account's own name for the instrument" : "Same symbol as the Leader"}>
                      {cross(r)}
                    </td>
                    <td className="py-2 ps-2 pe-3">
                      <span className="flex items-center justify-end gap-1">
                        <button type="button" disabled={!r.positions.length || !!cant || pending} title={cant ?? (!r.positions.length ? `No open ${r.symbol} position` : undefined)} className={cn(linkBtn, "h-7 px-2.5 text-xs font-semibold")} onClick={() => setFlattenOne(r.accountId)}>
                          Flatten
                        </button>
                        <button type="button" aria-label={`Manage ${a?.name ?? "account"}`} className={cn(linkBtn, "h-7 w-7 px-0")} onClick={() => setManage(r.accountId)}>
                          <MoreHorizontal className="size-3.5" />
                        </button>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {followers.length === 0 && (
            <p className="border-t px-4 py-3 text-sm text-muted-foreground">
              This group has no followers.{" "}
              <Link href={`/copy-trading/risk-management?group=${group.id}`} className="font-medium text-primary hover:underline">
                Add one in Risk Management
              </Link>
              .
            </p>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------ phone and tablet: cards */}
      <div className="space-y-3 lg:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Cockpit</h1>
          <span role="status" className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-card px-3 text-xs font-semibold">
            <span className={cn("size-2 rounded-full", running > 0 ? "animate-pulse bg-[var(--gain)]" : "bg-muted-foreground/40")} aria-hidden />
            Running Trades <span className="tabular-nums">{running}</span>
          </span>
        </div>
        <MarketStatus spec={spec} />
        <GroupSelect className="[&>select]:h-11 [&>select]:w-full [&>select]:max-w-none" />
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button type="button" aria-label="Add a contract" className={cn(linkBtnPrimary, "h-9 shrink-0")} onClick={() => setDialog("contract")}>
            <Plus className="size-4" /> Contract
          </button>
          {contractTabs}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" className={cn(linkBtn, "h-11 px-1 text-xs")} onClick={() => setDialog("leader")}>
            <Crown className="size-3.5 shrink-0" /> Change Leader
          </button>
          <button type="button" className={cn(linkBtn, "h-11 px-1 text-xs")} onClick={() => setDialog("disable")}>
            <Ban className="size-3.5 shrink-0" /> Disable All
          </button>
          <button type="button" disabled={!contract} className={cn(linkBtn, "h-11 px-1 text-xs")} onClick={() => setDialog("cancel")}>
            <CircleX className="size-3.5 shrink-0" /> Cancel Orders
          </button>
        </div>
        <button type="button" className={cn(dangerBtn, "h-12 w-full text-base")} onClick={flattenAll}>
          <TriangleAlert className="size-4" /> Flatten All
        </button>
        {contract && tabs.length > 1 && (
          <button type="button" className={cn(linkBtn, "h-11 w-full border-[var(--loss)]/50 text-[var(--loss)]")} onClick={flattenContract}>
            Flatten {contract} only
          </button>
        )}

        <dl className="grid grid-cols-3 gap-2">
          {[
            ["Day P&L", money(dayPnl, true), tone(dayPnl)],
            ["Open P&L", money(openPnl, true), tone(openPnl)],
            ["Balance", money(balance), ""],
            ["Open positions", String(running), ""],
            ["Copies today", `${stats.todayFilled}/${stats.today}`, ""],
            ["Sync status", `${sync.synced} / ${sync.total}`, sync.tone === "good" ? "text-[var(--gain)]" : sync.tone === "none" ? "" : "text-[var(--warning)]"],
          ].map(([k, v, cls]) => (
            <div key={k} className="min-w-0 rounded-xl bg-card p-2.5 ring-1 ring-foreground/10">
              <dt className="truncate text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{k}</dt>
              <dd className={cn("mt-0.5 truncate text-base font-semibold tabular-nums", cls)}>{v}</dd>
            </div>
          ))}
        </dl>

        {problems.length > 0 && (
          <button type="button" onClick={() => setDialog("alerts")} className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-3 py-2 text-start text-sm">
            <TriangleAlert className="size-4 shrink-0 text-[var(--warning)]" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium">{problems[0].title}</span>
            <span className="shrink-0 font-medium text-primary">{problems.length > 1 ? `${problems.length} alerts` : "View"}</span>
          </button>
        )}

        <section aria-label="Accounts" className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2.5">
            <h2 className="min-w-0 truncate text-sm font-semibold">{group.name}</h2>
            <GroupStatusPill status={group.status} />
            <p className="w-full text-xs text-muted-foreground">
              Leader: {rows[0].account?.name ?? "—"} · Followers: {followers.length}
              {contract ? ` · ${contract}` : ""}
            </p>
          </div>
          <ul className="divide-y">
            {rows.map((r) => {
              const a = r.account
              const open = openRow === r.accountId
              const cant = blocker(r)
              const h = a ? HEALTH[a.health] : HEALTH.disconnected
              return (
                <li key={r.accountId} className={cn(r.leader && "bg-amber-500/[0.06]")}>
                  <div className="flex min-h-14 items-center gap-2.5 px-3 py-2">
                    {r.leader ? (
                      <span className="flex h-5 w-9 shrink-0 items-center justify-center">
                        <Crown className="size-5 text-amber-500" aria-label="Leader" />
                      </span>
                    ) : (
                      <Toggle checked={r.follower!.config.enabled} disabled={pending} label={`Follow with ${a?.name ?? "this account"}`} onChange={(v) => toggle(r, v)} />
                    )}
                    <button type="button" aria-expanded={open} onClick={() => setOpenRow(open ? null : r.accountId)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 text-start">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className={cn("size-2 shrink-0 rounded-full", h.dot)} aria-hidden />
                          <span className="min-w-0 truncate text-sm font-semibold">{a?.name ?? "Deleted account"}</span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <RolePill role={r.leader ? "leader" : "follower"} />
                          {a && a.health !== "connected" && a.health !== "syncing" ? <span className={cn("font-medium", a.health === "warning" ? "text-[var(--warning)]" : "text-[var(--loss)]")}>{h.label}</span> : <span className="truncate tabular-nums">{money(a?.balance)}</span>}
                        </span>
                      </span>
                      <span className="shrink-0 text-end">
                        {r.net.tickets > 0 ? (
                          <>
                            <span className={cn("block text-sm font-semibold tabular-nums", tone(r.net.openPnl))}>{money(r.net.openPnl ?? 0, true)}</span>
                            <span className="block text-xs text-muted-foreground tabular-nums">
                              {r.net.side === "long" ? "Long" : "Short"} {formatQuantity(r.net.quantity)}
                              {r.net.simulated ? " · sim" : ""}
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">Flat</span>
                        )}
                      </span>
                      {open ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                    </button>
                  </div>
                  {open && (
                    <div className="space-y-2.5 border-t bg-muted/30 px-3 py-3">
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                        {[
                          ["Symbol", r.symbol],
                          ["Side", r.net.side ? (r.net.side === "long" ? "Long" : "Short") : "Flat"],
                          ["Quantity", r.net.tickets ? formatQuantity(r.net.quantity) : "—"],
                          ["Avg. price", price(r.net.avgPrice)],
                          ["Open P&L", r.net.tickets ? money(r.net.openPnl ?? 0, true) : "—"],
                          ["Day P&L", money(a?.dayPnl ?? 0, true)],
                          ["Balance", money(a?.balance)],
                          ["Ratio", r.leader ? "—" : ratioOf(r.follower!.config)],
                          ["Cross", cross(r)],
                          ["Connection", a?.platform ?? "—"],
                        ].map(([k, v]) => (
                          <div key={k} className="flex items-baseline justify-between gap-2">
                            <dt className="text-xs text-muted-foreground">{k}</dt>
                            <dd className="truncate font-medium tabular-nums">{v}</dd>
                          </div>
                        ))}
                      </dl>
                      {r.risk && r.risk.status !== "healthy" && r.follower!.config.enabled && <p className="text-xs text-[var(--warning)]">{r.risk.note}</p>}
                      {cant && <p className="text-xs text-muted-foreground">{cant}</p>}
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" disabled={!r.positions.length || !!cant || pending} className={cn(linkBtn, "h-11 border-[var(--loss)]/50 font-semibold text-[var(--loss)]")} onClick={() => setFlattenOne(r.accountId)}>
                          Flatten
                        </button>
                        <button type="button" className={cn(linkBtn, "h-11")} onClick={() => setManage(r.accountId)}>
                          Manage
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={cn(linkBtn, "h-11 flex-1")} onClick={() => (setRules(group.rules), setDialog("rules"))}>
            <Settings2 className="size-3.5" /> Copy rules
          </button>
          <button type="button" disabled={pending} className={cn(active ? linkBtn : linkBtnPrimary, "h-11 flex-1")} onClick={() => run(() => setCopyGroupActive(group.id, !active), async () => (toast.success(active ? "Copying paused." : "Group activated."), await after()))}>
            <Power className="size-3.5" /> {active ? "Pause" : "Activate"}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------ both: orders, activity, health */}
      <OrderHistory orders={orders} />

      <div className="grid gap-3 lg:grid-cols-2">
        <section aria-label="Live activity" className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Repeat2 className="size-4 text-primary" aria-hidden /> Live Activity
          </h2>
          <div className="mt-1.5">
            <ActivityFeed copies={copies} />
          </div>
        </section>
        <section aria-label="Account health" className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <HeartPulse className="size-4 text-primary" aria-hidden /> Account Health
          </h2>
          <ul className="mt-1.5 divide-y">
            {rows.map((r) => {
              const a = r.account
              const h = a ? HEALTH[a.health] : HEALTH.disconnected
              return (
                <li key={r.accountId}>
                  <button type="button" onClick={() => setManage(r.accountId)} className="flex min-h-12 w-full items-center gap-2.5 py-2 text-start">
                    <PlatformIcon platform={a?.platform ?? ""} className="size-8 rounded-lg text-[10px]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 truncate text-sm font-medium">{a?.name ?? "Deleted account"}</span>
                        <RolePill role={r.leader ? "leader" : "follower"} />
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {money(a?.balance)} · equity {money(a?.equity)}
                        {r.risk && r.follower!.config.enabled && r.risk.status !== "healthy" ? ` · ${r.risk.note}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-end">
                      <Pill tone={h.tone}>{h.label}</Pill>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground tabular-nums">
                        {a?.pingMs != null ? `${a.pingMs}ms · ` : ""}
                        {a?.linked ? ago(a.heartbeatAt) : "not linked"}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      <ContractDialog open={dialog === "contract"} onClose={() => setDialog(null)} group={group} />
      <ChangeLeaderDialog open={dialog === "leader"} onClose={() => setDialog(null)} group={group} />
      <AccountDrawer accountId={manage} onClose={() => setManage(null)} />
      <Sheet open={dialog === "alerts"} onClose={() => setDialog(null)} title="Alerts" description={`What happened in “${group.name}”, why, and what you can do.`}>
        <AlertList events={state.events.filter((e) => e.groupId === group.id)} limit={30} />
      </Sheet>
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

      <ConfirmDialog open={dialog === "disable"} onClose={() => setDialog(null)} title="Disable all followers?" action="Disable all followers" pending={pending} onConfirm={() => run(() => disableAllFollowers(group.id), async () => (toast.success("All followers disabled."), setDialog(null), await after()))}>
        <p>New trades will no longer be copied. Existing positions will remain open.</p>
        <p>“{group.name}” is paused until you switch followers back on and activate it.</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === "cancel"} onClose={() => setDialog(null)} title={`Cancel all pending ${contract ?? ""} orders?`} action="Cancel orders" pending={pending} onConfirm={() => contract && run(() => cancelCopyOrders(group.id, contract), async (res) => (toast.success(res.cancelled ? `${res.cancelled} pending ${contract} ${res.cancelled === 1 ? "order" : "orders"} cancelled.` : `No pending ${contract} orders to cancel.`), setDialog(null), await after()))}>
        <p>
          {contract} copy orders that haven&apos;t reached a broker yet are withdrawn. <span className="font-semibold text-foreground">Open positions are not closed</span>, and orders for other contracts are not touched.
        </p>
        <p>An order already working at a broker can&apos;t be withdrawn from here: cancel it in the Trade Manager or on the broker&apos;s platform.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "flatten"}
        onClose={() => setDialog(null)}
        title="Flatten all positions?"
        action={allClosable > 0 ? `Flatten ${allClosable} ${allClosable === 1 ? "Position" : "Positions"}` : "Nothing to flatten"}
        danger
        pending={pending}
        disabled={allClosable === 0}
        onConfirm={() => run(() => flattenCopyPositions(group.id, null), async (res) => (flattened("")(res), setDialog(null), await after()))}
      >
        <p>
          {allClosable === allOpen ? (
            <>
              This will close all <span className="font-semibold text-foreground">{allOpen}</span> open {allOpen === 1 ? "position" : "positions"} on every account of “{group.name}”, the Leader&apos;s included, in every symbol, at market.
            </>
          ) : (
            <>
              This will close <span className="font-semibold text-foreground">{allClosable}</span> of the {allOpen} open positions on the accounts of “{group.name}”, at market.
            </>
          )}
        </p>
        <ul className="divide-y rounded-lg border text-foreground">
          {everything.map((r) => (
            <li key={r.accountId} className="flex items-baseline justify-between gap-3 px-2.5 py-1.5">
              <span className="min-w-0 truncate font-medium">
                {r.leader && <Crown className="me-1 inline size-3.5 text-amber-500" aria-label="Leader" />}
                {r.account?.name ?? "Deleted account"}
              </span>
              <span className="shrink-0 text-end text-muted-foreground tabular-nums">
                <span className="font-semibold text-foreground">{r.positions.length}</span> · {symbolCounts(r.positions)}
              </span>
            </li>
          ))}
        </ul>
        <p>Pending orders are not cancelled, and the group keeps copying new trades.</p>
        {allBlocked.length > 0 && (
          <div className="rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-2.5 text-foreground">
            <p className="font-medium">Can&apos;t be closed from here:</p>
            <ul className="mt-1 list-disc space-y-0.5 ps-5">
              {allBlocked.map((r) => (
                <li key={r.accountId}>
                  {r.account?.name ?? "An account"}: <span className="text-muted-foreground">{cantClose(r.positions, r.account)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "flattenContract"}
        onClose={() => setDialog(null)}
        title={`Flatten all ${contract ?? ""} positions?`}
        action={closable > 0 ? `Flatten ${closable} ${closable === 1 ? "Position" : "Positions"}` : "Nothing to flatten"}
        danger
        pending={pending}
        disabled={closable === 0}
        onConfirm={() => contract && run(() => flattenCopyPositions(group.id, contract), async (res) => (flattened(contract)(res), setDialog(null), await after()))}
      >
        <p>
          {closable === running ? (
            <>
              This will close all <span className="font-semibold text-foreground">{running}</span> currently open {contract} {running === 1 ? "position" : "positions"} across the active copy group, at market.
            </>
          ) : (
            <>
              This will close <span className="font-semibold text-foreground">{closable}</span> of the {running} currently open {contract} positions across the active copy group, at market.
            </>
          )}
        </p>
        <p>Positions in other contracts are not touched, pending orders are not cancelled, and the group keeps copying.</p>
        {blocked.length > 0 && (
          <div className="rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-2.5 text-foreground">
            <p className="font-medium">Can&apos;t be closed from here:</p>
            <ul className="mt-1 list-disc space-y-0.5 ps-5">
              {blocked.map((r) => (
                <li key={r.accountId}>
                  {r.account?.name ?? "An account"}: <span className="text-muted-foreground">{blocker(r)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={!!one}
        onClose={() => setFlattenOne(null)}
        title={one ? `Flatten ${one.symbol} for ${one.account?.name ?? "this account"}?` : ""}
        action="Flatten"
        danger
        pending={pending}
        onConfirm={() => one && contract && run(() => flattenCopyPositions(group.id, contract, one.accountId), async (res) => (flattened(one.symbol)(res), setFlattenOne(null), await after()))}
      >
        {one && (
          <>
            <p>
              Closes this account&apos;s {one.positions.length === 1 ? `open ${one.symbol} position` : `${one.positions.length} open ${one.symbol} positions`} ({one.net.side === "long" ? "Long" : "Short"} {formatQuantity(one.net.quantity)}) at market.
            </p>
            <p>{one.leader ? "This is the Leader: its followers close their copies of it too." : "Other accounts are not touched, and this account keeps copying new trades."}</p>
          </>
        )}
      </ConfirmDialog>
      <ConfirmDialog open={dialog === "delete"} onClose={() => setDialog(null)} title={`Delete “${group.name}”?`} action="Delete group" danger pending={pending} onConfirm={() => run(() => deleteCopyGroup(group.id), async () => (toast.success("Group deleted."), setDialog(null), router.replace("/copy-trading/cockpit"), await after()))}>
        <p>Its followers, contracts and rules are removed. What it copied stays in the history.</p>
      </ConfirmDialog>
    </>
  )
}
