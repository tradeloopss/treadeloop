"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

export type SubNavItem = { href: string; label: string; badge?: number }

// Section tabs for the affiliate admin area, under the page header.
export function AffiliateSubNav({ items }: { items: SubNavItem[] }) {
  const pathname = usePathname()
  return (
    <nav aria-label="Affiliate program sections" className="flex gap-1 overflow-x-auto border-b px-4 sm:px-6">
      {items.map((item) => {
        const active = item.href === "/admin/affiliates" ? pathname === item.href || /^\/admin\/affiliates\/\d+$/.test(pathname) : pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn("-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors", active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {item.label}
            {!!item.badge && (
              <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums" aria-label={`${item.badge} waiting`}>
                {item.badge}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
