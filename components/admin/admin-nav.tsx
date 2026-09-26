"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Activity, BookOpen, CreditCard, Database, FileUp, Gauge, LifeBuoy, Lock, Megaphone, PlugZap, ScrollText, ShieldCheck, SlidersHorizontal, Users } from "lucide-react"

const ICONS = { overview: Gauge, users: Users, billing: CreditCard, brokers: PlugZap, analytics: Activity, announcements: Megaphone, audit: ScrollText, team: ShieldCheck, support: LifeBuoy, security: Lock, imports: FileUp, content: BookOpen, system: Database, propRules: SlidersHorizontal }

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number }

export function AdminNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname()
  return (
    <nav className="flex gap-1 overflow-x-auto p-3 md:flex-col md:overflow-visible">
      {items.map((item) => {
        const Icon = ICONS[item.icon]
        const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
              active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {item.label}
            {!!item.badge && (
              <span className="ms-auto rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums" aria-label={`${item.badge} waiting`}>
                {item.badge}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
