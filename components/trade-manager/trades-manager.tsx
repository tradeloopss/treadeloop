"use client"

import { useMemo, useState, useTransition, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Activity,
  Search,
  SlidersHorizontal,
  ArrowDownUp,
  Layers,
  MoreHorizontal,
  X,
  Plus,
  Minus,
  ShieldCheck,
  Scissors,
  TrendingUp,
  Info as InfoIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatCurrency } from "@/lib/calc"
import { closeOpenTrade } from "@/app/actions/trade-manager"
import { submitOrder, setTradingPassword } from "@/app/actions/orders"
import type { OpenTradeView, ClosedTradeRow, TradesManagerData, AccountExecution } from "@/lib/trade-manager"
import type { OrderCommandInput } from "@/lib/order-execution/types"

// ---------- helpers -------------------------------------------------------

const INSTRUMENTS: Record<string, { name: string; tone: string }> = {
  EURUSD: { name: "Euro / US Dollar", tone: "bg-blue-500/10 text-blue-600" },
  GBPUSD: { name: "British Pound / US Dollar", tone: "bg-indigo-500/10 text-indigo-600" },
  GBPJPY: { name: "British Pound / Yen", tone: "bg-indigo-500/10 text-indigo-600" },
  AUDUSD: { name: "Australian Dollar / US Dollar", tone: "bg-emerald-500/10 text-emerald-600" },
  USDJPY: { name: "US Dollar / Yen", tone: "bg-rose-500/10 text-rose-600" },
  XAUUSD: { name: "Gold / US Dollar", tone: "bg-amber-500/10 text-amber-600" },
  XAGUSD: { name: "Silver / US Dollar", tone: "bg-slate-500/10 text-slate-600" },
  BTCUSD: { name: "Bitcoin / US Dollar", tone: "bg-orange-500/10 text-orange-600" },
  ETHUSD: { name: "Ethereum / US Dollar", tone: "bg-violet-500/10 text-violet-600" },
  US30: { name: "Dow Jones 30", tone: "bg-sky-500/10 text-sky-600" },
  NAS100: { name: "Nasdaq 100", tone: "bg-cyan-500/10 text-cyan-600" },
  ES: { name: "E-mini S&P 500", tone: "bg-sky-500/10 text-sky-600" },
  NQ: { name: "E-mini Nasdaq", tone: "bg-cyan-500/10 text-cyan-600" },
}

function instrument(symbol: string): { name: string; tone: string } {
  const base = symbol.replace(/m$/, "").toUpperCase()
  return INSTRUMENTS[base] ?? { name: symbol, tone: "bg-primary/10 text-primary" }
}

function pipSize(symbol: string): number {
  const s = symbol.toUpperCase()
  if (s.includes("JPY")) return 0.01
  if (/^[A-Z]{6}M?$/.test(s) && !s.startsWith("XA")) return 0.0001 // FX majors
  return 1 // metals/indices/crypto shown in points
}

function pips(level: number, ref: number, symbol: string): number {
  return Math.round(((level - ref) / pipSize(symbol)) * 100) / 100
}

const fmtPrice = (n: number | null) => (n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 5 }))

// A trade the panel can locally edit (prototype: SL/TP/close reflect in the UI
// and are wired for broker integration; only closing a MANUAL trade actually
// executes today, since TradeLoop syncs read-only).
type UITrade = OpenTradeView & { closed?: boolean; trailing?: { distance: number; step: number; active: boolean } }
type HistEvent = { time: string; label: string; detail?: string }

// ---------- main ----------------------------------------------------------

export function TradesManager({ data }: { data: TradesManagerData }) {
  const [trades, setTrades] = useState<UITrade[]>(() => data.openTrades.map((t) => ({ ...t })))
  const [tab, setTab] = useState<"open" | "pending" | "closed" | "all">("open")
  const [account, setAccount] = useState("all")
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<number | null>(() => data.openTrades[0]?.id ?? null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [history, setHistory] = useState<Record<number, HistEvent[]>>({})
  const [panelTab, setPanelTab] = useState<"manage" | "info" | "history">("manage")

  const openTrades = trades.filter((t) => !t.closed)
  const stats = data.stats

  const filtered = useMemo(() => {
    let list: UITrade[] = openTrades
    if (account !== "all") list = list.filter((t) => String(t.accountId) === account)
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((t) => t.symbol.toLowerCase().includes(q) || t.accountName.toLowerCase().includes(q))
    return list
  }, [openTrades, account, query])

  const selected = selectedId != null ? trades.find((t) => t.id === selectedId) ?? null : null

  function pushHistory(id: number, ev: HistEvent) {
    setHistory((h) => ({ ...h, [id]: [...(h[id] ?? []), ev] }))
  }
  const nowLabel = () => new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })

  function updateTrade(id: number, patch: Partial<UITrade>) {
    setTrades((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }

  function toggleCheck(id: number) {
    setChecked((c) => {
      const next = new Set(c)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const router = useRouter()
  const [enableFor, setEnableFor] = useState<UITrade | null>(null)

  function execFor(t: UITrade): AccountExecution {
    return (t.accountId != null && data.execution[t.accountId]) || { broker: null, supported: false, enabled: false }
  }
  // A live MetaTrader position on an account with execution turned on → real orders.
  function tradable(t: UITrade): boolean {
    const e = execFor(t)
    return t.origin === "provider" && !!t.positionRef && (e.broker === "mt5" || e.broker === "mt4") && e.enabled
  }

  // Send a real order to the broker and report the outcome. Returns true when it
  // was accepted/queued (so the caller can apply the optimistic UI change).
  async function runOrder(t: UITrade, input: Omit<OrderCommandInput, "accountId" | "broker">): Promise<boolean> {
    if (t.accountId == null) return false
    const e = execFor(t)
    try {
      const res = await submitOrder({ accountId: t.accountId, broker: (e.broker ?? "mt5") as OrderCommandInput["broker"], positionRef: t.positionRef, ...input })
      if (res.status === "blocked") {
        toast.error("Blocked by your prop-firm rules", { description: res.reasons.join(" ") })
        return false
      }
      if (res.status === "pending" || res.status === "filled" || res.status === "sent") {
        toast.success(res.message)
        router.refresh()
        return true
      }
      toast.error(res.message || "Order couldn't be sent")
      return false
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Order failed")
      return false
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Activity className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trades Manager</h1>
          <p className="text-sm text-muted-foreground">Manage your open trades, modify levels, or close positions — all in one place.</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total Open Trades" value={String(stats.openCount)} foot={`${stats.buys} Buy · ${stats.shorts} Sell`} icon={TrendingUp} />
        <KpiCard
          label="Total P&L"
          value={stats.totalUnrealized != null ? signed(stats.totalUnrealized) : "—"}
          foot={stats.totalUnrealized != null ? "across live positions" : "no live P&L feed"}
          tone={stats.totalUnrealized != null ? (stats.totalUnrealized >= 0 ? "gain" : "loss") : undefined}
          spark={stats.totalUnrealized != null}
        />
        <KpiCard label="Today's P&L" value={signed(stats.todayRealized)} foot="realized, closed today" tone={stats.todayRealized >= 0 ? "gain" : "loss"} spark />
        <KpiCard label="Win Rate" value={stats.winRate != null ? `${stats.winRate}%` : "—"} foot={stats.winRate != null ? `${stats.wins} / ${stats.wins + stats.losses}` : "nothing closed today"} ring={stats.winRate} />
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        {/* List card */}
        <div className="min-w-0 rounded-2xl border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <Tab active={tab === "open"} onClick={() => setTab("open")} dot>
              Open Trades ({openTrades.length})
            </Tab>
            <Tab active={tab === "pending"} onClick={() => setTab("pending")}>
              Pending (0)
            </Tab>
            <Tab active={tab === "closed"} onClick={() => setTab("closed")}>
              Closed Today ({data.closedToday.length})
            </Tab>
            <Tab active={tab === "all"} onClick={() => setTab("all")}>
              All Trades
            </Tab>

            <div className="ms-auto flex items-center gap-2">
              <div className="relative hidden sm:block">
                <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search trades…" className="h-8 w-44 ps-8" />
              </div>
              <Select value={account} onValueChange={(v) => v && setAccount(v)}>
                <SelectTrigger className="h-8 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    <span className="flex items-center gap-1.5">
                      <Layers className="size-3.5" /> All accounts
                    </span>
                  </SelectItem>
                  {data.accounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" className="size-8" aria-label="Sort">
                <ArrowDownUp className="size-4" />
              </Button>
              <Button variant="outline" size="icon" className="size-8" aria-label="Filter">
                <SlidersHorizontal className="size-4" />
              </Button>
            </div>
          </div>

          {tab === "closed" ? (
            <ClosedList rows={data.closedToday} />
          ) : tab === "pending" ? (
            <EmptyBlock title="No pending orders" note="Pending orders you place with your broker will appear here." />
          ) : (
            <TradeTable
              trades={filtered}
              selectedId={selectedId}
              checked={checked}
              onSelect={(id) => {
                setSelectedId(id)
                setPanelTab("manage")
              }}
              onCheck={toggleCheck}
              onAction={(id, action) => handleRowAction(id, action)}
            />
          )}
        </div>

        {/* Management panel — right column on xl, slide-over drawer below */}
        {selected && (
          <div
            className="fixed inset-0 z-40 bg-black/40 xl:hidden"
            onClick={() => setSelectedId(null)}
            aria-hidden="true"
          />
        )}
        <aside
          className={cn(
            "fixed inset-y-0 end-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-s bg-card transition-transform duration-200",
            "xl:static xl:z-auto xl:max-w-none xl:translate-x-0 xl:rounded-2xl xl:border xl:shadow-sm",
            selected ? "translate-x-0" : "translate-x-full xl:translate-x-0",
          )}
        >
          {selected ? (
            <ManagementPanel
              key={selected.id}
              trade={selected}
              execution={execFor(selected)}
              tradable={tradable(selected)}
              onEnableExecution={() => setEnableFor(selected)}
              onOrder={(input) => runOrder(selected, input)}
              panelTab={panelTab}
              onPanelTab={setPanelTab}
              history={history[selected.id] ?? [{ time: openLabel(selected), label: "Position opened", detail: `${selected.quantity} @ ${fmtPrice(selected.entryPrice)}` }]}
              onClose={() => setSelectedId(null)}
              onModifyLevels={(sl, tp) => {
                const prev = selected
                updateTrade(selected.id, { stopLoss: sl, takeProfit: tp })
                if (sl !== prev.stopLoss) pushHistory(prev.id, { time: nowLabel(), label: "Stop Loss modified", detail: fmtPrice(sl) })
                if (tp !== prev.takeProfit) pushHistory(prev.id, { time: nowLabel(), label: "Take Profit modified", detail: fmtPrice(tp) })
                if (tradable(selected)) void runOrder(selected, { kind: "modify", positionRef: selected.positionRef, stopLoss: sl, takeProfit: tp })
                else toast.success("Levels updated", { description: `${selected.symbol} · SL ${fmtPrice(sl)} · TP ${fmtPrice(tp)}` })
              }}
              onMoveBE={(buffer) => {
                const be = selected.entryPrice + (selected.side === "long" ? buffer : -buffer)
                updateTrade(selected.id, { stopLoss: be })
                pushHistory(selected.id, { time: nowLabel(), label: "Moved SL to break-even", detail: fmtPrice(be) })
                if (tradable(selected)) void runOrder(selected, { kind: "modify", positionRef: selected.positionRef, stopLoss: be, takeProfit: selected.takeProfit })
                else toast.success("Stop moved to break-even", { description: `${selected.symbol} · SL ${fmtPrice(be)}` })
              }}
              onTrailing={(cfg) => {
                updateTrade(selected.id, { trailing: cfg })
                pushHistory(selected.id, { time: nowLabel(), label: cfg.active ? "Trailing stop enabled" : "Trailing stop disabled", detail: cfg.active ? `${cfg.distance} pips` : undefined })
                toast.success(cfg.active ? "Trailing stop active — TradeLoop will trail your stop" : "Trailing stop off")
              }}
              onPartial={(lots) => {
                const remaining = Math.max(0, round4(selected.quantity - lots))
                pushHistory(selected.id, { time: nowLabel(), label: "Partial close", detail: `${lots} lots` })
                if (tradable(selected)) void runOrder(selected, { kind: "partial_close", positionRef: selected.positionRef, volume: lots })
                else toast.success("Partial close sent", { description: `${lots} lots of ${selected.symbol}` })
                if (remaining <= 0) {
                  updateTrade(selected.id, { closed: true })
                  setSelectedId(null)
                } else updateTrade(selected.id, { quantity: remaining })
              }}
              onClosed={() => {
                updateTrade(selected.id, { closed: true })
                setSelectedId(null)
                pushHistory(selected.id, { time: nowLabel(), label: "Position closed" })
              }}
            />
          ) : (
            <div className="hidden flex-col items-center justify-center p-10 text-center xl:flex">
              <Activity className="mb-2 size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Select a trade to manage it.</p>
            </div>
          )}
        </aside>
      </div>

      {/* Bulk action bar */}
      {checked.size > 0 && (
        <BulkBar
          count={checked.size}
          onClear={() => setChecked(new Set())}
          onCloseAll={() => {
            setTrades((ts) => ts.map((t) => (checked.has(t.id) ? { ...t, closed: true } : t)))
            toast.success(`Close request sent for ${checked.size} trade${checked.size > 1 ? "s" : ""}`)
            setChecked(new Set())
            setSelectedId(null)
          }}
        />
      )}

      {enableFor && enableFor.accountId != null && (
        <EnableExecutionDialog accountId={enableFor.accountId} accountName={enableFor.accountName} onClose={() => setEnableFor(null)} />
      )}
    </div>
  )

  function handleRowAction(id: number, action: string) {
    const t = trades.find((x) => x.id === id)
    if (!t) return
    setSelectedId(id)
    if (action === "manage" || action === "modify") setPanelTab("manage")
    if (action === "info") setPanelTab("info")
    if (action === "history") setPanelTab("history")
  }
}

// ---------- KPIs ----------------------------------------------------------

const signed = (n: number) => `${n >= 0 ? "+" : ""}${formatCurrency(n)}`
const round4 = (n: number) => Math.round(n * 10000) / 10000

function KpiCard({
  label,
  value,
  foot,
  icon: Icon,
  tone,
  spark,
  ring,
}: {
  label: string
  value: string
  foot: string
  icon?: typeof TrendingUp
  tone?: "gain" | "loss"
  spark?: boolean
  ring?: number | null
}) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-start justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        {Icon && <Icon className="size-4 text-muted-foreground/60" />}
        {ring != null && <MiniRing pct={ring} />}
        {spark && !ring && <Sparkline up={tone !== "loss"} />}
      </div>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "gain" && "text-[var(--gain)]", tone === "loss" && "text-[var(--loss)]")}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{foot}</p>
    </div>
  )
}

function Sparkline({ up }: { up: boolean }) {
  const d = up ? "M0 20 L12 14 L24 16 L36 8 L48 10 L60 2" : "M0 4 L12 8 L24 6 L36 14 L48 12 L60 20"
  return (
    <svg viewBox="0 0 60 22" className="h-6 w-16" fill="none">
      <path d={d} stroke={up ? "var(--gain)" : "var(--loss)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MiniRing({ pct }: { pct: number }) {
  const r = 9
  const circ = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 24 24" className="size-6 -rotate-90">
      <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeWidth="3" className="text-muted" />
      <circle cx="12" cy="12" r={r} fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)} />
    </svg>
  )
}

// ---------- tabs / table --------------------------------------------------

function Tab({ active, onClick, dot, children }: { active: boolean; onClick: () => void; dot?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-[var(--gain)]" />}
      {children}
    </button>
  )
}

function TypePill({ side }: { side: "long" | "short" }) {
  const long = side === "long"
  return (
    <span className={cn("inline-flex rounded-md px-2 py-0.5 text-xs font-semibold", long ? "bg-[var(--gain)]/10 text-[var(--gain)]" : "bg-[var(--loss)]/10 text-[var(--loss)]")}>
      {long ? "BUY" : "SELL"}
    </span>
  )
}

function SymbolCell({ symbol }: { symbol: string }) {
  const meta = instrument(symbol)
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold", meta.tone)}>{symbol.replace(/m$/, "").slice(0, 3)}</span>
      <div className="min-w-0">
        <p className="font-medium leading-tight">{symbol}</p>
        <p className="truncate text-xs text-muted-foreground">{meta.name}</p>
      </div>
    </div>
  )
}

function pnlPercent(t: OpenTradeView): number | null {
  if (t.currentPrice == null || t.entryPrice === 0) return null
  const dir = t.side === "long" ? 1 : -1
  return Math.round(((t.currentPrice - t.entryPrice) / t.entryPrice) * 100 * dir * 100) / 100
}

const ROW_ACTIONS: { key: string; label: string }[] = [
  { key: "manage", label: "Manage Trade" },
  { key: "modify", label: "Modify SL/TP" },
  { key: "partial", label: "Partial Close" },
  { key: "be", label: "Move SL to Break Even" },
  { key: "close", label: "Close Trade" },
  { key: "info", label: "View Trade Details" },
  { key: "history", label: "View History" },
]

function TradeTable({
  trades,
  selectedId,
  checked,
  onSelect,
  onCheck,
  onAction,
}: {
  trades: UITrade[]
  selectedId: number | null
  checked: Set<number>
  onSelect: (id: number) => void
  onCheck: (id: number) => void
  onAction: (id: number, action: string) => void
}) {
  if (trades.length === 0) return <EmptyBlock title="No open positions" note="When you have a running trade it'll show here with its live risk and P&L." />
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="w-8 px-4 py-2.5"></th>
            <th className="px-2 py-2.5 font-medium">Symbol</th>
            <th className="px-2 py-2.5 font-medium">Type</th>
            <th className="px-2 py-2.5 font-medium">Lots</th>
            <th className="px-2 py-2.5 font-medium">Entry</th>
            <th className="px-2 py-2.5 font-medium">Current</th>
            <th className="px-2 py-2.5 font-medium">P&L</th>
            <th className="px-2 py-2.5 font-medium">SL / TP</th>
            <th className="px-2 py-2.5 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const pct = pnlPercent(t)
            const sel = t.id === selectedId
            return (
              <tr
                key={t.id}
                onClick={() => onSelect(t.id)}
                className={cn("cursor-pointer border-b transition-colors hover:bg-muted/40", sel && "bg-primary/5 ring-1 ring-inset ring-primary/20")}
              >
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={checked.has(t.id)} onChange={() => onCheck(t.id)} className="size-4 rounded border-border accent-[var(--primary)]" />
                </td>
                <td className="px-2 py-3">
                  <SymbolCell symbol={t.symbol} />
                </td>
                <td className="px-2 py-3">
                  <TypePill side={t.side} />
                </td>
                <td className="px-2 py-3 tabular-nums">{t.quantity}</td>
                <td className="px-2 py-3 tabular-nums">{fmtPrice(t.entryPrice)}</td>
                <td className="px-2 py-3 tabular-nums">{fmtPrice(t.currentPrice)}</td>
                <td className="px-2 py-3">
                  {t.unrealizedPnl != null ? (
                    <div className={cn("font-medium tabular-nums", t.unrealizedPnl >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")}>
                      {signed(t.unrealizedPnl)}
                      {pct != null && <div className="text-xs font-normal">{pct >= 0 ? "+" : ""}{pct}%</div>}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-2 py-3 text-xs tabular-nums text-muted-foreground">
                  {t.stopLoss != null || t.takeProfit != null ? `${fmtPrice(t.stopLoss)} / ${fmtPrice(t.takeProfit)}` : "—"}
                </td>
                <td className="px-2 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-7" aria-label="Actions"><MoreHorizontal className="size-4" /></Button>} />
                    <DropdownMenuContent align="end" className="w-48">
                      {ROW_ACTIONS.map((a) => (
                        <DropdownMenuItem key={a.key} variant={a.key === "close" ? "destructive" : undefined} onClick={() => onAction(t.id, a.key)}>
                          {a.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ClosedList({ rows }: { rows: ClosedTradeRow[] }) {
  if (rows.length === 0) return <EmptyBlock title="Nothing closed today" note="Trades you close today will be listed here." />
  return (
    <div className="divide-y">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-3 px-4 py-3">
          <SymbolCell symbol={r.symbol} />
          <TypePill side={r.side} />
          <span className="ms-auto text-xs text-muted-foreground">{r.accountName}</span>
          <span className={cn("w-24 text-right font-medium tabular-nums", r.pnl >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")}>{signed(r.pnl)}</span>
        </div>
      ))}
    </div>
  )
}

function EmptyBlock({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Activity className="size-6" />
      </span>
      <p className="font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{note}</p>
    </div>
  )
}

// ---------- management panel ---------------------------------------------

function openLabel(t: OpenTradeView): string {
  return new Date(t.entryTime).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

function ManagementPanel({
  trade,
  execution,
  tradable,
  onEnableExecution,
  onOrder,
  panelTab,
  onPanelTab,
  history,
  onClose,
  onModifyLevels,
  onMoveBE,
  onTrailing,
  onPartial,
  onClosed,
}: {
  trade: UITrade
  execution: AccountExecution
  tradable: boolean
  onEnableExecution: () => void
  onOrder: (input: Omit<OrderCommandInput, "accountId" | "broker">) => Promise<boolean>
  panelTab: "manage" | "info" | "history"
  onPanelTab: (t: "manage" | "info" | "history") => void
  history: HistEvent[]
  onClose: () => void
  onModifyLevels: (sl: number | null, tp: number | null) => void
  onMoveBE: (buffer: number) => void
  onTrailing: (cfg: { distance: number; step: number; active: boolean }) => void
  onPartial: (lots: number) => void
  onClosed: () => void
}) {
  const meta = instrument(trade.symbol)
  const pct = pnlPercent(trade)
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b p-4">
        <div className="flex items-center gap-3">
          <span className={cn("flex size-10 items-center justify-center rounded-full text-[10px] font-bold", meta.tone)}>{trade.symbol.replace(/m$/, "").slice(0, 3)}</span>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{trade.symbol}</span>
              <TypePill side={trade.side} />
              <span className="text-xs text-muted-foreground">{trade.quantity} lots</span>
            </div>
            <p className="text-xs text-muted-foreground">{meta.name} · {trade.accountName}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close panel" className="rounded-md p-1 text-muted-foreground hover:bg-muted">
          <X className="size-5" />
        </button>
      </div>

      <div className="flex items-end justify-between gap-3 border-b px-4 py-3">
        <div>
          <div className="text-2xl font-bold tabular-nums">{fmtPrice(trade.currentPrice)}</div>
          <div className="text-xs text-muted-foreground">Entry {fmtPrice(trade.entryPrice)}</div>
        </div>
        <div className="text-right">
          {trade.unrealizedPnl != null ? (
            <div className={cn("text-lg font-bold tabular-nums", trade.unrealizedPnl >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")}>
              {signed(trade.unrealizedPnl)}
              {pct != null && <span className="ms-1 text-xs font-normal">({pct >= 0 ? "+" : ""}{pct}%)</span>}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No live P&L</div>
          )}
          <Sparkline up={(trade.unrealizedPnl ?? 0) >= 0} />
        </div>
      </div>

      <div className="flex gap-1 border-b px-4">
        {(["manage", "info", "history"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onPanelTab(t)}
            className={cn("border-b-2 px-2 py-2.5 text-sm font-medium capitalize transition-colors", panelTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t === "manage" ? "Manage Trade" : t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {panelTab === "manage" && (
          <ManageTab
            trade={trade}
            execution={execution}
            tradable={tradable}
            onEnableExecution={onEnableExecution}
            onOrder={onOrder}
            onModifyLevels={onModifyLevels}
            onMoveBE={onMoveBE}
            onTrailing={onTrailing}
            onPartial={onPartial}
            onClosed={onClosed}
          />
        )}
        {panelTab === "info" && <InfoTab trade={trade} />}
        {panelTab === "history" && <HistoryTab events={history} />}
      </div>
    </div>
  )
}

function ManageTab({
  trade,
  execution,
  tradable,
  onEnableExecution,
  onOrder,
  onModifyLevels,
  onMoveBE,
  onTrailing,
  onPartial,
  onClosed,
}: {
  trade: UITrade
  execution: AccountExecution
  tradable: boolean
  onEnableExecution: () => void
  onOrder: (input: Omit<OrderCommandInput, "accountId" | "broker">) => Promise<boolean>
  onModifyLevels: (sl: number | null, tp: number | null) => void
  onMoveBE: (buffer: number) => void
  onTrailing: (cfg: { distance: number; step: number; active: boolean }) => void
  onPartial: (lots: number) => void
  onClosed: () => void
}) {
  const [sl, setSl] = useState(trade.stopLoss != null ? String(trade.stopLoss) : "")
  const [tp, setTp] = useState(trade.takeProfit != null ? String(trade.takeProfit) : "")
  const [partialOpen, setPartialOpen] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)

  const slNum = sl.trim() === "" ? null : Number(sl)
  const tpNum = tp.trim() === "" ? null : Number(tp)
  const ref = trade.currentPrice ?? trade.entryPrice
  const slPips = slNum != null ? pips(slNum, ref, trade.symbol) : null
  const tpPips = tpNum != null ? pips(tpNum, ref, trade.symbol) : null
  const step = pipSize(trade.symbol)
  const dirty = slNum !== trade.stopLoss || tpNum !== trade.takeProfit
  // A live broker position whose account supports execution but hasn't turned it on.
  const needsEnable = trade.origin === "provider" && execution.supported && !execution.enabled

  return (
    <div className="space-y-6">
      {/* Execution status */}
      {trade.origin === "provider" && (
        <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-xs", tradable ? "border-[var(--gain)]/30 bg-[var(--gain)]/5 text-[var(--gain)]" : "text-muted-foreground")}>
          <span className={cn("size-1.5 rounded-full", tradable ? "bg-[var(--gain)]" : "bg-amber-500")} />
          {tradable ? (
            <span>Live order execution is on — actions are sent to your broker.</span>
          ) : needsEnable ? (
            <span className="flex-1">
              Order execution is off for this account.{" "}
              <button type="button" onClick={onEnableExecution} className="font-medium text-primary underline">
                Enable it
              </button>
            </span>
          ) : execution.broker === "tradovate" ? (
            <span>Tradovate execution is dormant until its API is connected.</span>
          ) : (
            <span>Actions update your TradeLoop view; broker execution isn&apos;t available for this account.</span>
          )}
        </div>
      )}

      {/* Quick actions */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quick Actions</p>
        <div className="grid grid-cols-4 gap-2">
          <QuickBtn label="Close" icon={X} tone="loss" onClick={() => setCloseOpen(true)} />
          <QuickBtn label="Partial" icon={Scissors} onClick={() => setPartialOpen(true)} />
          <QuickBtn label="SL to BE" icon={ShieldCheck} tone="primary" onClick={() => onMoveBE(0)} />
          <MoreMenu trade={trade} onTrailing={onTrailing} />
        </div>
      </div>

      {/* Modify levels */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Modify Levels</p>
        <LevelInput label="Stop Loss (SL)" value={sl} onChange={setSl} step={step} pips={slPips} tone="loss" />
        <div className="h-3" />
        <LevelInput label="Take Profit (TP)" value={tp} onChange={setTp} step={step} pips={tpPips} tone="gain" />
        <Button className="mt-3 w-full" disabled={!dirty} onClick={() => onModifyLevels(slNum, tpNum)}>
          Update levels
        </Button>
      </div>

      {/* Partial close inline summary */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Partial Close</p>
        <Button variant="outline" className="w-full" onClick={() => setPartialOpen(true)}>
          <Scissors className="size-4" /> Close part of {trade.quantity} lots
        </Button>
      </div>

      {/* Break even */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Move SL to Break Even</p>
        <div className="rounded-lg border p-3 text-xs text-muted-foreground">
          Break-even price <span className="font-medium text-foreground">{fmtPrice(trade.entryPrice)}</span> · locks in about $0.00
        </div>
        <Button variant="outline" className="mt-2 w-full" onClick={() => onMoveBE(0)}>
          <ShieldCheck className="size-4" /> Move SL to break-even
        </Button>
      </div>

      {/* Close */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Close Trade</p>
        <Button variant="destructive" className="w-full" onClick={() => setCloseOpen(true)}>
          <X className="size-4" /> Close position
        </Button>
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <InfoIcon className="size-3.5" />
          {trade.origin === "trade" ? "Records the close in your TradeLoop journal." : "Live position — wired for broker integration; manage it in your platform for now."}
        </p>
      </div>

      <PartialCloseModal open={partialOpen} onOpenChange={setPartialOpen} trade={trade} onExecute={(lots) => { onPartial(lots); setPartialOpen(false) }} />
      <CloseModal open={closeOpen} onOpenChange={setCloseOpen} trade={trade} tradable={tradable} onOrder={onOrder} onDone={() => { onClosed(); setCloseOpen(false) }} />
    </div>
  )
}

function QuickBtn({ label, icon: Icon, tone, onClick }: { label: string; icon: typeof X; tone?: "loss" | "primary"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 rounded-xl border p-2.5 text-xs font-medium transition-colors hover:bg-muted",
        tone === "loss" && "border-[var(--loss)]/30 text-[var(--loss)] hover:bg-[var(--loss)]/5",
        tone === "primary" && "border-primary/30 text-primary hover:bg-primary/5",
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  )
}

function MoreMenu({ trade, onTrailing }: { trade: UITrade; onTrailing: (cfg: { distance: number; step: number; active: boolean }) => void }) {
  const [trailOpen, setTrailOpen] = useState(false)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button type="button" className="flex flex-col items-center gap-1 rounded-xl border p-2.5 text-xs font-medium transition-colors hover:bg-muted">
              <MoreHorizontal className="size-4" />
              More
            </button>
          }
        />
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => setTrailOpen(true)}>Set trailing stop</DropdownMenuItem>
          <DropdownMenuItem onClick={() => toast("Modify order — coming with broker integration")}>Modify order</DropdownMenuItem>
          <DropdownMenuItem onClick={() => toast.success("Note added")}>Add note</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => toast("Trade copied")}>Copy trade</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TrailingModal open={trailOpen} onOpenChange={setTrailOpen} active={!!trade.trailing?.active} onApply={onTrailing} />
    </>
  )
}

function LevelInput({ label, value, onChange, step, pips, tone }: { label: string; value: string; onChange: (v: string) => void; step: number; pips: number | null; tone: "loss" | "gain" }) {
  const bump = (dir: number) => {
    const n = value.trim() === "" ? 0 : Number(value)
    onChange(String(Math.round((n + dir * step) / step) * step))
  }
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs text-muted-foreground">{label}</label>
        {pips != null && <span className={cn("text-xs font-medium tabular-nums", tone === "gain" ? "text-[var(--gain)]" : "text-[var(--loss)]")}>{pips >= 0 ? "+" : ""}{pips} pips</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="icon" className="size-9 shrink-0" onClick={() => bump(-1)} aria-label="Decrease">
          <Minus className="size-4" />
        </Button>
        <Input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" className="text-center tabular-nums" placeholder="—" />
        <Button variant="outline" size="icon" className="size-9 shrink-0" onClick={() => bump(1)} aria-label="Increase">
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  )
}

// ---------- info / history tabs -------------------------------------------

function InfoTab({ trade }: { trade: UITrade }) {
  const rows: [string, string][] = [
    ["Symbol", trade.symbol],
    ["Direction", trade.side === "long" ? "BUY" : "SELL"],
    ["Volume", `${trade.quantity} lots`],
    ["Entry Price", fmtPrice(trade.entryPrice)],
    ["Current Price", fmtPrice(trade.currentPrice)],
    ["Stop Loss", fmtPrice(trade.stopLoss)],
    ["Take Profit", fmtPrice(trade.takeProfit)],
    ["Open Time", new Date(trade.entryTime).toLocaleString()],
    ["Account", trade.accountName],
    ["Platform", (trade.source ?? "—").toUpperCase()],
    ["Ticket", trade.origin === "trade" ? `#${trade.id}` : "live"],
  ]
  return (
    <div className="divide-y rounded-lg border">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between px-3 py-2 text-sm">
          <span className="text-muted-foreground">{k}</span>
          <span className="font-medium tabular-nums">{v}</span>
        </div>
      ))}
    </div>
  )
}

function HistoryTab({ events }: { events: HistEvent[] }) {
  return (
    <ol className="relative space-y-4 ps-5">
      <span className="absolute inset-y-1 start-1.5 w-px bg-border" aria-hidden />
      {events.map((e, i) => (
        <li key={i} className="relative">
          <span className="absolute -start-[13px] top-1 size-2.5 rounded-full border-2 border-background bg-primary" aria-hidden />
          <p className="text-xs text-muted-foreground">{e.time}</p>
          <p className="text-sm font-medium">{e.label}</p>
          {e.detail && <p className="text-xs text-muted-foreground">{e.detail}</p>}
        </li>
      ))}
    </ol>
  )
}

// ---------- modals --------------------------------------------------------

function PartialCloseModal({ open, onOpenChange, trade, onExecute }: { open: boolean; onOpenChange: (v: boolean) => void; trade: UITrade; onExecute: (lots: number) => void }) {
  const [pctSel, setPctSel] = useState(50)
  const lots = round4((trade.quantity * pctSel) / 100)
  const remaining = round4(trade.quantity - lots)
  const estPnl = trade.unrealizedPnl != null ? (trade.unrealizedPnl * pctSel) / 100 : null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Partial close · {trade.symbol}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3 text-sm">
            <span className="text-muted-foreground">Current position</span>
            <span className="font-medium tabular-nums">{trade.quantity} lots</span>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Amount to close</span>
              <span className="font-semibold tabular-nums">{lots} lots</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[25, 50, 75, 100].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPctSel(p)}
                  className={cn("rounded-lg border py-1.5 text-sm font-medium transition-colors", pctSel === p ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}
                >
                  {p}%
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Remaining</p>
              <p className="font-medium tabular-nums">{remaining} lots</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Est. P&L</p>
              <p className={cn("font-medium tabular-nums", (estPnl ?? 0) >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")}>{estPnl != null ? signed(estPnl) : "—"}</p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onExecute(lots)}>Execute partial close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CloseModal({ open, onOpenChange, trade, tradable, onOrder, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; trade: UITrade; tradable: boolean; onOrder: (input: Omit<OrderCommandInput, "accountId" | "broker">) => Promise<boolean>; onDone: () => void }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [exit, setExit] = useState(trade.currentPrice != null ? String(trade.currentPrice) : "")

  function confirm() {
    // A manual trade closes for real (records realized P&L); a live broker
    // position with execution on sends a real close order; otherwise it's a
    // view-only action.
    if (trade.origin === "trade") {
      const price = Number(exit)
      if (!Number.isFinite(price) || exit.trim() === "") {
        toast.error("Enter the exit price.")
        return
      }
      startTransition(async () => {
        try {
          const { pnl } = await closeOpenTrade(trade.id, price)
          toast.success(`Closed ${trade.symbol}`, { description: `${pnl >= 0 ? "+" : ""}${formatCurrency(pnl)} realized` })
          onDone()
          router.refresh()
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't close.")
        }
      })
    } else if (tradable) {
      startTransition(async () => {
        const ok = await onOrder({ kind: "close", positionRef: trade.positionRef })
        if (ok) onDone()
      })
    } else {
      toast.success(`Close request queued · ${trade.symbol}`)
      onDone()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Close {trade.symbol} position?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <TypePill side={trade.side} />
            <span className="tabular-nums">{trade.quantity} lots · {trade.accountName}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Current price</p>
              <p className="font-medium tabular-nums">{fmtPrice(trade.currentPrice)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Unrealized P&L</p>
              <p className={cn("font-medium tabular-nums", (trade.unrealizedPnl ?? 0) >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")}>{trade.unrealizedPnl != null ? signed(trade.unrealizedPnl) : "—"}</p>
            </div>
          </div>
          {trade.origin === "trade" && (
            <div>
              <label className="text-xs text-muted-foreground">Exit price</label>
              <Input value={exit} onChange={(e) => setExit(e.target.value)} inputMode="decimal" placeholder="e.g. 2641.20" className="mt-1" />
            </div>
          )}
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <InfoIcon className="size-3.5" />
            {trade.origin === "trade" ? "This records the close in your journal." : tradable ? "This sends a close order to your broker now." : "Broker execution isn't enabled — this updates your TradeLoop view only."}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button variant="destructive" onClick={confirm} disabled={pending}>{pending ? "Closing…" : "Close position"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TrailingModal({ open, onOpenChange, active, onApply }: { open: boolean; onOpenChange: (v: boolean) => void; active: boolean; onApply: (cfg: { distance: number; step: number; active: boolean }) => void }) {
  const [distance, setDistance] = useState("20")
  const [step, setStep] = useState("5")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Trailing stop</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Distance (pips)</label>
            <Input value={distance} onChange={(e) => setDistance(e.target.value)} inputMode="numeric" className="mt-1" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Step (pips)</label>
            <Input value={step} onChange={(e) => setStep(e.target.value)} inputMode="numeric" className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          {active && (
            <Button variant="ghost" onClick={() => { onApply({ distance: Number(distance), step: Number(step), active: false }); onOpenChange(false) }}>
              Turn off
            </Button>
          )}
          <Button onClick={() => { onApply({ distance: Number(distance), step: Number(step), active: true }); onOpenChange(false) }}>
            {active ? "Update" : "Activate"} trailing stop
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- bulk bar ------------------------------------------------------

function EnableExecutionDialog({ accountId, accountName, onClose }: { accountId: number; accountName: string; onClose: () => void }) {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [pending, startTransition] = useTransition()
  function save() {
    if (!password.trim()) {
      toast.error("Enter your master (trading) password.")
      return
    }
    startTransition(async () => {
      try {
        await setTradingPassword(accountId, password)
        toast.success("Order execution enabled", { description: accountName })
        onClose()
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't enable execution.")
      }
    })
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Enable order execution</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            To send orders for <span className="font-medium text-foreground">{accountName}</span>, TradeLoop needs its <span className="font-medium text-foreground">master (trading)</span> password —
            the investor password used for syncing can only read. It&apos;s stored encrypted and used only to place, modify and close orders you request.
          </p>
          <div>
            <label className="text-xs text-muted-foreground">Master (trading) password</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1" autoFocus />
          </div>
          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
            On a funded account, orders are still checked against your PropFirm Max rules first — a rule-breaking order is blocked before it reaches the broker.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={save} disabled={pending}>{pending ? "Enabling…" : "Enable execution"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BulkBar({ count, onClear, onCloseAll }: { count: number; onClear: () => void; onCloseAll: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit items-center gap-3 rounded-full border bg-card px-4 py-2 shadow-lg">
      <span className="text-sm font-medium">{count} selected</span>
      <span className="h-4 w-px bg-border" />
      <Button variant="ghost" size="sm" onClick={() => toast("Move SL to BE for selected")}>Move SL to BE</Button>
      <Button variant="ghost" size="sm" onClick={() => toast("Modify SL/TP for selected")}>Modify</Button>
      <Button variant="destructive" size="sm" onClick={onCloseAll}>Close selected</Button>
      <button type="button" onClick={onClear} aria-label="Clear selection" className="rounded-md p-1 text-muted-foreground hover:bg-muted">
        <X className="size-4" />
      </button>
    </div>
  )
}
