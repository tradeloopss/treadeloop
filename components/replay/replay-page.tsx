"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ChevronRight, Flag } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { timeframeSeconds } from "@/lib/market-data/types"
import { visibleCandles, nextCandleTime, candleAt, isAtEnd } from "@/lib/backtest/replay-engine"
import { REPLAY_ACCOUNTS, findSymbol, generateCandles, sessionStartUnix } from "@/lib/replay/mock"
import { pnl as calcPnl, riskAmount, hitLevel, dayKeyOf } from "@/lib/replay/calc"
import { accountState, ruleProgress, overallStatus, projectTrade, type SessionStats } from "@/lib/replay/rules"
import type { AccountState, ReplayActivityItem, ReplayMode, ReplayTrade, Side } from "@/lib/replay/types"
import type { ChartMarker, ChartPriceLine } from "@/components/backtest/backtest-chart"
import { ReplayControls } from "@/components/replay/replay-controls"
import { ReplayChart } from "@/components/replay/replay-chart"
import { ReplayTimeline } from "@/components/replay/replay-timeline"
import { PlaceTradePanel } from "@/components/replay/place-trade-panel"
import { ReplayAccountCard, PropFirmRulesCard } from "@/components/replay/account-rules-cards"
import { TradeDetailsPanel } from "@/components/replay/trade-details-panel"
import { TradesTables } from "@/components/replay/trades-tables"
import { RecentActivity, SessionTimeline } from "@/components/replay/replay-extras"
import { EditTradeModal, PartialCloseModal, CloseTradeModal, JournalNoteModal } from "@/components/replay/replay-modals"
import { ReplaySummary } from "@/components/replay/replay-summary"

let seq = 0
const uid = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`

function parseSession(s: string): [number, number] {
  const [a, b] = s.split(" - ").map((x) => Number(x.slice(0, 2)))
  return [Number.isFinite(a) ? a : 9, Number.isFinite(b) ? b : 16]
}

export function ReplayPage() {
  const [symbol, setSymbol] = useState("EURUSD")
  const [tf, setTf] = useState("15m")
  const [dateISO, setDateISO] = useState("2026-09-14")
  const [session, setSession] = useState("09:00 - 16:00")
  const [mode, setMode] = useState<ReplayMode>("single")
  const [speed, setSpeed] = useState(1)
  const [accountId, setAccountId] = useState("ftmo-100k")
  const [playing, setPlaying] = useState(false)

  const [trades, setTrades] = useState<ReplayTrade[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [worstEquity, setWorstEquity] = useState(100_000)
  const [activity, setActivity] = useState<ReplayActivityItem[]>([])
  const [modal, setModal] = useState<{ kind: "edit" | "partial" | "close" | "note"; id: string } | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)

  // Draft order.
  const [side, setSide] = useState<Side>("long")
  const [size, setSize] = useState("1.00")
  const [entry, setEntry] = useState("")
  const [sl, setSl] = useState("")
  const [tp, setTp] = useState("")

  const meta = findSymbol(symbol)
  const account = REPLAY_ACCOUNTS.find((a) => a.id === accountId) ?? REPLAY_ACCOUNTS[0]
  const tfSec = timeframeSeconds(tf)
  const [startHour, endHour] = parseSession(session)
  const startUnix = sessionStartUnix(dateISO, startHour)
  const count = Math.max(12, Math.round(((endHour - startHour) * 3600) / tfSec))

  const candles = useMemo(() => generateCandles(symbol, tfSec, startUnix, count), [symbol, tfSec, startUnix, count])
  const [cursor, setCursor] = useState<number>(() => candles[Math.floor(candles.length * 0.4)]?.time ?? startUnix)

  // Reset the whole session when the market/date/session changes.
  useEffect(() => {
    setPlaying(false)
    setTrades([])
    setActivity([])
    setSelectedId(null)
    setSummaryOpen(false)
    const idx = Math.min(candles.length - 1, Math.max(1, Math.floor(candles.length * 0.4)))
    setCursor(candles[idx]?.time ?? startUnix)
    setEntry("")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles])

  // Practice mode uses the no-limits practice account.
  useEffect(() => {
    if (mode === "practice") setAccountId("practice")
  }, [mode])
  useEffect(() => setWorstEquity(account.startingBalance), [accountId, account.startingBalance])

  const visible = useMemo(() => visibleCandles(candles, cursor), [candles, cursor])
  const currentPrice = visible.length ? visible[visible.length - 1].close : meta.basePrice
  const atStart = candles.length === 0 || cursor <= candles[0].time
  const atEnd = isAtEnd(candles, cursor)

  // Default the entry to the market once, so the panel isn't blank.
  useEffect(() => {
    if (entry.trim() === "") setEntry(currentPrice.toFixed(meta.digits))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPrice])

  // --- derived account + rules ---------------------------------------------
  const closed = useMemo(() => trades.filter((t) => t.status === "closed"), [trades])
  const openTrades = useMemo(() => trades.filter((t) => t.status === "open"), [trades])
  const realizedTotal = closed.reduce((s, t) => s + (t.pnl ?? 0), 0)
  const dayKey = dayKeyOf(cursor)
  const realizedToday = closed.filter((t) => dayKeyOf(t.exitTime ?? t.entryTime) === dayKey).reduce((s, t) => s + (t.pnl ?? 0), 0)
  const unrealized = openTrades.reduce((s, t) => s + calcPnl(t.side, t.entry, currentPrice, t.size, t.contractMultiplier), 0)
  const openRisk = openTrades.reduce((s, t) => s + riskAmount(t.side, t.entry, t.stopLoss, t.size, t.contractMultiplier), 0)
  const tradingDays = new Set(closed.map((t) => dayKeyOf(t.exitTime ?? t.entryTime))).size
  const equityNow = account.startingBalance + realizedTotal + unrealized

  useEffect(() => setWorstEquity((w) => Math.min(w, equityNow)), [equityNow])

  const stats: SessionStats = { realizedTotal, realizedToday, unrealized, worstEquity: Math.min(worstEquity, equityNow), tradingDays }
  const baseState = accountState(account, stats)
  const state: AccountState = { ...baseState, openRisk, openTrades: openTrades.length }
  const ruleRows = ruleProgress(account, stats)
  const overall = overallStatus(ruleRows)

  // Pre-trade projection for the place panel (from the current draft).
  const draftEntry = entry.trim() === "" ? currentPrice : Number(entry)
  const draftSl = sl.trim() === "" ? null : Number(sl)
  const draftSize = Number(size) || 0
  const draftWorstLoss = riskAmount(side, draftEntry, draftSl, draftSize, meta.contractMultiplier)
  const projection = projectTrade(account, stats, draftWorstLoss)

  const selectedTrade = openTrades.find((t) => t.id === selectedId) ?? null
  const modalTrade = modal ? trades.find((t) => t.id === modal.id) ?? null : null

  // Rule "remaining" for the details panel.
  const dailyLossUsed = Math.max(0, -(realizedToday + unrealized))
  const drawdownUsed = Math.max(0, account.startingBalance - Math.min(worstEquity, equityNow))
  const dailyLossRemaining = account.rules.dailyLoss != null ? Math.max(0, account.rules.dailyLoss - dailyLossUsed) : null
  const maxDrawdownRemaining = account.rules.maxDrawdown != null ? Math.max(0, account.rules.maxDrawdown - drawdownUsed) : null
  const afterSlStatus = selectedTrade
    ? projectTrade(account, stats, riskAmount(selectedTrade.side, selectedTrade.entry, selectedTrade.stopLoss, selectedTrade.size, selectedTrade.contractMultiplier)).status
    : "safe"

  // --- activity + engine ---------------------------------------------------
  function pushActivity(text: string, tone: ReplayActivityItem["tone"], at: number) {
    setActivity((p) => [{ id: uid(), text, at, tone }, ...p].slice(0, 30))
  }

  const candlesRef = useRef(candles)
  candlesRef.current = candles
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  const symbolRef = useRef(symbol)
  symbolRef.current = symbol
  const hasClosedRef = useRef(false)
  hasClosedRef.current = closed.length > 0

  function processCandle(time: number) {
    const c = candleAt(candlesRef.current, time)
    if (!c) return
    setTrades((prev) => {
      let changed = false
      const next = prev.map((t) => {
        if (t.status !== "open" || t.symbol !== symbolRef.current) return t
        const hit = hitLevel(t, c.high, c.low)
        if (!hit) return t
        changed = true
        const realized = calcPnl(t.side, t.entry, hit.price, t.size, t.contractMultiplier)
        pushActivity(`${t.symbol} ${hit.reason === "tp" ? "take profit hit" : "stop loss hit"}`, hit.reason === "tp" ? "gain" : "loss", time)
        if (hit.reason === "tp") toast.success(`Take profit hit · ${t.symbol}`, { description: `+$${realized.toFixed(2)}` })
        else toast.error(`Stop loss hit · ${t.symbol}`, { description: `-$${Math.abs(realized).toFixed(2)}` })
        return { ...t, status: "closed" as const, exitPrice: hit.price, exitTime: time, pnl: realized, result: realized >= 0 ? ("win" as const) : ("loss" as const), reason: hit.reason }
      })
      return changed ? next : prev
    })
  }

  function advance() {
    const nt = nextCandleTime(candlesRef.current, cursorRef.current)
    if (nt == null) {
      setPlaying(false)
      if (hasClosedRef.current) setSummaryOpen(true)
      return
    }
    setCursor(nt)
    processCandle(nt)
  }
  const advanceRef = useRef(advance)
  advanceRef.current = advance

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => advanceRef.current(), Math.max(140, 1000 / speed))
    return () => clearInterval(id)
  }, [playing, speed])

  function prev() {
    const idx = candles.findIndex((c) => c.time === cursor)
    if (idx > 0) setCursor(candles[idx - 1].time)
  }
  function reset() {
    setPlaying(false)
    setTrades([])
    setActivity([])
    setSelectedId(null)
    setSummaryOpen(false)
    const idx = Math.min(candles.length - 1, Math.max(1, Math.floor(candles.length * 0.4)))
    setCursor(candles[idx]?.time ?? startUnix)
    setWorstEquity(account.startingBalance)
    toast("Replay reset")
  }

  // --- trade actions -------------------------------------------------------
  function placeTrade() {
    const nEntry = entry.trim() === "" ? currentPrice : Number(entry)
    const nSize = Number(size)
    if (!(nSize > 0) || !(nEntry > 0)) return toast.error("Enter a size and entry price.")
    const nSl = sl.trim() === "" ? null : Number(sl)
    const nTp = tp.trim() === "" ? null : Number(tp)
    const worst = riskAmount(side, nEntry, nSl, nSize, meta.contractMultiplier)
    const proj = projectTrade(account, stats, worst)
    if (proj.status === "breach") return toast.error("Trade blocked by prop firm rule", { description: proj.message ?? undefined })
    const t: ReplayTrade = {
      id: uid(),
      symbol,
      side,
      size: nSize,
      entry: nEntry,
      stopLoss: nSl,
      takeProfit: nTp,
      entryTime: cursor,
      status: "open",
      contractMultiplier: meta.contractMultiplier,
      pip: meta.pip,
      digits: meta.digits,
    }
    setTrades((p) => [...p, t])
    setSelectedId(t.id)
    pushActivity(`${symbol} ${side === "long" ? "buy" : "sell"} position opened`, "neutral", cursor)
    toast.success(`${side === "long" ? "Buy" : "Sell"} order placed · ${symbol}`)
  }

  function closeTrade(id: string) {
    setTrades((prev) =>
      prev.map((t) => {
        if (t.id !== id || t.status !== "open") return t
        const realized = calcPnl(t.side, t.entry, currentPrice, t.size, t.contractMultiplier)
        pushActivity(`${t.symbol} position closed`, realized >= 0 ? "gain" : "loss", cursor)
        toast.success(`Trade closed · ${t.symbol}`, { description: `${realized >= 0 ? "+" : "-"}$${Math.abs(realized).toFixed(2)}` })
        return { ...t, status: "closed", exitPrice: currentPrice, exitTime: cursor, pnl: realized, result: realized >= 0 ? "win" : "loss", reason: "manual" }
      }),
    )
    if (selectedId === id) setSelectedId(null)
    setModal(null)
  }

  function editTrade(id: string, newSl: number | null, newTp: number | null) {
    setTrades((prev) => prev.map((t) => (t.id === id ? { ...t, stopLoss: newSl, takeProfit: newTp } : t)))
    pushActivity(`${symbol} SL/TP updated`, "neutral", cursor)
    toast.success("Levels updated")
    setModal(null)
  }

  function breakEven(id: string) {
    setTrades((prev) => prev.map((t) => (t.id === id ? { ...t, stopLoss: t.entry } : t)))
    pushActivity(`${symbol} SL moved to break-even`, "neutral", cursor)
    toast.success("Stop moved to break-even")
  }

  function partialClose(id: string, closeLots: number) {
    setTrades((prev) => {
      const out: ReplayTrade[] = []
      for (const t of prev) {
        if (t.id !== id || t.status !== "open") {
          out.push(t)
          continue
        }
        const lots = Math.min(closeLots, t.size)
        const realized = calcPnl(t.side, t.entry, currentPrice, lots, t.contractMultiplier)
        out.push({ id: uid(), symbol: t.symbol, side: t.side, size: lots, entry: t.entry, stopLoss: t.stopLoss, takeProfit: t.takeProfit, entryTime: t.entryTime, status: "closed", exitPrice: currentPrice, exitTime: cursor, pnl: realized, result: realized >= 0 ? "win" : "loss", reason: "manual", contractMultiplier: t.contractMultiplier, pip: t.pip, digits: t.digits })
        const remaining = Math.round((t.size - lots) * 100) / 100
        if (remaining > 0) out.push({ ...t, size: remaining })
      }
      return out
    })
    pushActivity(`${symbol} partially closed`, "gain", cursor)
    toast.success("Partial close done")
    setModal(null)
  }

  function addNote(id: string, note: string, tags: string[]) {
    setTrades((prev) => prev.map((t) => (t.id === id ? { ...t, note, tags } : t)))
    pushActivity(`${symbol} note added`, "neutral", cursor)
    toast.success("Note saved")
    setModal(null)
  }

  // --- chart overlays ------------------------------------------------------
  const shown = selectedTrade
  const priceLines: ChartPriceLine[] = []
  if (shown) {
    priceLines.push({ price: shown.entry, color: "#6d4aff", title: "Entry" })
    if (shown.stopLoss != null) priceLines.push({ price: shown.stopLoss, color: "#dc2626", title: "SL" })
    if (shown.takeProfit != null) priceLines.push({ price: shown.takeProfit, color: "#16a34a", title: "TP" })
  } else if (draftSize > 0 && draftEntry > 0) {
    priceLines.push({ price: draftEntry, color: "#6d4aff", title: "Entry", dashed: true })
    if (draftSl != null) priceLines.push({ price: draftSl, color: "#dc2626", title: "SL", dashed: true })
    if (tp.trim() !== "") priceLines.push({ price: Number(tp), color: "#16a34a", title: "TP", dashed: true })
  }
  const markers: ChartMarker[] = []
  for (const t of trades) {
    if (t.entryTime <= cursor) markers.push({ time: t.entryTime, position: t.side === "long" ? "belowBar" : "aboveBar", color: t.side === "long" ? "#16a34a" : "#dc2626", shape: t.side === "long" ? "arrowUp" : "arrowDown" })
    if (t.status === "closed" && t.exitTime != null && t.exitTime <= cursor) markers.push({ time: t.exitTime, position: "aboveBar", color: "#6d4aff", shape: "circle", text: t.reason === "tp" ? "TP" : t.reason === "sl" ? "SL" : "Exit" })
  }

  const nonPractice = mode !== "practice"

  return (
    <div className="@container/replay min-h-full bg-background">
      <div className="space-y-4 p-4 @[900px]/replay:p-6">
        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <nav className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Link href="/dashboard" className="hover:text-foreground">
                Home
              </Link>
              <ChevronRight className="size-3" />
              <span className="font-medium text-foreground">Replay</span>
            </nav>
            <h1 className="text-[26px] font-semibold tracking-[-0.5px] text-foreground @[768px]/replay:text-[30px]">Trade Replay</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Practice your setups, replay markets, and improve your decisions.</p>
          </div>
          <Button variant="outline" onClick={() => setSummaryOpen(true)} disabled={closed.length === 0}>
            <Flag className="size-4" /> End &amp; review
          </Button>
        </header>

        {/* Controls */}
        <ReplayControls
          symbol={symbol}
          onSymbol={setSymbol}
          timeframe={tf}
          onTimeframe={setTf}
          dateISO={dateISO}
          onDate={setDateISO}
          session={session}
          onSession={setSession}
          mode={mode}
          onMode={setMode}
          speed={speed}
          onSpeed={setSpeed}
          playing={playing}
          onPlayPause={() => setPlaying((p) => !p)}
          onNext={advance}
          onPrev={prev}
          onReset={reset}
          atStart={atStart}
          atEnd={atEnd}
        />

        {/* Workspace + details */}
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-4">
            <div className="h-[420px]">
              <ReplayChart candles={visible} priceLines={priceLines} markers={markers} digits={meta.digits} symbol={symbol} timeframe={tf} />
            </div>
            <ReplayTimeline times={candles.map((c) => c.time)} cursor={cursor} onSeek={setCursor} />

            <div className="grid gap-4 lg:grid-cols-3">
              <PlaceTradePanel
                side={side}
                onSide={setSide}
                size={size}
                onSize={setSize}
                entry={entry}
                onEntry={setEntry}
                sl={sl}
                onSl={setSl}
                tp={tp}
                onTp={setTp}
                meta={meta}
                balance={state.balance}
                projection={nonPractice ? projection : { status: "safe", message: null }}
                onPlace={placeTrade}
              />
              <ReplayAccountCard account={account} accounts={REPLAY_ACCOUNTS} onSelect={setAccountId} state={state} />
              <PropFirmRulesCard account={account} rows={ruleRows} overall={overall} />
            </div>

            <TradesTables
              open={openTrades}
              history={closed}
              currentPrice={currentPrice}
              meta={meta}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onAction={(id, action) => (action === "close" ? setModal({ kind: "close", id }) : setModal({ kind: action, id }))}
            />

            <div className="grid gap-4 lg:grid-cols-2">
              <SessionTimeline startUnix={candles[0]?.time ?? startUnix} endUnix={candles[candles.length - 1]?.time ?? startUnix} trades={trades} />
              <RecentActivity items={activity} now={cursor} />
            </div>
          </div>

          <div className="min-w-0 xl:sticky xl:top-4 xl:self-start">
            <TradeDetailsPanel
              trade={selectedTrade}
              currentPrice={currentPrice}
              meta={meta}
              account={account}
              dailyLossRemaining={dailyLossRemaining}
              maxDrawdownRemaining={maxDrawdownRemaining}
              afterSlStatus={afterSlStatus}
              onClose={() => setSelectedId(null)}
              onEdit={() => selectedTrade && setModal({ kind: "edit", id: selectedTrade.id })}
              onPartial={() => selectedTrade && setModal({ kind: "partial", id: selectedTrade.id })}
              onBreakEven={() => selectedTrade && breakEven(selectedTrade.id)}
              onCloseTrade={() => selectedTrade && setModal({ kind: "close", id: selectedTrade.id })}
              onNote={() => selectedTrade && setModal({ kind: "note", id: selectedTrade.id })}
            />
          </div>
        </div>
      </div>

      {modal && modalTrade && modal.kind === "edit" && <EditTradeModal trade={modalTrade} meta={meta} onSave={(s, t) => editTrade(modalTrade.id, s, t)} onClose={() => setModal(null)} />}
      {modal && modalTrade && modal.kind === "partial" && <PartialCloseModal trade={modalTrade} current={currentPrice} onConfirm={(lots) => partialClose(modalTrade.id, lots)} onClose={() => setModal(null)} />}
      {modal && modalTrade && modal.kind === "close" && <CloseTradeModal trade={modalTrade} current={currentPrice} onConfirm={() => closeTrade(modalTrade.id)} onClose={() => setModal(null)} />}
      {modal && modalTrade && modal.kind === "note" && <JournalNoteModal trade={modalTrade} onSave={(n, tags) => addNote(modalTrade.id, n, tags)} onClose={() => setModal(null)} />}

      {summaryOpen && <ReplaySummary trades={trades} onReview={() => setSummaryOpen(false)} onJournal={() => setSummaryOpen(false)} onRestart={() => { setSummaryOpen(false); reset() }} onClose={() => setSummaryOpen(false)} />}
    </div>
  )
}
