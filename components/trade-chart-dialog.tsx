"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ReferenceDot,
} from "recharts"
import { getTradeChartData, type TradeChartData, type ChartPoint } from "@/app/actions/chart"
import { INTERVAL_LIMITS, defaultInterval, availableIntervals } from "@/lib/chart-intervals"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Loader2, ZoomOut } from "lucide-react"
import { useIntlLocale, useT } from "@/components/locale-provider"

export interface ChartTrade {
  symbol: string
  market: string
  side: string
  entryTime: string
  exitTime: string | null
  entryPrice: number
  exitPrice: number | null
  stopLoss: number | null
  takeProfit: number | null
  pnl: number
}

type Point = ChartPoint & { range: [number, number] }

function formatTick(sec: number, interval: string) {
  const d = new Date(sec * 1000)
  return interval === "1d"
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

// Recharts has no built-in candlestick — this draws one per bar using a
// custom Bar shape. Recharts maps the [low, high] range dataKey onto the
// bar's own y/height, so the open/close body is positioned by linearly
// interpolating within that same pixel range rather than needing direct
// access to the chart's y-scale.
function Candlestick(props: { x?: number; y?: number; width?: number; height?: number; payload?: Point }) {
  const { x, y, width, height, payload } = props
  if (x == null || y == null || width == null || height == null || !payload) return null
  const { open, close, high, low } = payload
  if (high === low) return null

  const isUp = close >= open
  const color = isUp ? "var(--gain)" : "var(--loss)"
  const priceToY = (price: number) => y + ((high - price) / (high - low)) * height
  const bodyTop = priceToY(Math.max(open, close))
  const bodyBottom = priceToY(Math.min(open, close))
  const bodyHeight = Math.max(bodyBottom - bodyTop, 1)
  const wickX = x + width / 2
  const bodyWidth = Math.max(width * 0.7, 2)
  const bodyX = x + (width - bodyWidth) / 2

  return (
    <g>
      <line x1={wickX} x2={wickX} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={bodyX} y={bodyTop} width={bodyWidth} height={bodyHeight} fill={color} />
    </g>
  )
}

function VolumeBar(props: { x?: number; y?: number; width?: number; height?: number; payload?: Point }) {
  const { x, y, width, height, payload } = props
  if (x == null || y == null || width == null || height == null || !payload) return null
  const color = payload.close >= payload.open ? "var(--gain)" : "var(--loss)"
  return <rect x={x} y={y} width={width} height={height} fill={color} opacity={0.35} />
}

// A crosshair that follows the cursor — the vertical line comes from
// recharts' own hover position, the horizontal one is derived from the
// hovered candle's close so it tracks price too, matching how a real
// trading platform's crosshair behaves.
function Crosshair(props: { points?: { x: number; y: number }[]; height?: number; width?: number }) {
  const { points, height, width } = props
  if (!points || points.length === 0 || height == null || width == null) return null
  const { x, y } = points[0]
  return (
    <g>
      <line x1={x} x2={x} y1={0} y2={height} stroke="var(--muted-foreground)" strokeDasharray="3 3" strokeWidth={1} />
      <line x1={0} x2={width} y1={y} y2={y} stroke="var(--muted-foreground)" strokeDasharray="3 3" strokeWidth={1} />
    </g>
  )
}

export function TradeChartDialog({
  trade,
  open,
  onOpenChange,
}: {
  trade: ChartTrade
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [interval, setInterval] = useState(() => defaultInterval(trade.entryTime))
  const [data, setData] = useState<TradeChartData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [domain, setDomain] = useState<[number, number] | null>(null)

  const t = useT()
  const dateLocale = useIntlLocale()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startDomain: [number, number] } | null>(null)

  const intervals = useMemo(() => availableIntervals(), [])

  useEffect(() => {
    if (!open) return
    setInterval(defaultInterval(trade.entryTime))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trade.entryTime])

  useEffect(() => {
    if (!open) return
    // Guards against a stale response overwriting a newer one — e.g. React
    // re-running this effect twice in dev, or switching timeframes quickly
    // enough that two requests are in flight at once.
    let cancelled = false
    setLoading(true)
    setError(null)
    getTradeChartData(trade.symbol, trade.market, trade.entryTime, trade.exitTime, interval)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? t(err.message) : t("Could not load chart"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, trade.symbol, trade.market, trade.entryTime, trade.exitTime, interval])

  const entrySec = Math.floor(new Date(trade.entryTime).getTime() / 1000)
  const exitSec = trade.exitTime ? Math.floor(new Date(trade.exitTime).getTime() / 1000) : null
  const exitColor = trade.pnl >= 0 ? "var(--gain)" : "var(--loss)"

  // The candlestick Bar reads its pixel range from a [low, high] dataKey —
  // the custom shape then interpolates the open/close body within that same
  // pixel span (see Candlestick above).
  const chartPoints: Point[] = useMemo(
    () => (data ? data.points.map((p) => ({ ...p, range: [p.low, p.high] as [number, number] })) : []),
    [data]
  )

  const fullDomain = useMemo((): [number, number] | null => {
    if (chartPoints.length === 0) return null
    return [chartPoints[0].time, chartPoints[chartPoints.length - 1].time]
  }, [chartPoints])

  // Reset the zoom window every time a fresh dataset comes in (new trade or
  // timeframe switch) rather than carrying over a stale zoomed range.
  useEffect(() => {
    setDomain(fullDomain)
    setHoverIndex(null)
  }, [fullDomain])

  const visibleDomain = domain ?? fullDomain

  function onWheel(e: React.WheelEvent) {
    if (!fullDomain || !visibleDomain) return
    e.preventDefault()
    const [lo, hi] = visibleDomain
    const [fullLo, fullHi] = fullDomain
    const fullRange = fullHi - fullLo || 1
    const range = hi - lo || 1
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15
    const mid = (lo + hi) / 2
    let newRange = Math.min(Math.max(range * factor, fullRange * 0.01), fullRange)
    let newLo = mid - newRange / 2
    let newHi = mid + newRange / 2
    if (newLo < fullLo) { newHi += fullLo - newLo; newLo = fullLo }
    if (newHi > fullHi) { newLo -= newHi - fullHi; newHi = fullHi }
    setDomain([Math.max(newLo, fullLo), Math.min(newHi, fullHi)])
  }

  function onMouseDown(e: React.MouseEvent) {
    if (!visibleDomain) return
    dragRef.current = { startX: e.clientX, startDomain: visibleDomain }
  }
  function onMouseMoveDrag(e: React.MouseEvent) {
    if (!dragRef.current || !fullDomain || !wrapperRef.current) return
    const { startX, startDomain } = dragRef.current
    const width = wrapperRef.current.clientWidth || 1
    const range = startDomain[1] - startDomain[0]
    const deltaTime = (-(e.clientX - startX) / width) * range
    let newLo = startDomain[0] + deltaTime
    let newHi = startDomain[1] + deltaTime
    const [fullLo, fullHi] = fullDomain
    if (newLo < fullLo) { newHi += fullLo - newLo; newLo = fullLo }
    if (newHi > fullHi) { newLo -= newHi - fullHi; newHi = fullHi }
    setDomain([newLo, newHi])
  }
  function onMouseUp() {
    dragRef.current = null
  }

  // Candle high/low alone can miss the SL/TP levels (a stop can sit well
  // outside the price action actually shown) — fold them into the Y domain
  // explicitly so they're never clipped off-screen.
  const yDomain = useMemo((): [number, number] | ["auto", "auto"] => {
    const visible = visibleDomain
      ? chartPoints.filter((p) => p.time >= visibleDomain[0] && p.time <= visibleDomain[1])
      : chartPoints
    if (visible.length === 0) return ["auto", "auto"]
    const values = visible.flatMap((p) => [p.low, p.high])
    values.push(trade.entryPrice)
    if (trade.exitPrice != null) values.push(trade.exitPrice)
    if (trade.stopLoss != null) values.push(trade.stopLoss)
    if (trade.takeProfit != null) values.push(trade.takeProfit)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const pad = (max - min) * 0.08 || 1
    return [min - pad, max + pad]
  }, [chartPoints, visibleDomain, trade.entryPrice, trade.exitPrice, trade.stopLoss, trade.takeProfit])

  const maxVolume = useMemo(() => Math.max(1, ...chartPoints.map((p) => p.volume)), [chartPoints])
  const shown = hoverIndex != null ? chartPoints[hoverIndex] : chartPoints[chartPoints.length - 1]
  const isZoomed = !!domain && !!fullDomain && (domain[0] !== fullDomain[0] || domain[1] !== fullDomain[1])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{trade.symbol}</DialogTitle>
          <DialogDescription>
            {trade.side === "long" ? t("Long") : t("Short")} · {t("entered {time}", { time: new Date(trade.entryTime).toLocaleString(dateLocale) })}
            {trade.exitTime && <> · {t("exited {time}", { time: new Date(trade.exitTime).toLocaleString(dateLocale) })}</>}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-[var(--primary)]" /> {t("Entry")} {trade.entryPrice}
            </span>
            {trade.exitPrice != null && (
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: exitColor }} /> {t("Exit")} {trade.exitPrice}
              </span>
            )}
            {trade.stopLoss != null && (
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 bg-[var(--loss)]" /> {t("Stop loss")} {trade.stopLoss}
              </span>
            )}
            {trade.takeProfit != null && (
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 bg-[var(--gain)]" /> {t("Take profit")} {trade.takeProfit}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isZoomed && (
              <button
                type="button"
                onClick={() => setDomain(fullDomain)}
                className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ZoomOut className="size-3.5" /> {t("Reset zoom")}
              </button>
            )}
            <div className="flex items-center gap-1 rounded-lg border p-1">
              {intervals.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setInterval(i)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                    interval === i ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {INTERVAL_LIMITS[i].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading && (
          <div className="flex h-[460px] items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}

        {error && !loading && (
          <div className="flex h-[460px] items-center justify-center px-8 text-center text-sm text-muted-foreground">
            {error}
          </div>
        )}

        {data && !loading && !error && (
          <>
            {shown && (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-xs">
                <span className={cn("font-semibold", shown.close >= shown.open ? "text-[var(--gain)]" : "text-[var(--loss)]")}>
                  {data.symbol}
                </span>
                <span>O <span className="text-foreground">{shown.open.toFixed(2)}</span></span>
                <span>H <span className="text-foreground">{shown.high.toFixed(2)}</span></span>
                <span>L <span className="text-foreground">{shown.low.toFixed(2)}</span></span>
                <span>C <span className="text-foreground">{shown.close.toFixed(2)}</span></span>
                <span className="text-muted-foreground">Vol <span className="text-foreground">{shown.volume.toLocaleString()}</span></span>
              </div>
            )}

            <div
              ref={wrapperRef}
              className="h-[460px] w-full cursor-crosshair select-none"
              onWheel={onWheel}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMoveDrag}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
            >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartPoints}
                  margin={{ top: 12, right: 16, left: 8, bottom: 0 }}
                  onMouseMove={(state) => {
                    if (state?.isTooltipActive && state.activeTooltipIndex != null) {
                      setHoverIndex(Number(state.activeTooltipIndex))
                    }
                  }}
                  onMouseLeave={() => setHoverIndex(null)}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="time"
                    type="number"
                    domain={visibleDomain ?? ["dataMin", "dataMax"]}
                    allowDataOverflow
                    tickFormatter={(v) => formatTick(v, data.interval)}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={40}
                  />
                  <YAxis
                    yAxisId="price"
                    domain={yDomain}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                    width={64}
                  />
                  <YAxis yAxisId="volume" domain={[0, maxVolume * 4]} hide />
                  <Tooltip
                    cursor={<Crosshair />}
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                      color: "var(--popover-foreground)",
                    }}
                    labelFormatter={(v) => new Date(Number(v) * 1000).toLocaleString()}
                    formatter={(value, name) =>
                      name === "volume"
                        ? [Number(value).toLocaleString(), "VOL"]
                        : [typeof value === "number" ? value.toFixed(2) : String(value ?? ""), String(name).toUpperCase()]
                    }
                  />

                  {trade.stopLoss != null && (
                    <ReferenceLine
                      yAxisId="price"
                      y={trade.stopLoss}
                      stroke="var(--loss)"
                      strokeDasharray="4 4"
                      label={{ value: "SL", position: "insideTopRight", fontSize: 11, fill: "var(--loss)" }}
                    />
                  )}
                  {trade.takeProfit != null && (
                    <ReferenceLine
                      yAxisId="price"
                      y={trade.takeProfit}
                      stroke="var(--gain)"
                      strokeDasharray="4 4"
                      label={{ value: "TP", position: "insideTopRight", fontSize: 11, fill: "var(--gain)" }}
                    />
                  )}

                  <Bar yAxisId="volume" dataKey="volume" shape={VolumeBar} isAnimationActive={false} barSize={6} />
                  <Bar yAxisId="price" dataKey="range" shape={Candlestick} isAnimationActive={false} barSize={6} />

                  <ReferenceLine yAxisId="price" x={entrySec} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
                  <ReferenceDot
                    yAxisId="price"
                    x={entrySec}
                    y={trade.entryPrice}
                    r={5}
                    fill="var(--primary)"
                    stroke="var(--popover)"
                    strokeWidth={2}
                    label={{ value: t("Entry"), position: "top", fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  {exitSec != null && trade.exitPrice != null && (
                    <>
                      <ReferenceLine yAxisId="price" x={exitSec} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
                      <ReferenceDot
                        yAxisId="price"
                        x={exitSec}
                        y={trade.exitPrice}
                        r={5}
                        fill={exitColor}
                        stroke="var(--popover)"
                        strokeWidth={2}
                        label={{ value: t("Exit"), position: "top", fontSize: 11, fill: "var(--muted-foreground)" }}
                      />
                    </>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              {t("Scroll to zoom, drag to pan — just like a real trading platform.")}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
