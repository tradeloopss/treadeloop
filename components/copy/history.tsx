"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowDown, ArrowDownRight, ArrowUpRight, CircleAlert, CircleCheck, Crown, Download, Info, SlidersHorizontal, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { readCopyAlerts, retryCopyOrder } from "@/app/actions/copy-trading"
import { formatQuantity } from "@/lib/copy/contracts"
import { classifyFailure } from "@/lib/copy/errors"
import { ACTION_LABELS, ORDER_BUCKETS, ORDER_STATUS, ORDER_TYPES, isFailure, latencyParts, orderBucket, orderSide, price, type Copy, type EventView, type OrderBucket, type OrderView } from "@/lib/copy/view"
import { useAction } from "@/components/insights/client"
import { NotEnough, Pill, fieldClass, linkBtn } from "@/components/insights/ui"
import { useCopy } from "./store"

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
const stamp = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
const sideWord = (side: string) => (side === "long" ? "BUY" : "SELL")
// the time for today's, the date with it for anything older
const when = (iso: string) => (new Date(iso).toLocaleDateString("en-CA") === new Date().toLocaleDateString("en-CA") ? time(iso) : stamp(iso))
// what became of one order of the Leader across its followers, in a word
function copyState(c: Copy): { label: string; tone: "good" | "ok" | "warn" | "bad" | "none" } {
  if (c.total === 0) return { label: "Skipped", tone: "none" }
  if (c.filled === c.total) return { label: "Filled", tone: "good" }
  if (c.orders.some((o) => orderBucket(o.status) === "open")) return { label: "Working", tone: "ok" }
  return c.filled === 0 ? { label: "Failed", tone: "bad" } : { label: "Partial", tone: "warn" }
}

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
        const state = copyState(c)
        return (
          <li key={c.masterOrderId} className="rounded-xl border">
            <button type="button" aria-expanded={expanded} disabled={detailed} onClick={() => setOpen(expanded ? null : c.masterOrderId)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 p-3 text-start text-sm">
              <span className="text-xs text-muted-foreground tabular-nums">{when(c.at)}</span>
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
                <Pill tone={state.tone}>
                  {c.filled}/{c.total} {state.label === "Working" ? "working" : c.action === "open" || c.action === "increase" ? "filled" : "done"}
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
                    {o.reason && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {isFailure(o.status) && <span className="font-medium text-foreground">{classifyFailure(o.reason).label}: </span>}
                        {o.reason}
                      </p>
                    )}
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

// Live activity as a ticker: one line per order of the Leader, newest first,
// with how many followers took it.
export function ActivityFeed({ copies, limit = 7 }: { copies: Copy[]; limit?: number }) {
  const { account } = useCopy()
  if (!copies.length) return <p className="py-6 text-center text-sm text-muted-foreground">No copied trades yet.</p>
  return (
    <ul className="divide-y text-sm">
      {copies.slice(0, limit).map((c) => {
        const state = copyState(c)
        const entry = c.action === "open" || c.action === "increase"
        const buy = orderSide(c) === "buy"
        return (
          <li key={c.masterOrderId} className="flex items-center gap-x-3 py-2">
            <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums sm:w-28">{when(c.at)}</span>
            <span className="w-20 shrink-0 truncate font-semibold">{c.symbol}</span>
            <span className={cn("w-9 shrink-0 text-xs font-bold", buy ? "text-[var(--gain)]" : "text-[var(--loss)]")}>{buy ? "BUY" : "SELL"}</span>
            <span className="hidden min-w-0 flex-1 truncate text-muted-foreground sm:block">
              {account(c.orders[0].masterAccountId)?.name ?? "Leader"}
              {!entry && <span className="ms-1.5 text-xs">· {ACTION_LABELS[c.action] ?? c.action}</span>}
            </span>
            <span className="ms-auto shrink-0 text-xs text-muted-foreground tabular-nums sm:ms-0" title="Followers that took it / followers it was copied to">
              {c.filled}/{c.total}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {c.simulated && <span className="text-[10px] font-semibold text-muted-foreground uppercase">Sim</span>}
              <Pill tone={state.tone}>{state.label}</Pill>
            </span>
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

const BUCKET_TONE: Record<OrderBucket, "good" | "ok" | "none" | "bad"> = { filled: "good", open: "ok", canceled: "none", failed: "bad" }
type Line = { key: string; id: string; leader: boolean; accountId: number; at: string; contract: string; type: string; action: string; side: "buy" | "sell"; quantity: number | null; price: number | null; bucket: OrderBucket; status: string; reason: string | null; simulated: boolean; order: OrderView | null }

function SideCell({ side }: { side: "buy" | "sell" }) {
  return (
    <span className={cn("inline-flex items-center gap-1 font-medium", side === "buy" ? "text-[var(--gain)]" : "text-[var(--loss)]")}>
      {side === "buy" ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
      {side === "buy" ? "Buy" : "Sell"}
    </span>
  )
}

// The order history under the Cockpit's table: every order of the group, the
// Leader's own and each follower's copy of it, by status, with an export.
export function OrderHistory({ orders }: { orders: OrderView[] }) {
  const { account } = useCopy()
  const [bucket, setBucket] = useState<OrderBucket | "all">("all")
  const [filters, setFilters] = useState(false)
  const [from, setFrom] = useState("")
  const [accountId, setAccountId] = useState("")
  const [connection, setConnection] = useState("")
  const [contract, setContract] = useState("")
  const [side, setSide] = useState("")

  const lines = useMemo(() => {
    const out: Line[] = []
    const seen = new Set<string>()
    for (const o of orders) {
      // the Leader's own order, once, beside the copies made from it
      if (!seen.has(o.masterOrderId)) {
        seen.add(o.masterOrderId)
        out.push({ key: `L${o.masterOrderId}`, id: o.masterOrderId, leader: true, accountId: o.masterAccountId, at: o.createdAt, contract: o.leaderSymbol, type: ORDER_TYPES[o.action] ?? o.action, action: o.action, side: orderSide(o), quantity: o.leaderQuantity, price: o.requestedPrice, bucket: "filled", status: "Filled", reason: null, simulated: false, order: null })
      }
      out.push({ key: String(o.id), id: o.correlationId, leader: false, accountId: o.followerAccountId, at: o.createdAt, contract: o.symbol, type: ORDER_TYPES[o.action] ?? o.action, action: o.action, side: orderSide(o), quantity: o.status === "blocked" || o.status === "skipped" ? null : o.quantity, price: o.executionPrice ?? o.requestedPrice, bucket: orderBucket(o.status), status: ORDER_STATUS[o.status]?.label ?? o.status, reason: o.reason, simulated: o.simulated, order: o })
    }
    return out.sort((a, b) => b.at.localeCompare(a.at) || Number(b.leader) - Number(a.leader))
  }, [orders])
  const filtered = useMemo(() => lines.filter((l) => (!from || l.at.slice(0, 10) >= from) && (!accountId || l.accountId === Number(accountId)) && (!connection || account(l.accountId)?.platform === connection) && (!contract || l.contract === contract) && (!side || l.side === side)), [lines, from, accountId, connection, contract, side, account])
  const rows = bucket === "all" ? filtered : filtered.filter((l) => l.bucket === bucket)
  const count = (b: OrderBucket) => filtered.filter((l) => l.bucket === b).length
  const accounts = [...new Set(lines.map((l) => l.accountId))]
  const active = [from, accountId, connection, contract, side].filter(Boolean).length

  const exportCsv = () => {
    const head = ["ID", "Connection", "Account", "Time", "Contract", "Type", "Action", "Side", "Qty", "Price", "Status", "Reason", "Latency ms", "TradeLoop ms", "Slippage", "Simulated", "Leader order"]
    const body = rows.map((l) => [l.id, account(l.accountId)?.platform, account(l.accountId)?.name, l.at, l.contract, l.type, ACTION_LABELS[l.action] ?? l.action, l.side, l.quantity, l.price, l.status, l.reason, l.order?.latencyMs, l.order?.tradeloopMs, l.order?.slippage, l.simulated ? "yes" : "no", l.order?.masterOrderId ?? l.id].map(csv).join(","))
    const url = URL.createObjectURL(new Blob([[head.join(","), ...body].join("\n")], { type: "text/csv" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `tradeloop-copy-orders-${new Date().toISOString().slice(0, 10)}.csv`
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
  const tabs: { key: OrderBucket | "all"; label: string }[] = [{ key: "all", label: "All" }, ...ORDER_BUCKETS]

  return (
    <section aria-label="Order history" className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div role="tablist" aria-label="Orders by status" className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((b) => (
            <button key={b.key} type="button" role="tab" aria-selected={bucket === b.key} onClick={() => setBucket(b.key)} className={cn("h-8 shrink-0 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap tabular-nums transition-colors", bucket === b.key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {b.label} ({b.key === "all" ? filtered.length : count(b.key)})
            </button>
          ))}
        </div>
        <button type="button" aria-expanded={filters} className={cn(linkBtn, active > 0 && "border-primary/50 text-primary")} onClick={() => setFilters((v) => !v)}>
          <SlidersHorizontal className="size-3.5" /> Filters{active > 0 ? ` (${active})` : ""}
        </button>
        <button type="button" disabled={!rows.length} className={linkBtn} onClick={exportCsv}>
          <Download className="size-3.5" /> Export
        </button>
      </div>
      {filters && (
        <div className="grid grid-cols-2 items-end gap-2.5 border-b bg-muted/30 px-3 py-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            From
            <input type="date" className={cn(fieldClass, "h-8")} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          {select("Account", accountId, setAccountId, accounts.map((id) => [String(id), account(id)?.name ?? "Deleted account"]))}
          {select("Connection", connection, setConnection, [...new Set(accounts.map((id) => account(id)?.platform).filter((p): p is string => !!p))].map((p) => [p, p]))}
          {select("Contract", contract, setContract, [...new Set(lines.map((l) => l.contract))].sort().map((c) => [c, c]))}
          {select("Side", side, setSide, [["buy", "Buy"], ["sell", "Sell"]])}
          <button type="button" disabled={!active} className={cn(linkBtn, "h-8")} onClick={() => (setFrom(""), setAccountId(""), setConnection(""), setContract(""), setSide(""))}>
            Clear
          </button>
        </div>
      )}
      {!lines.length ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">No copied trades yet. Every order of the Leader, and each follower&apos;s copy of it, is listed here.</p>
      ) : !rows.length ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">No orders match.</p>
      ) : (
        <>
          <div className="hidden max-h-[26rem] overflow-auto md:block">
            <table className="w-full min-w-[60rem] text-[13px]">
              <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_var(--border)]">
                <tr className="text-xs text-muted-foreground">
                  {["ID", "Connection", "Account", "Time", "Contract", "Type", "Side", "Qty", "Price", "Latency", "Status"].map((h, i) => (
                    <th key={h} scope="col" className={cn("px-3 py-2 font-medium whitespace-nowrap", i >= 7 ? "text-end" : "text-start")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.slice(0, 200).map((l) => {
                  const lat = l.order ? latencyParts(l.order) : null
                  return (
                    <tr key={l.key} title={l.reason ?? undefined} className={cn("hover:bg-muted/40", l.leader && "bg-amber-500/[0.05]")}>
                      <td className="max-w-40 truncate px-3 py-1.5 font-mono text-xs" title={l.id}>
                        {l.leader && <Crown className="me-1 inline size-3 text-amber-500" aria-label="Leader's order" />}
                        {l.id}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{account(l.accountId)?.platform ?? "—"}</td>
                      <td className="max-w-48 truncate px-3 py-1.5 font-medium">{account(l.accountId)?.name ?? "Deleted account"}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground tabular-nums" title={stamp(l.at)}>
                        {when(l.at)}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{l.contract}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        {l.type}
                        {l.action !== "open" && l.type === "Market" && <span className="ms-1 text-xs text-muted-foreground">· {ACTION_LABELS[l.action] ?? l.action}</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        <SideCell side={l.side} />
                      </td>
                      <td className="px-3 py-1.5 text-end tabular-nums">{l.quantity != null ? formatQuantity(l.quantity) : "—"}</td>
                      <td className="px-3 py-1.5 text-end tabular-nums">{price(l.price)}</td>
                      <td className="px-3 py-1.5 text-end whitespace-nowrap text-muted-foreground tabular-nums" title={lat?.split ?? undefined}>
                        {lat ? (l.order?.tradeloopMs != null ? `${l.order.tradeloopMs} + ${Math.max(0, (l.order.latencyMs ?? 0) - l.order.tradeloopMs)}ms` : lat.total) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-end">
                        <span className="inline-flex items-center gap-1.5">
                          {l.simulated && <span className="text-[10px] font-semibold text-muted-foreground uppercase">Sim</span>}
                          <Pill tone={BUCKET_TONE[l.bucket]}>{l.status}</Pill>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <ul className="divide-y md:hidden">
            {rows.slice(0, 60).map((l) => (
              <li key={l.key} className="space-y-1 px-3 py-2.5 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">{when(l.at)}</span>
                  <span className="font-semibold">{l.contract}</span>
                  <SideCell side={l.side} />
                  <span className="tabular-nums">{l.quantity != null ? formatQuantity(l.quantity) : ""}</span>
                  <span className="ms-auto flex items-center gap-1.5">
                    {l.simulated && <span className="text-[10px] font-semibold text-muted-foreground uppercase">Sim</span>}
                    <Pill tone={BUCKET_TONE[l.bucket]}>{l.status}</Pill>
                  </span>
                </div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {l.leader && <Crown className="size-3 shrink-0 text-amber-500" aria-label="Leader's order" />}
                  <span className="min-w-0 truncate">{account(l.accountId)?.name ?? "Deleted account"}</span>
                  <span aria-hidden>·</span>
                  <span className="shrink-0">{l.type}</span>
                  {l.price != null && <span className="shrink-0 tabular-nums">@ {price(l.price)}</span>}
                </p>
                {l.reason && (
                  <p className="text-xs text-muted-foreground">
                    {l.bucket === "failed" && <span className="font-medium text-foreground">{classifyFailure(l.reason).label}: </span>}
                    {l.reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            {rows.length > 200 ? `Showing the latest 200 of ${rows.length}; the export has them all. ` : ""}
            Latency is TradeLoop&apos;s part plus the broker&apos;s own answer time, for live orders the copy lane sent. Hover a failed order for the reason.
          </p>
        </>
      )}
    </section>
  )
}
