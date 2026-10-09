"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Crown, Plus } from "lucide-react"
import { setCopyFollowerEnabled } from "@/app/actions/copy-trading"
import { ago, money, type AccountView } from "@/lib/copy/view"
import { useAction } from "@/components/insights/client"
import { NotEnough, Section, linkBtn, linkBtnPrimary } from "@/components/insights/ui"
import { AccountDrawer, ConnectAccountDialog } from "./dialogs"
import { SharedStrategies } from "./sharing"
import { useCopy } from "./store"
import { AccountCard, HealthPill, PageHead, PlatformIcon, RolePill, Stat, Toggle, isOnline } from "./ui"

// Connection: every trading account TradeLoop knows, and what each is used for
// in Copy Trading. The accounts and their broker connections are the same ones
// as on the Accounts page — nothing is connected twice.
export function Connection() {
  const { state, refresh } = useCopy()
  const router = useRouter()
  const { pending, run } = useAction()
  const [connect, setConnect] = useState(false)
  const [manage, setManage] = useState<number | null>(null)
  const linked = state.accounts.filter((a) => a.linked)
  const leaders = state.accounts.filter((a) => a.role === "leader" || a.role === "both").length
  const followers = state.accounts.filter((a) => a.role === "follower" || a.role === "both").length

  // the groups an account follows in, and whether it is switched on in all of them
  const following = (a: AccountView) => state.groups.flatMap((g) => g.followers.filter((f) => f.accountId === a.id).map((f) => ({ groupId: g.id, enabled: f.config.enabled })))
  const follow = (a: AccountView, on: boolean) =>
    run(
      async () => {
        for (const f of following(a)) {
          const res = await setCopyFollowerEnabled(f.groupId, a.id, on)
          if (!res.ok) return res
        }
        return { ok: true as const }
      },
      async () => {
        toast.success(on ? `${a.name} is following again.` : `${a.name} stopped following. Its open positions stay open.`)
        await refresh()
        router.refresh()
      },
    )

  return (
    <>
      <PageHead title="Connection" subtitle="Connect and manage your trading accounts.">
        <button type="button" className={`${linkBtnPrimary} max-md:h-11`} onClick={() => setConnect(true)}>
          <Plus className="size-3.5" /> Connect Account
        </button>
      </PageHead>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Connected" value={linked.length} sub={state.accounts.length > linked.length ? `${state.accounts.length - linked.length} manual` : undefined} />
        <Stat label="Leaders" value={leaders} />
        <Stat label="Followers" value={followers} />
        <Stat label="Healthy" value={`${linked.filter(isOnline).length} / ${linked.length}`} />
      </div>

      {state.accounts.length === 0 ? (
        <Section title="Accounts">
          <NotEnough title="No trading accounts connected yet.">Connect the account you trade on, and the accounts that should copy it.</NotEnough>
          <div className="flex justify-center">
            <button type="button" className={linkBtnPrimary} onClick={() => setConnect(true)}>
              Connect Account
            </button>
          </div>
        </Section>
      ) : (
        <>
          <div className="hidden lg:block">
            <Section title="Accounts" description="An account isn't tied to one role: it can lead one Copy Group and follow another.">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      {["Follow", "Account", "Connection", "Balance", "Equity", "Role", "Status", "Last sync", ""].map((h, i) => (
                        <th key={i} scope="col" className={`py-2 font-medium ${i === 3 || i === 4 ? "ps-3 text-end" : i === 0 ? "text-start" : "ps-3 text-start"}`}>
                          {h || <span className="sr-only">Actions</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {state.accounts.map((a) => {
                      const mine = following(a)
                      return (
                        <tr key={a.id} className="hover:bg-muted/40">
                          <td className="py-2.5">
                            <span className="flex items-center gap-1.5">
                              {(a.role === "leader" || a.role === "both") && <Crown className="size-4 text-amber-500" aria-label="Leader" />}
                              {mine.length > 0 ? <Toggle checked={mine.every((f) => f.enabled)} disabled={pending} label={`Follow with ${a.name}`} onChange={(v) => follow(a, v)} /> : a.role !== "leader" && <span className="text-muted-foreground">—</span>}
                            </span>
                          </td>
                          <th scope="row" className="max-w-64 py-2.5 ps-3 text-start">
                            <span className="flex items-center gap-2.5">
                              <PlatformIcon platform={a.platform} className="size-8 rounded-lg text-[10px]" />
                              <span className="min-w-0">
                                <span className="block truncate font-semibold">{a.name}</span>
                                <span className="block text-xs font-normal text-muted-foreground tabular-nums">{a.login ? `#${a.login}` : "No account ID"}</span>
                              </span>
                            </span>
                          </th>
                          <td className="py-2.5 ps-3">
                            <span className="block">{a.platform}</span>
                            {a.broker && <span className="block text-xs text-muted-foreground">{a.broker}</span>}
                          </td>
                          <td className="py-2.5 ps-3 text-end tabular-nums">{money(a.balance)}</td>
                          <td className="py-2.5 ps-3 text-end tabular-nums">{money(a.equity)}</td>
                          <td className="py-2.5 ps-3">
                            <RolePill role={a.role} />
                          </td>
                          <td className="py-2.5 ps-3">
                            <HealthPill health={a.health} />
                          </td>
                          <td className="py-2.5 ps-3 text-xs text-muted-foreground tabular-nums">{a.linked ? ago(a.lastSyncAt) : "—"}</td>
                          <td className="py-2.5 ps-3 text-end">
                            <button type="button" className={linkBtn} onClick={() => setManage(a.id)}>
                              Manage
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>
          {/* phone and tablet: a card to tap for each account */}
          <section aria-label="Accounts" className="space-y-2 lg:hidden">
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {state.accounts.map((a) => (
                <li key={a.id}>
                  <AccountCard account={a} onOpen={() => setManage(a.id)} />
                </li>
              ))}
            </ul>
            <p className="px-1 text-xs text-muted-foreground">Tap an account for its balance, role, connection health and what it is copying.</p>
          </section>
        </>
      )}

      <SharedStrategies onOpen={setManage} />
      <ConnectAccountDialog open={connect} onClose={() => setConnect(false)} />
      <AccountDrawer accountId={manage} onClose={() => setManage(null)} />
    </>
  )
}
