"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"
import { LayoutDashboard, ListChecks, BarChart3 } from "lucide-react"

const TABS = [
  { href: "/backtest/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/backtest/sessions", label: "Sessions", icon: ListChecks },
  { href: "/backtest/reports", label: "Reports", icon: BarChart3 },
]

export function BacktestNav() {
  const t = useT()
  const pathname = usePathname()
  return (
    <nav className="flex items-center gap-1 border-b px-2 sm:px-4">
      {TABS.map((tab) => {
        const active = pathname === tab.href
        const Icon = tab.icon
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" /> {t(tab.label)}
          </Link>
        )
      })}
    </nav>
  )
}
