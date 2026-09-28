"use client"

import { useState } from "react"
import { X, Pencil, Scissors, ShieldCheck, NotebookPen, Activity } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { StatusPill, SideBadge } from "@/components/replay/shared"
import { pnl as calcPnl, riskAmount, riskReward, rewardAmount, pips, fmtSigned, fmtMoney } from "@/lib/replay/calc"
import type { ReplayAccount, ReplaySymbol, ReplayTrade, RuleStatus } from "@/lib/replay/types"

type Tab = "overview" | "risk" | "impact"

function Row({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium tabular-nums", tone === "gain" ? "text-[var(--gain)]" : tone === "loss" ? "text-[var(--loss)]" : "text-foreground")}>{value}</span>
    </div>
  )
}

export function TradeDetailsPanel({
  trade,
  currentPrice,
  meta,
  account,
  dailyLossRemaining,
  maxDrawdownRemaining,
  afterSlStatus,
  onClose,
  onEdit,
  onPartial,
  onBreakEven,
  onCloseTrade,
  onNote,
}: {
  trade: ReplayTrade | null
  currentPrice: number
  meta: ReplaySymbol
  account: ReplayAccount
  dailyLossRemaining: number | null
  maxDrawdownRemaining: number | null
  afterSlStatus: RuleStatus
  onClose: () => void
  onEdit: () => void
  onPartial: () => void
  onBreakEven: () => void
  onCloseTrade: () => void
  onNote: () => void
}) {
  const [tab, setTab] = useState<Tab>("overview")

  if (!trade) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-2xl border bg-card p-8 text-center shadow-[0_1px_2px_rgba(20,21,42,0.03)]">
        <Activity className="mb-2 size-7 text-muted-foreground/40" />
        <p className="text-sm font-medium">Trade Details</p>
        <p className="mt-1 text-xs text-muted-foreground">Select an open trade to manage it and see its risk and account impact.</p>
      </div>
    )
  }

  const p = calcPnl(trade.side, trade.entry, currentPrice, trade.size, trade.contractMultiplier)
  const pPct = (p / account.startingBalance) * 100
  const risk = riskAmount(trade.side, trade.entry, trade.stopLoss, trade.size, trade.contractMultiplier)
  const reward = rewardAmount(trade.side, trade.entry, trade.takeProfit, trade.size, trade.contractMultiplier)
  const rr = riskReward(risk, reward)
  const dSl = trade.stopLoss != null ? pips(currentPrice, trade.stopLoss, trade.pip) : null
  const dTp = trade.takeProfit != null ? pips(currentPrice, trade.takeProfit, trade.pip) : null
  const status: RuleStatus = risk > 0 && risk / account.startingBalance > 0.02 ? "warning" : "safe"

  return (
    <div className="flex h-full flex-col rounded-2xl border bg-card shadow-[0_1px_2px_rgba(20,21,42,0.03)]">
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{trade.symbol}</span>
            <SideBadge side={trade.side} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {trade.size} lots · {account.name}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close details" className="rounded-md p-1 text-muted-foreground hover:bg-muted">
          <X className="size-4" />
        </button>
      </div>

      <div className="flex items-end justify-between gap-2 border-b px-4 py-3">
        <div>
          <p className={cn("text-2xl font-bold tabular-nums", p >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")}>{fmtSigned(p)}</p>
          <p className="text-xs text-muted-foreground">
            ({pPct >= 0 ? "+" : ""}
            {pPct.toFixed(2)}%)
          </p>
        </div>
        <StatusPill status={status} />
      </div>

      <div className="flex gap-1 border-b px-4">
        {(["overview", "risk", "impact"] as Tab[]).map((tk) => (
          <button
            key={tk}
            type="button"
            onClick={() => setTab(tk)}
            className={cn(
              "border-b-2 px-1 py-2.5 text-xs font-medium capitalize transition-colors",
              tab === tk ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tk === "risk" ? "Risk Analysis" : tk === "impact" ? "Account Impact" : "Overview"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === "overview" && (
          <div className="divide-y">
            <Row label="Entry" value={trade.entry.toFixed(meta.digits)} />
            <Row label="Current" value={currentPrice.toFixed(meta.digits)} />
            <Row label="Stop Loss" value={trade.stopLoss != null ? trade.stopLoss.toFixed(meta.digits) : "—"} />
            <Row label="Take Profit" value={trade.takeProfit != null ? trade.takeProfit.toFixed(meta.digits) : "—"} />
          </div>
        )}
        {tab === "risk" && (
          <div className="divide-y">
            <Row label="Risk if SL hit" value={risk > 0 ? fmtSigned(-risk) : "—"} tone={risk > 0 ? "loss" : undefined} />
            <Row label="Risk / Account" value={`${((risk / account.startingBalance) * 100).toFixed(2)}%`} />
            <Row label="Distance to SL" value={dSl != null ? `${dSl.toFixed(1)} pips` : "—"} />
            <Row label="Distance to TP" value={dTp != null ? `${dTp.toFixed(1)} pips` : "—"} />
            <Row label="Risk / Reward" value={rr != null ? `1 : ${rr.toFixed(1)}` : "—"} />
          </div>
        )}
        {tab === "impact" && (
          <div className="divide-y">
            <Row label="Daily Loss Remaining" value={dailyLossRemaining != null ? fmtMoney(dailyLossRemaining, account.currency) : "No limit"} />
            <Row label="Max Drawdown Remaining" value={maxDrawdownRemaining != null ? fmtMoney(maxDrawdownRemaining, account.currency) : "No limit"} />
            <div className="flex items-center justify-between py-2 text-sm">
              <span className="text-muted-foreground">After SL</span>
              <StatusPill status={afterSlStatus} />
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 border-t p-3">
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="size-3.5" /> Edit SL/TP
        </Button>
        <Button variant="outline" size="sm" onClick={onPartial}>
          <Scissors className="size-3.5" /> Partial Close
        </Button>
        <Button variant="outline" size="sm" onClick={onBreakEven}>
          <ShieldCheck className="size-3.5" /> Move to BE
        </Button>
        <Button variant="outline" size="sm" onClick={onNote}>
          <NotebookPen className="size-3.5" /> Add Note
        </Button>
        <Button variant="destructive" size="sm" className="col-span-2" onClick={onCloseTrade}>
          <X className="size-3.5" /> Close Trade
        </Button>
      </div>
    </div>
  )
}
