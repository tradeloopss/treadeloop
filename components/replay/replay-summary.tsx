"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { riskAmount, fmtSigned } from "@/lib/replay/calc"
import type { ReplayTrade } from "@/lib/replay/types"

function Stat({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", tone === "gain" ? "text-[var(--gain)]" : tone === "loss" ? "text-[var(--loss)]" : "text-foreground")}>{value}</p>
    </div>
  )
}

export function ReplaySummary({ trades, onReview, onJournal, onRestart, onClose }: { trades: ReplayTrade[]; onReview: () => void; onJournal: () => void; onRestart: () => void; onClose: () => void }) {
  const closed = trades.filter((t) => t.status === "closed")
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0)
  const losses = closed.filter((t) => (t.pnl ?? 0) < 0)
  const net = closed.reduce((s, t) => s + (t.pnl ?? 0), 0)
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0
  const grossProfit = wins.reduce((s, t) => s + (t.pnl ?? 0), 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0))
  const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0
  const rs = closed.map((t) => {
    const risk = riskAmount(t.side, t.entry, t.stopLoss, t.size, t.contractMultiplier)
    return risk > 0 && t.pnl != null ? t.pnl / risk : 0
  })
  const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0
  const best = closed.reduce((m, t) => Math.max(m, t.pnl ?? 0), 0)
  const worst = closed.reduce((m, t) => Math.min(m, t.pnl ?? 0), 0)
  const holds = closed.filter((t) => t.exitTime).map((t) => (t.exitTime! - t.entryTime) / 60)
  const avgHold = holds.length ? Math.round(holds.reduce((a, b) => a + b, 0) / holds.length) : 0

  // Equity curve + max drawdown from the running cumulative.
  let run = 0
  let peak = 0
  let maxDd = 0
  const pts = [0]
  for (const t of closed) {
    run += t.pnl ?? 0
    peak = Math.max(peak, run)
    maxDd = Math.max(maxDd, peak - run)
    pts.push(run)
  }
  const min = Math.min(...pts)
  const max = Math.max(...pts, 1)
  const range = max - min || 1
  const path = pts.map((v, i) => `${(i / Math.max(1, pts.length - 1)) * 100},${40 - ((v - min) / range) * 36 - 2}`).join(" ")

  const wellPct = winRate >= 55
  const goodRr = avgR >= 0.5

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Replay complete</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Total Trades" value={String(closed.length)} />
          <Stat label="Win Rate" value={`${winRate.toFixed(0)}%`} />
          <Stat label="Net P&L" value={fmtSigned(net)} tone={net >= 0 ? "gain" : "loss"} />
          <Stat label="Avg R" value={`${avgR >= 0 ? "+" : ""}${avgR.toFixed(2)}R`} tone={avgR >= 0 ? "gain" : "loss"} />
          <Stat label="Profit Factor" value={Number.isFinite(pf) ? pf.toFixed(2) : "∞"} />
          <Stat label="Max Drawdown" value={fmtSigned(-maxDd)} tone="loss" />
          <Stat label="Best Trade" value={fmtSigned(best)} tone="gain" />
          <Stat label="Worst Trade" value={fmtSigned(worst)} tone="loss" />
        </div>

        <div className="rounded-xl border bg-card p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Session performance · avg hold {avgHold}m</p>
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-20 w-full">
            <polyline points={path} fill="none" stroke={net >= 0 ? "var(--gain)" : "var(--loss)"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded-xl border bg-[var(--gain)]/5 p-3">
            <p className="text-xs font-semibold text-[var(--gain)]">What went well</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {wellPct ? "Strong win rate — your entries found follow-through." : goodRr ? "Your winners outran your losers on average R." : "You completed a full session — consistency is the first win."}
            </p>
          </div>
          <div className="rounded-xl border bg-amber-500/5 p-3">
            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">What to improve</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {avgR < 0.5 ? "Aim for a higher reward-to-risk — let winners run past 1:2." : winRate < 45 ? "Tighten entries; your win rate has room to grow." : "Watch drawdown — size down after a losing streak."}
            </p>
          </div>
        </div>

        <div className="mt-1 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onReview}>
            Review trades
          </Button>
          <Button variant="outline" onClick={onJournal}>
            View journal
          </Button>
          <Button onClick={onRestart}>Start new replay</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
