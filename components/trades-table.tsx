"use client"

import type React from "react"
import { Fragment, useMemo, useState, useTransition } from "react"
import { deleteTrade } from "@/app/actions/trades"
import { formatCurrency, tradingSession, type TradingSession } from "@/lib/calc"
import { cn } from "@/lib/utils"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Trash2, Search, NotebookPen, ShieldCheck, CandlestickChart, Share2 } from "lucide-react"
import { toast } from "sonner"
import { TradeNotes } from "@/components/trade-notes"
import { TradeChartDialog } from "@/components/trade-chart-dialog"
import { TradePnlShareDialog } from "@/components/trade-pnl-card"
import { useIntlLocale, useT } from "@/components/locale-provider"

export interface TradeRow {
  id: number
  symbol: string
  market: string
  side: string
  status: string
  quantity: string
  entryPrice: string
  exitPrice: string | null
  pnl: string
  fees: string
  rMultiple: string | null
  entryTime: string
  exitTime: string | null
  stopLoss: string | null
  takeProfit: string | null
  tags: string[] | null
  notes: string | null
  externalId: string | null
}

type Source = "all" | "manual" | "verified"
type Session = "all" | TradingSession
type Result = "all" | "win" | "loss" | "breakeven"

const SESSIONS: TradingSession[] = ["NY AM", "London", "NY PM", "Asia"]

export function TradesTable({
  trades,
  traderName,
  traderImage,
}: {
  trades: TradeRow[]
  traderName?: string
  traderImage?: string | null
}) {
  const t = useT()
  const dateLocale = useIntlLocale()
  const [query, setQuery] = useState("")
  const [market, setMarket] = useState("all")
  const [source, setSource] = useState<Source>("all")
  const [session, setSession] = useState<Session>("all")
  const [result, setResult] = useState<Result>("all")
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [chartTrade, setChartTrade] = useState<TradeRow | null>(null)
  const [shareTradeRow, setShareTradeRow] = useState<TradeRow | null>(null)
  const [pending, startTransition] = useTransition()

  const counts = useMemo(() => {
    const verified = trades.filter((t) => t.externalId != null).length
    return { all: trades.length, manual: trades.length - verified, verified }
  }, [trades])

  const filtered = useMemo(() => {
    return trades.filter((t) => {
      const q = query.toLowerCase()
      const matchesQuery =
        q === "" || t.symbol.toLowerCase().includes(q) || (t.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
      const matchesMarket = market === "all" || t.market === market
      const isVerified = t.externalId != null
      const matchesSource = source === "all" || (source === "verified" ? isVerified : !isVerified)
      const matchesSession = session === "all" || tradingSession(t.entryTime) === session
      const pnl = Number(t.pnl)
      const matchesResult =
        result === "all" ||
        t.status === "open" ||
        (result === "win" && pnl > 0) ||
        (result === "loss" && pnl < 0) ||
        (result === "breakeven" && pnl === 0)
      return matchesQuery && matchesMarket && matchesSource && matchesSession && matchesResult
    })
  }, [trades, query, market, source, session, result])

  function onDelete(id: number) {
    startTransition(async () => {
      try {
        await deleteTrade(id)
        toast.success(t("Trade deleted"))
      } catch {
        toast.error(t("Could not delete trade"))
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterButton active={source === "all"} onClick={() => setSource("all")}>
          {t("All Trades")} <CountBadge n={counts.all} active={source === "all"} />
        </FilterButton>
        <FilterButton active={source === "manual"} onClick={() => setSource("manual")}>
          {t("Manual")} <CountBadge n={counts.manual} active={source === "manual"} />
        </FilterButton>
        <FilterButton active={source === "verified"} onClick={() => setSource("verified")}>
          <ShieldCheck className="size-3.5" /> {t("Verified")} <CountBadge n={counts.verified} active={source === "verified"} />
        </FilterButton>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search instrument or tag…")}
            className="ps-9"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg border p-1">
          <FilterChip active={session === "all"} onClick={() => setSession("all")}>{t("All")}</FilterChip>
          {SESSIONS.map((s) => (
            <FilterChip key={s} active={session === s} onClick={() => setSession(s)}>{t(s)}</FilterChip>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-lg border p-1">
          <FilterChip active={result === "all"} onClick={() => setResult("all")}>{t("All")}</FilterChip>
          <FilterChip active={result === "win"} onClick={() => setResult("win")} tone="gain">{t("WIN")}</FilterChip>
          <FilterChip active={result === "loss"} onClick={() => setResult("loss")} tone="loss">{t("LOSS")}</FilterChip>
          <FilterChip active={result === "breakeven"} onClick={() => setResult("breakeven")}>{t("BREAKEVEN")}</FilterChip>
        </div>

        <Select value={market} onValueChange={setMarket}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("All markets")}</SelectItem>
            <SelectItem value="futures">{t("Futures")}</SelectItem>
            <SelectItem value="stocks">{t("Stocks")}</SelectItem>
            <SelectItem value="options">{t("Options")}</SelectItem>
            <SelectItem value="future_option">{t("Future options")}</SelectItem>
            <SelectItem value="forex">{t("Forex")}</SelectItem>
            <SelectItem value="crypto">{t("Crypto")}</SelectItem>
            <SelectItem value="cfd">{t("CFD")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Symbol")}</TableHead>
              <TableHead>{t("Side")}</TableHead>
              <TableHead className="text-end">{t("Qty")}</TableHead>
              <TableHead className="text-end">{t("Entry")}</TableHead>
              <TableHead className="text-end">{t("Exit")}</TableHead>
              <TableHead className="text-end">R</TableHead>
              <TableHead className="text-end">{t("P&L")}</TableHead>
              <TableHead>{t("Date")}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center text-sm text-muted-foreground">
                  {t("No trades match your filters.")}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => {
                const pnl = Number(row.pnl)
                return (
                  <Fragment key={row.id}>
                  <TableRow>
                    <TableCell>
                      <div className="font-medium">{row.symbol}</div>
                      <div className="text-xs uppercase text-muted-foreground">{row.market}</div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "uppercase",
                          row.side === "long"
                            ? "border-[var(--gain)]/30 text-[var(--gain)]"
                            : "border-[var(--loss)]/30 text-[var(--loss)]",
                        )}
                      >
                        {row.side === "long" ? t("Long") : t("Short")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{Number(row.quantity)}</TableCell>
                    <TableCell className="text-end tabular-nums">{Number(row.entryPrice)}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {row.exitPrice == null ? <span className="text-muted-foreground">—</span> : Number(row.exitPrice)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {row.rMultiple == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        `${Number(row.rMultiple) >= 0 ? "+" : ""}${Number(row.rMultiple).toFixed(2)}R`
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-end font-medium tabular-nums",
                        row.status === "open"
                          ? "text-muted-foreground"
                          : pnl >= 0
                            ? "text-[var(--gain)]"
                            : "text-[var(--loss)]",
                      )}
                    >
                      {row.status === "open" ? t("Open") : `${pnl >= 0 ? "+" : ""}${formatCurrency(pnl)}`}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {new Date(row.entryTime).toLocaleDateString(dateLocale, { month: "short", day: "numeric", year: "2-digit" })}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground"
                          onClick={() => setChartTrade(row)}
                          aria-label={t("Preview {symbol} trade on chart", { symbol: row.symbol })}
                        >
                          <CandlestickChart className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground"
                          onClick={() => setShareTradeRow(row)}
                          aria-label={t("Share {symbol} trade", { symbol: row.symbol })}
                        >
                          <Share2 className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn("size-8", expandedId === row.id ? "text-foreground" : "text-muted-foreground")}
                          onClick={() => setExpandedId((cur) => (cur === row.id ? null : row.id))}
                          aria-label={t("Notes for {symbol} trade", { symbol: row.symbol })}
                        >
                          <NotebookPen className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          onClick={() => onDelete(row.id)}
                          disabled={pending}
                          aria-label={t("Delete {symbol} trade", { symbol: row.symbol })}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {expandedId === row.id && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={9} className="bg-muted/20 p-4">
                        <TradeNotes trade={row} />
                      </TableCell>
                    </TableRow>
                  )}
                  </Fragment>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {chartTrade && (
        <TradeChartDialog
          trade={{
            symbol: chartTrade.symbol,
            market: chartTrade.market,
            side: chartTrade.side,
            entryTime: chartTrade.entryTime,
            exitTime: chartTrade.exitTime,
            entryPrice: Number(chartTrade.entryPrice),
            exitPrice: chartTrade.exitPrice == null ? null : Number(chartTrade.exitPrice),
            stopLoss: chartTrade.stopLoss == null ? null : Number(chartTrade.stopLoss),
            takeProfit: chartTrade.takeProfit == null ? null : Number(chartTrade.takeProfit),
            pnl: Number(chartTrade.pnl),
          }}
          open={chartTrade != null}
          onOpenChange={(next) => !next && setChartTrade(null)}
        />
      )}

      {shareTradeRow && (
        <TradePnlShareDialog
          tradeId={shareTradeRow.id}
          trade={{
            symbol: shareTradeRow.symbol,
            market: shareTradeRow.market,
            side: shareTradeRow.side,
            status: shareTradeRow.status,
            quantity: Number(shareTradeRow.quantity),
            entryPrice: Number(shareTradeRow.entryPrice),
            exitPrice: shareTradeRow.exitPrice == null ? null : Number(shareTradeRow.exitPrice),
            pnl: Number(shareTradeRow.pnl),
            fees: Number(shareTradeRow.fees),
            rMultiple: shareTradeRow.rMultiple == null ? null : Number(shareTradeRow.rMultiple),
            entryTime: shareTradeRow.entryTime,
            exitTime: shareTradeRow.exitTime,
          }}
          traderName={traderName ?? t("Trader")}
          traderImage={traderImage}
          open={shareTradeRow != null}
          onOpenChange={(next) => !next && setShareTradeRow(null)}
        />
      )}
    </div>
  )
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "border-border bg-foreground text-background" : "border-border bg-background text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

function CountBadge({ n, active }: { n: number; active: boolean }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-xs tabular-nums",
        active ? "bg-background/20" : "bg-muted",
      )}
    >
      {n}
    </span>
  )
}

function FilterChip({
  active,
  onClick,
  tone,
  children,
}: {
  active: boolean
  onClick: () => void
  tone?: "gain" | "loss"
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
        active
          ? tone === "gain"
            ? "bg-[var(--gain)]/15 text-[var(--gain)]"
            : tone === "loss"
              ? "bg-[var(--loss)]/15 text-[var(--loss)]"
              : "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}
