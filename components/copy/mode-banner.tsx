"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CircleCheck, FlaskConical, Radio, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { setCopyTradingLive } from "@/app/actions/copy-trading"
import { useAction } from "@/components/insights/client"
import { linkBtn } from "@/components/insights/ui"
import { useCopy } from "./store"
import { ConfirmDialog } from "./ui"

// Says, on every Copy Trading page, whether real orders are being sent — and
// lets an admin change it right here. In Simulation nothing reaches a broker,
// which is easy to miss when you are watching a follower account for a trade;
// so the banner says it in as many words, and shows the way out.
export function ModeBanner({ admin }: { admin: boolean }) {
  const { state, account, refresh } = useCopy()
  const router = useRouter()
  const { pending, run } = useAction()
  const [dialog, setDialog] = useState<"live" | "simulation" | null>(null)
  const live = state.mode === "live"
  const Icon = live ? Radio : FlaskConical

  // every follower of a group that is switched on, and whether it can take a real order
  const followers = [...new Set(state.groups.filter((g) => g.status === "active").flatMap((g) => g.followers.map((f) => f.accountId)))].map(account).filter((a) => !!a)
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

  return (
    <>
      <div role="status" className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5 text-sm", live ? "border-[var(--gain)]/40 bg-[var(--gain)]/10" : "border-[var(--warning)]/50 bg-[var(--warning)]/10")}>
        <Icon className={cn("size-4 shrink-0", live ? "text-[var(--gain)]" : "text-[var(--warning)]")} aria-hidden />
        <p className="min-w-0 flex-1">
          <span className="font-semibold">{live ? "Live — real orders are sent to your follower accounts." : "Simulation — no real orders are placed."}</span>{" "}
          <span className="text-muted-foreground">
            {live
              ? speed
              : "Copies are worked out and shown here marked SIM, but nothing is opened on your follower accounts. To open real trades on them, switch to Live."}
          </span>
          {live && notReady.length > 0 && (
            <span className="block text-[var(--loss)]">
              Can&apos;t receive orders: {notReady.map((a) => a!.name).join(", ")}. {notReady[0]!.executionNote}
            </span>
          )}
          {!state.liveData && <span className="block text-[var(--warning)]">Live positions couldn&apos;t be read just now, so nothing was copied on this pass.</span>}
        </p>
        {admin && (
          <button type="button" className={cn(live ? linkBtn : "inline-flex h-8 items-center justify-center rounded-md bg-[var(--warning)] px-3 text-sm font-semibold text-black transition-colors hover:bg-[var(--warning)]/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none")} onClick={() => setDialog(live ? "simulation" : "live")}>
            {live ? "Back to Simulation" : "Switch to Live"}
          </button>
        )}
      </div>

      <ConfirmDialog open={dialog === "live"} onClose={() => setDialog(null)} title="Switch Copy Trading to Live?" action="Switch to Live" danger word="LIVE" pending={pending} onConfirm={() => change(true)}>
        <p>
          <span className="font-semibold text-foreground">Real orders will be sent to your follower accounts</span> for every copy group that is switched on, whether or not this page is open.
        </p>
        <ul className="list-disc space-y-1 ps-5">
          <li>
            Only trades the Leader opens <span className="font-semibold text-foreground">after</span> you switch are copied for real.{open > 0 ? ` The ${open} simulated ${open === 1 ? "position" : "positions"} open now stay simulated.` : " Trades that are already open are not copied."}
          </li>
          <li>A follower needs a MetaTrader 5 account with its master (trading) password added in the Trade Manager.</li>
          <li>{speed}</li>
          <li>Start with the smallest size, on a demo account if you can. Live mode has not placed an order with a broker yet.</li>
        </ul>
        {followers.length > 0 && (
          <ul className="space-y-1 rounded-lg border p-2.5">
            {ready.map((a) => (
              <li key={a!.id} className="flex items-start gap-2 text-foreground">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-[var(--gain)]" aria-hidden />
                <span>{a!.name} — can receive orders</span>
              </li>
            ))}
            {notReady.map((a) => (
              <li key={a!.id} className="flex items-start gap-2 text-foreground">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--loss)]" aria-hidden />
                <span>
                  {a!.name} — will NOT get orders. <span className="text-muted-foreground">{a!.executionNote}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </ConfirmDialog>
      <ConfirmDialog open={dialog === "simulation"} onClose={() => setDialog(null)} title="Go back to Simulation?" action="Back to Simulation" pending={pending} onConfirm={() => change(false)}>
        <p>No more orders are sent to brokers. Copies are worked out and recorded only.</p>
        <p>Positions that are already open on your follower accounts are not closed: close them yourself, or use Flatten All first.</p>
      </ConfirmDialog>
    </>
  )
}
