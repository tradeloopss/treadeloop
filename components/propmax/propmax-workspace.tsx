"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import Link from "next/link"
import {
  Gauge,
  Plus,
  Search,
  ArrowUpDown,
  LayoutGrid,
  List as ListIcon,
  ShieldCheck,
  TriangleAlert,
  Banknote,
  TrendingUp,
  Layers,
  Bell,
  X,
  ChevronRight,
  RefreshCw,
  ScrollText,
  MoreHorizontal,
  CircleDollarSign,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { PropMaxAccountView } from "@/lib/propmax/account"
import type { CatalogOption, PropMaxAlertView } from "@/lib/propmax/view-types"
import { removePropMaxAccount, acknowledgePropMaxAlert, acknowledgeAllPropMaxAlerts } from "@/app/actions/propmax"
import { PropMaxSetupDialog } from "@/components/propmax/setup-dialog"
import { STATUS_META, ruleLabel, formatMoney, formatSize, timeAgo } from "@/components/propmax/display"

// --- per-account derived data --------------------------------------------

interface Row {
  view: PropMaxAccountView
  balance: number
  equity: number
  pnl: number
  pnlPct: number
  progressPct: number | null // profit-target progress
  status: string // engine risk status
  closest: string | null // closest rule label
  payoutEligible: boolean
}

function toRow(v: PropMaxAccountView): Row {
  const balance = v.metrics?.balance ?? v.brokerBalance ?? v.startingBalance
  const equity = v.metrics?.equity ?? balance
  const pnl = balance - v.startingBalance
  const pnlPct = v.startingBalance > 0 ? (pnl / v.startingBalance) * 100 : 0
  const target = v.evaluation?.rules.find((r) => r.type === "profit_target")
  return {
    view: v,
    balance,
    equity,
    pnl,
    pnlPct,
    progressPct: target?.percentageUsed ?? null,
    status: v.evaluation?.risk.status ?? "unknown",
    closest: v.evaluation?.risk.closest ? ruleLabel(v.evaluation.risk.closest.type) : null,
    payoutEligible: v.evaluation?.payout.eligible ?? false,
  }
}

// The account's headline status label + tone (spec §6).
function statusLabel(r: Row): { label: string; tone: keyof typeof TONE } {
  const s = r.status
  if (s === "breached") return { label: "Breached", tone: "loss" }
  if (s === "critical") return { label: "At Risk", tone: "loss" }
  if (s === "warning") return { label: "Warning", tone: "amber" }
  if (s === "stale") return { label: "Stale", tone: "slate" }
  if (s === "unknown") return { label: "Unverified", tone: "slate" }
  if (r.payoutEligible) return { label: "Payout Eligible", tone: "gain" }
  if (r.view.binding?.phase === "funded") return { label: "Funded", tone: "gain" }
  if (s === "watch") return { label: "On Track", tone: "sky" }
  return { label: "Active", tone: "gain" }
}

const TONE = {
  primary: "bg-primary/10 text-primary",
  gain: "bg-[var(--gain)]/10 text-[var(--gain)]",
  loss: "bg-[var(--loss)]/10 text-[var(--loss)]",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  slate: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
} as const

const DOT = {
  primary: "bg-primary",
  gain: "bg-[var(--gain)]",
  loss: "bg-[var(--loss)]",
  amber: "bg-amber-500",
  sky: "bg-sky-500",
  slate: "bg-slate-400",
} as const

const money = (n: number) => `${n >= 0 ? "+" : ""}${formatMoney(n)}`

// --- main -----------------------------------------------------------------

export function PropMaxWorkspace({
  accounts,
  catalog,
  alerts = [],
}: {
  accounts: PropMaxAccountView[]
  catalog: CatalogOption[]
  alerts?: PropMaxAlertView[]
}) {
  const bound = useMemo(() => accounts.filter((a) => a.binding && a.evaluation).map(toRow), [accounts])
  const unbound = accounts.filter((a) => !a.binding)

  const [query, setQuery] = useState("")
  const [firm, setFirm] = useState("all")
  const [statusF, setStatusF] = useState("all")
  const [marketF, setMarketF] = useState("all")
  const [sort, setSort] = useState("risk")
  const [view, setView] = useState<"list" | "grid">("list")

  const firms = useMemo(() => [...new Set(bound.map((r) => r.view.binding!.firmName).filter((f): f is string => !!f))].sort(), [bound])

  const filtered = useMemo(() => {
    let list = bound
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((r) => `${r.view.name} ${r.view.binding?.firmName ?? ""} ${r.view.binding?.programName ?? ""}`.toLowerCase().includes(q))
    if (firm !== "all") list = list.filter((r) => r.view.binding?.firmName === firm)
    if (marketF !== "all") list = list.filter((r) => r.view.binding?.market === marketF)
    if (statusF !== "all") list = list.filter((r) => statusLabel(r).label === statusF)
    const rank = (r: Row) => ["breached", "critical", "warning", "watch", "stale", "unknown", "safe"].indexOf(r.status)
    list = [...list].sort((a, b) => {
      if (sort === "risk") return rank(a) - rank(b)
      if (sort === "pnl") return b.pnl - a.pnl
      if (sort === "balance") return b.balance - a.balance
      if (sort === "progress") return (b.progressPct ?? 0) - (a.progressPct ?? 0)
      return 0
    })
    return list
  }, [bound, query, firm, marketF, statusF, sort])

  const summary = useMemo(() => {
    const total = bound.length
    const active = bound.filter((r) => r.status !== "breached").length
    const atRisk = bound.filter((r) => r.status === "warning" || r.status === "critical").length
    const payout = bound.filter((r) => r.payoutEligible).length
    const profit = bound.reduce((s, r) => s + r.pnl, 0)
    return { total, active, atRisk, payout, profit }
  }, [bound])

  const activeFilters = [
    firm !== "all" && { key: "firm", label: `Firm: ${firm}`, clear: () => setFirm("all") },
    statusF !== "all" && { key: "status", label: `Status: ${statusF}`, clear: () => setStatusF("all") },
    marketF !== "all" && { key: "market", label: `Market: ${marketF}`, clear: () => setMarketF("all") },
    query.trim() && { key: "q", label: `“${query}”`, clear: () => setQuery("") },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[]

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-widest text-primary">PROP FIRM TRACKER</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Track your prop firm accounts</h1>
          <p className="mt-1 text-sm text-muted-foreground">Monitor your accounts, stay within the rules, and get real-time alerts before you hit a breach.</p>
        </div>
        <Link href="/accounts">
          <Button>
            <Plus className="size-4" /> Add prop account
          </Button>
        </Link>
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <SummaryCard icon={Layers} tone="primary" label="Total Accounts" value={String(summary.total)} />
        <SummaryCard icon={ShieldCheck} tone="gain" label="Active Accounts" value={String(summary.active)} sub={summary.total ? `${Math.round((summary.active / summary.total) * 100)}% of total` : "—"} />
        <SummaryCard icon={TriangleAlert} tone={summary.atRisk ? "amber" : "slate"} label="Accounts At Risk" value={String(summary.atRisk)} sub={summary.total ? `${Math.round((summary.atRisk / summary.total) * 100)}% of total` : "—"} />
        <SummaryCard icon={Banknote} tone={summary.payout ? "gain" : "slate"} label="Payout Eligible" value={String(summary.payout)} sub={summary.total ? `${Math.round((summary.payout / summary.total) * 100)}% of total` : "—"} />
        <SummaryCard icon={TrendingUp} tone={summary.profit >= 0 ? "gain" : "loss"} label="Total Tracked Profit" value={money(summary.profit)} valueTone={summary.profit >= 0 ? "gain" : "loss"} />
      </div>

      {alerts.length > 0 && <div className="mb-6 xl:hidden"><AlertPanel alerts={alerts} /></div>}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
        {/* Main */}
        <div className="min-w-0 space-y-6">
          <section className="rounded-2xl border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Your prop firm accounts</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{filtered.length}</span>
              <div className="ms-auto flex flex-wrap items-center gap-2">
                <div className="relative hidden sm:block">
                  <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search accounts…" className="h-8 w-40 ps-8" />
                </div>
                <FilterSelect value={firm} onChange={setFirm} placeholder="All firms" options={firms} />
                <FilterSelect value={statusF} onChange={setStatusF} placeholder="Any status" options={["Active", "On Track", "Warning", "At Risk", "Breached", "Payout Eligible", "Funded"]} />
                <FilterSelect value={marketF} onChange={setMarketF} placeholder="Any market" options={["futures", "forex"]} />
                <Select value={sort} onValueChange={(v) => v && setSort(v)}>
                  <SelectTrigger className="h-8 w-[132px]">
                    <ArrowUpDown className="size-3.5" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="risk">Sort: Risk</SelectItem>
                    <SelectItem value="pnl">Sort: P&amp;L</SelectItem>
                    <SelectItem value="balance">Sort: Balance</SelectItem>
                    <SelectItem value="progress">Sort: Progress</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center rounded-lg border p-0.5">
                  <button type="button" onClick={() => setView("list")} aria-label="List view" className={cn("rounded-md p-1.5", view === "list" ? "bg-muted text-foreground" : "text-muted-foreground")}>
                    <ListIcon className="size-4" />
                  </button>
                  <button type="button" onClick={() => setView("grid")} aria-label="Grid view" className={cn("rounded-md p-1.5", view === "grid" ? "bg-muted text-foreground" : "text-muted-foreground")}>
                    <LayoutGrid className="size-4" />
                  </button>
                </div>
              </div>
            </div>

            {activeFilters.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
                {activeFilters.map((f) => (
                  <button key={f.key} type="button" onClick={f.clear} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground">
                    {f.label} <X className="size-3" />
                  </button>
                ))}
                <button type="button" onClick={() => { setFirm("all"); setStatusF("all"); setMarketF("all"); setQuery("") }} className="text-xs text-primary hover:underline">
                  Clear all
                </button>
              </div>
            )}

            {bound.length === 0 ? (
              <EmptyState />
            ) : filtered.length === 0 ? (
              <div className="px-6 py-14 text-center text-sm text-muted-foreground">No accounts match these filters.</div>
            ) : view === "grid" ? (
              <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
                {filtered.map((r) => <AccountCard key={r.view.accountId} r={r} />)}
              </div>
            ) : (
              <AccountTable rows={filtered} />
            )}
          </section>

          {unbound.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Not tracked yet</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {unbound.map((a) => <SetupCard key={a.accountId} account={a} catalog={catalog} />)}
              </div>
            </section>
          )}
        </div>

        {/* Right rail */}
        <div className="hidden space-y-4 xl:block">
          <AlertPanel alerts={alerts} />
          <QuickActions />
        </div>
      </div>
    </div>
  )
}

// --- pieces ---------------------------------------------------------------

function SummaryCard({ icon: Icon, tone, label, value, sub, valueTone }: { icon: typeof Layers; tone: keyof typeof TONE; label: string; value: string; sub?: string; valueTone?: "gain" | "loss" }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className={cn("flex size-8 items-center justify-center rounded-lg", TONE[tone])}>
          <Icon className="size-4" />
        </span>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className={cn("text-2xl font-semibold tabular-nums", valueTone === "gain" && "text-[var(--gain)]", valueTone === "loss" && "text-[var(--loss)]")}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function FilterSelect({ value, onChange, placeholder, options }: { value: string; onChange: (v: string) => void; placeholder: string; options: string[] }) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger className="h-8 w-[128px] capitalize">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o} className="capitalize">
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function StatusPill({ r }: { r: Row }) {
  const { label, tone } = statusLabel(r)
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", TONE[tone])}>
      <span className={cn("size-1.5 rounded-full", DOT[tone])} />
      {label}
    </span>
  )
}

function MarketBadge({ market }: { market: string }) {
  return <span className="rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">{market}</span>
}

function FirmMark({ name }: { name: string }) {
  return <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">{name.slice(0, 2).toUpperCase()}</span>
}

function AccountTable({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">Account</th>
            <th className="px-2 py-2.5 font-medium">Status</th>
            <th className="px-2 py-2.5 font-medium">Balance</th>
            <th className="px-2 py-2.5 font-medium">P&amp;L</th>
            <th className="px-2 py-2.5 font-medium">Progress</th>
            <th className="px-2 py-2.5 font-medium">Closest rule</th>
            <th className="px-2 py-2.5 font-medium">Synced</th>
            <th className="px-2 py-2.5 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const b = r.view.binding!
            return (
              <tr key={r.view.accountId} className="border-b transition-colors hover:bg-muted/40">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <FirmMark name={b.firmName ?? r.view.name} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{r.view.name}</span>
                        <MarketBadge market={b.market} />
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {b.firmName ?? "—"} · {b.programName ?? "—"} · {formatSize(b.accountSize)}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-3"><StatusPill r={r} /></td>
                <td className="px-2 py-3 tabular-nums">{formatMoney(r.balance, r.view.currency)}</td>
                <td className={cn("px-2 py-3 tabular-nums font-medium", r.pnl >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")}>
                  {money(r.pnl)}
                  <span className="ms-1 text-xs font-normal">{r.pnlPct >= 0 ? "+" : ""}{r.pnlPct.toFixed(1)}%</span>
                </td>
                <td className="px-2 py-3">
                  {r.progressPct != null ? (
                    <div className="w-24">
                      <div className="mb-0.5 text-xs text-muted-foreground">{Math.round(r.progressPct)}%</div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-[var(--gain)]" style={{ width: `${Math.min(100, r.progressPct)}%` }} />
                      </div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-2 py-3 text-xs text-muted-foreground">{r.closest ?? "—"}</td>
                <td className="px-2 py-3 whitespace-nowrap text-xs text-muted-foreground">{timeAgo(r.view.evaluation?.evaluatedAt)}</td>
                <td className="px-2 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Link href={`/propfirm-max/${r.view.accountId}`}>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs">Open</Button>
                    </Link>
                    <RowMenu accountId={r.view.accountId} name={r.view.name} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function AccountCard({ r }: { r: Row }) {
  const b = r.view.binding!
  return (
    <div className="flex flex-col rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <FirmMark name={b.firmName ?? r.view.name} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium">{r.view.name}</span>
              <MarketBadge market={b.market} />
            </div>
            <p className="truncate text-xs text-muted-foreground">{b.firmName ?? "—"} · {b.programName ?? "—"}</p>
          </div>
        </div>
        <StatusPill r={r} />
      </div>
      <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-3 text-center">
        <div>
          <p className="text-[11px] text-muted-foreground">Balance</p>
          <p className="text-sm font-semibold tabular-nums">{formatMoney(r.balance, r.view.currency)}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">P&amp;L</p>
          <p className={cn("text-sm font-semibold tabular-nums", r.pnl >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")}>{money(r.pnl)}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Progress</p>
          <p className="text-sm font-semibold tabular-nums">{r.progressPct != null ? `${Math.round(r.progressPct)}%` : "—"}</p>
        </div>
      </div>
      {r.closest && r.status !== "safe" && (
        <p className="mt-3 text-xs text-muted-foreground">Closest to breach: <span className="text-foreground">{r.closest}</span></p>
      )}
      <div className="mt-3 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
        <span>Synced {timeAgo(r.view.evaluation?.evaluatedAt)}</span>
        <Link href={`/propfirm-max/${r.view.accountId}`} className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
          Open <ChevronRight className="size-3.5" />
        </Link>
      </div>
    </div>
  )
}

function RowMenu({ accountId, name }: { accountId: number; name: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  function untrack() {
    if (!confirm(`Stop tracking ${name} in PropFirm Max?`)) return
    startTransition(async () => {
      try {
        await removePropMaxAccount(accountId)
        toast.success("Stopped tracking.")
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't remove.")
      }
    })
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-7" aria-label="Account menu"><MoreHorizontal className="size-4" /></Button>} />
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem render={<Link href={`/propfirm-max/${accountId}`} />}>Open account</DropdownMenuItem>
        <DropdownMenuItem render={<Link href={`/propfirm-max/${accountId}?tab=running`} />}>Running trades</DropdownMenuItem>
        <DropdownMenuItem render={<Link href={`/propfirm-max/${accountId}?tab=rules`} />}>View rules</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={untrack} disabled={pending}>Stop tracking</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AlertPanel({ alerts }: { alerts: PropMaxAlertView[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const act = (fn: () => Promise<void>) =>
    startTransition(async () => {
      try {
        await fn()
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't update.")
      }
    })
  return (
    <div className="rounded-2xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bell className="size-4 text-amber-500" /> Prop Firm Alerts
          {alerts.length > 0 && <span className="rounded-full bg-amber-500/15 px-1.5 text-xs font-semibold text-amber-600 tabular-nums dark:text-amber-400">{alerts.length}</span>}
        </div>
        {alerts.length > 0 && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => act(() => acknowledgeAllPropMaxAlerts())} disabled={pending}>
            Clear
          </Button>
        )}
      </div>
      {alerts.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-muted-foreground">No alerts — every account is within its rules.</div>
      ) : (
        <ul className="divide-y">
          {alerts.slice(0, 8).map((a) => {
            const meta = STATUS_META[a.status as keyof typeof STATUS_META] ?? STATUS_META.unknown
            return (
              <li key={a.id} className="flex items-start gap-2.5 px-4 py-3">
                <span className={cn("mt-1 inline-block size-2 shrink-0 rounded-full", meta.dot)} />
                <div className="min-w-0 flex-1">
                  {a.accountId != null ? (
                    <Link href={`/propfirm-max/${a.accountId}`} className="text-sm font-medium hover:underline">{a.title}</Link>
                  ) : (
                    <p className="text-sm font-medium">{a.title}</p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">{a.body}</p>
                  <p className="text-xs text-muted-foreground">{timeAgo(a.createdAt)}</p>
                </div>
                <button type="button" onClick={() => act(() => acknowledgePropMaxAlert(a.id))} disabled={pending} aria-label="Dismiss" className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted">
                  <X className="size-3.5" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function QuickActions() {
  const router = useRouter()
  const items = [
    { icon: Plus, label: "Add prop account", href: "/accounts" },
    { icon: RefreshCw, label: "Sync all accounts", onClick: () => { router.refresh(); toast.success("Refreshed") } },
    { icon: ScrollText, label: "Prop firm rules", href: "/admin/prop-rules" },
    { icon: CircleDollarSign, label: "Payouts", href: "/payouts" },
  ]
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="mb-3 text-sm font-semibold">Quick actions</p>
      <div className="space-y-1">
        {items.map((it) =>
          it.href ? (
            <Link key={it.label} href={it.href} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <it.icon className="size-4" /> {it.label}
            </Link>
          ) : (
            <button key={it.label} type="button" onClick={it.onClick} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <it.icon className="size-4" /> {it.label}
            </button>
          ),
        )}
      </div>
    </div>
  )
}

function SetupCard({ account, catalog }: { account: PropMaxAccountView; catalog: CatalogOption[] }) {
  const d = account.detection
  return (
    <div className="flex flex-col rounded-xl border border-dashed bg-card/50 p-4">
      <h3 className="truncate font-medium">{account.name}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {formatMoney(account.startingBalance, account.currency)}
        {account.broker ? ` · ${account.broker}` : ""}
      </p>
      {d?.reason && <p className="mt-2 flex-1 text-xs text-muted-foreground">{d.reason}</p>}
      <PropMaxSetupDialog
        accountId={account.accountId}
        accountName={account.name}
        catalog={catalog}
        detection={d}
        trigger={
          <Button size="sm" variant="outline" className="mt-3 w-full">
            <Plus className="size-4" /> Set up tracking
          </Button>
        }
      />
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Gauge className="size-6" />
      </span>
      <h2 className="text-lg font-medium">No prop firm accounts yet</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">Connect your first account to start tracking rules, risk, and payouts automatically.</p>
      <Link href="/accounts" className="mt-4">
        <Button variant="outline" size="sm"><Plus className="size-4" /> Add prop account</Button>
      </Link>
    </div>
  )
}
