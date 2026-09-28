"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { pnl as calcPnl, riskAmount, rewardAmount, riskReward, fmtSigned } from "@/lib/replay/calc"
import type { ReplaySymbol, ReplayTrade } from "@/lib/replay/types"

export function EditTradeModal({ trade, meta, onSave, onClose }: { trade: ReplayTrade; meta: ReplaySymbol; onSave: (sl: number | null, tp: number | null) => void; onClose: () => void }) {
  const [sl, setSl] = useState(trade.stopLoss != null ? String(trade.stopLoss) : "")
  const [tp, setTp] = useState(trade.takeProfit != null ? String(trade.takeProfit) : "")
  const nSl = sl.trim() === "" ? null : Number(sl)
  const nTp = tp.trim() === "" ? null : Number(tp)
  const risk = riskAmount(trade.side, trade.entry, nSl, trade.size, trade.contractMultiplier)
  const reward = rewardAmount(trade.side, trade.entry, nTp, trade.size, trade.contractMultiplier)
  const rr = riskReward(risk, reward)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit position · {trade.symbol}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Stop Loss</span>
            <Input value={sl} onChange={(e) => setSl(e.target.value)} inputMode="decimal" className="tabular-nums" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Take Profit</span>
            <Input value={tp} onChange={(e) => setTp(e.target.value)} inputMode="decimal" className="tabular-nums" />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-3 text-center text-sm">
          <div>
            <p className="text-[11px] text-muted-foreground">Risk</p>
            <p className="font-semibold tabular-nums text-[var(--loss)]">{risk > 0 ? fmtSigned(-risk) : "—"}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Reward</p>
            <p className="font-semibold tabular-nums text-[var(--gain)]">{reward > 0 ? fmtSigned(reward) : "—"}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">R : R</p>
            <p className="font-semibold tabular-nums">{rr != null ? `1 : ${rr.toFixed(1)}` : "—"}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(nSl, nTp)}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function PartialCloseModal({ trade, current, onConfirm, onClose }: { trade: ReplayTrade; current: number; onConfirm: (closeLots: number) => void; onClose: () => void }) {
  const [pct, setPct] = useState(50)
  const round = (n: number) => Math.round(n * 100) / 100
  const closeLots = round((trade.size * pct) / 100)
  const remaining = round(trade.size - closeLots)
  const estPnl = calcPnl(trade.side, trade.entry, current, closeLots, trade.contractMultiplier)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Partial close · {trade.symbol}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3 text-sm">
            <span className="text-muted-foreground">Current position</span>
            <span className="font-medium tabular-nums">{trade.size} lots</span>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Close amount</span>
              <span className="font-semibold tabular-nums">{closeLots} lots</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[25, 50, 75, 100].map((p) => (
                <button key={p} type="button" onClick={() => setPct(p)} className={cn("rounded-lg border py-1.5 text-sm font-medium transition-colors", pct === p ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
                  {p}%
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Remaining</p>
              <p className="font-medium tabular-nums">{remaining} lots</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Est. P&L</p>
              <p className={cn("font-medium tabular-nums", estPnl >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")}>{fmtSigned(estPnl)}</p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(closeLots)}>Confirm partial close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function CloseTradeModal({ trade, current, onConfirm, onClose }: { trade: ReplayTrade; current: number; onConfirm: () => void; onClose: () => void }) {
  const p = calcPnl(trade.side, trade.entry, current, trade.size, trade.contractMultiplier)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Close {trade.symbol}?</DialogTitle>
          <DialogDescription>Closing this position locks in the current result.</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border p-3 text-center">
          <p className="text-xs text-muted-foreground">Current P&L</p>
          <p className={cn("text-xl font-bold tabular-nums", p >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")}>{fmtSigned(p)}</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Close trade
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const TAGS = ["Breakout", "Pullback", "Liquidity", "Trend", "Reversal", "News", "FOMO", "Late Entry", "Good Execution"]

export function JournalNoteModal({ trade, onSave, onClose }: { trade: ReplayTrade; onSave: (note: string, tags: string[]) => void; onClose: () => void }) {
  const [note, setNote] = useState(trade.note ?? "")
  const [tags, setTags] = useState<string[]>(trade.tags ?? [])
  const toggle = (tag: string) => setTags((t) => (t.includes(tag) ? t.filter((x) => x !== tag) : [...t, tag]))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add journal note · {trade.symbol}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Setup, entry reason, market context, what you'd do differently…" />
          <div className="flex flex-wrap gap-1.5">
            {TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggle(tag)}
                className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition-colors", tags.includes(tag) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(note.trim(), tags)}>Save note</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
