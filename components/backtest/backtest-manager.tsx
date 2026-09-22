"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { INSTRUMENTS } from "@/lib/market-data/instruments"
import { TIMEFRAMES } from "@/lib/market-data/types"
import { createBacktestSession, deleteBacktestSession } from "@/app/actions/backtest"
import { useT } from "@/components/locale-provider"
import { CandlestickChart, Dice5, Play, Trash2 } from "lucide-react"

export interface BacktestSessionCard {
  id: number
  name: string | null
  symbol: string
  timeframe: string
  status: string
  startingBalance: number
  currentBalance: number
  randomMode: boolean
  createdAt: string
}

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)

export function BacktestManager({ sessions }: { sessions: BacktestSessionCard[] }) {
  const t = useT()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [symbol, setSymbol] = useState(INSTRUMENTS[0].symbol)
  const [timeframe, setTimeframe] = useState("5m")
  const [balance, setBalance] = useState("50000")
  const [name, setName] = useState("")
  const [randomMode, setRandomMode] = useState(false)

  function onCreate() {
    startTransition(async () => {
      try {
        const { id } = await createBacktestSession({
          symbol,
          timeframe,
          startingBalance: Number(balance) || 50000,
          name: name.trim() || undefined,
          randomMode,
        })
        router.push(`/backtest/${id}`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("Could not create the backtest"))
      }
    })
  }

  function onDelete(id: number) {
    startTransition(async () => {
      try {
        await deleteBacktestSession(id)
        toast.success(t("Backtest deleted"))
        router.refresh()
      } catch {
        toast.error(t("Could not delete the backtest"))
      }
    })
  }

  return (
    <div className="space-y-6">
      <Card className="max-w-2xl gap-4 p-5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
            <CandlestickChart className="size-4" />
          </span>
          <div>
            <h2 className="font-semibold">{t("New backtest")}</h2>
            <p className="text-sm text-muted-foreground">{t("Pick a market and timeframe, then replay it candle by candle.")}</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("Market")}</Label>
            <Select value={symbol} onValueChange={(v) => v && setSymbol(v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INSTRUMENTS.map((i) => (
                  <SelectItem key={i.symbol} value={i.symbol}>
                    {i.name} <span className="text-muted-foreground">({i.symbol})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t("Timeframe")}</Label>
            <Select value={timeframe} onValueChange={(v) => v && setTimeframe(v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEFRAMES.map((tf) => (
                  <SelectItem key={tf.id} value={tf.id}>
                    {tf.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t("Starting balance")}</Label>
            <Input type="number" inputMode="numeric" value={balance} onChange={(e) => setBalance(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>{t("Name (optional)")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. NQ opening range")} />
          </div>
        </div>

        <label className="flex items-start gap-2.5 rounded-lg border p-3 text-sm">
          <Checkbox checked={randomMode} onCheckedChange={(c) => setRandomMode(c === true)} className="mt-0.5" />
          <span>
            <span className="flex items-center gap-1.5 font-medium">
              <Dice5 className="size-4" /> {t("Random date")}
            </span>
            <span className="text-muted-foreground">{t("Start on a hidden historical date, so you trade the chart without hindsight.")}</span>
          </span>
        </label>

        <div>
          <Button onClick={onCreate} disabled={pending}>
            <Play className="size-4" /> {t("Start backtest")}
          </Button>
        </div>
      </Card>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("Your backtests")}</h2>
        {sessions.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">{t("No backtests yet — start one above.")}</Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sessions.map((s) => {
              const pnl = s.currentBalance - s.startingBalance
              return (
                <Card key={s.id} className="gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{s.name || s.symbol}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.symbol} · {s.timeframe}
                      </div>
                    </div>
                    <Badge variant={s.status === "completed" ? "secondary" : "outline"}>{t(s.status)}</Badge>
                  </div>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground">{t("Balance")}</span>
                    <span className="font-medium tabular-nums">{usd(s.currentBalance)}</span>
                  </div>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground">{t("P&L")}</span>
                    <span className={`font-semibold tabular-nums ${pnl > 0 ? "text-emerald-600 dark:text-emerald-400" : pnl < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                      {pnl >= 0 ? "+" : ""}
                      {usd(pnl)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" className="flex-1" onClick={() => router.push(`/backtest/${s.id}`)}>
                      {s.status === "completed" ? t("View") : t("Open")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onDelete(s.id)} disabled={pending} aria-label={t("Delete")}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
