"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowDown, CircleAlert, CircleCheck, Download, Info, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { readCopyAlerts, retryCopyOrder } from "@/app/actions/copy-trading"
import { formatQuantity } from "@/lib/copy/contracts"
import { ACTION_LABELS, ORDER_STATUS, isFailure, latencyParts, price, type Copy, type EventView, type OrderView } from "@/lib/copy/view"
import { useAction } from "@/components/insights/client"
import { NotEnough, Pill, fieldClass, linkBtn } from "@/components/insights/ui"
import { useCopy } from "./store"

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
const stamp = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
const sideWord = (side: string) => (side === "long" ? "BUY" : "SELL")

function StatusPill({ o }: { o: OrderView }) {
  const s = ORDER_STATUS[o.status] ?? { label: o.status, tone: "none" as const }
  return <Pill tone={s.tone}>{s.label}</Pill>
}

// Live activity: each of the Leader's orders, and what every follower did with it.
export function CopyFeed({ copies, limit = 6, detailed }: { copies: Copy[]; limit?: number; detailed?: boolean }) {
  const { account } = useCopy()
  const [open, setOpen] = useState<string | null>(null)
  if (!copies.length) return <NotEnough title="No copied trades yet.">When the Leader trades, each copy appears here with what every follower did.</NotEnough>
  return (
    <ul className="space-y-2.5">
      {copies.slice(0, limit).map((c) => {
        const expanded = detailed || open === c.masterOrderId
        const all = c.filled === c.total
        return (
          <li key={c.masterOrderId} className="rounded-xl border">
            <button type="button" aria-expanded={expanded} disabled={detailed} onClick={() => setOpen(expanded ? null : c.masterOrderId)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 p-3 text-start text-sm">
              <span className="text-xs text-muted-foreground tabular-nums">{time(c.at)}</span>
              <span className="font-semibold">{c.symbol}</span>
              <span className={cn("font-semibold tabular-nums", c.side === "long" ? "text-[var(--gain)]" : "text-[var(--loss)]")}>
                {ACTION_LABELS[c.action] ?? c.action}
                {(c.action === "open" || c.action === "increase") && c.leaderQuantity != null ? `: ${sideWord(c.side)} ${formatQuantity(c.leaderQuantity)}` : ""}
              </span>
              <span className="text-xs text-muted-foreground">
                {c.total} {c.total === 1 ? "follower" : "followers"}
              </span>
              <span className="ms-auto flex items-center gap-1.5">
                {c.simulated && <span className="rounded border px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase">Sim</span>}
                <Pill tone={all ? "good" : c.filled === 0 ? "bad" : "warn"}>
                  {c.filled}/{c.total} {c.action === "open" || c.action === "increase" ? "filled" : "done"}
                </Pill>
              </span>
            </button>
            {expanded && (
              <ol className="space-y-1 border-t px-3 py-2.5">
                <li className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-600 uppercase dark:text-amber-400">Master</span>
                  <span className="font-medium">{account(c.orders[0].masterAccountId)?.name ?? "Leader"}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {price(c.orders[0].requestedPrice)} · {c.masterOrderId}
                  </span>
                </li>
                {c.orders.map((o) => (
                  <li key={o.id} className="text-sm">
                    <ArrowDown className="ms-3 size-3.5 text-muted-foreground" aria-hidden />
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium">{account(o.followerAccountId)?.name ?? "Follower"}</span>
                      <span className="tabular-nums">
                        {o.status === "blocked" || o.status === "skipped" ? "—" : `${o.action === "open" || o.action === "increase" ? sideWord(o.side) : (ACTION_LABELS[o.action] ?? o.action)} ${formatQuantity(o.quantity)} ${o.symbol}`}
                      </span>
                      <StatusPill o={o} />
                      {o.executionPrice != null && <span className="text-xs text-muted-foreground tabular-nums">{price(o.executionPrice)}</span>}
                      {latencyParts(o) && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          Latency: {latencyParts(o)!.total}
                          {latencyParts(o)!.split && <> ({latencyParts(o)!.split})</>}
                        </span>
                      )}
                    </div>
                    {o.reason && <p className="mt-0.5 text-xs text-muted-foreground">{o.reason}</p>}
                  </li>
                ))}
              </ol>
            )}
          </li>
        )
      })}
    </ul>
  )
}

const LEVEL = { error: { Icon: CircleAlert, cls: "text-[var(--loss)]" }, warning: { Icon: TriangleAlert, cls: "text-[var(--warning)]" }, success: { Icon: CircleCheck, cls: "text-[var(--gain)]" }, info: { Icon: Info, cls: "text-muted-foreground" } } as const

// Alerts and errors: what happened, why, and what the trader can do about it.
export function AlertList({ events, limit = 8, problemsOnly }: { events: EventView[]; limit?: number; problemsOnly?: boolean }) {
  const { state, refresh } = useCopy()
  const router = useRouter()
  const { pending, run } = useAction()
  const list = (problemsOnly ? events.filter((e) => e.level === "error" || e.level === "warning") : events).slice(0, limit)
  const unread = events.filter((e) => e.unread).length
  const after = async () => {
    await refresh()
    router.refresh()
  }
  if (!list.length) return <p className="text-sm text-muted-foreground">{problemsOnly ? "No alerts. Risk blocks, lost connections and rejected orders show up here, each with what to do." : "Nothing has happened yet."}</p>
  return (
    <div className="space-y-2">
      {unread > 0 && (
        <button type="button" disabled={pending} className={linkBtn} onClick={() => run(readCopyAlerts, after)}>
          Mark {unread} as read
        </button>
      )}
      <ul className="divide-y">
        {list.map((e) => {
          const { Icon, cls } = LEVEL[e.level]
          // the refused entry this alert is about, if it can still be tried again
          const order = e.masterOrderId && e.accountId != null ? state.orders.find((o) => o.masterOrderId === e.masterOrderId && o.followerAccountId === e.accountId && isFailure(o.status) && (o.action === "open" || o.action === "increase")) : undefined
          return (
            <li key={e.id} className="flex gap-2.5 py-2.5">
              <Icon className={cn("mt-0.5 size-4 shrink-0", cls)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {e.title}
                  {e.unread && <span className="ms-1.5 inline-block size-1.5 rounded-full bg-primary align-middle" aria-label="unread" />}
                </p>
                {e.body && <p className="text-sm text-muted-foreground">{e.body}</p>}
                {e.action && <p className="mt-0.5 text-sm">{e.action}</p>}
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">{stamp(e.createdAt)}</span>
                  {e.code.startsWith("blocked_") && e.groupId != null && (
                    <Link href={`/copy-trading/risk-management?group=${e.groupId}`} className={cn(linkBtn, "h-7 text-xs")}>
                      View rule / Adjust
                    </Link>
                  )}
                  {order && (
                    <button type="button" disabled={pending} className={cn(linkBtn, "h-7 text-xs")} onClick={() => run(() => retryCopyOrder(order.id), async () => (toast.success("Tried again with the current settings."), await after()))}>
                      Retry
                    </button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const csv = (v: unknown) => {
  const s = v == null ? "" : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Every follower order, newest first, with filters and a CSV export.
export function HistoryTable({ orders }: { orders: OrderView[] }) {
  const { state, account } = useCopy()
  const [from, setFrom] = useState("")
  const [groupId, setGroupId] = useState("")
  const [accountId, setAccountId] = useState("")
  const [symbol, setSymbol] = useState("")
  const [side, setSide] = useState("")
  const [status, setStatus] = useState("")
  const rows = useMemo(() => orders.filter((o) => (!from || o.createdAt.slice(0, 10) >= from) && (!groupId || o.groupId === Number(groupId)) && (!accountId || o.followerAccountId === Number(accountId) || o.masterAccountId === Number(accountId)) && (!symbol || o.symbol === symbol || o.leaderSymbol === symbol) && (!side || o.side === side) && (!status || o.status === status)), [orders, from, groupId, accountId, symbol, side, status])
  const groupName = (id: number) => state.groups.find((g) => g.id === id)?.name ?? "Deleted group"
  const symbols = [...new Set(orders.flatMap((o) => [o.leaderSymbol, o.symbol]))].sort()
  const exportCsv = () => {
    const head = ["Time", "Group", "Leader", "Follower", "Action", "Symbol", "Side", "Quantity", "Leader quantity", "Requested price", "Execution price", "Slippage", "Latency ms", "TradeLoop ms", "Status", "Reason", "Simulated", "Master order", "Follower order"]
    const lines = rows.map((o) => [o.createdAt, groupName(o.groupId), account(o.masterAccountId)?.name, account(o.followerAccountId)?.name, ACTION_LABELS[o.action] ?? o.action, o.symbol, o.side, o.quantity, o.leaderQuantity, o.requestedPrice, o.executionPrice, o.slippage, o.latencyMs, o.tradeloopMs, o.status, o.reason, o.simulated ? "yes" : "no", o.masterOrderId, o.correlationId].map(csv).join(","))
    const url = URL.createObjectURL(new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `tradeloop-copy-history-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
  const select = (label: string, value: string, set: (v: string) => void, options: [string, string][]) => (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <select className={cn(fieldClass, "h-8")} value={value} onChange={(e) => set(e.target.value)}>
        <option value="">All</option>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  )
  if (!orders.length) return <NotEnough title="No copied trades yet.">Every follower order is listed here once the group has copied something.</NotEnough>
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 items-end gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          From
          <input type="date" className={cn(fieldClass, "h-8")} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        {select("Group", groupId, setGroupId, state.groups.map((g) => [String(g.id), g.name]))}
        {select("Account", accountId, setAccountId, state.accounts.map((a) => [String(a.id), a.name]))}
        {select("Symbol", symbol, setSymbol, symbols.map((s) => [s, s]))}
        {select("Direction", side, setSide, [["long", "Buy"], ["short", "Sell"]])}
        {select("Status", status, setStatus, Object.entries(ORDER_STATUS).map(([k, v]) => [k, v.label]))}
        <button type="button" disabled={!rows.length} className={cn(linkBtn, "h-8")} onClick={exportCsv}>
          <Download className="size-3.5" /> Export
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              {["Time", "Group", "Leader", "Follower", "Action", "Symbol", "Side", "Qty", "Price", "Slippage", "Latency", "Status"].map((h, i) => (
                <th key={h} scope="col" className={cn("py-2 font-medium", i === 0 ? "text-start" : "ps-3 text-start")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.slice(0, 100).map((o) => (
              <tr key={o.id} title={o.reason ?? undefined}>
                <td className="py-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums">{stamp(o.createdAt)}</td>
                <td className="max-w-32 truncate py-2 ps-3">{groupName(o.groupId)}</td>
                <td className="max-w-32 truncate py-2 ps-3">{account(o.masterAccountId)?.name ?? "—"}</td>
                <td className="max-w-32 truncate py-2 ps-3 font-medium">{account(o.followerAccountId)?.name ?? "—"}</td>
                <td className="py-2 ps-3">{ACTION_LABELS[o.action] ?? o.action}</td>
                <td className="py-2 ps-3">{o.symbol}</td>
                <td className={cn("py-2 ps-3 font-medium", o.side === "long" ? "text-[var(--gain)]" : "text-[var(--loss)]")}>{sideWord(o.side)}</td>
                <td className="py-2 ps-3 tabular-nums">{formatQuantity(o.quantity)}</td>
                <td className="py-2 ps-3 tabular-nums">{price(o.executionPrice ?? o.requestedPrice)}</td>
                <td className="py-2 ps-3 tabular-nums">{o.slippage != null ? price(o.slippage) : "—"}</td>
                <td className="py-2 ps-3 tabular-nums" title={latencyParts(o)?.split ?? undefined}>
                  {latencyParts(o)?.total ?? "—"}
                  {o.tradeloopMs != null && <span className="block text-[10px] text-muted-foreground">TradeLoop {o.tradeloopMs}ms</span>}
                </td>
                <td className="py-2 ps-3">
                  <span className="flex items-center gap-1.5">
                    <StatusPill o={o} />
                    {o.simulated && <span className="text-[10px] font-semibold text-muted-foreground uppercase">Sim</span>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {rows.length > 100 ? `Showing the latest 100 of ${rows.length}; the export has them all. ` : ""}
        Slippage and latency are filled in for live orders once the broker confirms them. Simulated orders have neither.
      </p>
    </div>
  )
}
