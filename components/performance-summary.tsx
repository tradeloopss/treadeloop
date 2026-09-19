import type React from "react"
import { formatCurrency } from "@/lib/calc"
import type { PerformanceSummary } from "@/lib/performance-summary"
import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown, Zap, Trophy } from "lucide-react"
import { getT } from "@/lib/i18n/server"

export async function PerformanceSummaryCard({ summary }: { summary: PerformanceSummary }) {
  const t = await getT()
  const hasData = summary.bestDay != null

  return (
    <div className="space-y-6">
      <div>
        {hasData ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Tile
              icon={<TrendingUp className="size-4 text-emerald-500" />}
              label={t("Best performing day")}
              day={t(summary.bestDay!.day)}
            >
              <span className="text-sm text-slate-500">{t("{n} trades", { n: summary.bestDay!.trades })}</span>
              <Pill value={summary.bestDay!.netPnl} />
            </Tile>
            <Tile
              icon={<TrendingDown className="size-4 text-rose-500" />}
              label={t("Least performing day")}
              day={t(summary.leastDay!.day)}
            >
              <span className="text-sm text-slate-500">{t("{n} trades", { n: summary.leastDay!.trades })}</span>
              <Pill value={summary.leastDay!.netPnl} />
            </Tile>
            <Tile
              icon={<Zap className="size-4 text-amber-500" />}
              label={t("Most active day")}
              day={t(summary.mostActiveDay!.day)}
            >
              <span className="text-sm text-slate-500">{t("{n} trades", { n: summary.mostActiveDay!.trades })}</span>
            </Tile>
            <Tile
              icon={<Trophy className="size-4 text-violet-500" />}
              label={t("Best win rate")}
              day={t(summary.bestWinRateDay!.day)}
            >
              <span className="text-sm text-slate-500">
                {summary.bestWinRateDay!.winRate.toFixed(0)}% / {t("{n} trades", { n: summary.bestWinRateDay!.trades })}
              </span>
            </Tile>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t("Log a few closed trades to see your day-of-week performance breakdown.")}
          </p>
        )}
      </div>
    </div>
  )
}

function Tile({
  icon,
  label,
  day,
  children,
}: {
  icon: React.ReactNode
  label: string
  day: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mb-2 text-2xl font-semibold">{day}</p>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

function Pill({ value }: { value: number }) {
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 text-sm font-medium",
        value >= 0 ? "bg-[var(--gain)]/12 text-[var(--gain)]" : "bg-[var(--loss)]/12 text-[var(--loss)]",
      )}
    >
      {formatCurrency(value)}
    </span>
  )
}
