// Rule-based coaching for the single largest losing trade — deterministic,
// derived only from what the trade itself recorded (mistakes, rating, stop,
// size relative to average), never fabricated advice. The sentences go
// through `t` so they read in the trader's language.
import type { TFunction } from "@/lib/i18n"

export interface LossAnalysisTrade {
  id: number
  symbol: string
  side: string
  quantity: string | number
  entryPrice: string | number
  exitPrice: string | number | null
  stopLoss: string | number | null
  pnl: string | number
  rMultiple: string | number | null
  rating: number | null
  mistakes: string[] | null
  tags: string[] | null
  notes: string | null
  entryTime: string | Date
  exitTime: string | Date | null
  status: string
}

export interface LossAnalysisResult {
  trade: LossAnalysisTrade
  tips: string[]
}

const MISTAKE_ADVICE: [pattern: string, advice: string][] = [
  ["chase", "Wait for your setup to fully confirm before entering — chasing price into a move often means buying the top or selling the bottom."],
  ["moved stop", "Honor your original stop-loss once it's set. Moving it wider to avoid being stopped out usually turns a small loss into a big one."],
  ["oversize", "Reduce position size until your process is consistent — oversizing turns an ordinary loss into an account-damaging one."],
  ["revenge", "Step away after a loss instead of re-entering immediately. Revenge trades are rarely planned trades."],
  ["fomo", "Fear of missing out led to a lower-quality entry here. Let the setup come to you instead of chasing it."],
  ["no stop", "Define your stop-loss before entering, every time — this trade shows what happens when risk isn't capped in advance."],
  ["impulsive", "Slow down before entering — an impulsive entry skips the checklist that normally keeps losses small."],
]

export function analyzeBiggestLoss(trades: LossAnalysisTrade[], avgLoss: number, t: TFunction = fill): LossAnalysisResult | null {
  const closed = trades.filter((t) => t.status === "closed" && Number(t.pnl) < 0)
  if (closed.length === 0) return null

  const trade = closed.reduce((worst, t) => (Number(t.pnl) < Number(worst.pnl) ? t : worst))
  const tips: string[] = []

  const mistakes = trade.mistakes ?? []
  for (const m of mistakes) {
    const lower = m.toLowerCase()
    const match = MISTAKE_ADVICE.find(([pattern]) => lower.includes(pattern))
    if (match) tips.push(t(match[1]))
  }

  if (trade.stopLoss == null) {
    tips.push(t("No stop-loss was recorded for this trade — defining risk before entry keeps a bad trade from becoming your worst one."))
  }

  if (trade.rating != null && trade.rating <= 2) {
    tips.push(t("You rated your own execution {rating}/5 on this trade — worth revisiting what broke down in the moment.", { rating: trade.rating }))
  }

  const pnl = Number(trade.pnl)
  if (avgLoss < 0 && Math.abs(pnl) > Math.abs(avgLoss) * 2) {
    tips.push(
      t("This loss was {x}x your average loss — check whether size or stop distance was out of line with the rest of your trades.", { x: (Math.abs(pnl) / Math.abs(avgLoss)).toFixed(1) }),
    )
  }

  if (tips.length === 0) {
    tips.push(
      t("No mistakes or notes were logged on this trade — add a quick note next time a big loss happens so there's something concrete to learn from."),
    )
  }

  return { trade, tips }
}

function fill(key: string, vars?: Record<string, string | number>): string {
  return vars ? key.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : key
}
