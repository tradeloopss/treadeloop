"use client"

import { useState } from "react"
import { MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { Panel, SideBadge, StatusPill } from "@/components/replay/shared"
import { pnl as calcPnl, riskAmount, rewardAmount, riskReward, fmtSigned } from "@/lib/replay/calc"
import type { ReplaySymbol, ReplayTrade, RuleStatus } from "@/lib/replay/types"

type Tab = "open" | "history" | "notes"

function money(n: number | undefined) {
  return n == null ? "—" : fmtSigned(n)
}

function duration(from: number, to: number): string {
  const m = Math.max(0, Math.round((to - from) / 60))
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function TradesTables({
  open,
  history,
  currentPrice,
  meta,
  selectedId,
  onSelect,
  onAction,
}: {
  open: ReplayTrade[]
  history: ReplayTrade[]
  currentPrice: number
  meta: ReplaySymbol
  selectedId: string | null
  onSelect: (id: string) => void
  onAction: (id: string, action: "edit" | "partial" | "close") => void
}) {
  const [tab, setTab] = useState<Tab>("open")
  const notes = history.filter((t) => t.note || (t.tags && t.tags.length))
  const fmt = (n: number | null) => (n == null ? "—" : n.toFixed(meta.digits))

  return (
    <Panel>
      <div className="flex items-center gap-1 border-b px-3 py-2">
        {(
          [
            ["open", `Open Trades (${open.length})`],
            ["history", `Trade History (${history.length})`],
            ["notes", `Journal Notes (${notes.length})`],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              tab === k ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        {tab === "open" &&
          (open.length === 0 ? (
            <Empty title="No trades yet" note="Place your first simulated trade during the replay." />
          ) : (
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  {["Symbol", "Side", "Size", "Entry", "Current", "SL", "TP", "P&L", "Risk", "Status", ""].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {open.map((t) => {
                  const p = calcPnl(t.side, t.entry, currentPrice, t.size, t.contractMultiplier)
                  const risk = riskAmount(t.side, t.entry, t.stopLoss, t.size, t.contractMultiplier)
                  const status: RuleStatus = "safe"
                  return (
                    <tr
                      key={t.id}
                      onClick={() => onSelect(t.id)}
                      className={cn("cursor-pointer border-b transition-colors hover:bg-muted/40", selectedId === t.id && "bg-primary/5 ring-1 ring-inset ring-primary/20")}
                    >
                      <td className="px-3 py-2.5 font-medium">{t.symbol}</td>
                      <td className="px-3 py-2.5">
                        <SideBadge side={t.side} />
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">{t.size}</td>
                      <td className="px-3 py-2.5 tabular-nums">{fmt(t.entry)}</td>
                      <td className="px-3 py-2.5 tabular-nums">{fmt(currentPrice)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{fmt(t.stopLoss)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{fmt(t.takeProfit)}</td>
                      <td className={cn("px-3 py-2.5 font-medium tabular-nums", p >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")}>{money(p)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-[var(--loss)]">{risk > 0 ? money(-risk) : "—"}</td>
                      <td className="px-3 py-2.5">
                        <StatusPill status={status} />
                      </td>
                      <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-7" aria-label="Trade actions"><MoreHorizontal className="size-4" /></Button>} />
                          <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem onClick={() => onSelect(t.id)}>Manage</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onAction(t.id, "edit")}>Edit SL/TP</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onAction(t.id, "partial")}>Partial close</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => onAction(t.id, "close")}>
                              Close trade
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ))}

        {tab === "history" &&
          (history.length === 0 ? (
            <Empty title="No closed trades yet" note="Trades you close during replay appear here." />
          ) : (
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  {["Time", "Symbol", "Side", "Entry", "Exit", "Size", "P&L", "R:R", "Duration", "Result"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map((t) => {
                  const risk = riskAmount(t.side, t.entry, t.stopLoss, t.size, t.contractMultiplier)
                  const rewardAtExit = t.pnl != null && t.pnl > 0 && risk > 0 ? t.pnl : rewardAmount(t.side, t.entry, t.takeProfit, t.size, t.contractMultiplier)
                  const rr = riskReward(risk, rewardAtExit)
                  const rMultiple = risk > 0 && t.pnl != null ? t.pnl / risk : null
                  const win = (t.pnl ?? 0) > 0
                  return (
                    <tr key={t.id} className="border-b">
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{new Date((t.exitTime ?? t.entryTime) * 1000).toISOString().slice(11, 16)}</td>
                      <td className="px-3 py-2.5 font-medium">{t.symbol}</td>
                      <td className="px-3 py-2.5">
                        <SideBadge side={t.side} />
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">{fmt(t.entry)}</td>
                      <td className="px-3 py-2.5 tabular-nums">{t.exitPrice != null ? fmt(t.exitPrice) : "—"}</td>
                      <td className="px-3 py-2.5 tabular-nums">{t.size}</td>
                      <td className={cn("px-3 py-2.5 font-medium tabular-nums", win ? "text-[var(--gain)]" : "text-[var(--loss)]")}>{money(t.pnl)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{rMultiple != null ? `${rMultiple >= 0 ? "+" : ""}${rMultiple.toFixed(1)}R` : rr != null ? `1:${rr.toFixed(1)}` : "—"}</td>
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{t.exitTime ? duration(t.entryTime, t.exitTime) : "—"}</td>
                      <td className="px-3 py-2.5">
                        <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-semibold", win ? "bg-[var(--gain)]/10 text-[var(--gain)]" : "bg-[var(--loss)]/10 text-[var(--loss)]")}>
                          {win ? "WIN" : "LOSS"}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ))}

        {tab === "notes" &&
          (notes.length === 0 ? (
            <Empty title="No journal notes yet" note="Add a note to any trade to build your journal." />
          ) : (
            <ul className="divide-y">
              {[...notes].reverse().map((t) => (
                <li key={t.id} className="px-4 py-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-sm font-medium">{t.symbol}</span>
                    <SideBadge side={t.side} />
                    <span className={cn("ms-auto text-sm font-semibold tabular-nums", (t.pnl ?? 0) >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")}>{money(t.pnl)}</span>
                  </div>
                  {t.note && <p className="text-sm text-foreground">{t.note}</p>}
                  {t.tags && t.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {t.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ))}
      </div>
    </Panel>
  )
}

function Empty({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">{note}</p>
    </div>
  )
}
