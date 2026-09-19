"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import {
  LayoutDashboard,
  ListChecks,
  NotebookPen,
  CalendarDays,
  BookOpen,
  BarChart3,
  LogOut,
  Plug,
  CirclePlus,
  Sun,
  Moon,
  Menu,
  X,
  HelpCircle,
  ChevronsLeft,
  ChevronsRight,
  ShieldCheck,
  Banknote,
} from "lucide-react"
import { BrandMark } from "@/components/brand-mark"

const links = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/trades", label: "Trades", icon: ListChecks },
  { href: "/journal", label: "Journal", icon: NotebookPen },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/playbooks", label: "Playbooks", icon: BookOpen },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/propfirm", label: "Prop Firm", icon: ShieldCheck },
  { href: "/payouts", label: "Payouts", icon: Banknote },
]

const COLLAPSED_KEY = "sidebarCollapsed"

export function DashboardSidebar({ userName, userImage, isAdmin = false }: { userName: string; userImage?: string | null; isAdmin?: boolean }) {
  const pathname = usePathname()
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    setMounted(true)
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1")
    } catch {
      // private browsing / storage disabled — just stay expanded
    }
  }, [])

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setOpen(false), [pathname])

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0")
      } catch {
        // ignore
      }
      return next
    })
  }

  async function handleSignOut() {
    await authClient.signOut()
    router.push("/sign-in")
    router.refresh()
  }

  return (
    <TooltipProvider>
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-sidebar px-4 text-sidebar-foreground md:hidden">
        <div className="flex items-center gap-2">
          <BrandMark className="size-7" />
          <span className="font-semibold tracking-tight">TradeLoop</span>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu">
          <Menu className="size-5" />
        </Button>
      </header>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-svh w-72 max-w-[85vw] shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-transform duration-200 md:static md:z-auto md:max-w-none md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
          mounted && collapsed ? "md:w-[72px]" : "md:w-60",
        )}
      >
        <div className={cn("flex items-center gap-2 px-5 py-5", collapsed ? "md:justify-center md:px-0" : "justify-between")}>
          <div className="flex items-center gap-2">
            <BrandMark className="size-8" />
            <span className={cn("text-lg font-semibold tracking-tight", collapsed && "md:hidden")}>TradeLoop</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <X className="size-5" />
          </Button>
        </div>

        <div className={cn("px-3 pt-1 pb-2", collapsed && "md:px-2")}>
          <Tooltip>
            <TooltipTrigger
              render={
                <Link
                  href="/add-trade"
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90",
                    pathname === "/add-trade" && "ring-2 ring-primary/40 ring-offset-2 ring-offset-sidebar",
                  )}
                >
                  <CirclePlus className="size-4 shrink-0" />
                  <span className={cn(collapsed && "md:hidden")}>Add Trade</span>
                </Link>
              }
            />
            {collapsed && <TooltipContent side="right">Add Trade</TooltipContent>}
          </Tooltip>
        </div>

        <nav className={cn("flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2", collapsed && "md:px-2")}>
          {links.map((link) => {
            const active = pathname === link.href
            const Icon = link.icon
            return (
              <Tooltip key={link.href}>
                <TooltipTrigger
                  render={
                    <Link
                      href={link.href}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        collapsed && "md:justify-center md:px-0",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className={cn(collapsed && "md:hidden")}>{link.label}</span>
                    </Link>
                  }
                />
                {collapsed && <TooltipContent side="right">{link.label}</TooltipContent>}
              </Tooltip>
            )
          })}
        </nav>

        <div className={cn("hidden border-t px-3 py-2 md:block")}>
          <button
            type="button"
            onClick={toggleCollapsed}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              collapsed && "justify-center",
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            {!collapsed && "Collapse"}
          </button>
        </div>

        <div className={cn("border-t p-3", collapsed && "md:px-2")}>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className={cn(
                    "flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-sidebar-accent/60",
                    collapsed && "md:justify-center md:px-0",
                  )}
                >
                  <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-sm font-medium text-primary">
                    {userImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={userImage} alt="" className="size-full object-cover" />
                    ) : (
                      userName.charAt(0).toUpperCase()
                    )}
                  </div>
                  <p className={cn("truncate text-sm font-medium", collapsed && "md:hidden")}>{userName}</p>
                </button>
              }
            />
            <DropdownMenuContent side="top" align="start" className="w-64">
              <div className="flex items-center justify-between px-1.5 py-1">
                <span className="text-sm">Theme</span>
                <div className="flex items-center gap-0.5 rounded-full bg-muted p-0.5">
                  <button
                    type="button"
                    onClick={() => setTheme("dark")}
                    aria-label="Dark mode"
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full transition-colors",
                      mounted && resolvedTheme === "dark" ? "bg-background shadow-sm" : "text-muted-foreground",
                    )}
                  >
                    <Moon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme("light")}
                    aria-label="Light mode"
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full transition-colors",
                      mounted && resolvedTheme === "light" ? "bg-background shadow-sm" : "text-muted-foreground",
                    )}
                  >
                    <Sun className="size-3.5" />
                  </button>
                </div>
              </div>

              <DropdownMenuSeparator />

              <DropdownMenuItem render={<Link href="/support" />}>
                <HelpCircle className="size-4" />
                Help &amp; support
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/settings" />}>
                <Plug className="size-4" />
                Settings
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem render={<Link href="/admin" />}>
                  <ShieldCheck className="size-4" />
                  Admin panel
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
                <LogOut className="size-4" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </TooltipProvider>
  )
}
