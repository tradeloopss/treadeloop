"use client"

import { Fragment, useEffect, useMemo, useState, useTransition, type ReactNode } from "react"
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
  Shield,
  Scissors,
  Target,
  Repeat2,
  Pencil,
  ChevronDown,
  UserRound,
  Zap,
  TrendingUp,
  CandlestickChart,
  FileText,
  Clock,
  LayoutGrid,
  RefreshCw,
  Check,
  CircleCheck,
  List,
  Info as InfoIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { formatCurrency } from "@/lib/calc"
import { closeOpenTrade } from "@/app/actions/trade-manager"
import { submitOrder, setTradingPassword, getOrderStatus, getOrderStatuses } from "@/app/actions/orders"
import type { OpenTradeView, ClosedTradeRow, TradesManagerData, AccountExecution } from "@/lib/trade-manager"
import type { OrderCommandInput, OrderStatus } from "@/lib/order-execution/types"

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
  MNQ: { name: "Micro E-mini Nasdaq", tone: "bg-primary/10 text-primary" },
  MES: { name: "Micro E-mini S&P", tone: "bg-primary/10 text-primary" },
}

function instrument(symbol: string): { name: string; tone: string } {
  const base = symbol.replace(/m$/, "").toUpperCase()
  // Futures carry a month/year code (MNQZ6) — strip it for the lookup + badge.
  const root = base.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, "")
  return INSTRUMENTS[root] ?? INSTRUMENTS[base] ?? { name: symbol, tone: "bg-primary/10 text-primary" }
}

function badgeText(symbol: string): string {
  const base = symbol.replace(/m$/, "").toUpperCase().replace(/[FGHJKMNQUVXZ]\d{1,2}$/, "")
  return base.slice(0, 3) || symbol.slice(0, 3)
}

function pipSize(symbol: string): number {
  const s = symbol.toUpperCase()
  if (s.includes("JPY")) return 0.01
  if (/^[A-Z]{6}M?$/.test(s) && !s.startsWith("XA")) return 0.0001 // FX majors
  return 0.25 // futures/indices tick — display in points
}

function pips(level: number, ref: number, symbol: string): number {
  return Math.round(((level - ref) / pipSize(symbol)) * 100) / 100
}

const fmtPrice = (n: number | null) => (n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 5 }))
const signed = (n: number) => `${n >= 0 ? "+" : ""}${formatCurrency(n)}`
const round4 = (n: number) => Math.round(n * 10000) / 10000

function pnlPercent(t: OpenTradeView): number | null {
  if (t.currentPrice == null || t.entryPrice === 0) return null
  const dir = t.side === "long" ? 1 : -1
  return Math.round(((t.currentPrice - t.entryPrice) / t.entryPrice) * 100 * dir * 100) / 100
}

// Favourable points — sign matches the trade's P&L (a short in profit shows +).
function favPoints(t: OpenTradeView): number | null {
  if (t.currentPrice == null) return null
  const dir = t.side === "long" ? 1 : -1
  return Math.round((((t.currentPrice - t.entryPrice) * dir) / pipSize(t.symbol)) * 100) / 100
}

type UITrade = OpenTradeView & { closed?: boolean; trailing?: { distance: number; step: number; active: boolean } }
type HistEvent = { time: string; label: string; detail?: string }
type EditorKind = "sl" | "tp" | "partial" | "close" | "reverse" | "bulk" | "trailing"
type Editor = { kind: EditorKind; tradeId?: number }

// ==========================================================================
// A panel that is a bottom sheet on mobile and a right-side drawer on desktop.
// ==========================================================================
function Sheet({ open, onClose, title, subtitle, children, footer }: { open: boolean; onClose: () => void; title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 animate-in fade-in" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "fixed z-50 flex flex-col bg-card shadow-xl",
          // Mobile: bottom sheet
          "inset-x-0 bottom-0 max-h-[88vh] rounded-t-3xl border-t animate-in fade-in slide-in-from-bottom-4 duration-200",
          // Desktop: right drawer
          "lg:inset-y-0 lg:end-0 lg:bottom-auto lg:h-full lg:w-[420px] lg:max-h-none lg:rounded-none lg:rounded-s-2xl lg:border-t-0 lg:border-s",
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border lg:hidden" />
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-3 lg:pt-5">
          <div>
            <h2 className="text-lg font-bold tracking-tight">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="flex gap-2 border-t px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:pb-3">{footer}</div>}
      </div>
    </>
  )
}

function TypePill({ side, size = "sm" }: { side: "long" | "short"; size?: "sm" | "xs" }) {
  const long = side === "long"
  return (
    <span className={cn("inline-flex items-center rounded-md font-semibold uppercase", size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs", long ? "bg-[var(--gain)]/12 text-[var(--gain)]" : "bg-[var(--loss)]/12 text-[var(--loss)]")}>
      {long ? "BUY" : "SELL"}
    </span>
  )
}

function SymbolBadge({ symbol, className }: { symbol: string; className?: string }) {
  const meta = instrument(symbol)
  return <span className={cn("flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold", meta.tone, className)}>{badgeText(symbol)}</span>
}

function Pnl({ value, className }: { value: number | null; className?: string }) {
  if (value == null) return <span className={cn("text-muted-foreground", className)}>—</span>
  return <span className={cn("tabular-nums", value >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]", className)}>{signed(value)}</span>
}

// ==========================================================================
// Main
// ==========================================================================
export function TradesManager({ data }: { data: TradesManagerData }) {
  const router = useRouter()
  const [trades, setTrades] = useState<UITrade[]>(() => data.openTrades.map((t) => ({ ...t })))
  const [tab, setTab] = useState<"open" | "pending" | "closed" | "all">("open")
  const [account, setAccount] = useState<string>("all")
  const [query, setQuery] = useState("")
  const [side, setSide] = useState<"all" | "long" | "short">("all")
  const [sortDesc, setSortDesc] = useState(true)
  const [expandedId, setExpandedId] = useState<number | null>(() => data.openTrades[0]?.id ?? null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [history, setHistory] = useState<Record<number, HistEvent[]>>({})
  const [editor, setEditor] = useState<Editor | null>(null)
  const [bulkCloseOpen, setBulkCloseOpen] = useState(false)
  const [enableFor, setEnableFor] = useState<UITrade | null>(null)

  const openTrades = trades.filter((t) => !t.closed)
  const stats = data.stats
  const totalCount = stats.openCount + data.closedToday.length
  const live = data.openTrades.some((t) => t.origin === "provider")

  const filtered = useMemo(() => {
    let list = openTrades
    if (account !== "all") list = list.filter((t) => String(t.accountId) === account)
    if (side !== "all") list = list.filter((t) => t.side === side)
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((t) => t.symbol.toLowerCase().includes(q) || t.accountName.toLowerCase().includes(q))
    return [...list].sort((a, b) => ((b.unrealizedPnl ?? 0) - (a.unrealizedPnl ?? 0)) * (sortDesc ? 1 : -1))
  }, [openTrades, account, side, query, sortDesc])

  const accountLabel = account === "all" ? "All accounts" : data.accounts.find((a) => String(a.id) === account)?.name ?? "All accounts"
  const editorTrade = editor?.tradeId != null ? trades.find((t) => t.id === editor.tradeId) ?? null : null
  const checkedTrades = trades.filter((t) => checked.has(t.id) && !t.closed)

  // --- small state helpers -------------------------------------------------
  const nowLabel = () => new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  function pushHistory(id: number, ev: HistEvent) {
    setHistory((h) => ({ ...h, [id]: [...(h[id] ?? []), ev] }))
  }
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
  function toggleAll() {
    setChecked((c) => (c.size === filtered.length ? new Set() : new Set(filtered.map((t) => t.id))))
  }

  // --- execution capability ------------------------------------------------
  function execFor(t: UITrade): AccountExecution {
    return (t.accountId != null && data.execution[t.accountId]) || { broker: null, supported: false, enabled: false }
  }
  function tradable(t: UITrade): boolean {
    const e = execFor(t)
    if (e.broker === "mt5" || e.broker === "mt4") return t.origin === "provider" && !!t.positionRef && e.enabled
    if (e.broker === "rithmic") return t.origin === "provider" && e.enabled
    return false
  }
  // A live broker position whose account CAN execute but hasn't had its
  // master/trading password stored yet — orders can't be sent until it's on.
  function accountNeedsEnable(t: UITrade): boolean {
    const e = execFor(t)
    return t.origin === "provider" && e.supported && !e.enabled
  }
  // Prompt to enable execution when acting on a not-yet-enabled account. Returns
  // true when it prompted (so the caller stops — nothing was sent).
  function guardEnable(list: UITrade[]): boolean {
    const t = list.find(accountNeedsEnable)
    if (t) {
      setEditor(null)
      setEnableFor(t)
      return true
    }
    return false
  }

  // --- order plumbing (preserved) -----------------------------------------
  async function queueOrder(t: UITrade, input: Omit<OrderCommandInput, "accountId" | "broker">): Promise<{ id: number | null; status: OrderStatus; message: string; reasons: string[] } | null> {
    if (t.accountId == null) return null
    const e = execFor(t)
    const broker = (e.broker ?? "mt5") as OrderCommandInput["broker"]
    const brokerFields: Partial<OrderCommandInput> =
      broker === "rithmic"
        ? {
            positionRef: null,
            symbol: t.exchange ? `${t.symbol}@${t.exchange}` : t.symbol,
            ...(input.kind === "partial_close" ? { side: t.side === "long" ? "short" : "long" } : {}),
          }
        : { positionRef: t.positionRef }
    try {
      return await submitOrder({ accountId: t.accountId, broker, ...brokerFields, ...input })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Order failed")
      return null
    }
  }

  async function confirmOrder(id: number, timeoutMs = 8_000): Promise<{ status: OrderStatus; message: string | null }> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 700))
      const s = await getOrderStatus(id)
      if (s && s.status !== "pending") return s
    }
    return { status: "pending", message: null }
  }

  async function confirmOrders(ids: number[], timeoutMs = 8_000): Promise<Record<number, OrderStatus>> {
    const out: Record<number, OrderStatus> = {}
    const deadline = Date.now() + timeoutMs
    let remaining = [...ids]
    while (remaining.length > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 800))
      const statuses = await getOrderStatuses(remaining)
      remaining = remaining.filter((id) => {
        const st = statuses[id]?.status
        if (st && st !== "pending") {
          out[id] = st
          return false
        }
        return true
      })
    }
    for (const id of remaining) out[id] = "pending"
    return out
  }

  async function runOrder(t: UITrade, input: Omit<OrderCommandInput, "accountId" | "broker">): Promise<boolean> {
    const res = await queueOrder(t, input)
    if (!res) return false
    if (res.status === "blocked") {
      toast.error("Blocked by your prop-firm rules", { description: res.reasons.join(" ") })
      return false
    }
    if (res.status === "filled" || res.status === "sent") {
      toast.success(res.message)
      router.refresh()
      return true
    }
    if (res.status === "pending" && res.id != null) {
      const toastId = toast.loading(`Sending to your broker · ${t.symbol}…`)
      const final = await confirmOrder(res.id)
      router.refresh()
      if (final.status === "filled") {
        toast.success("Order executed", { id: toastId, description: t.symbol })
        return true
      }
      if (final.status === "pending") {
        toast.message("Order still working", { id: toastId, description: "Your broker hasn't confirmed yet — it'll apply shortly." })
        return true
      }
      toast.error("Order didn't go through", { id: toastId, description: final.message ?? "Your broker rejected it — try again." })
      return false
    }
    toast.error(res.message || "Order couldn't be sent")
    return false
  }

  // Run one action across a group of positions — queue live orders in parallel,
  // handle manual/view-only inline, wait for outcomes, report a real summary.
  async function runGroup(group: UITrade[], verb: "Closing" | "Moving" | "Updating", label: string, build: (t: UITrade) => Omit<OrderCommandInput, "accountId" | "broker">, optimistic: (t: UITrade) => void) {
    if (group.length === 0) return
    const past = verb === "Closing" ? "Closed" : verb === "Moving" ? "Moved" : "Updated"
    const toastId = toast.loading(`${verb} ${group.length} ${label}…`)
    let done = 0
    let failed = 0
    const toQueue: UITrade[] = []
    for (const t of group) {
      optimistic(t)
      if (tradable(t)) toQueue.push(t)
      else if (verb === "Closing" && t.origin === "trade" && t.currentPrice != null) {
        try {
          await closeOpenTrade(t.id, t.currentPrice)
          done++
        } catch {
          failed++
        }
      } else done++
    }
    const submitted = await Promise.all(toQueue.map((t) => queueOrder(t, build(t))))
    const queued: number[] = []
    for (const res of submitted) {
      if (res?.status === "pending" && res.id != null) queued.push(res.id)
      else if (res?.status === "filled") done++
      else failed++
    }
    if (queued.length) {
      const results = await confirmOrders(queued)
      for (const id of queued) {
        const st = results[id]
        if (st === "filled" || st === "pending") done++
        else failed++
      }
    }
    router.refresh()
    if (failed > 0) toast.error(`${past} ${done}/${group.length} — ${failed} didn't go through`, { id: toastId })
    else toast.success(`${past} ${done} position${done === 1 ? "" : "s"}`, { id: toastId })
  }

  // --- per-trade actions ---------------------------------------------------
  function applyLevels(t: UITrade, sl: number | null, tp: number | null) {
    if (guardEnable([t])) return
    updateTrade(t.id, { stopLoss: sl, takeProfit: tp })
    if (sl !== t.stopLoss) pushHistory(t.id, { time: nowLabel(), label: "Stop Loss modified", detail: fmtPrice(sl) })
    if (tp !== t.takeProfit) pushHistory(t.id, { time: nowLabel(), label: "Take Profit modified", detail: fmtPrice(tp) })
    if (tradable(t)) void runOrder(t, { kind: "modify", positionRef: t.positionRef, stopLoss: sl, takeProfit: tp })
    else toast.success("Levels updated", { description: `${t.symbol} · SL ${fmtPrice(sl)} · TP ${fmtPrice(tp)}` })
  }
  function moveBE(t: UITrade) {
    if (guardEnable([t])) return
    updateTrade(t.id, { stopLoss: t.entryPrice })
    pushHistory(t.id, { time: nowLabel(), label: "Moved SL to break-even", detail: fmtPrice(t.entryPrice) })
    if (tradable(t)) void runOrder(t, { kind: "modify", positionRef: t.positionRef, stopLoss: t.entryPrice, takeProfit: t.takeProfit })
    else toast.success("Stop moved to break-even", { description: `${t.symbol} · SL ${fmtPrice(t.entryPrice)}` })
  }
  function doPartial(t: UITrade, lots: number) {
    if (guardEnable([t])) return
    const remaining = Math.max(0, round4(t.quantity - lots))
    pushHistory(t.id, { time: nowLabel(), label: "Partial close", detail: `${lots} lots` })
    if (tradable(t)) void runOrder(t, { kind: "partial_close", positionRef: t.positionRef, volume: lots })
    else toast.success("Partial close sent", { description: `${lots} of ${t.symbol}` })
    if (remaining <= 0) {
      updateTrade(t.id, { closed: true })
      if (expandedId === t.id) setExpandedId(null)
    } else updateTrade(t.id, { quantity: remaining })
  }
  async function doClose(t: UITrade, exitPrice?: number): Promise<boolean> {
    if (guardEnable([t])) return false
    if (t.origin === "trade") {
      const price = exitPrice ?? t.currentPrice
      if (price == null || !Number.isFinite(price)) {
        toast.error("Enter the exit price.")
        return false
      }
      try {
        const { pnl } = await closeOpenTrade(t.id, price)
        toast.success(`Closed ${t.symbol}`, { description: `${pnl >= 0 ? "+" : ""}${formatCurrency(pnl)} realized` })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't close.")
        return false
      }
    } else if (tradable(t)) {
      const ok = await runOrder(t, { kind: "close", positionRef: t.positionRef })
      if (!ok) return false
    } else {
      toast.success(`Close request queued · ${t.symbol}`)
    }
    updateTrade(t.id, { closed: true })
    if (expandedId === t.id) setExpandedId(null)
    pushHistory(t.id, { time: nowLabel(), label: "Position closed" })
    router.refresh()
    return true
  }
  async function reverseTrade(t: UITrade) {
    if (guardEnable([t])) return
    const opp = t.side === "long" ? "short" : "long"
    if (tradable(t)) {
      const closed = await runOrder(t, { kind: "close", positionRef: t.positionRef })
      if (!closed) return
      await runOrder(t, { kind: "place", symbol: t.symbol, side: opp, volume: t.quantity, orderType: "market" })
    } else {
      updateTrade(t.id, { side: opp })
      toast.success("Position reversed", { description: `${t.symbol} is now ${opp === "long" ? "BUY" : "SELL"}` })
    }
    pushHistory(t.id, { time: nowLabel(), label: "Position reversed", detail: `${t.side === "long" ? "BUY" : "SELL"} → ${opp === "long" ? "BUY" : "SELL"}` })
  }

  // --- bulk across the selection ------------------------------------------
  function bulkModify(sl: number | null, tp: number | null) {
    if (guardEnable(checkedTrades)) return
    setEditor(null)
    void runGroup(
      checkedTrades,
      "Updating",
      `selected position${checkedTrades.length === 1 ? "" : "s"}`,
      (t) => ({ kind: "modify", positionRef: t.positionRef, stopLoss: sl ?? t.stopLoss, takeProfit: tp ?? t.takeProfit }),
      (t) => updateTrade(t.id, { stopLoss: sl ?? t.stopLoss, takeProfit: tp ?? t.takeProfit }),
    ).then(() => setChecked(new Set()))
  }
  function bulkClose() {
    if (guardEnable(checkedTrades)) {
      setBulkCloseOpen(false)
      return
    }
    setBulkCloseOpen(false)
    const group = checkedTrades
    void runGroup(
      group,
      "Closing",
      `selected position${group.length === 1 ? "" : "s"}`,
      (t) => ({ kind: "close", positionRef: t.positionRef }),
      (t) => updateTrade(t.id, { closed: true }),
    ).then(() => {
      setChecked(new Set())
      setExpandedId(null)
    })
  }

  // --- instrument bulk (preserved, via runGroup) ---------------------------
  function instrumentGroup(symbol: string): UITrade[] {
    return filtered.filter((t) => t.symbol === symbol && !t.closed)
  }
  function onInstrument(symbol: string, action: "closeAll" | "beAll" | "levelsAll") {
    const group = instrumentGroup(symbol)
    if (action !== "levelsAll" && guardEnable(group)) return
    if (action === "closeAll") {
      void runGroup(group, "Closing", `${symbol} position${group.length === 1 ? "" : "s"}`, (t) => ({ kind: "close", positionRef: t.positionRef }), (t) => updateTrade(t.id, { closed: true }))
    } else if (action === "beAll") {
      void runGroup(group, "Moving", `${symbol} to break-even`, (t) => ({ kind: "modify", positionRef: t.positionRef, stopLoss: t.entryPrice, takeProfit: t.takeProfit }), (t) => updateTrade(t.id, { stopLoss: t.entryPrice }))
    } else {
      // reuse the selection: check the group and open the bulk sheet
      setChecked(new Set(group.map((t) => t.id)))
      setEditor({ kind: "bulk" })
    }
  }

  function onTrailing(t: UITrade, cfg: { distance: number; step: number; active: boolean }) {
    updateTrade(t.id, { trailing: cfg })
    toast.success(cfg.active ? "Trailing stop active — TradeLoop will trail your stop" : "Trailing stop off")
  }

  const tabs = (
    <TabBar tab={tab} onTab={setTab} counts={{ open: openTrades.length, pending: 0, closed: data.closedToday.length }} />
  )

  return (
    <div className="pb-24 lg:pb-6">
      {/* ============================ MOBILE ============================ */}
      <div className="px-4 pt-4 lg:hidden">
        <div className="mb-3 flex items-center justify-end">
          <ConnectionStatus live={live} />
        </div>
        <AccountSelectorCard label={accountLabel} accounts={data.accounts} onPick={setAccount} />
        <div className="mb-4 mt-4 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Activity className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Trades Manager</h1>
            <p className="text-sm text-muted-foreground">Manage live positions, edit SL/TP, and close trades.</p>
          </div>
        </div>

        <SummaryCard open={stats.openCount} total={totalCount} today={stats.todayRealized} winRate={stats.winRate} totalPnl={stats.totalUnrealized} />

        <div className="mb-3 mt-4 -mx-4 overflow-x-auto px-4">{tabs}</div>

        {tab === "open" || tab === "all" ? (
          <>
            <BulkActionBar
              total={filtered.length}
              count={checked.size}
              allChecked={filtered.length > 0 && checked.size === filtered.length}
              onToggleAll={toggleAll}
              onEditSL={() => {
                if (checked.size === 0) setChecked(new Set(filtered.map((t) => t.id)))
                setEditor({ kind: "bulk" })
              }}
              onEditTP={() => {
                if (checked.size === 0) setChecked(new Set(filtered.map((t) => t.id)))
                setEditor({ kind: "bulk" })
              }}
              onClose={() => {
                if (checked.size === 0) setChecked(new Set(filtered.map((t) => t.id)))
                setBulkCloseOpen(true)
              }}
            />
            {filtered.length === 0 ? (
              <EmptyBlock title="No open trades" note="You currently have no live positions." className="mt-3" />
            ) : (
              <div className="mt-3 space-y-3">
                {filtered.map((t) => (
                  <TradeCard
                    key={t.id}
                    trade={t}
                    expanded={expandedId === t.id}
                    checked={checked.has(t.id)}
                    onToggleExpand={() => setExpandedId((id) => (id === t.id ? null : t.id))}
                    onCheck={() => toggleCheck(t.id)}
                    onEditSL={() => setEditor({ kind: "sl", tradeId: t.id })}
                    onEditTP={() => setEditor({ kind: "tp", tradeId: t.id })}
                    onClose={() => setEditor({ kind: "close", tradeId: t.id })}
                    onPartial={() => setEditor({ kind: "partial", tradeId: t.id })}
                    onReverse={() => setEditor({ kind: "reverse", tradeId: t.id })}
                    onBE={() => moveBE(t)}
                    onTrailing={() => setEditor({ kind: "trailing", tradeId: t.id })}
                    onEnable={accountNeedsEnable(t) ? () => setEnableFor(t) : undefined}
                  />
                ))}
              </div>
            )}
            <LiveBanner live={live} className="mt-4" />
          </>
        ) : tab === "pending" ? (
          <EmptyBlock title="No Pending Orders" note="No orders are currently waiting. Pending orders you place will appear here." className="mt-3" />
        ) : (
          <div className="mt-3 rounded-2xl border bg-card">
            <ClosedList rows={data.closedToday} />
          </div>
        )}
      </div>

      {/* ============================ DESKTOP =========================== */}
      <div className="mx-auto hidden w-full max-w-[1500px] px-6 py-6 lg:block">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Activity className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Trades Manager</h1>
            <p className="text-sm text-muted-foreground">Manage live positions, edit SL/TP, and close trades.</p>
          </div>
          <div className="ms-auto flex items-center gap-3">
            <ConnectionStatus live={live} />
            <AccountSelectorInline label={accountLabel} accounts={data.accounts} onPick={setAccount} />
            <Button variant="outline" size="icon" className="size-9" aria-label="Refresh" onClick={() => router.refresh()}>
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-4 gap-3">
          <KpiCard label="Open Trades" value={String(stats.openCount)} foot={`of ${totalCount} total`} icon={Layers} />
          <KpiCard label="Today's P&L" value={signed(stats.todayRealized)} foot="realized, closed today" tone={stats.todayRealized >= 0 ? "gain" : "loss"} />
          <KpiCard label="Win Rate" value={stats.winRate != null ? `${stats.winRate}%` : "—"} foot={stats.winRate != null ? `${stats.wins}/${stats.wins + stats.losses}` : "nothing closed today"} icon={Target} />
          <KpiCard label="Total P&L" value={stats.totalUnrealized != null ? signed(stats.totalUnrealized) : signed(stats.todayRealized)} foot="across live positions" tone={(stats.totalUnrealized ?? stats.todayRealized) >= 0 ? "gain" : "loss"} icon={TrendingUp} />
        </div>

        <div className="rounded-2xl border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            {tabs}
            <div className="ms-auto flex items-center gap-2">
              <div className="relative hidden sm:block">
                <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search trades…" className="h-9 w-48 ps-8" />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="h-9 gap-1.5"><SlidersHorizontal className="size-4" /> {side === "all" ? "Filter" : side === "long" ? "Buys" : "Sells"}</Button>} />
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={() => setSide("all")}>All sides</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSide("long")}>Buy only</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSide("short")}>Sell only</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="icon" className="size-9" aria-label="Sort by P&L" onClick={() => setSortDesc((s) => !s)}>
                <ArrowDownUp className="size-4" />
              </Button>
            </div>
          </div>

          {(tab === "open" || tab === "all") && checked.size > 0 && (
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-primary/5 px-4 py-2.5">
              <span className="text-sm font-semibold text-primary">{checked.size} selected</span>
              <div className="ms-auto flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditor({ kind: "bulk" })}><Shield className="size-4" /> Edit SL</Button>
                <Button variant="outline" size="sm" onClick={() => setEditor({ kind: "bulk" })}><Target className="size-4" /> Edit TP</Button>
                <Button variant="destructive" size="sm" onClick={() => setBulkCloseOpen(true)}><X className="size-4" /> Close {checked.size}</Button>
                <button type="button" onClick={() => setChecked(new Set())} aria-label="Clear" className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
              </div>
            </div>
          )}

          {tab === "closed" ? (
            <ClosedList rows={data.closedToday} />
          ) : tab === "pending" ? (
            <EmptyBlock title="No Pending Orders" note="Pending orders you place with your broker will appear here." />
          ) : (
            <DesktopTable
              trades={filtered}
              expandedId={expandedId}
              checked={checked}
              onToggleExpand={(id) => setExpandedId((cur) => (cur === id ? null : id))}
              onCheck={toggleCheck}
              onEditSL={(id) => setEditor({ kind: "sl", tradeId: id })}
              onEditTP={(id) => setEditor({ kind: "tp", tradeId: id })}
              onClose={(id) => setEditor({ kind: "close", tradeId: id })}
              onPartial={(id) => setEditor({ kind: "partial", tradeId: id })}
              onReverse={(id) => setEditor({ kind: "reverse", tradeId: id })}
              onBE={(id) => { const t = trades.find((x) => x.id === id); if (t) moveBE(t) }}
              onInstrument={onInstrument}
            />
          )}
        </div>
        <LiveBanner live={live} className="mt-4" />
      </div>

      {/* ============================ SHARED ============================ */}
      {editorTrade && (editor?.kind === "sl" || editor?.kind === "tp") && (
        <EditLevelSheet field={editor.kind} trade={editorTrade} onClose={() => setEditor(null)} onApply={(sl, tp) => { applyLevels(editorTrade, sl, tp); setEditor(null) }} onBE={() => { moveBE(editorTrade); setEditor(null) }} />
      )}
      {editorTrade && editor?.kind === "partial" && (
        <PartialSheet trade={editorTrade} onClose={() => setEditor(null)} onExecute={(lots) => { doPartial(editorTrade, lots); setEditor(null) }} />
      )}
      {editorTrade && editor?.kind === "close" && (
        <CloseSheet trade={editorTrade} tradable={tradable(editorTrade)} onClose={() => setEditor(null)} onConfirm={async (exit) => { const ok = await doClose(editorTrade, exit); if (ok) setEditor(null) }} />
      )}
      {editorTrade && editor?.kind === "reverse" && (
        <ReverseSheet trade={editorTrade} onClose={() => setEditor(null)} onConfirm={() => { void reverseTrade(editorTrade); setEditor(null) }} />
      )}
      {editorTrade && editor?.kind === "trailing" && (
        <TrailingSheet active={!!editorTrade.trailing?.active} onClose={() => setEditor(null)} onApply={(cfg) => { onTrailing(editorTrade, cfg); setEditor(null) }} />
      )}
      {editor?.kind === "bulk" && (
        <BulkEditSheet trades={checkedTrades} onClose={() => setEditor(null)} onApply={bulkModify} />
      )}
      {bulkCloseOpen && (
        <ConfirmSheet
          title={`Close ${checkedTrades.length} position${checkedTrades.length === 1 ? "" : "s"}?`}
          body={<BulkCloseBody trades={checkedTrades} />}
          confirmLabel={`Close ${checkedTrades.length}`}
          destructive
          onCancel={() => setBulkCloseOpen(false)}
          onConfirm={bulkClose}
        />
      )}
      {enableFor && enableFor.accountId != null && (
        <EnableExecutionDialog accountId={enableFor.accountId} accountName={enableFor.accountName} onClose={() => setEnableFor(null)} />
      )}

      <BottomNav tab={tab} onTab={setTab} />
    </div>
  )
}

type TabKey = "open" | "pending" | "closed" | "all"

// ---------- chrome --------------------------------------------------------

function ConnectionStatus({ live }: { live: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="relative flex size-2.5">
        {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--gain)] opacity-60" />}
        <span className={cn("relative inline-flex size-2.5 rounded-full", live ? "bg-[var(--gain)]" : "bg-muted-foreground")} />
      </span>
      <div className="leading-tight">
        <p className={cn("text-sm font-bold", live ? "text-[var(--gain)]" : "text-muted-foreground")}>{live ? "LIVE" : "SYNC ONLY"}</p>
        <p className="text-xs text-muted-foreground">{live ? "Broker Connected" : "Read-only feed"}</p>
      </div>
    </div>
  )
}

function AccountSelectorCard({ label, accounts, onPick }: { label: string; accounts: { id: number; name: string }[]; onPick: (v: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button type="button" className="flex w-full items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/40">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UserRound className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Trading Account</span>
              <span className="block truncate text-sm text-muted-foreground">{label}</span>
            </span>
            <ChevronDown className="size-5 shrink-0 text-muted-foreground" />
          </button>
        }
      />
      <DropdownMenuContent className="w-[calc(100vw-2rem)] max-w-sm">
        <DropdownMenuItem onClick={() => onPick("all")}>All accounts</DropdownMenuItem>
        {accounts.map((a) => (
          <DropdownMenuItem key={a.id} onClick={() => onPick(String(a.id))}>
            {a.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AccountSelectorInline({ label, accounts, onPick }: { label: string; accounts: { id: number; name: string }[]; onPick: (v: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="h-9 gap-1.5"><UserRound className="size-4" /> {label} <ChevronDown className="size-4" /></Button>} />
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => onPick("all")}>All accounts</DropdownMenuItem>
        {accounts.map((a) => (
          <DropdownMenuItem key={a.id} onClick={() => onPick(String(a.id))}>
            {a.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SummaryCard({ open, total, today, winRate, totalPnl }: { open: number; total: number; today: number; winRate: number | null; totalPnl: number | null }) {
  const cells: { label: string; icon: typeof Layers; value: string; foot?: string; tone?: "gain" | "loss" }[] = [
    { label: "Open Trades", icon: Layers, value: String(open), foot: `of ${total} total` },
    { label: "Today's P&L", icon: TrendingUp, value: signed(today), tone: today >= 0 ? "gain" : "loss" },
    { label: "Win Rate", icon: Target, value: winRate != null ? `${winRate}%` : "—" },
    { label: "Total P&L", icon: Activity, value: totalPnl != null ? signed(totalPnl) : signed(today), tone: (totalPnl ?? today) >= 0 ? "gain" : "loss" },
  ]
  return (
    <div className="grid grid-cols-4 divide-x rounded-2xl border bg-card">
      {cells.map((c) => (
        <div key={c.label} className="min-w-0 px-2.5 py-3">
          <div className="flex items-center justify-between gap-1 text-muted-foreground">
            <span className="truncate text-[10px] font-medium">{c.label}</span>
            <c.icon className="hidden size-3.5 shrink-0 sm:block" />
          </div>
          <p className={cn("mt-1 truncate text-[15px] font-bold tabular-nums", c.tone === "gain" && "text-[var(--gain)]", c.tone === "loss" && "text-[var(--loss)]")}>{c.value}</p>
          {"foot" in c && c.foot && <p className="truncate text-[10px] text-muted-foreground">{c.foot}</p>}
        </div>
      ))}
    </div>
  )
}

function TabBar({ tab, onTab, counts }: { tab: TabKey; onTab: (t: TabKey) => void; counts: { open: number; pending: number; closed: number } }) {
  const items: { key: TabKey; label: string; dot?: boolean; icon?: typeof Clock }[] = [
    { key: "open", label: `Open (${counts.open})`, dot: true },
    { key: "pending", label: `Pending (${counts.pending})`, icon: Clock },
    { key: "closed", label: `Closed Today (${counts.closed})`, icon: CircleCheck },
    { key: "all", label: "All Trades", icon: List },
  ]
  return (
    <div className="flex gap-2">
      {items.map((it) => {
        const active = tab === it.key
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onTab(it.key)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors",
              active ? "bg-primary text-primary-foreground shadow-sm" : "border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {it.dot && <span className={cn("size-1.5 rounded-full", active ? "bg-white" : "bg-[var(--gain)]")} />}
            {it.icon && <it.icon className="size-4" />}
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

function BulkActionBar({ total, count, allChecked, onToggleAll, onEditSL, onEditTP, onClose }: { total: number; count: number; allChecked: boolean; onToggleAll: () => void; onEditSL: () => void; onEditTP: () => void; onClose: () => void }) {
  const has = count > 0
  return (
    <div className="flex items-center gap-2 rounded-2xl border bg-card p-2.5">
      <button type="button" onClick={onToggleAll} className="flex items-center gap-2 px-1 text-sm font-medium">
        <span className={cn("flex size-5 items-center justify-center rounded-md border", allChecked ? "border-primary bg-primary text-white" : "border-border")}>{allChecked && <Check className="size-3.5" strokeWidth={3} />}</span>
        {has ? `${count} selected` : "Select all"}
      </button>
      <div className="ms-auto flex items-center gap-1">
        <button type="button" onClick={onEditSL} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted">
          <Pencil className="size-3.5" /> Edit SL
        </button>
        <button type="button" onClick={onEditTP} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted">
          <Target className="size-3.5" /> Edit TP
        </button>
        <button type="button" onClick={onClose} className="inline-flex items-center gap-1 rounded-lg bg-[var(--loss)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90">
          <X className="size-3.5" /> Close {count || total}
        </button>
      </div>
    </div>
  )
}

function LiveBanner({ live, className }: { live: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 rounded-xl bg-primary/10 px-4 py-2.5 text-sm", className)}>
      <Zap className="size-4 shrink-0 text-primary" />
      <span className="text-muted-foreground">Live prices &amp; P&amp;L update in real-time</span>
      <span className="ms-auto flex items-center gap-1.5 text-xs font-semibold">
        <span className={cn("size-1.5 rounded-full", live ? "bg-[var(--gain)]" : "bg-muted-foreground")} /> {live ? "LIVE" : "OFF"}
      </span>
    </div>
  )
}

function EmptyBlock({ title, note, className }: { title: string; note: string; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-2xl border bg-card px-6 py-14 text-center", className)}>
      <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Activity className="size-6" />
      </span>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">{note}</p>
    </div>
  )
}

function ClosedList({ rows }: { rows: ClosedTradeRow[] }) {
  if (rows.length === 0) return <p className="px-4 py-12 text-center text-sm text-muted-foreground">Nothing closed today.</p>
  return (
    <div className="divide-y">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-3 px-4 py-3">
          <SymbolBadge symbol={r.symbol} className="size-8" />
          <div className="min-w-0">
            <p className="font-medium leading-tight">{r.symbol}</p>
            <p className="truncate text-xs text-muted-foreground">{r.accountName}</p>
          </div>
          <TypePill side={r.side} size="xs" />
          <span className="ms-auto">
            <Pnl value={r.pnl} className="font-semibold" />
          </span>
        </div>
      ))}
    </div>
  )
}

function KpiCard({ label, value, foot, icon: Icon, tone }: { label: string; value: string; foot: string; icon?: typeof Layers; tone?: "gain" | "loss" }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        {Icon && <Icon className="size-4 text-muted-foreground/60" />}
      </div>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", tone === "gain" && "text-[var(--gain)]", tone === "loss" && "text-[var(--loss)]")}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{foot}</p>
    </div>
  )
}

// ---------- mobile trade card --------------------------------------------

function TradeCard({
  trade,
  expanded,
  checked,
  onToggleExpand,
  onCheck,
  onEditSL,
  onEditTP,
  onClose,
  onPartial,
  onReverse,
  onBE,
  onTrailing,
  onEnable,
}: {
  trade: UITrade
  expanded: boolean
  checked: boolean
  onToggleExpand: () => void
  onCheck: () => void
  onEditSL: () => void
  onEditTP: () => void
  onClose: () => void
  onPartial: () => void
  onReverse: () => void
  onBE: () => void
  onTrailing: () => void
  onEnable?: () => void
}) {
  const pts = favPoints(trade)
  return (
    <div className={cn("overflow-hidden rounded-2xl border bg-card", checked && "ring-2 ring-primary/40")}>
      <div className="flex items-center gap-3 p-4">
        <button type="button" onClick={onCheck} aria-label="Select trade" className={cn("flex size-6 shrink-0 items-center justify-center rounded-lg border transition-colors", checked ? "border-primary bg-primary text-white" : "border-border")}>
          {checked && <Check className="size-4" strokeWidth={3} />}
        </button>
        <SymbolBadge symbol={trade.symbol} className="size-10" />
        <button type="button" onClick={onToggleExpand} className="min-w-0 flex-1 text-left">
          <span className="block text-base font-bold leading-tight">{trade.symbol}</span>
          <span className="mt-1 block">
            <TypePill side={trade.side} />
          </span>
        </button>
        <div className="text-right">
          <p className="flex items-center justify-end gap-1 text-[11px] font-semibold text-[var(--gain)]">
            <TrendingUp className="size-3" /> LIVE P&amp;L
          </p>
          <Pnl value={trade.unrealizedPnl} className="text-lg font-extrabold" />
        </div>
        {expanded ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<button type="button" aria-label="More" className="rounded-md p-1 text-muted-foreground hover:bg-muted"><MoreHorizontal className="size-5" /></button>} />
            <DropdownMenuContent align="end" className="w-48">
              {onEnable && <DropdownMenuItem onClick={onEnable}>Enable live orders</DropdownMenuItem>}
              <DropdownMenuItem onClick={onBE}>Move SL to break-even</DropdownMenuItem>
              <DropdownMenuItem onClick={onTrailing}>Set trailing stop</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button type="button" onClick={onToggleExpand} aria-label="Expand" className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <ChevronDown className="size-5" />
          </button>
        )}
      </div>

      {expanded && (
        <div className="animate-in fade-in border-t px-4 pb-4 pt-3">
          <div className="grid grid-cols-5 gap-2 border-b pb-3">
            <Stat label="Qty" value={String(trade.quantity)} />
            <Stat label="Entry" value={fmtPrice(trade.entryPrice)} />
            <Stat label="Current" value={fmtPrice(trade.currentPrice)} />
            <Stat label="P&L (pts)" value={pts != null ? `${pts >= 0 ? "+" : ""}${pts}` : "—"} tone={pts != null ? (pts >= 0 ? "gain" : "loss") : undefined} />
            <Stat label="P&L (USD)" node={<Pnl value={trade.unrealizedPnl} className="text-[13px] font-bold" />} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <LevelBox tone="loss" icon={Shield} label="Stop Loss" value={trade.stopLoss} onEdit={onEditSL} />
            <LevelBox tone="gain" icon={Target} label="Take Profit" value={trade.takeProfit} onEdit={onEditTP} />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <ActionBtn primary icon={X} title="Close" sub="Full close" onClick={onClose} />
            <ActionBtn icon={Scissors} title="Partial" sub="Close part" onClick={onPartial} />
            <ActionBtn icon={Repeat2} title="Reverse" sub="Flip side" onClick={onReverse} />
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, node, tone }: { label: string; value?: string; node?: ReactNode; tone?: "gain" | "loss" }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] font-medium text-muted-foreground">{label}</p>
      {node ?? <p className={cn("truncate text-[13px] font-bold tabular-nums", tone === "gain" && "text-[var(--gain)]", tone === "loss" && "text-[var(--loss)]")}>{value}</p>}
    </div>
  )
}

function LevelBox({ tone, icon: Icon, label, value, onEdit }: { tone: "gain" | "loss"; icon: typeof Shield; label: string; value: number | null; onEdit: () => void }) {
  const gain = tone === "gain"
  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className={cn("size-3.5", gain ? "text-[var(--gain)]" : "text-[var(--loss)]")} />
        {label}
        <span className={cn("size-1.5 rounded-full", gain ? "bg-[var(--gain)]" : "bg-[var(--loss)]")} />
      </div>
      <p className="mt-1 text-base font-bold tabular-nums">{fmtPrice(value)}</p>
      <button type="button" onClick={onEdit} className={cn("mt-2 inline-flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-semibold", gain ? "bg-[var(--gain)]/10 text-[var(--gain)]" : "bg-[var(--loss)]/10 text-[var(--loss)]")}>
        <Pencil className="size-3" /> Edit
      </button>
    </div>
  )
}

function ActionBtn({ primary, icon: Icon, title, sub, onClick }: { primary?: boolean; icon: typeof X; title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-2.5 text-center transition-colors", primary ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border hover:bg-muted")}>
      <span className="flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="size-4" /> {title}
      </span>
      <span className={cn("text-[10px]", primary ? "text-primary-foreground/70" : "text-muted-foreground")}>{sub}</span>
    </button>
  )
}

// ---------- desktop table -------------------------------------------------

function DesktopTable({
  trades,
  expandedId,
  checked,
  onToggleExpand,
  onCheck,
  onEditSL,
  onEditTP,
  onClose,
  onPartial,
  onReverse,
  onBE,
  onInstrument,
}: {
  trades: UITrade[]
  expandedId: number | null
  checked: Set<number>
  onToggleExpand: (id: number) => void
  onCheck: (id: number) => void
  onEditSL: (id: number) => void
  onEditTP: (id: number) => void
  onClose: (id: number) => void
  onPartial: (id: number) => void
  onReverse: (id: number) => void
  onBE: (id: number) => void
  onInstrument: (symbol: string, action: "closeAll" | "beAll" | "levelsAll") => void
}) {
  if (trades.length === 0) return <EmptyBlock title="No open positions" note="When you have a running trade it'll show here with its live risk and P&L." className="m-4" />
  const groups: { symbol: string; rows: UITrade[] }[] = []
  const idx = new Map<string, number>()
  for (const t of trades) {
    let i = idx.get(t.symbol)
    if (i === undefined) {
      i = groups.length
      idx.set(t.symbol, i)
      groups.push({ symbol: t.symbol, rows: [] })
    }
    groups[i].rows.push(t)
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="w-10 px-4 py-3" />
            <th className="px-2 py-3 font-medium">Symbol</th>
            <th className="px-2 py-3 font-medium">Side</th>
            <th className="px-2 py-3 font-medium">Qty</th>
            <th className="px-2 py-3 font-medium">Entry</th>
            <th className="px-2 py-3 font-medium">Current</th>
            <th className="px-2 py-3 font-medium">P&L</th>
            <th className="px-2 py-3 font-medium">Stop Loss</th>
            <th className="px-2 py-3 font-medium">Take Profit</th>
            <th className="px-2 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.symbol}>
              {g.rows.length > 1 && <InstrumentHeader symbol={g.symbol} rows={g.rows} onInstrument={onInstrument} />}
              {g.rows.map((t) => {
                const open = expandedId === t.id
                return (
                  <Fragment key={t.id}>
                    <tr className={cn("border-b transition-colors hover:bg-muted/40", open && "bg-primary/5")}>
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={checked.has(t.id)} onChange={() => onCheck(t.id)} className="size-4 rounded border-border accent-[var(--primary)]" aria-label="Select" />
                      </td>
                      <td className="cursor-pointer px-2 py-3" onClick={() => onToggleExpand(t.id)}>
                        <div className="flex items-center gap-2.5">
                          <SymbolBadge symbol={t.symbol} className="size-8" />
                          <div className="min-w-0">
                            <p className="font-semibold leading-tight">{t.symbol}</p>
                            <p className="truncate text-xs text-muted-foreground">{instrument(t.symbol).name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-3"><TypePill side={t.side} /></td>
                      <td className="px-2 py-3 tabular-nums">{t.quantity}</td>
                      <td className="px-2 py-3 tabular-nums">{fmtPrice(t.entryPrice)}</td>
                      <td className="px-2 py-3 tabular-nums">{fmtPrice(t.currentPrice)}</td>
                      <td className="px-2 py-3"><Pnl value={t.unrealizedPnl} className="font-semibold" /></td>
                      <td className="px-2 py-3">
                        <InlineLevel value={t.stopLoss} tone="loss" onEdit={() => onEditSL(t.id)} />
                      </td>
                      <td className="px-2 py-3">
                        <InlineLevel value={t.takeProfit} tone="gain" onEdit={() => onEditTP(t.id)} />
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="destructive" size="xs" onClick={() => onClose(t.id)}>Close</Button>
                          <Button variant="outline" size="xs" onClick={() => onPartial(t.id)}>Partial</Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label="More"><MoreHorizontal className="size-4" /></Button>} />
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem onClick={() => onReverse(t.id)}>Reverse position</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => onBE(t.id)}>Move SL to break-even</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => onToggleExpand(t.id)}>{open ? "Hide details" : "View details"}</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b bg-primary/5">
                        <td />
                        <td colSpan={9} className="px-2 pb-4">
                          <div className="grid grid-cols-2 gap-x-8 gap-y-2 rounded-xl border bg-card p-4 text-sm sm:grid-cols-4">
                            <Detail k="Account" v={t.accountName} />
                            <Detail k="Platform" v={(t.source ?? "—").toUpperCase()} />
                            <Detail k="Opened" v={new Date(t.entryTime).toLocaleString()} />
                            <Detail k="Ticket" v={t.origin === "trade" ? `#${t.id}` : "live"} />
                            <Detail k="P&L %" v={pnlPercent(t) != null ? `${pnlPercent(t)! >= 0 ? "+" : ""}${pnlPercent(t)}%` : "—"} />
                            <Detail k="Points" v={favPoints(t) != null ? `${favPoints(t)! >= 0 ? "+" : ""}${favPoints(t)}` : "—"} />
                            <Detail k="Stop Loss" v={fmtPrice(t.stopLoss)} />
                            <Detail k="Take Profit" v={fmtPrice(t.takeProfit)} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{k}</p>
      <p className="font-medium tabular-nums">{v}</p>
    </div>
  )
}

function InlineLevel({ value, tone, onEdit }: { value: number | null; tone: "gain" | "loss"; onEdit: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="tabular-nums">{fmtPrice(value)}</span>
      <button type="button" onClick={onEdit} className={cn("inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium opacity-70 hover:opacity-100", tone === "gain" ? "text-[var(--gain)]" : "text-[var(--loss)]")}>
        <Pencil className="size-3" /> Edit
      </button>
    </div>
  )
}

function InstrumentHeader({ symbol, rows, onInstrument }: { symbol: string; rows: UITrade[]; onInstrument: (symbol: string, action: "closeAll" | "beAll" | "levelsAll") => void }) {
  const netLots = round4(rows.reduce((s, t) => s + (t.side === "long" ? t.quantity : -t.quantity), 0))
  const pnls = rows.map((t) => t.unrealizedPnl).filter((v): v is number => v != null)
  const totalPnl = pnls.length ? pnls.reduce((a, b) => a + b, 0) : null
  return (
    <tr className="border-b bg-muted/40">
      <td colSpan={10} className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-2">
            <SymbolBadge symbol={symbol} className="size-6" />
            <span className="text-sm font-semibold">{symbol}</span>
          </span>
          <span className="text-xs text-muted-foreground">{rows.length} positions · net {netLots > 0 ? "+" : ""}{netLots}</span>
          {totalPnl != null && <Pnl value={totalPnl} className="text-xs font-semibold" />}
          <div className="ms-auto">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs"><Layers className="size-3.5" /> Manage all {rows.length}</Button>} />
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => onInstrument(symbol, "levelsAll")}>Set SL/TP for all {rows.length}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onInstrument(symbol, "beAll")}>Move all to break-even</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => onInstrument(symbol, "closeAll")}>Close all {rows.length}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </td>
    </tr>
  )
}

// ---------- editors (bottom sheet / drawer) -------------------------------

function Stepper({ value, onChange, step }: { value: string; onChange: (v: string) => void; step: number }) {
  const bump = (dir: number) => {
    const n = value.trim() === "" ? 0 : Number(value)
    onChange(String(Math.round((n + dir * step) / step) * step))
  }
  return (
    <div className="flex items-center gap-1.5">
      <Button variant="outline" size="icon" className="size-11 shrink-0" onClick={() => bump(-1)} aria-label="Decrease"><Minus className="size-4" /></Button>
      <Input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" className="h-11 text-center text-lg tabular-nums" placeholder="—" />
      <Button variant="outline" size="icon" className="size-11 shrink-0" onClick={() => bump(1)} aria-label="Increase"><Plus className="size-4" /></Button>
    </div>
  )
}

function Chip({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("rounded-xl border py-2 text-sm font-medium transition-colors", active ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
      {label}
    </button>
  )
}

function EditLevelSheet({ field, trade, onClose, onApply, onBE }: { field: "sl" | "tp"; trade: UITrade; onClose: () => void; onApply: (sl: number | null, tp: number | null) => void; onBE: () => void }) {
  const isSL = field === "sl"
  const current = isSL ? trade.stopLoss : trade.takeProfit
  const [val, setVal] = useState(current != null ? String(current) : "")
  const step = pipSize(trade.symbol)
  const long = trade.side === "long"
  const riskPrice = (x: number) => String(round4(trade.entryPrice + (long ? -1 : 1) * x * step))
  const profitPrice = (x: number) => String(round4(trade.entryPrice + (long ? 1 : -1) * x * step))
  const num = val.trim() === "" ? null : Number(val)
  return (
    <Sheet
      open
      onClose={onClose}
      title={isSL ? "Edit Stop Loss" : "Edit Take Profit"}
      subtitle={<span className="flex items-center gap-1.5">{trade.symbol} · <TypePill side={trade.side} size="xs" /></span>}
      footer={
        <>
          <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" disabled={val.trim() !== "" && !Number.isFinite(num)} onClick={() => (isSL ? onApply(num, trade.takeProfit) : onApply(trade.stopLoss, num))}>
            {isSL ? "Update SL" : "Update TP"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-xl border p-3 text-sm">
          <span className="text-muted-foreground">Current {isSL ? "SL" : "TP"}</span>
          <span className="font-semibold tabular-nums">{fmtPrice(current)}</span>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">New {isSL ? "Stop Loss" : "Take Profit"}</p>
          <Stepper value={val} onChange={setVal} step={step} />
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quick options</p>
          <div className="grid grid-cols-4 gap-2">
            {isSL ? (
              <>
                <Chip label="Breakeven" onClick={onBE} />
                <Chip label="10 pts" onClick={() => setVal(riskPrice(10))} />
                <Chip label="20 pts" onClick={() => setVal(riskPrice(20))} />
                <Chip label="50 pts" onClick={() => setVal(riskPrice(50))} />
              </>
            ) : (
              <>
                <Chip label="+10 pts" onClick={() => setVal(profitPrice(10))} />
                <Chip label="+20 pts" onClick={() => setVal(profitPrice(20))} />
                <Chip label="+50 pts" onClick={() => setVal(profitPrice(50))} />
                <Chip label="+100 pts" onClick={() => setVal(profitPrice(100))} />
              </>
            )}
          </div>
        </div>
      </div>
    </Sheet>
  )
}

function PartialSheet({ trade, onClose, onExecute }: { trade: UITrade; onClose: () => void; onExecute: (lots: number) => void }) {
  const [pct, setPct] = useState(50)
  const lots = round4((trade.quantity * pct) / 100)
  const remaining = round4(trade.quantity - lots)
  const estPnl = trade.unrealizedPnl != null ? (trade.unrealizedPnl * pct) / 100 : null
  return (
    <Sheet
      open
      onClose={onClose}
      title="Partial Close"
      subtitle={<span className="flex items-center gap-1.5">{trade.symbol} · <TypePill side={trade.side} size="xs" /></span>}
      footer={
        <>
          <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" disabled={lots <= 0} onClick={() => onExecute(lots)}>Close {lots}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-xl border p-3 text-sm">
          <span className="text-muted-foreground">Current quantity</span>
          <span className="font-semibold tabular-nums">{trade.quantity}</span>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">Close</p>
          <div className="grid grid-cols-4 gap-2">
            {[25, 50, 75, 100].map((p) => (
              <Chip key={p} label={`${p}%`} active={pct === p} onClick={() => setPct(p)} />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">Remaining</p>
            <p className="font-semibold tabular-nums">{remaining}</p>
          </div>
          <div className="rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">Est. P&L</p>
            <Pnl value={estPnl} className="font-semibold" />
          </div>
        </div>
      </div>
    </Sheet>
  )
}

function CloseSheet({ trade, tradable, onClose, onConfirm }: { trade: UITrade; tradable: boolean; onClose: () => void; onConfirm: (exit?: number) => void }) {
  const [pending, start] = useTransition()
  const [exit, setExit] = useState(trade.currentPrice != null ? String(trade.currentPrice) : "")
  const manual = trade.origin === "trade"
  return (
    <Sheet
      open
      onClose={onClose}
      title="Close Position?"
      subtitle={<span className="flex items-center gap-1.5">{trade.symbol} · <TypePill side={trade.side} size="xs" /></span>}
      footer={
        <>
          <Button variant="ghost" className="flex-1" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="destructive" className="flex-1" disabled={pending} onClick={() => start(() => onConfirm(manual ? Number(exit) : undefined))}>{pending ? "Closing…" : "Close Position"}</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">Quantity</p>
            <p className="font-semibold tabular-nums">{trade.quantity}</p>
          </div>
          <div className="rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">Current P&L</p>
            <Pnl value={trade.unrealizedPnl} className="font-semibold" />
          </div>
        </div>
        {manual && (
          <div>
            <label className="text-xs text-muted-foreground">Exit price</label>
            <Input value={exit} onChange={(e) => setExit(e.target.value)} inputMode="decimal" placeholder="e.g. 30817.75" className="mt-1" />
          </div>
        )}
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
          {manual ? "This records the close in your journal." : tradable ? "This sends a close order to your broker now." : "Broker execution isn't enabled — this updates your TradeLoop view only."}
        </p>
      </div>
    </Sheet>
  )
}

function ReverseSheet({ trade, onClose, onConfirm }: { trade: UITrade; onClose: () => void; onConfirm: () => void }) {
  const opp = trade.side === "long" ? "short" : "long"
  return (
    <Sheet
      open
      onClose={onClose}
      title="Reverse Position?"
      subtitle={trade.symbol}
      footer={
        <>
          <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" onClick={onConfirm}><Repeat2 className="size-4" /> Reverse</Button>
        </>
      }
    >
      <div className="flex items-center justify-center gap-3 rounded-xl border p-5 text-center">
        <div>
          <TypePill side={trade.side} />
          <p className="mt-1 text-sm text-muted-foreground">{trade.quantity} {trade.symbol}</p>
        </div>
        <Repeat2 className="size-5 text-muted-foreground" />
        <div>
          <TypePill side={opp} />
          <p className="mt-1 text-sm text-muted-foreground">{trade.quantity} {trade.symbol}</p>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">Closes the current position and opens the opposite side.</p>
    </Sheet>
  )
}

function TrailingSheet({ active, onClose, onApply }: { active: boolean; onClose: () => void; onApply: (cfg: { distance: number; step: number; active: boolean }) => void }) {
  const [distance, setDistance] = useState("20")
  const [step, setStep] = useState("5")
  return (
    <Sheet
      open
      onClose={onClose}
      title="Trailing Stop"
      footer={
        <>
          {active && <Button variant="ghost" className="flex-1" onClick={() => onApply({ distance: Number(distance), step: Number(step), active: false })}>Turn off</Button>}
          <Button className="flex-1" onClick={() => onApply({ distance: Number(distance), step: Number(step), active: true })}>{active ? "Update" : "Activate"}</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Distance (pts)</label>
          <Input value={distance} onChange={(e) => setDistance(e.target.value)} inputMode="numeric" className="mt-1" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Step (pts)</label>
          <Input value={step} onChange={(e) => setStep(e.target.value)} inputMode="numeric" className="mt-1" />
        </div>
      </div>
    </Sheet>
  )
}

function BulkEditSheet({ trades, onClose, onApply }: { trades: UITrade[]; onClose: () => void; onApply: (sl: number | null, tp: number | null) => void }) {
  const [sl, setSl] = useState("")
  const [tp, setTp] = useState("")
  const slNum = sl.trim() === "" ? null : Number(sl)
  const tpNum = tp.trim() === "" ? null : Number(tp)
  const valid = (sl.trim() === "" || Number.isFinite(slNum)) && (tp.trim() === "" || Number.isFinite(tpNum)) && (slNum != null || tpNum != null)
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Edit ${trades.length} Position${trades.length === 1 ? "" : "s"}`}
      subtitle="Applies the same levels to every selected position"
      footer={
        <>
          <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" disabled={!valid || trades.length === 0} onClick={() => onApply(slNum, tpNum)}>Apply Changes</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">Stop Loss</label>
          <Input value={sl} onChange={(e) => setSl(e.target.value)} inputMode="decimal" placeholder="Leave blank to keep" className="mt-1 tabular-nums" />
        </div>
        <div>
          <label className="text-sm font-medium">Take Profit</label>
          <Input value={tp} onChange={(e) => setTp(e.target.value)} inputMode="decimal" placeholder="Leave blank to keep" className="mt-1 tabular-nums" />
        </div>
        <div className="rounded-xl border p-3 text-xs text-muted-foreground">
          {trades.length} position{trades.length === 1 ? "" : "s"} will be modified: {trades.map((t) => t.symbol).join(", ") || "—"}
        </div>
      </div>
    </Sheet>
  )
}

function ConfirmSheet({ title, body, confirmLabel, destructive, onCancel, onConfirm }: { title: string; body: ReactNode; confirmLabel: string; destructive?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Sheet
      open
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button variant={destructive ? "destructive" : "default"} className="flex-1" onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      {body}
    </Sheet>
  )
}

function BulkCloseBody({ trades }: { trades: UITrade[] }) {
  const total = trades.map((t) => t.unrealizedPnl).filter((v): v is number => v != null).reduce((a, b) => a + b, 0)
  return (
    <div className="space-y-2">
      <div className="divide-y rounded-xl border">
        {trades.map((t) => (
          <div key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <SymbolBadge symbol={t.symbol} className="size-7" />
            <span className="font-medium">{t.symbol}</span>
            <TypePill side={t.side} size="xs" />
            <span className="ms-auto"><Pnl value={t.unrealizedPnl} className="font-medium" /></span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between px-1 text-sm">
        <span className="text-muted-foreground">Combined P&L</span>
        <Pnl value={total} className="font-semibold" />
      </div>
    </div>
  )
}

function EnableExecutionDialog({ accountId, accountName, onClose }: { accountId: number; accountName: string; onClose: () => void }) {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [pending, start] = useTransition()
  function save() {
    if (!password.trim()) {
      toast.error("Enter your master (trading) password.")
      return
    }
    start(async () => {
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
            To send orders for <span className="font-medium text-foreground">{accountName}</span>, TradeLoop needs its <span className="font-medium text-foreground">master (trading)</span> password. It&apos;s stored encrypted and used only for orders you request.
          </p>
          <div>
            <label className="text-xs text-muted-foreground">Master (trading) password</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1" autoFocus />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={save} disabled={pending}>{pending ? "Enabling…" : "Enable execution"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BottomNav({ tab, onTab }: { tab: TabKey; onTab: (t: TabKey) => void }) {
  const items: { key: TabKey; label: string; icon: typeof CandlestickChart }[] = [
    { key: "open", label: "Trades", icon: CandlestickChart },
    { key: "pending", label: "Orders", icon: FileText },
    { key: "closed", label: "History", icon: Clock },
    { key: "all", label: "More", icon: LayoutGrid },
  ]
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
      {items.map((it) => {
        const active = tab === it.key
        return (
          <button key={it.key} type="button" onClick={() => onTab(it.key)} className={cn("flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors", active ? "text-primary" : "text-muted-foreground")}>
            <it.icon className="size-5" />
            {it.label}
            <span className={cn("mt-0.5 h-0.5 w-6 rounded-full", active ? "bg-primary" : "bg-transparent")} />
          </button>
        )
      })}
    </nav>
  )
}

