"use client"

import type React from "react"
import { useMemo, useState } from "react"
import { createTrade } from "@/app/actions/trades"
import { FUTURES_CONTRACTS, contractMultiplierForSymbol, parseFuturesExpiryHint, type Market } from "@/lib/calc"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Plus, Trash2, ChevronDown, Info } from "lucide-react"
import { toast } from "sonner"

const TYPES: { value: Market; label: string }[] = [
  { value: "stocks", label: "Stock" },
  { value: "options", label: "Option" },
  { value: "futures", label: "Future" },
  { value: "future_option", label: "Future opt." },
  { value: "forex", label: "Forex" },
  { value: "crypto", label: "Crypto" },
  { value: "cfd", label: "CFD" },
]

const isFuturesLike = (m: Market) => m === "futures" || m === "future_option"

let rowSeq = 0
function nextRowId() {
  rowSeq += 1
  return `row-${rowSeq}`
}

interface ExecutionRow {
  id: string
  dateTime: string
  side: "buy" | "sell"
  quantity: string
  price: string
  fees: string
}

function newRow(overrides?: Partial<ExecutionRow>): ExecutionRow {
  const now = new Date()
  now.setSeconds(0, 0)
  return {
    id: nextRowId(),
    dateTime: now.toISOString().slice(0, 16),
    side: "buy",
    quantity: "1",
    price: "",
    fees: "",
    ...overrides,
  }
}

function aggregateExecutions(rows: ExecutionRow[]) {
  const parsed = rows
    .map((r) => ({
      ...r,
      dt: new Date(r.dateTime),
      quantityNum: Number(r.quantity) || 0,
      priceNum: Number(r.price) || 0,
      feesNum: Number(r.fees) || 0,
    }))
    .filter((r) => r.quantityNum > 0 && r.priceNum > 0)
    .sort((a, b) => a.dt.getTime() - b.dt.getTime())

  if (parsed.length === 0) return null

  const openingSide = parsed[0].side
  const opens = parsed.filter((r) => r.side === openingSide)
  const closes = parsed.filter((r) => r.side !== openingSide)

  const sumQty = (list: typeof parsed) => list.reduce((s, r) => s + r.quantityNum, 0)
  const weightedAvg = (list: typeof parsed) => {
    const q = sumQty(list)
    return q > 0 ? list.reduce((s, r) => s + r.quantityNum * r.priceNum, 0) / q : 0
  }

  const quantity = sumQty(opens)
  const closedQty = sumQty(closes)
  const entryPrice = weightedAvg(opens)
  const exitPrice = closes.length > 0 ? weightedAvg(closes) : null
  const totalFees = parsed.reduce((s, r) => s + r.feesNum, 0)
  const side: "long" | "short" = openingSide === "buy" ? "long" : "short"
  const status: "open" | "closed" = closes.length > 0 && closedQty >= quantity ? "closed" : "open"
  const entryTime = opens[0]?.dt ?? parsed[0].dt
  const exitTime = closes.length > 0 ? closes[closes.length - 1].dt : null

  return { quantity, entryPrice, exitPrice, fees: totalFees, side, status, entryTime, exitTime }
}

export function ManualTradeForm({
  accounts,
  playbooks,
  onSaved,
}: {
  accounts: { id: number; name: string }[]
  playbooks: { id: number; name: string }[]
  onSaved?: () => void
}) {
  const [market, setMarket] = useState<Market>("futures")
  const [symbol, setSymbol] = useState("")
  const [multiplier, setMultiplier] = useState("1")
  const [expirationDate, setExpirationDate] = useState("")
  const [rows, setRows] = useState<ExecutionRow[]>([newRow()])
  const [showMore, setShowMore] = useState(false)
  const [pending, setPending] = useState(false)

  const futures = isFuturesLike(market)
  const expiryHint = futures ? parseFuturesExpiryHint(symbol) : null

  function onSymbolChange(v: string) {
    const up = v.toUpperCase()
    setSymbol(up)
    if (futures) setMultiplier(String(contractMultiplierForSymbol(up)))
  }

  function updateRow(id: string, patch: Partial<ExecutionRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function addRow() {
    setRows((prev) => [...prev, newRow({ dateTime: prev[prev.length - 1]?.dateTime, side: prev[prev.length - 1]?.side === "buy" ? "sell" : "buy" })])
  }

  function removeRow(id: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev))
  }

  const aggregate = useMemo(() => aggregateExecutions(rows), [rows])

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!symbol.trim()) {
      toast.error("Enter a symbol")
      return
    }
    if (!aggregate) {
      toast.error("Add at least one execution with a quantity and price")
      return
    }

    const formData = new FormData(e.currentTarget)
    formData.set("symbol", symbol)
    formData.set("market", market)
    formData.set("side", aggregate.side)
    formData.set("status", aggregate.status)
    formData.set("quantity", String(aggregate.quantity))
    formData.set("entryPrice", String(aggregate.entryPrice))
    if (aggregate.exitPrice != null) formData.set("exitPrice", String(aggregate.exitPrice))
    formData.set("fees", String(aggregate.fees))
    formData.set("contractMultiplier", futures ? multiplier : "1")
    formData.set("entryTime", aggregate.entryTime.toISOString().slice(0, 16))
    if (aggregate.exitTime) formData.set("exitTime", aggregate.exitTime.toISOString().slice(0, 16))
    if (futures && expirationDate) formData.set("expirationDate", expirationDate)

    setPending(true)
    createTrade(formData)
      .then(() => {
        toast.success("Trade logged")
        setSymbol("")
        setExpirationDate("")
        setRows([newRow()])
        setShowMore(false)
        e.currentTarget.reset()
        onSaved?.()
      })
      .catch(() => toast.error("Could not save trade"))
      .finally(() => setPending(false))
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <p className="flex items-start gap-1.5 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        Prop firm and live-synced accounts aren&apos;t listed here — their trades have to come from the firm itself. Use
        Rithmic auto-sync, or a file upload for Tradovate and other platforms, so your journal always matches their record.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {accounts.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Account</Label>
            <Select name="accountId" items={Object.fromEntries(accounts.map((acc) => [String(acc.id), acc.name]))}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                {accounts.map((acc) => (
                  <SelectItem key={acc.id} value={String(acc.id)}>{acc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Type</Label>
          <Select value={market} onValueChange={(v) => v && setMarket(v as Market)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="symbol" className="text-xs text-muted-foreground">Symbol</Label>
          <Input
            id="symbol"
            value={symbol}
            onChange={(e) => onSymbolChange(e.target.value)}
            placeholder={futures ? "MNQU4, ESZ4…" : "AAPL, BTC…"}
            required
          />
          {expiryHint && <p className="text-xs text-muted-foreground">{expiryHint}</p>}
        </div>
        {futures && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contractMultiplier" className="text-xs text-muted-foreground">Multiplier</Label>
            <Input id="contractMultiplier" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} type="number" step="any" />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Executions</Label>
          {aggregate && (
            <Badge variant="outline" className={cn("text-[10px] uppercase", aggregate.status === "open" ? "text-primary" : "text-muted-foreground")}>
              {aggregate.status}
            </Badge>
          )}
        </div>

        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center gap-2">
              <Input
                type="datetime-local"
                value={row.dateTime}
                onChange={(e) => updateRow(row.id, { dateTime: e.target.value })}
                className="h-9 flex-1 basis-44"
              />
              <div className="flex overflow-hidden rounded-md border text-xs font-medium">
                <button
                  type="button"
                  onClick={() => updateRow(row.id, { side: "buy" })}
                  className={cn("px-2.5 py-2", row.side === "buy" ? "bg-[var(--gain)]/15 text-[var(--gain)]" : "text-muted-foreground hover:bg-accent/40")}
                >
                  Buy
                </button>
                <button
                  type="button"
                  onClick={() => updateRow(row.id, { side: "sell" })}
                  className={cn("border-l px-2.5 py-2", row.side === "sell" ? "bg-[var(--loss)]/15 text-[var(--loss)]" : "text-muted-foreground hover:bg-accent/40")}
                >
                  Sell
                </button>
              </div>
              <Input type="number" step="any" value={row.quantity} onChange={(e) => updateRow(row.id, { quantity: e.target.value })} placeholder="Qty" className="h-9 w-16" />
              <Input type="number" step="any" value={row.price} onChange={(e) => updateRow(row.id, { price: e.target.value })} placeholder="Price" required className="h-9 w-24" />
              <Input type="number" step="any" value={row.fees} onChange={(e) => updateRow(row.id, { fees: e.target.value })} placeholder="Fees" className="h-9 w-20" />
              <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeRow(row.id)} disabled={rows.length === 1}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addRow} className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
          <Plus className="size-3.5" /> Add execution
        </button>
      </div>

      <button
        type="button"
        onClick={() => setShowMore((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", showMore && "rotate-180")} />
        {showMore ? "Hide" : "Add"} stop loss, tags & notes
      </button>

      {showMore && (
        <div className="space-y-4 border-t pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="stopLoss" className="text-xs text-muted-foreground">Stop loss</Label>
              <Input id="stopLoss" name="stopLoss" type="number" step="any" placeholder="For R-multiple" />
            </div>
            {futures && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="expirationDate" className="text-xs text-muted-foreground">Expiration date</Label>
                <Input id="expirationDate" type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} />
              </div>
            )}
            {playbooks.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Playbook</Label>
                <Select name="playbookId" items={Object.fromEntries(playbooks.map((p) => [String(p.id), p.name]))}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    {playbooks.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rating" className="text-xs text-muted-foreground">Execution rating (1–5)</Label>
              <Input id="rating" name="rating" type="number" min="1" max="5" placeholder="How well did you follow your plan?" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mistakes" className="text-xs text-muted-foreground">Mistakes</Label>
            <Input id="mistakes" name="mistakes" placeholder="chased entry, moved stop, oversized" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tags" className="text-xs text-muted-foreground">Tags</Label>
            <Input id="tags" name="tags" placeholder="breakout, news, reversal" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes" className="text-xs text-muted-foreground">Notes</Label>
            <Textarea id="notes" name="notes" rows={3} placeholder="What was your thesis? How did it play out?" />
          </div>
        </div>
      )}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Saving…" : "Log trade"}
      </Button>
    </form>
  )
}
