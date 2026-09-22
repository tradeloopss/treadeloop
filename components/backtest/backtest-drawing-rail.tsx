"use client"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"
import { MousePointer2, TrendingUp, Minus, Type, Ruler, Magnet, Eye, EyeOff, Trash2, Spline, Brush } from "lucide-react"

export type DrawingTool = "cursor" | "trend" | "hline" | "text" | "measure"

const TOOLS: { id: DrawingTool; icon: typeof MousePointer2; label: string }[] = [
  { id: "cursor", icon: MousePointer2, label: "Cursor" },
  { id: "trend", icon: TrendingUp, label: "Trend line" },
  { id: "hline", icon: Minus, label: "Horizontal line" },
  { id: "text", icon: Type, label: "Text" },
  { id: "measure", icon: Ruler, label: "Measure" },
]

export function BacktestDrawingRail({
  activeTool,
  onTool,
  magnet,
  onToggleMagnet,
  showDrawings,
  onToggleShowDrawings,
  onClear,
}: {
  activeTool: DrawingTool
  onTool: (t: DrawingTool) => void
  magnet: boolean
  onToggleMagnet: () => void
  showDrawings: boolean
  onToggleShowDrawings: () => void
  onClear: () => void
}) {
  const t = useT()
  return (
    <div className="flex w-10 shrink-0 flex-col items-center gap-0.5 border-r py-1.5">
      {TOOLS.map((tool) => {
        const Icon = tool.icon
        const active = activeTool === tool.id
        return (
          <Tooltip key={tool.id}>
            <TooltipTrigger
              render={
                <Button size="icon-sm" variant={active ? "secondary" : "ghost"} onClick={() => onTool(tool.id)} aria-label={t(tool.label)} className={cn(active && "text-foreground")}>
                  <Icon className="size-4" />
                </Button>
              }
            />
            <TooltipContent side="inline-end">{t(tool.label)}</TooltipContent>
          </Tooltip>
        )
      })}

      {/* Present but not wired — the full drawing suite (fib, patterns, brush)
          is TradingView-licensed-library territory. */}
      <Tooltip>
        <TooltipTrigger render={<Button size="icon-sm" variant="ghost" disabled aria-label={t("Fibonacci")}><Spline className="size-4" /></Button>} />
        <TooltipContent side="inline-end">{t("Fibonacci — coming soon")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<Button size="icon-sm" variant="ghost" disabled aria-label={t("Brush")}><Brush className="size-4" /></Button>} />
        <TooltipContent side="inline-end">{t("Brush — coming soon")}</TooltipContent>
      </Tooltip>

      <span className="my-1 h-px w-5 bg-border" />

      <Tooltip>
        <TooltipTrigger render={<Button size="icon-sm" variant={magnet ? "secondary" : "ghost"} onClick={onToggleMagnet} aria-label={t("Magnet")}><Magnet className="size-4" /></Button>} />
        <TooltipContent side="inline-end">{t("Magnet — snap to price")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<Button size="icon-sm" variant="ghost" onClick={onToggleShowDrawings} aria-label={t("Hide drawings")}>{showDrawings ? <Eye className="size-4" /> : <EyeOff className="size-4" />}</Button>} />
        <TooltipContent side="inline-end">{showDrawings ? t("Hide drawings") : t("Show drawings")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<Button size="icon-sm" variant="ghost" onClick={onClear} aria-label={t("Remove all")}><Trash2 className="size-4" /></Button>} />
        <TooltipContent side="inline-end">{t("Remove all drawings")}</TooltipContent>
      </Tooltip>
    </div>
  )
}
