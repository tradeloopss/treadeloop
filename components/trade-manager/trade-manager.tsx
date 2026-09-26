"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Activity, ArrowUpRight, ArrowDownRight, X, ShieldAlert, ExternalLink, Layers } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatCurrency } from "@/lib/calc"
import { summarizeOpenTrades, type OpenTradeView, type TradeManagerData } from "@/lib/trade-manager"

function timeOpen(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ${mins % 60}m`
  const days = Math.floor(hrs / 24)
  return `${days}d ${hrs % 24}h`
}

function price(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

export function TradeManager({ data }: { data: TradeManagerData }) {
  const [mode, setMode] = useState<string>("all") // "all" | account id as string
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const trades = useMemo(
    () => (mode === "all" ? data.trades : data.trades.filter((t) => String(t.accountId) === mode)),
    [data.trades, mode],
  )
  const summary = useMemo(() => summarizeOpenTrades(trades.map((t) => ({ side: t.side, riskAmount: t.metrics.riskAmount }))), [trades])
  const currency = trades[0]?.currency ?? "USD"
  const selected = selectedId != null ? data.trades.find((t) => t.id === selectedId) ?? null : null

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Activity className="size-5" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">Trade Manager</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Your open positions and the risk on each — the loss if the stop is hit, the reward if the target is.</p>
        </div>
        <div className="w-full sm:w-56">
          <Select value={mode} onValueChange={(v) => v && setMode(v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                <span className="flex items-center gap-2">
                  <Layers className="size-3.5" /> All accounts
                </span>
              </SelectItem>
              {data.accounts.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="Open positions" value={String(summary.count)} />
        <SummaryTile label="Total risk" value={formatCurrency(summary.totalRisk, currency)} tone={summary.totalRisk > 0 ? "loss" : undefined} />
        <SummaryTile label="Longs / Shorts" value={`${summary.longs} / ${summary.shorts}`} />
        <SummaryTile label="No stop set" value={String(summary.unprotected)} tone={summary.unprotected ? "warning" : undefined} />
      </div>

      {trades.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Activity className="size-6" />
          </span>
          <h2 className="text-lg font-medium">No open positions</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">When you have a running trade, it&apos;ll show here with its live risk and reward.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Symbol</th>
                  <th className="px-4 py-2.5 font-medium">Side</th>
                  <th className="px-4 py-2.5 font-medium">Qty</th>
                  <th className="px-4 py-2.5 font-medium">Entry</th>
                  <th className="px-4 py-2.5 font-medium">Stop</th>
                  <th className="px-4 py-2.5 font-medium">Target</th>
                  <th className="px-4 py-2.5 font-medium">Risk</th>
                  <th className="px-4 py-2.5 font-medium">R:R</th>
                  <th className="px-4 py-2.5 font-medium">Open</th>
                  {mode === "all" && <th className="px-4 py-2.5 font-medium">Account</th>}
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className={cn("cursor-pointer border-b transition-colors hover:bg-muted/50", selectedId === t.id && "bg-primary/5")}
                  >
                    <td className="px-4 py-2.5 font-medium">{t.symbol}</td>
                    <td className="px-4 py-2.5">
                      <SideBadge side={t.side} />
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{t.quantity}</td>
                    <td className="px-4 py-2.5 tabular-nums">{price(t.entryPrice)}</td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {t.stopLoss != null ? (
                        <span className={cn(!t.metrics.stopConsistent && "text-amber-500")}>{price(t.stopLoss)}</span>
                      ) : (
                        <span className="text-amber-500">none</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{t.takeProfit != null ? price(t.takeProfit) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {t.metrics.riskAmount != null ? formatCurrency(t.metrics.riskAmount, t.currency) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{t.metrics.riskReward != null ? `${t.metrics.riskReward}` : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-muted-foreground">{timeOpen(t.entryTime)}</td>
                    {mode === "all" && <td className="px-4 py-2.5 text-muted-foreground">{t.accountName}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <TradeDrawer trade={selected} onClose={() => setSelectedId(null)} />
    </div>
  )
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: "loss" | "warning" }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-lg font-semibold tabular-nums", tone === "loss" && "text-[var(--loss)]", tone === "warning" && "text-amber-500")}>{value}</div>
    </div>
  )
}

function SideBadge({ side }: { side: "long" | "short" }) {
  const long = side === "long"
  const Icon = long ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        long ? "border-[var(--gain)]/20 bg-[var(--gain)]/10 text-[var(--gain)]" : "border-[var(--loss)]/20 bg-[var(--loss)]/10 text-[var(--loss)]",
      )}
    >
      <Icon className="size-3.5" />
      {long ? "Long" : "Short"}
    </span>
  )
}

function TradeDrawer({ trade, onClose }: { trade: OpenTradeView | null; onClose: () => void }) {
  return (
    <>
      <div
        className={cn("fixed inset-0 z-40 bg-black/40 transition-opacity", trade ? "opacity-100" : "pointer-events-none opacity-0")}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={cn(
          "fixed inset-y-0 end-0 z-50 flex w-full max-w-md flex-col border-s bg-background shadow-xl transition-transform duration-200",
          trade ? "translate-x-0" : "translate-x-full rtl:-translate-x-full",
        )}
        aria-hidden={!trade}
      >
        {trade && (
          <>
            <div className="flex items-start justify-between gap-3 border-b p-5">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">{trade.symbol}</h2>
                  <SideBadge side={trade.side} />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {trade.accountName} · {trade.market} · open {timeOpen(trade.entryTime)}
                </p>
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="size-5" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              {trade.unrealizedPnl != null && (
                <div className={cn("rounded-lg border p-3", trade.unrealizedPnl >= 0 ? "border-[var(--gain)]/30 bg-[var(--gain)]/5" : "border-[var(--loss)]/30 bg-[var(--loss)]/5")}>
                  <div className="text-xs text-muted-foreground">Unrealized P&amp;L</div>
                  <div className={cn("text-xl font-bold tabular-nums", trade.unrealizedPnl >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")}>
                    {trade.unrealizedPnl >= 0 ? "+" : ""}
                    {formatCurrency(trade.unrealizedPnl, trade.currency)}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Quantity" value={String(trade.quantity)} />
                <Field label="Entry" value={price(trade.entryPrice)} />
                <Field label="Current" value={trade.currentPrice != null ? price(trade.currentPrice) : "—"} />
                <Field label="Stop" value={trade.stopLoss != null ? price(trade.stopLoss) : "none"} tone={trade.stopLoss == null || !trade.metrics.stopConsistent ? "warning" : undefined} />
                <Field label="Target" value={trade.takeProfit != null ? price(trade.takeProfit) : "—"} />
              </div>

              {!trade.metrics.stopConsistent && trade.stopLoss != null && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
                  The stop is on the wrong side of entry for a {trade.side} — that would lock in a gain, not cap a loss. Double-check it.
                </div>
              )}

              <div className="rounded-lg border">
                <Row label="Risk if stopped" value={trade.metrics.riskAmount != null ? formatCurrency(trade.metrics.riskAmount, trade.currency) : "No stop set"} tone="loss" />
                <Row label="Reward if target hit" value={trade.metrics.rewardAmount != null ? formatCurrency(trade.metrics.rewardAmount, trade.currency) : "No target set"} tone="gain" />
                <Row label="Risk : Reward" value={trade.metrics.riskReward != null ? `1 : ${trade.metrics.riskReward}` : "—"} />
                <Row label="Notional" value={formatCurrency(trade.metrics.notional, trade.currency)} last />
              </div>

              {trade.notes && (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Notes</div>
                  <p className="rounded-lg border bg-muted/30 p-3 text-sm">{trade.notes}</p>
                </div>
              )}
            </div>

            <div className="border-t p-4">
              {trade.origin === "trade" ? (
                <Link href={`/trades?highlight=${trade.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  Open in Trades <ExternalLink className="size-3.5" />
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-[var(--gain)]" /> Live position synced from {trade.source ?? "your broker"} — manage it in your platform.
                </span>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  )
}

function Field({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 font-medium tabular-nums", tone === "warning" && "text-amber-500")}>{value}</div>
    </div>
  )
}

function Row({ label, value, tone, last }: { label: string; value: string; tone?: "loss" | "gain"; last?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between px-3 py-2.5 text-sm", !last && "border-b")}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium tabular-nums", tone === "loss" && "text-[var(--loss)]", tone === "gain" && "text-[var(--gain)]")}>{value}</span>
    </div>
  )
}
