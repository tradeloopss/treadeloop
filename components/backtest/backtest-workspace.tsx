"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { BacktestChart, type ChartMarker, type ChartPriceLine, type Drawing, type SeriesType } from "@/components/backtest/backtest-chart"
import { BacktestChartToolbar } from "@/components/backtest/backtest-chart-toolbar"
import { BacktestDrawingRail, type DrawingTool } from "@/components/backtest/backtest-drawing-rail"
import type { Candle } from "@/lib/market-data/types"
import type { OpenPosition, PendingOrder } from "@/lib/backtest/types"
import { stepCandle, positionPnl } from "@/lib/backtest/execution-engine"
import { visibleCandles, nextCandleTime, candleAt, isAtEnd } from "@/lib/backtest/replay-engine"
import { instrumentSpec, sizeFromRisk, riskAmountFor } from "@/lib/backtest/sizing"
import { computeIndicators, type IndicatorId } from "@/lib/backtest/indicators"
import { contractMultiplierForSymbol } from "@/lib/calc"
import { timeframeSeconds } from "@/lib/market-data"
import { getBacktestCandles } from "@/app/actions/market-data"
import { updateBacktestState, saveBacktestTrade, finishBacktest } from "@/app/actions/backtest"
import { useT } from "@/components/locale-provider"
import { Play, Pause, ChevronRight, RotateCcw, Flag, Loader2, Dice5 } from "lucide-react"

export interface WorkspaceSession {
  id: number
  symbol: string
  market: string
  timeframe: string
  provider: string
  rangeStart: number // unix sec
  rangeEnd: number
  currentTime: number
  startingBalance: number
  currentBalance: number
  speed: number
  status: string
  randomMode: boolean
}

interface LocalTrade {
  side: "long" | "short"
  qty: number
  entryPrice: number
  exitPrice: number
  entryTime: number
  exitTime: number
  pnl: number
  reason: string
}

const SPEEDS = [1, 2, 5, 10, 20]
const BASE_TICK_MS = 900
const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n)

export function BacktestWorkspace({ session }: { session: WorkspaceSession }) {
  const t = useT()
  const router = useRouter()

  const spec = useMemo(() => instrumentSpec(session.symbol, session.market), [session.symbol, session.market])
  const contractMultiplier = useMemo(() => {
    const m = contractMultiplierForSymbol(session.symbol)
    return m > 1 ? m : spec.multiplier
  }, [session.symbol, spec.multiplier])

  const [candles, setCandles] = useState<Candle[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [currentTime, setCurrentTime] = useState(session.currentTime)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(session.speed || 1)

  // Chart view + drawing state.
  const [viewTf, setViewTf] = useState(session.timeframe)
  const [seriesType, setSeriesType] = useState<SeriesType>("candles")
  const [indicators, setIndicators] = useState<IndicatorId[]>([])
  const [activeTool, setActiveTool] = useState<DrawingTool>("cursor")
  const [magnet, setMagnet] = useState(false)
  const [showDrawings, setShowDrawings] = useState(true)
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [redoStack, setRedoStack] = useState<Drawing[]>([])
  const pendingPoint = useRef<{ time: number; price: number } | null>(null)

  const currentTimeRef = useRef(currentTime)
  currentTimeRef.current = currentTime

  const [balance, setBalance] = useState(session.currentBalance)
  const [position, setPosition] = useState<OpenPosition | null>(null)
  const [orders] = useState<PendingOrder[]>([])
  const [closed, setClosed] = useState<LocalTrade[]>([])
  const [finished, setFinished] = useState(session.status === "completed")

  // Order-entry inputs.
  const [qtyInput, setQtyInput] = useState("1")
  const [riskPct, setRiskPct] = useState("0.5")
  const [useRisk, setUseRisk] = useState(false)
  const [slInput, setSlInput] = useState("")
  const [tpInput, setTpInput] = useState("")

  // Fetch the candle window. On the session's own timeframe it uses the stored
  // replay window; switching timeframe fetches a fresh window around the
  // current cursor (sized to that timeframe) so the replay stays sensible at
  // any resolution. Never re-fetches per candle — the array is stepped in
  // memory.
  const loadWindow = useCallback(
    async (tf: string, sessionRange: boolean, initial = false) => {
      setLoading(true)
      const tfSec = timeframeSeconds(tf)
      const from = sessionRange ? session.rangeStart : currentTimeRef.current - 160 * tfSec
      const to = sessionRange ? session.rangeEnd : currentTimeRef.current + 320 * tfSec
      const res = await getBacktestCandles({ provider: session.provider, symbol: session.symbol, timeframe: tf, from, to })
      setLoading(false)
      if (res.ok) {
        setCandles(res.candles)
        setLoadError(null)
        return true
      }
      // Only blank the screen if the very first load fails; a failed timeframe
      // switch just warns and keeps the current view.
      if (initial) setLoadError(res.error)
      return false
    },
    [session.provider, session.symbol, session.rangeStart, session.rangeEnd],
  )

  useEffect(() => {
    loadWindow(session.timeframe, true, true)
  }, [loadWindow, session.timeframe])

  async function onTimeframe(tf: string) {
    if (tf === viewTf) return
    setPlaying(false)
    const prev = viewTf
    setViewTf(tf)
    const ok = await loadWindow(tf, tf === session.timeframe)
    if (!ok) {
      setViewTf(prev)
      toast.error(t("That timeframe isn't available for this period on the free data feed."))
    }
  }

  function toggleIndicator(id: IndicatorId) {
    setIndicators((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function pushDrawing(d: Drawing) {
    setDrawings((prev) => [...prev, d])
    setRedoStack([])
  }
  function undoDrawing() {
    setDrawings((prev) => {
      if (!prev.length) return prev
      setRedoStack((r) => [...r, prev[prev.length - 1]])
      return prev.slice(0, -1)
    })
  }
  function redoDrawing() {
    setRedoStack((prev) => {
      if (!prev.length) return prev
      setDrawings((d) => [...d, prev[prev.length - 1]])
      return prev.slice(0, -1)
    })
  }

  // The drawing-tool state machine: single-click tools place immediately;
  // two-click tools (trend line, measure) capture an anchor first.
  function onChartClick(pt: { time: number; price: number }) {
    if (activeTool === "cursor") return
    if (activeTool === "hline") {
      pushDrawing({ id: crypto.randomUUID(), type: "hline", points: [pt], color: "#3b82f6" })
      return
    }
    if (activeTool === "text") {
      const text = window.prompt(t("Label text")) ?? ""
      if (text.trim()) pushDrawing({ id: crypto.randomUUID(), type: "text", points: [pt], color: "#eab308", text: text.trim() })
      return
    }
    if (activeTool === "trend" || activeTool === "measure") {
      if (!pendingPoint.current) {
        pendingPoint.current = pt
        return
      }
      const a = pendingPoint.current
      pendingPoint.current = null
      if (activeTool === "trend") {
        pushDrawing({ id: crypto.randomUUID(), type: "trend", points: [a, pt], color: "#3b82f6" })
      } else {
        const diff = pt.price - a.price
        const pct = a.price ? (diff / a.price) * 100 : 0
        const bars = Math.round(Math.abs(pt.time - a.time) / timeframeSeconds(viewTf))
        toast(`${diff >= 0 ? "+" : ""}${diff.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%) · ${bars} ${t("bars")}`)
      }
    }
  }

  const visible = useMemo(() => visibleCandles(candles, currentTime), [candles, currentTime])
  // Indicators are computed on the VISIBLE candles only — they can't peek at
  // bars the replay hasn't revealed.
  const indicatorOutputs = useMemo(() => computeIndicators(visible, indicators), [visible, indicators])
  const currentCandle = visible.length ? visible[visible.length - 1] : null
  const price = currentCandle?.close ?? 0
  const atEnd = candles.length > 0 && isAtEnd(candles, currentTime)

  const unrealized = position ? positionPnl(position, price) : 0
  const equity = balance + unrealized

  // Persist working state (debounced) so a refresh resumes where we left off.
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persist = useCallback(
    (patch: Parameters<typeof updateBacktestState>[1]) => {
      if (persistTimer.current) clearTimeout(persistTimer.current)
      persistTimer.current = setTimeout(() => {
        updateBacktestState(session.id, patch).catch(() => {})
      }, 800)
    },
    [session.id],
  )

  // Advance exactly one candle: reveal it, then let the execution engine act on
  // it. A close becomes a real journal trade.
  const advance = useCallback(() => {
    const nt = nextCandleTime(candles, currentTime)
    if (nt == null) {
      setPlaying(false)
      return
    }
    const bar = candleAt(candles, nt)
    setCurrentTime(nt)
    if (!bar) return

    const result = stepCandle(bar, position, orders)
    if (result.closed.length > 0) {
      let newBalance = balance
      for (const ev of result.closed) {
        newBalance += ev.pnl
        const trade: LocalTrade = {
          side: ev.position.side,
          qty: ev.position.qty,
          entryPrice: ev.position.entryPrice,
          exitPrice: ev.exitPrice,
          entryTime: ev.position.entryTime,
          exitTime: ev.exitTime,
          pnl: ev.pnl,
          reason: ev.reason,
        }
        setClosed((c) => [...c, trade])
        saveBacktestTrade(session.id, {
          symbol: session.symbol,
          market: session.market,
          side: ev.position.side,
          quantity: ev.position.qty,
          entryPrice: ev.position.entryPrice,
          exitPrice: ev.exitPrice,
          stopLoss: ev.position.stopLoss,
          takeProfit: ev.position.takeProfit,
          entryTime: new Date(ev.position.entryTime * 1000).toISOString(),
          exitTime: new Date(ev.exitTime * 1000).toISOString(),
        }).catch(() => {})
      }
      setBalance(newBalance)
      setPosition(result.position)
      persist({ currentTime: new Date(nt * 1000), currentBalance: newBalance, openPosition: result.position })
    } else {
      setPosition(result.position)
      persist({ currentTime: new Date(nt * 1000), openPosition: result.position })
    }
  }, [candles, currentTime, position, orders, balance, persist, session.id, session.symbol, session.market])

  // Play loop — steps on an interval scaled by speed. Uses market time, never
  // wall-clock beyond the tick cadence.
  useEffect(() => {
    if (!playing) return
    if (atEnd) {
      setPlaying(false)
      return
    }
    const id = setInterval(advance, Math.max(40, BASE_TICK_MS / speed))
    return () => clearInterval(id)
  }, [playing, speed, advance, atEnd])

  function openMarket(side: "long" | "short") {
    if (position || !currentCandle) return
    const sl = slInput ? Number(slInput) : null
    const tp = tpInput ? Number(tpInput) : null
    let qty = Number(qtyInput) || 0
    if (useRisk && sl != null) {
      qty = sizeFromRisk({ balance, riskPct: Number(riskPct) || 0, entryPrice: price, stopPrice: sl, spec })
    }
    if (!(qty > 0)) {
      toast.error(t("Set a quantity (or a risk % with a stop) first"))
      return
    }
    const pos: OpenPosition = {
      side,
      qty,
      entryPrice: price,
      entryTime: currentTime,
      stopLoss: sl,
      takeProfit: tp,
      symbol: session.symbol,
      contractMultiplier,
      fees: 0,
    }
    setPosition(pos)
    persist({ openPosition: pos })
  }

  function closeNow() {
    if (!position || !currentCandle) return
    const pnl = positionPnl(position, price)
    const newBalance = balance + pnl
    const trade: LocalTrade = {
      side: position.side,
      qty: position.qty,
      entryPrice: position.entryPrice,
      exitPrice: price,
      entryTime: position.entryTime,
      exitTime: currentTime,
      pnl,
      reason: "manual",
    }
    setClosed((c) => [...c, trade])
    setBalance(newBalance)
    saveBacktestTrade(session.id, {
      symbol: session.symbol,
      market: session.market,
      side: position.side,
      quantity: position.qty,
      entryPrice: position.entryPrice,
      exitPrice: price,
      stopLoss: position.stopLoss,
      takeProfit: position.takeProfit,
      entryTime: new Date(position.entryTime * 1000).toISOString(),
      exitTime: new Date(currentTime * 1000).toISOString(),
    }).catch(() => {})
    setPosition(null)
    persist({ currentBalance: newBalance, openPosition: null })
  }

  function moveSlToBreakeven() {
    if (!position) return
    const p = { ...position, stopLoss: position.entryPrice }
    setPosition(p)
    persist({ openPosition: p })
  }

  function restart() {
    setPlaying(false)
    setPosition(null)
    setClosed([])
    setBalance(session.startingBalance)
    setCurrentTime(session.currentTime)
    persist({ currentTime: new Date(session.currentTime * 1000), currentBalance: session.startingBalance, openPosition: null, status: "active" })
  }

  async function endBacktest() {
    setPlaying(false)
    if (position) closeNow()
    await finishBacktest(session.id).catch(() => {})
    setFinished(true)
    toast.success(t("Backtest ended — trades saved to your journal"))
    router.refresh()
  }

  // Chart overlays derived from live state.
  const markers: ChartMarker[] = useMemo(() => {
    const m: ChartMarker[] = []
    for (const t of closed) {
      m.push({ time: t.entryTime, position: t.side === "long" ? "belowBar" : "aboveBar", color: t.side === "long" ? "#16a34a" : "#dc2626", shape: t.side === "long" ? "arrowUp" : "arrowDown" })
      m.push({ time: t.exitTime, position: t.side === "long" ? "aboveBar" : "belowBar", color: t.pnl >= 0 ? "#16a34a" : "#dc2626", shape: "circle", text: (t.pnl >= 0 ? "+" : "") + Math.round(t.pnl) })
    }
    if (position) m.push({ time: position.entryTime, position: position.side === "long" ? "belowBar" : "aboveBar", color: "#6366f1", shape: position.side === "long" ? "arrowUp" : "arrowDown", text: t("Entry") })
    return m.sort((a, b) => a.time - b.time)
  }, [closed, position, t])

  const priceLines: ChartPriceLine[] = useMemo(() => {
    if (!position) return []
    const lines: ChartPriceLine[] = [{ price: position.entryPrice, color: "#6366f1", title: t("Entry") }]
    if (position.stopLoss != null) lines.push({ price: position.stopLoss, color: "#dc2626", title: "SL", dashed: true })
    if (position.takeProfit != null) lines.push({ price: position.takeProfit, color: "#16a34a", title: "TP", dashed: true })
    return lines
  }, [position, t])

  const netPnl = balance - session.startingBalance
  const wins = closed.filter((c) => c.pnl > 0).length
  const marketTime = currentCandle ? new Date(currentCandle.time * 1000) : null
  const clockLabel = marketTime
    ? session.randomMode && !finished
      ? marketTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
      : marketTime.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—"

  const riskPreview = useRisk && slInput ? riskAmountFor({ qty: sizeFromRisk({ balance, riskPct: Number(riskPct) || 0, entryPrice: price, stopPrice: Number(slInput), spec }), entryPrice: price, stopPrice: Number(slInput), spec }) : null

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" /> {t("Loading market data…")}
      </div>
    )
  }
  if (loadError) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t("The free data provider may not have this symbol/timeframe for that period. Try another market or a higher timeframe.")}</p>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-8.5rem)] flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_300px]">
        {/* Chart column: toolbar on top, drawing rail on the left */}
        <div className="flex min-h-0 flex-col border-b lg:border-r lg:border-b-0">
          <BacktestChartToolbar
            timeframe={viewTf}
            onTimeframe={onTimeframe}
            seriesType={seriesType}
            onSeriesType={setSeriesType}
            selectedIndicators={indicators}
            onToggleIndicator={toggleIndicator}
            canUndo={drawings.length > 0}
            onUndo={undoDrawing}
            canRedo={redoStack.length > 0}
            onRedo={redoDrawing}
          />
          <div className="flex min-h-0 flex-1">
            <BacktestDrawingRail
              activeTool={activeTool}
              onTool={setActiveTool}
              magnet={magnet}
              onToggleMagnet={() => setMagnet((m) => !m)}
              showDrawings={showDrawings}
              onToggleShowDrawings={() => setShowDrawings((s) => !s)}
              onClear={() => {
                setDrawings([])
                setRedoStack([])
                pendingPoint.current = null
              }}
            />
            <div className="relative min-h-[320px] flex-1">
              <div className="pointer-events-none absolute top-2 left-2 z-10 flex items-center gap-2 rounded-md bg-background/70 px-2 py-1 text-xs backdrop-blur">
                <span className="font-semibold">{session.symbol}</span>
                <span className="text-muted-foreground">{viewTf}</span>
                {activeTool !== "cursor" && <span className="text-indigo-500">{t("drawing")}</span>}
                {session.randomMode && !finished && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Dice5 className="size-3" /> {t("hidden date")}
                  </span>
                )}
              </div>
              <BacktestChart
                candles={visible}
                markers={markers}
                priceLines={priceLines}
                seriesType={seriesType}
                indicators={indicatorOutputs}
                drawings={drawings}
                showDrawings={showDrawings}
                magnet={magnet}
                onChartClick={onChartClick}
              />
            </div>
          </div>
        </div>

        {/* Account + order panel */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
          <div className="grid grid-cols-2 gap-2">
            <Stat label={t("Balance")} value={usd(balance)} />
            <Stat label={t("Equity")} value={usd(equity)} />
            <Stat label={t("Open P&L")} value={usd(unrealized)} tone={unrealized > 0 ? "up" : unrealized < 0 ? "down" : undefined} />
            <Stat label={t("Net P&L")} value={usd(netPnl)} tone={netPnl > 0 ? "up" : netPnl < 0 ? "down" : undefined} />
          </div>

          {position ? (
            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{t("Position")}</span>
                <Badge variant={position.side === "long" ? "secondary" : "outline"}>{position.side === "long" ? t("LONG") : t("SHORT")}</Badge>
              </div>
              <Row k={t("Qty")} v={String(position.qty)} />
              <Row k={t("Entry")} v={String(position.entryPrice)} />
              <Row k="SL" v={position.stopLoss != null ? String(position.stopLoss) : "—"} />
              <Row k="TP" v={position.takeProfit != null ? String(position.takeProfit) : "—"} />
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" className="flex-1" onClick={moveSlToBreakeven} disabled={finished}>
                  {t("SL → BE")}
                </Button>
                <Button size="sm" variant="destructive" className="flex-1" onClick={closeNow} disabled={finished}>
                  {t("Close")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border p-3">
              <span className="text-sm font-semibold">{t("New order")}</span>
              <label className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t("Size by risk %")}</span>
                <input type="checkbox" checked={useRisk} onChange={(e) => setUseRisk(e.target.checked)} />
              </label>
              {useRisk ? (
                <LabeledInput label={t("Risk %")} value={riskPct} onChange={setRiskPct} />
              ) : (
                <LabeledInput label={t("Quantity")} value={qtyInput} onChange={setQtyInput} />
              )}
              <LabeledInput label={t("Stop loss")} value={slInput} onChange={setSlInput} placeholder={t("price")} />
              <LabeledInput label={t("Take profit")} value={tpInput} onChange={setTpInput} placeholder={t("price")} />
              {riskPreview != null && <p className="text-xs text-muted-foreground">{t("Risking")} {usd(riskPreview)}</p>}
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="flex-1 bg-emerald-600 text-white hover:bg-emerald-600/90" onClick={() => openMarket("long")} disabled={finished || atEnd}>
                  {t("BUY")}
                </Button>
                <Button size="sm" className="flex-1 bg-red-600 text-white hover:bg-red-600/90" onClick={() => openMarket("short")} disabled={finished || atEnd}>
                  {t("SELL")}
                </Button>
              </div>
            </div>
          )}

          <div className="rounded-lg border p-3 text-sm">
            <div className="mb-1 font-semibold">{t("This session")}</div>
            <Row k={t("Trades")} v={String(closed.length)} />
            <Row k={t("Win rate")} v={closed.length ? `${Math.round((wins / closed.length) * 100)}%` : "—"} />
          </div>
        </div>
      </div>

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
        <Button size="sm" variant={playing ? "secondary" : "default"} onClick={() => setPlaying((p) => !p)} disabled={finished || atEnd}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          {playing ? t("Pause") : t("Play")}
        </Button>
        <Button size="sm" variant="outline" onClick={advance} disabled={finished || atEnd || playing}>
          <ChevronRight className="size-4" /> {t("Next")}
        </Button>
        <div className="flex items-center gap-1">
          {SPEEDS.map((s) => (
            <Button key={s} size="xs" variant={speed === s ? "default" : "ghost"} onClick={() => { setSpeed(s); persist({ speed: s }) }}>
              {s}x
            </Button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={restart} disabled={finished}>
          <RotateCcw className="size-4" /> {t("Restart")}
        </Button>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm tabular-nums text-muted-foreground">{clockLabel}</span>
          {atEnd && <Badge variant="outline">{t("End of data")}</Badge>}
          <Button size="sm" variant="outline" onClick={endBacktest} disabled={finished}>
            <Flag className="size-4" /> {t("End backtest")}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-lg border p-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${tone === "up" ? "text-emerald-600 dark:text-emerald-400" : tone === "down" ? "text-red-600 dark:text-red-400" : ""}`}>{value}</div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium tabular-nums">{v}</span>
    </div>
  )
}

function LabeledInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode="decimal" className="h-8" />
    </label>
  )
}
