"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useTransition } from "react"
import { Bell, ChartLine, CircleDollarSign, FolderOpen, LayoutDashboard, LifeBuoy, Link2, Megaphone, Settings, Target, TicketPercent, Users, Wallet } from "lucide-react"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { markNotificationsRead } from "@/app/actions/affiliate"

const ICONS = { overview: LayoutDashboard, analytics: ChartLine, referrals: Users, campaigns: Target, links: Link2, coupons: TicketPercent, earnings: CircleDollarSign, payouts: Wallet, resources: FolderOpen, announcements: Megaphone, support: LifeBuoy, settings: Settings }

export type PortalNavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number }

// Same shape as the admin area's nav: a column on desktop, a scrolling strip
// on a phone.
export function PortalNav({ items }: { items: PortalNavItem[] }) {
  const pathname = usePathname()
  return (
    <nav aria-label="Affiliate program" className="flex gap-1 overflow-x-auto p-3 md:flex-col md:overflow-visible">
      {items.map((item) => {
        const Icon = ICONS[item.icon]
        const active = item.href === "/affiliate" ? pathname === "/affiliate" : pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn("flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors", active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
          >
            <Icon className="size-4" aria-hidden="true" />
            {item.label}
            {!!item.badge && (
              <span className="ms-auto rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums" aria-label={`${item.badge} unread`}>
                {item.badge}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}

export type PortalNotification = { id: number; title: string; body: string | null; href: string | null; read: boolean; at: string }

export function NotificationsMenu({ items, unread }: { items: PortalNotification[]; unread: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Popover
      onOpenChange={(open) => {
        // Opening the list is reading it.
        if (open && unread > 0 && !pending) start(async () => void (await markNotificationsRead()))
        if (!open && unread > 0) router.refresh()
      }}
    >
      <PopoverTrigger
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Bell className="size-4" aria-hidden />
        {unread > 0 && <span className="absolute end-1 top-1 size-2 rounded-full bg-primary ring-2 ring-sidebar" aria-hidden />}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <p className="border-b px-4 py-3 text-sm font-semibold">Notifications</p>
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing yet. Referrals, commissions and payouts will show up here.</p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {items.map((n) => {
              const body = (
                <>
                  <span className="flex items-start gap-2">
                    {!n.read && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                    <span className="text-sm font-medium">{n.title}</span>
                  </span>
                  {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>}
                  <span className="mt-1 block text-[11px] text-muted-foreground">{n.at}</span>
                </>
              )
              return (
                <li key={n.id}>
                  {n.href ? (
                    <Link href={n.href} className="block px-4 py-3 hover:bg-muted/50">
                      {body}
                    </Link>
                  ) : (
                    <div className="px-4 py-3">{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
