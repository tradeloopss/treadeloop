"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { AlertTriangle, Bell, CheckCheck, Handshake, LifeBuoy, PlugZap, ShieldAlert, Wallet, type LucideIcon } from "lucide-react"
import { loadAdminNotifications, markAdminNotificationRead, markAllAdminNotificationsRead, type BellItem } from "@/app/actions/admin-shell"
import type { NoticeCategory } from "@/lib/admin/command-center-rules"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { fmtAgo } from "@/components/admin/ui"
import { TONE_DOT, TONE_ICON } from "@/components/admin/command/tones"
import { cn } from "@/lib/utils"

const CATEGORY_ICONS: Record<NoticeCategory, LucideIcon> = { payouts: Wallet, affiliates: Handshake, support: LifeBuoy, brokers: PlugZap, security: ShieldAlert }
const REFRESH_MS = 120_000

type State = { status: "loading" } | { status: "error" } | { status: "ready"; items: BellItem[]; unread: number }

// The header bell: what needs an admin's eye, from live data (payouts to
// approve, applications, waiting support requests, failing syncs, repeated
// failed sign-ins), limited to what their role can open. Read state is saved
// with their account.
export function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<State>({ status: "loading" })
  const busy = useRef(false)

  const load = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      const data = await loadAdminNotifications()
      setState({ status: "ready", ...data })
    } catch {
      setState((s) => (s.status === "ready" ? s : { status: "error" }))
    } finally {
      busy.current = false
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(() => document.visibilityState === "visible" && load(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  const unread = state.status === "ready" ? state.unread : 0

  const markRead = (key: string) => {
    setState((s) => (s.status === "ready" ? { ...s, unread: Math.max(0, s.unread - (s.items.find((i) => i.key === key)?.unread ? 1 : 0)), items: s.items.map((i) => (i.key === key ? { ...i, unread: false } : i)) } : s))
    markAdminNotificationRead(key).catch(() => {})
  }
  const markAll = () => {
    setState((s) => (s.status === "ready" ? { ...s, unread: 0, items: s.items.map((i) => ({ ...i, unread: false })) } : s))
    markAllAdminNotificationsRead().catch(() => load())
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) load()
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
            className="relative inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none aria-expanded:bg-muted aria-expanded:text-foreground"
          />
        }
      >
        <Bell className="size-[18px]" aria-hidden />
        {unread > 0 && (
          <span className="absolute end-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-loss px-1 text-[10px] leading-none font-semibold text-white tabular-nums ring-2 ring-background" aria-hidden>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(380px,calc(100vw-1.5rem))] gap-0 p-0">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <button type="button" onClick={markAll} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
              <CheckCheck className="size-3.5" aria-hidden /> Mark all as read
            </button>
          )}
        </div>
        <div className="max-h-[min(420px,60vh)] overflow-y-auto">
          {state.status === "loading" && (
            <ul className="divide-y" aria-label="Loading notifications">
              {Array.from({ length: 4 }, (_, i) => (
                <li key={i} className="flex gap-3 px-4 py-3">
                  <span className="size-9 shrink-0 animate-pulse rounded-lg bg-muted" />
                  <span className="flex-1 space-y-2 pt-1">
                    <span className="block h-3 w-2/3 animate-pulse rounded bg-muted" />
                    <span className="block h-3 w-1/2 animate-pulse rounded bg-muted" />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {state.status === "error" && (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
              <AlertTriangle className="size-5" aria-hidden />
              Couldn&apos;t load notifications.
              <button type="button" onClick={load} className="font-medium text-primary hover:underline">
                Try again
              </button>
            </div>
          )}
          {state.status === "ready" && state.items.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">You&apos;re all caught up. Nothing needs your attention.</p>}
          {state.status === "ready" && state.items.length > 0 && (
            <ul className="divide-y">
              {state.items.slice(0, 12).map((item) => {
                const Icon = CATEGORY_ICONS[item.category]
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      onClick={() => {
                        markRead(item.key)
                        setOpen(false)
                      }}
                      className={cn("flex gap-3 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none", item.unread && "bg-primary/[0.03] dark:bg-primary/[0.06]")}
                    >
                      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", TONE_ICON[item.tone])} aria-hidden>
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-sm leading-snug", item.unread ? "font-semibold" : "font-medium")}>{item.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground/80">{fmtAgo(item.at)}</span>
                      </span>
                      {item.unread && (
                        <span className="mt-1.5 flex shrink-0 items-start">
                          <span className={cn("size-2 rounded-full", TONE_DOT[item.tone])} />
                          <span className="sr-only">Unread</span>
                        </span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="border-t p-1.5">
          <Link
            href="/admin/notifications"
            onClick={() => setOpen(false)}
            className="flex h-9 items-center justify-center rounded-md text-sm font-medium text-primary hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            View all
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
