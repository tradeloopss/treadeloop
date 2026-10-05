"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { ago, money } from "@/lib/copy/view"
import { NotEnough, Section, linkBtn, linkBtnPrimary } from "@/components/insights/ui"
import { AccountDrawer, ConnectAccountDialog } from "./dialogs"
import { useCopy } from "./store"
import { HealthPill, Heartbeat, PageHead, RolePill, Stat, isOnline } from "./ui"

// Connection: every trading account TradeLoop knows, and what each is used for
// in Copy Trading. The accounts and their broker connections are the same ones
// as on the Accounts page — nothing is connected twice.
export function Connection() {
  const { state } = useCopy()
  const [connect, setConnect] = useState(false)
  const [manage, setManage] = useState<number | null>(null)
  const linked = state.accounts.filter((a) => a.linked)
  const leaders = state.accounts.filter((a) => a.role === "leader" || a.role === "both").length
  const followers = state.accounts.filter((a) => a.role === "follower" || a.role === "both").length

  return (
    <>
      <PageHead title="Connection" subtitle="Connect and manage your Leader and Follower accounts.">
        <button type="button" className={linkBtnPrimary} onClick={() => setConnect(true)}>
          <Plus className="size-3.5" /> Connect Account
        </button>
      </PageHead>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Connected" value={linked.length} sub={state.accounts.length > linked.length ? `${state.accounts.length - linked.length} manual` : undefined} />
        <Stat label="Leaders" value={leaders} />
        <Stat label="Followers" value={followers} />
        <Stat label="Healthy" value={`${linked.filter(isOnline).length} / ${linked.length}`} />
      </div>

      <Section title="Accounts" description="An account isn't tied to one role: it can lead one Copy Group and follow another.">
        {state.accounts.length === 0 ? (
          <>
            <NotEnough title="No trading accounts connected yet.">Connect the account you trade on, and the accounts that should copy it.</NotEnough>
            <div className="flex justify-center">
              <button type="button" className={linkBtnPrimary} onClick={() => setConnect(true)}>
                Connect Account
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    {["Account", "Broker / Platform", "Balance", "Equity", "Role", "Status", "Last sync", ""].map((h, i) => (
                      <th key={i} scope="col" className={`py-2 font-medium ${i === 2 || i === 3 ? "ps-3 text-end" : i === 0 ? "text-start" : "ps-3 text-start"}`}>
                        {h || <span className="sr-only">Actions</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {state.accounts.map((a) => (
                    <tr key={a.id}>
                      <th scope="row" className="max-w-56 py-2.5 text-start">
                        <span className="block truncate font-semibold">{a.name}</span>
                        <span className="block text-xs font-normal text-muted-foreground tabular-nums">{a.login ? `ID ${a.login}` : "No account ID"}</span>
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
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 lg:hidden">
              {state.accounts.map((a) => (
                <li key={a.id} className="space-y-2.5 rounded-xl border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{a.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.platform}
                        {a.login ? ` · ID ${a.login}` : ""}
                      </p>
                    </div>
                    <RolePill role={a.role} />
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Balance</dt>
                      <dd className="font-medium tabular-nums">{money(a.balance)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Equity</dt>
                      <dd className="font-medium tabular-nums">{money(a.equity)}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap items-center gap-2">
                    <HealthPill health={a.health} />
                    <Heartbeat account={a} />
                  </div>
                  <button type="button" className={`${linkBtn} w-full`} onClick={() => setManage(a.id)}>
                    Manage
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <ConnectAccountDialog open={connect} onClose={() => setConnect(false)} />
      <AccountDrawer accountId={manage} onClose={() => setManage(null)} />
    </>
  )
}
