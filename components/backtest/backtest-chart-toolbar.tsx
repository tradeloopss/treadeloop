"use client"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"
import type { SeriesType } from "@/components/backtest/backtest-chart"
import { INDICATOR_META, type IndicatorId } from "@/lib/backtest/indicators"
import { CandlestickChart, ChartLine, ChartArea, LineChart, Undo2, Redo2, Check, ChevronDown, Bell, LayoutGrid } from "lucide-react"

// Timeframes the free provider actually serves. (TradingView's 3m/3h/4h aren't
// available from the free feed, so they're left out rather than shown broken.)
const TFS: { id: string; label: string }[] = [
  { id: "1m", label: "1m" },
  { id: "5m", label: "5m" },
  { id: "15m", label: "15m" },
  { id: "30m", label: "30m" },
  { id: "1h", label: "1h" },
  { id: "1d", label: "D" },
  { id: "1w", label: "W" },
  { id: "1M", label: "M" },
]

const SERIES: { id: SeriesType; label: string; icon: typeof CandlestickChart }[] = [
  { id: "candles", label: "Candles", icon: CandlestickChart },
  { id: "line", label: "Line", icon: ChartLine },
  { id: "area", label: "Area", icon: ChartArea },
]

const INDICATOR_IDS: IndicatorId[] = ["sma20", "sma50", "ema9", "ema21", "vwap", "bb"]

export function BacktestChartToolbar({
  timeframe,
  onTimeframe,
  seriesType,
  onSeriesType,
  selectedIndicators,
  onToggleIndicator,
  canUndo,
  onUndo,
  canRedo,
  onRedo,
}: {
  timeframe: string
  onTimeframe: (tf: string) => void
  seriesType: SeriesType
  onSeriesType: (s: SeriesType) => void
  selectedIndicators: IndicatorId[]
  onToggleIndicator: (id: IndicatorId) => void
  canUndo: boolean
  onUndo: () => void
  canRedo: boolean
  onRedo: () => void
}) {
  const t = useT()
  const ActiveSeriesIcon = SERIES.find((s) => s.id === seriesType)?.icon ?? CandlestickChart

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b px-2 py-1.5">
      {/* Timeframes */}
      <div className="flex items-center">
        {TFS.map((tf) => (
          <Button key={tf.id} size="xs" variant={timeframe === tf.id ? "secondary" : "ghost"} className="px-2" onClick={() => onTimeframe(tf.id)}>
            {tf.label}
          </Button>
        ))}
      </div>

      <Divider />

      {/* Series type */}
      <Popover>
        <PopoverTrigger render={<Button size="xs" variant="ghost" className="gap-1"><ActiveSeriesIcon className="size-4" /><ChevronDown className="size-3 opacity-60" /></Button>} />
        <PopoverContent align="start" className="w-40 p-1">
          {SERIES.map((s) => {
            const Icon = s.icon
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSeriesType(s.id)}
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent", seriesType === s.id && "bg-accent")}
              >
                <Icon className="size-4" /> {t(s.label)}
                {seriesType === s.id && <Check className="ml-auto size-3.5" />}
              </button>
            )
          })}
        </PopoverContent>
      </Popover>

      <Divider />

      {/* Indicators */}
      <Popover>
        <PopoverTrigger render={<Button size="xs" variant="ghost" className="gap-1.5"><LineChart className="size-4" /> {t("Indicators")}<ChevronDown className="size-3 opacity-60" /></Button>} />
        <PopoverContent align="start" className="w-52 p-1">
          <div className="px-2 py-1 text-xs font-medium text-muted-foreground">{t("Overlays")}</div>
          {INDICATOR_IDS.map((id) => {
            const on = selectedIndicators.includes(id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => onToggleIndicator(id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
              >
                <span className="size-2.5 rounded-full" style={{ backgroundColor: INDICATOR_META[id].color }} />
                {INDICATOR_META[id].label}
                {on && <Check className="ml-auto size-3.5" />}
              </button>
            )
          })}
        </PopoverContent>
      </Popover>

      <div className="ml-auto flex items-center gap-0.5">
        {/* Present-but-not-wired (need the licensed TradingView library). */}
        <Tooltip>
          <TooltipTrigger render={<Button size="icon-xs" variant="ghost" disabled><LayoutGrid className="size-4" /></Button>} />
          <TooltipContent>{t("Layouts — coming soon")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button size="icon-xs" variant="ghost" disabled><Bell className="size-4" /></Button>} />
          <TooltipContent>{t("Alerts — coming soon")}</TooltipContent>
        </Tooltip>
        <Divider />
        <Button size="icon-xs" variant="ghost" onClick={onUndo} disabled={!canUndo} aria-label={t("Undo")}>
          <Undo2 className="size-4" />
        </Button>
        <Button size="icon-xs" variant="ghost" onClick={onRedo} disabled={!canRedo} aria-label={t("Redo")}>
          <Redo2 className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" />
}
