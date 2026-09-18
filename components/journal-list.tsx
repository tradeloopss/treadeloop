"use client"

import type React from "react"
import { useMemo, useState } from "react"
import { formatCurrency, tradingSession, type TradingSession } from "@/lib/calc"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AccountCustomizer } from "@/components/account-customizer"
import { JournalReflection } from "@/components/journal-reflection"
import { Search, NotebookPen, ShieldCheck, Sparkles } from "lucide-react"

export interface JournalTrade {
  id: number
  symbol: string
  market: string
  status: string
  pnl: string
  entryTime: string
  exitTime: string | null
  tags: string[] | null
  externalId: string | null
}

export interface JournalDayEntry {
  autoSummary: string | null
  notes: string | null
  mood: string | null
}

type Source = "all" | "manual" | "verified"
type Session = "all" | TradingSession
type Result = "all" | "win" | "loss" | "breakeven"

const SESSIONS: TradingSession[] = ["NY AM", "London", "NY PM", "Asia"]

export function JournalList({
  trades,
  entriesByDay,
  accounts,
  activeAccountIds,
}: {
  trades: JournalTrade[]
  entriesByDay: Record<string, JournalDayEntry>
  accounts?: { id: number; name: string }[]
  activeAccountIds?: number[] | null
}) {
  const [query, setQuery] = useState("")
  const [market, setMarket] = useState("all")
  const [source, setSource] = useState<Source>("all")
  const [session, setSession] = useState<Session>("all")
  const [result, setResult] = useState<Result>("all")

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

  const byDay = useMemo(() => {
    const map = new Map<string, JournalTrade[]>()
    for (const t of filtered) {
      const day = new Date(t.exitTime ?? t.entryTime).toISOString().slice(0, 10)
      if (!map.has(day)) map.set(day, [])
      map.get(day)!.push(t)
    }
    return map
  }, [filtered])

  const days = useMemo(() => Array.from(byDay.keys()).sort((a, b) => (a < b ? 1 : -1)), [byDay])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <FilterButton active={source === "all"} onClick={() => setSource("all")}>
          All Trades <CountBadge n={counts.all} active={source === "all"} />
        </FilterButton>
        <FilterButton active={source === "manual"} onClick={() => setSource("manual")}>
          Manual <CountBadge n={counts.manual} active={source === "manual"} />
        </FilterButton>
        <FilterButton active={source === "verified"} onClick={() => setSource("verified")}>
          <ShieldCheck className="size-3.5" /> Verified <CountBadge n={counts.verified} active={source === "verified"} />
        </FilterButton>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search instrument or tag…"
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg border p-1">
          <FilterChip active={session === "all"} onClick={() => setSession("all")}>All</FilterChip>
          {SESSIONS.map((s) => (
            <FilterChip key={s} active={session === s} onClick={() => setSession(s)}>{s}</FilterChip>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-lg border p-1">
          <FilterChip active={result === "all"} onClick={() => setResult("all")}>All</FilterChip>
          <FilterChip active={result === "win"} onClick={() => setResult("win")} tone="gain">WIN</FilterChip>
          <FilterChip active={result === "loss"} onClick={() => setResult("loss")} tone="loss">LOSS</FilterChip>
          <FilterChip active={result === "breakeven"} onClick={() => setResult("breakeven")}>BREAKEVEN</FilterChip>
        </div>

        <Select value={market} onValueChange={setMarket}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All markets</SelectItem>
            <SelectItem value="futures">Futures</SelectItem>
            <SelectItem value="stocks">Stocks</SelectItem>
            <SelectItem value="options">Options</SelectItem>
            <SelectItem value="future_option">Future options</SelectItem>
            <SelectItem value="forex">Forex</SelectItem>
            <SelectItem value="crypto">Crypto</SelectItem>
            <SelectItem value="cfd">CFD</SelectItem>
          </SelectContent>
        </Select>

        {accounts && accounts.length > 0 && (
          <AccountCustomizer accounts={accounts} activeAccountIds={activeAccountIds ?? null} />
        )}
      </div>

      {days.length === 0 && (
        <Card className="flex h-48 flex-col items-center justify-center gap-2 text-center">
          <NotebookPen className="size-7 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {trades.length === 0 ? "Log trades and your journal writes itself here, day by day." : "No days match your filters."}
          </p>
        </Card>
      )}

      {days.map((day) => {
        const dayTrades = byDay.get(day)!
        const net = dayTrades.reduce((sum, t) => sum + Number(t.pnl), 0)
        const wins = dayTrades.filter((t) => Number(t.pnl) > 0).length
        const losses = dayTrades.filter((t) => Number(t.pnl) < 0).length
        const entry = entriesByDay[day]
        const dateLabel = new Date(day + "T00:00:00").toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })

        return (
          <Card key={day} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-5 py-3">
              <h2 className="font-medium">{dateLabel}</h2>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">{wins}W / {losses}L</span>
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    net >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]",
                  )}
                >
                  {net >= 0 ? "+" : ""}
                  {formatCurrency(net)}
                </span>
              </div>
            </div>

            <div className="space-y-4 p-5">
              <div className="flex items-start gap-2 rounded-md bg-accent/40 p-3">
                <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
                <p className="text-sm leading-relaxed">{entry?.autoSummary ?? "Summary will generate from this day's trades."}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                {dayTrades.map((t) => {
                  const pnl = Number(t.pnl)
                  return (
                    <Badge
                      key={t.id}
                      variant="outline"
                      className={cn(
                        "gap-1.5 font-normal",
                        t.status === "open"
                          ? "text-muted-foreground"
                          : pnl >= 0
                            ? "border-[var(--gain)]/30 text-[var(--gain)]"
                            : "border-[var(--loss)]/30 text-[var(--loss)]",
                      )}
                    >
                      <span className="font-medium">{t.symbol}</span>
                      {t.status !== "open" && <span className="tabular-nums">{pnl >= 0 ? "+" : ""}{formatCurrency(pnl)}</span>}
                    </Badge>
                  )
                })}
              </div>

              <JournalReflection date={day} notes={entry?.notes ?? null} mood={entry?.mood ?? null} />
            </div>
          </Card>
        )
      })}
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
    <span className={cn("rounded px-1.5 py-0.5 text-xs tabular-nums", active ? "bg-background/20" : "bg-muted")}>
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
