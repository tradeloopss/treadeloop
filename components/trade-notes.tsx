"use client"

import { useEffect, useRef, useState } from "react"
import { updateTradeNotes } from "@/app/actions/trades"
import { formatCurrency } from "@/lib/calc"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { ChevronRight, NotebookPen } from "lucide-react"
import { useT } from "@/components/locale-provider"

export interface TradeNotesTrade {
  id: number
  symbol: string
  side: string
  status: string
  quantity: string
  entryPrice: string
  exitPrice: string | null
  pnl: string
  notes: string | null
}

type SaveState = "idle" | "saving" | "saved"

export function TradeNotes({ trade }: { trade: TradeNotesTrade }) {
  const t = useT()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [notes, setNotes] = useState(trade.notes ?? "")
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current)
    }
  }, [])

  function onChange(value: string) {
    setNotes(value)
    setSaveState("saving")
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current)
    timeoutRef.current = setTimeout(async () => {
      await updateTradeNotes(trade.id, value)
      setSaveState("saved")
      savedTimeoutRef.current = setTimeout(() => setSaveState("idle"), 1500)
    }, 700)
  }

  const pnl = Number(trade.pnl)

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold">{t("Notes")}</h3>
        {saveState !== "idle" && (
          <span className="text-xs text-muted-foreground">{saveState === "saving" ? t("Saving…") : t("Saved")}</span>
        )}
      </div>

      <button
        type="button"
        onClick={() => setDetailsOpen((v) => !v)}
        className="mb-3 flex w-full items-center gap-2 rounded-md border px-3 py-2 text-start text-sm hover:bg-accent/50"
      >
        <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", detailsOpen && "rotate-90")} />
        <span className="font-medium">{t("Net P&L")}</span>
        <span
          className={cn(
            "tabular-nums",
            trade.status === "open" ? "text-muted-foreground" : pnl >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]",
          )}
        >
          {trade.status === "open" ? t("Open") : formatCurrency(pnl)}
        </span>
      </button>

      {detailsOpen && (
        <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-xs sm:grid-cols-4">
          <Detail label={t("Symbol")} value={trade.symbol} />
          <Detail label={t("Side")} value={trade.side === "long" ? t("Long") : t("Short")} />
          <Detail label={t("Qty")} value={Number(trade.quantity).toString()} />
          <Detail label={t("Entry")} value={Number(trade.entryPrice).toString()} />
          {trade.exitPrice != null && <Detail label={t("Exit")} value={Number(trade.exitPrice).toString()} />}
        </dl>
      )}

      <div className="flex items-center gap-1.5 text-sm font-medium">
        <NotebookPen className="size-4 text-muted-foreground" />
        {t("Pre-Trade Notes")}
      </div>
      <Textarea
        value={notes}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        placeholder={t("What's the plan? Levels, bias, invalidation, and what would change your mind…")}
        className="mt-2"
      />
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium capitalize">{value}</dd>
    </div>
  )
}
