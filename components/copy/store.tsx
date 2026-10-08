"use client"

import type React from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { refreshCopy } from "@/app/actions/copy-trading"
import { wantsOrdersAllowed } from "@/lib/copy/errors"
import { groupCopies, type AccountView, type CopyState, type GroupView } from "@/lib/copy/view"
import { AllowOrdersDialog } from "./allow-orders"

// The Copy Trading pages share one picture of the trader's setup. It is loaded
// with the page and refreshed while the page is in front — every 5 seconds in
// the Cockpit, every 15 elsewhere, and not at all in a background tab. Each
// refresh is also the engine's heartbeat (see lib/copy/server.ts).

type Store = {
  state: CopyState
  // the group the Cockpit and Risk Management are showing
  group: GroupView | null
  selectGroup: (id: number) => void
  account: (id: number) => AccountView | undefined
  // open "Allow orders" for one of the trader's accounts (allow-orders.tsx)
  allowOrders: (accountId: number) => void
  // ask for fresh data now (after something was changed)
  refresh: () => Promise<void>
  refreshing: boolean
}
const Ctx = createContext<Store | null>(null)

export function useCopy(): Store {
  const store = useContext(Ctx)
  if (!store) throw new Error("CopyProvider is missing")
  return store
}

const signature = (s: CopyState) => JSON.stringify({ ...s, at: "" })
// what the trader has just done themselves, and was told as they did it
const QUIET = new Set(["orders_allowed", "orders_stopped"])

export function CopyProvider({ initial, children }: { initial: CopyState; children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const params = useSearchParams()
  const [state, setState] = useState(initial)
  const [refreshing, setRefreshing] = useState(false)
  const last = useRef(signature(initial))
  const seen = useRef({ event: Math.max(0, ...initial.events.map((e) => e.id)), copies: new Set(initial.orders.map((o) => o.masterOrderId)) })
  const busy = useRef(false)
  const [allowing, setAllowing] = useState<number | null>(null)

  const apply = useCallback((next: CopyState) => {
    // tell the trader what happened since the last look
    const events = next.events.filter((e) => e.id > seen.current.event && !QUIET.has(e.code)).reverse()
    for (const e of events.slice(-3)) {
      // an order that had no password to go out with: the way to give it one, on the message itself
      const account = wantsOrdersAllowed(e) ? next.accounts.find((a) => a.id === e.accountId && a.canAllowOrders) : undefined
      ;(e.level === "error" ? toast.error : e.level === "warning" ? toast.warning : e.level === "success" ? toast.success : toast.message)(e.title, { description: e.body ?? undefined, action: account ? { label: "Allow orders", onClick: () => setAllowing(account.id) } : undefined })
    }
    for (const c of groupCopies(next.orders).filter((c) => !seen.current.copies.has(c.masterOrderId)).slice(0, 3)) {
      if (c.filled === c.total && c.total > 0) toast.success(`Trade copied: ${c.side === "long" ? "BUY" : "SELL"} ${c.symbol}`, { description: `${c.filled}/${c.total} followers${c.simulated ? " (simulated)" : ""}` })
    }
    seen.current = { event: Math.max(seen.current.event, ...next.events.map((e) => e.id)), copies: new Set(next.orders.map((o) => o.masterOrderId)) }
    const sig = signature(next)
    if (sig === last.current) return
    last.current = sig
    setState(next)
  }, [])

  const refresh = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setRefreshing(true)
    try {
      const res = await refreshCopy()
      if (res.ok) apply(res.state)
    } catch {
      // a missed refresh is made up by the next one
    } finally {
      busy.current = false
      setRefreshing(false)
    }
  }, [apply])

  // the server sent a new starting point (after a save)
  useEffect(() => apply(initial), [initial, apply])

  const every = pathname.startsWith("/copy-trading/cockpit") ? 5_000 : 15_000
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && void refresh()
    const timer = setInterval(tick, every)
    document.addEventListener("visibilitychange", tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", tick)
    }
  }, [every, refresh])

  const asked = Number(params.get("group"))
  const group = useMemo(() => state.groups.find((g) => g.id === asked) ?? state.groups.find((g) => g.status === "active") ?? state.groups[0] ?? null, [state.groups, asked])
  const selectGroup = useCallback(
    (id: number) => {
      const p = new URLSearchParams(params.toString())
      p.set("group", String(id))
      router.replace(`${pathname}?${p.toString()}`, { scroll: false })
    },
    [params, pathname, router],
  )
  const byId = useMemo(() => new Map([...state.accounts, ...state.shared].map((a) => [a.id, a])), [state.accounts, state.shared])
  const store = useMemo<Store>(() => ({ state, group, selectGroup, account: (id) => byId.get(id), allowOrders: setAllowing, refresh, refreshing }), [state, group, selectGroup, byId, refresh, refreshing])
  const asking = allowing != null ? state.accounts.find((a) => a.id === allowing && a.canAllowOrders) : undefined
  return (
    <Ctx.Provider value={store}>
      {children}
      <AllowOrdersDialog account={asking ?? null} onClose={() => setAllowing(null)} onDone={refresh} />
    </Ctx.Provider>
  )
}

const TABS = [
  { href: "/copy-trading", label: "Copy Dashboard" },
  { href: "/copy-trading/connection", label: "Connection" },
  { href: "/copy-trading/cockpit", label: "Cockpit" },
  { href: "/copy-trading/risk-management", label: "Risk Management" },
]

// The four pages of Copy Trading. The group being looked at travels with the link.
export function CopyTabs() {
  const pathname = usePathname()
  const params = useSearchParams()
  const group = params.get("group")
  return (
    <nav aria-label="Copy Trading" className="-mb-px flex min-w-0 flex-1 gap-1 overflow-x-auto px-4 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {TABS.map((tab) => {
        const active = pathname === tab.href
        return (
          <Link key={tab.href} href={group ? `${tab.href}?group=${group}` : tab.href} aria-current={active ? "page" : undefined} className={cn("shrink-0 border-b-2 px-2.5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors", active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
