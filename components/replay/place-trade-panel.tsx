"use client"

import { TrendingUp, TrendingDown, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { PanelHead, Panel } from "@/components/replay/shared"
import { riskAmount, rewardAmount, riskReward, riskPct, fmtSigned } from "@/lib/replay/calc"
import type { ReplaySymbol, RuleStatus, Side } from "@/lib/replay/types"

function NumField({ label, value, onChange, step }: { label: string; value: string; onChange: (v: string) => void; step?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" step={step} className="h-9 tabular-nums" />
    </label>
  )
}

export function PlaceTradePanel({
  side,
  onSide,
  size,
  onSize,
  entry,
  onEntry,
  sl,
  onSl,
  tp,
  onTp,
  meta,
  balance,
  projection,
  onPlace,
}: {
  side: Side
  onSide: (s: Side) => void
  size: string
  onSize: (v: string) => void
  entry: string
  onEntry: (v: string) => void
  sl: string
  onSl: (v: string) => void
  tp: string
  onTp: (v: string) => void
  meta: ReplaySymbol
  balance: number
  projection: { status: RuleStatus; message: string | null }
  onPlace: () => void
}) {
  const nSize = Number(size) || 0
  const nEntry = Number(entry) || 0
  const nSl = sl.trim() === "" ? null : Number(sl)
  const nTp = tp.trim() === "" ? null : Number(tp)
  const risk = riskAmount(side, nEntry, nSl, nSize, meta.contractMultiplier)
  const reward = rewardAmount(side, nEntry, nTp, nSize, meta.contractMultiplier)
  const rr = riskReward(risk, reward)
  const rPct = riskPct(risk, balance)
  const blocked = projection.status === "breach"
  const valid = nSize > 0 && nEntry > 0 && !blocked

  return (
    <Panel>
      <PanelHead title="Place Trade" />
      <div className="space-y-4 p-4">
        {/* Buy / Sell */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onSide("long")}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-semibold transition-colors",
              side === "long" ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
            )}
          >
            <TrendingUp className="size-4" /> Buy
          </button>
          <button
            type="button"
            onClick={() => onSide("short")}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-semibold transition-colors",
              side === "short" ? "border-[var(--loss)] bg-[var(--loss)]/10 text-[var(--loss)]" : "text-muted-foreground hover:bg-muted",
            )}
          >
            <TrendingDown className="size-4" /> Sell
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <NumField label="Size (lots)" value={size} onChange={onSize} step="0.01" />
          <NumField label="Entry" value={entry} onChange={onEntry} />
          <NumField label="Stop Loss" value={sl} onChange={onSl} />
          <NumField label="Take Profit" value={tp} onChange={onTp} />
        </div>

        {/* Live risk summary */}
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-3 text-center">
          <div>
            <p className="text-[11px] text-muted-foreground">Risk</p>
            <p className="text-sm font-semibold tabular-nums text-[var(--loss)]">{risk > 0 ? fmtSigned(-risk) : "—"}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Reward</p>
            <p className="text-sm font-semibold tabular-nums text-[var(--gain)]">{reward > 0 ? fmtSigned(reward) : "—"}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">R : R</p>
            <p className="text-sm font-semibold tabular-nums">{rr != null ? `1 : ${rr.toFixed(1)}` : "—"}</p>
          </div>
        </div>
        <p className="text-center text-[11px] text-muted-foreground">
          Risk {rPct.toFixed(2)}% of account
        </p>

        {projection.message && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
              blocked ? "border-[var(--loss)]/40 bg-[var(--loss)]/10 text-[var(--loss)]" : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
            )}
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{projection.message}</span>
          </div>
        )}

        <Button
          onClick={onPlace}
          disabled={!valid}
          className={cn("h-10 w-full font-semibold", side === "short" && "bg-[var(--loss)] text-white hover:bg-[var(--loss)]/90")}
        >
          {blocked ? "Trade blocked by prop firm rule" : side === "long" ? "Place Buy Order" : "Place Sell Order"}
        </Button>
      </div>
    </Panel>
  )
}
