"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CircleCheck, FlaskConical, Radio, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { setCopyTradingLive } from "@/app/actions/copy-trading"
import { useAction } from "@/components/insights/client"
import { useCopy } from "./store"
import { ConfirmDialog } from "./ui"

// Whether real orders are being sent, said on every Copy Trading page.
//
// In Simulation nothing reaches a broker, which is easy to miss when you are
// watching a follower account for a trade: that gets a banner, in as many
// words, with the way out. Live with nothing wrong is one small mark in the
// header, so the trading screens keep their room. An admin changes the mode
// from either.

function useMode() {
  const { state, account, allowOrders, refresh } = useCopy()
  const router = useRouter()
  const { pending, run } = useAction()
  const [dialog, setDialog] = useState<"live" | "simulation" | null>(null)
  const live = state.mode === "live"
  // every follower that is switched on, in a group that is, and whether it can take a real order
  const followers = [...new Set(state.groups.filter((g) => g.status === "active").flatMap((g) => g.followers.filter((f) => f.config.enabled).map((f) => f.accountId)))].map(account).filter((a) => !!a)
  const ready = followers.filter((a) => a!.canExecute)
  const notReady = followers.filter((a) => !a!.canExecute)
  const open = state.positions.filter((p) => p.simulated).length
  // every account of the groups that are on: all on the fast lane, or not
  const copying = [...new Set(state.groups.filter((g) => g.status === "active").flatMap((g) => [g.leaderAccountId, ...g.followers.filter((f) => f.config.enabled).map((f) => f.accountId)]))].map(account).filter((a) => !!a)
  const fast = copying.length > 0 && copying.every((a) => a!.lane === "fast")
  // the slowest broker among the followers: an order can't be confirmed faster than its round trip
  const ping = Math.max(0, ...followers.map((a) => a!.pingMs ?? 0))
  const speed = fast
    ? `A new trade on the Leader is sent to the followers within a few milliseconds. After that it is the broker's own answer time${ping > 0 ? ` (about ${ping}ms from our server to the slowest of them)` : ""}: the latency of every order is shown in the Cockpit, split into TradeLoop's part and the broker's.`
    : "A new trade on the Leader reaches the followers in about 30 to 60 seconds (1 to 2 minutes for a Rithmic leader). Accounts on the fast lane are quicker: see the Cockpit."
  const change = (next: boolean) =>
    run(
      () => setCopyTradingLive(next),
      async (res) => {
        toast.success(res.message)
        setDialog(null)
        await refresh()
        router.refresh()
      },
    )
  const dialogs = (
    <>
      <ConfirmDialog open={dialog === "live"} onClose={() => setDialog(null)} title="Switch Copy Trading to Live?" action="Switch to Live" danger word="LIVE" pending={pending} onConfirm={() => change(true)}>
        <p>
          <span className="font-semibold text-foreground">Real orders will be sent to your follower accounts</span> for every copy group that is switched on, whether or not this page is open.
        </p>
        <ul className="list-disc space-y-1 ps-5">
          <li>
            Only trades the Leader opens <span className="font-semibold text-foreground">after</span> you switch are copied for real.{open > 0 ? ` The ${open} simulated ${open === 1 ? "position" : "positions"} open now stay simulated.` : " Trades that are already open are not copied."}
          </li>
          <li>A follower needs a MetaTrader 5 account that orders are allowed on: Connection, Manage, Allow orders.</li>
          <li>{speed}</li>
          <li>Start with the smallest size, on a demo account if you can.</li>
        </ul>
        {followers.length > 0 && (
          <ul className="space-y-1 rounded-lg border p-2.5">
            {ready.map((a) => (
              <li key={a!.id} className="flex items-start gap-2 text-foreground">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-[var(--gain)]" aria-hidden />
                <span>{a!.name}: can receive orders</span>
              </li>
            ))}
            {notReady.map((a) => (
              <li key={a!.id} className="flex items-start gap-2 text-foreground">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--loss)]" aria-hidden />
                <span>
                  {a!.name}: will NOT get orders. <span className="text-muted-foreground">{a!.executionNote}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </ConfirmDialog>
      <ConfirmDialog open={dialog === "simulation"} onClose={() => setDialog(null)} title="Go back to Simulation?" action="Back to Simulation" pending={pending} onConfirm={() => change(false)}>
        <p>No more orders are sent to brokers. Copies are worked out and recorded only.</p>
        <p>Positions that are already open on your follower accounts are not closed: close them yourself, or flatten them in the Cockpit first.</p>
      </ConfirmDialog>
    </>
  )
  return { state, live, notReady, speed, setDialog, dialogs, allowOrders }
}

// The header's mark: Live or Simulation, in a word. For an admin it is also the switch.
export function ModeChip({ admin }: { admin: boolean }) {
  const { live, speed, setDialog, dialogs } = useMode()
  const cls = cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold whitespace-nowrap", live ? "border-[var(--gain)]/40 bg-[var(--gain)]/10 text-[var(--gain)]" : "border-[var(--warning)]/50 bg-[var(--warning)]/10 text-[var(--warning)]")
  const body = (
    <>
      {live ? <Radio className="size-3.5" aria-hidden /> : <FlaskConical className="size-3.5" aria-hidden />}
      {live ? "Live" : "Simulation"}
    </>
  )
  const title = live ? `Real orders are sent to your follower accounts. ${speed}` : "No real orders are placed: copies are worked out and shown marked SIM."
  if (!admin)
    return (
      <span role="status" className={cls} title={title}>
        {body}
      </span>
    )
  return (
    <>
      <button type="button" className={cn(cls, "transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none")} title={`${title} Click to change.`} onClick={() => setDialog(live ? "simulation" : "live")}>
        {body}
      </button>
      {dialogs}
    </>
  )
}

// The banner: shown in Simulation, and in Live only when something is wrong.
export function ModeBanner({ admin }: { admin: boolean }) {
  const { state, live, notReady, setDialog, dialogs, allowOrders } = useMode()
  if (live && notReady.length === 0 && state.liveData) return null
  const Icon = live ? TriangleAlert : FlaskConical
  return (
    <>
      <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--warning)]/50 bg-[var(--warning)]/10 px-3 py-2.5 text-sm">
        <Icon className="size-4 shrink-0 text-[var(--warning)]" aria-hidden />
        <p className="min-w-0 flex-1">
          {!live && (
            <>
              <span className="font-semibold">Simulation: no real orders are placed.</span> <span className="text-muted-foreground">Copies are worked out and shown here marked SIM, but nothing is opened on your follower accounts. To open real trades on them, switch to Live.</span>
            </>
          )}
          {live && notReady.length > 0 && (
            <span className="block">
              <span className="font-semibold">Can&apos;t receive orders: {notReady.map((a) => a!.name).join(", ")}.</span> <span className="text-muted-foreground">{notReady[0]!.executionNote}</span>
            </span>
          )}
          {!state.liveData && <span className="block">Live positions couldn&apos;t be read just now, so nothing was copied on this pass.</span>}
        </p>
        {live &&
          notReady
            .filter((a) => a!.canAllowOrders)
            .map((a) => (
              <button key={a!.id} type="button" className="inline-flex h-8 items-center justify-center rounded-md bg-[var(--warning)] px-3 text-sm font-semibold text-black transition-colors hover:bg-[var(--warning)]/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" onClick={() => allowOrders(a!.id)}>
                Allow orders{notReady.length > 1 ? ` on ${a!.name}` : ""}
              </button>
            ))}
        {admin && !live && (
          <button type="button" className="inline-flex h-8 items-center justify-center rounded-md bg-[var(--warning)] px-3 text-sm font-semibold text-black transition-colors hover:bg-[var(--warning)]/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" onClick={() => setDialog("live")}>
            Switch to Live
          </button>
        )}
      </div>
      {dialogs}
    </>
  )
}
