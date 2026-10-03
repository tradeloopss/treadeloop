"use client"

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { ArrowLeft, ArrowLeftRight, Bell, ChevronDown, LayoutGrid, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, Settings, ShieldCheck, SlidersHorizontal, UserRound, X } from "lucide-react"
import { setSidebarCollapsed } from "@/app/actions/admin-shell"
import { isActive, type NavIcon } from "@/lib/admin/nav"
import { authClient } from "@/lib/auth-client"
import { BrandMark } from "@/components/brand-mark"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { NAV_ICONS } from "@/components/admin/shell/nav-icons"
import { CommandPalette } from "@/components/admin/shell/command-palette"
import { NotificationsBell } from "@/components/admin/shell/notifications-bell"
import { ReturnToOldDialog } from "@/components/admin/shell/dashboard-switch"
import { ThemeChoice, ThemeToggle } from "@/components/admin/shell/theme-toggle"
import { cn } from "@/lib/utils"

export type ShellNavItem = { href: string; label: string; icon: NavIcon; badge?: number }
export type ShellNavGroup = { label: string; items: ShellNavItem[] }
export type ShellQuickAction = { key: string; label: string; href: string | null; icon: NavIcon }

type ShellProps = {
  groups: ShellNavGroup[]
  bottom: ShellNavItem[]
  quickActions: ShellQuickAction[]
  admin: { name: string; email: string; role: string }
  canSecurity: boolean
  sidebar: "expanded" | "collapsed"
  children: React.ReactNode
}

// --- Shared with the pages inside the shell ------------------------------------------

type ShellContextValue = { openPalette: () => void; quickActions: ShellQuickAction[] }
const ShellContext = createContext<ShellContextValue>({ openPalette: () => {}, quickActions: [] })
export const useAdminShell = () => useContext(ShellContext)

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    () => window.matchMedia(query).matches,
    () => false
  )
}

const initials = (name: string, email: string) =>
  (name || email)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "A"

// --- The shell --------------------------------------------------------------------------

// The command center's frame: a grouped, collapsible sidebar on a desktop
// (icons only on a tablet), a header with search, theme, notifications and the
// admin's menu, and on a phone a compact header, a slide-out menu with every
// section, and a bottom bar of shortcuts. One component for both themes — the
// colours all come from theme tokens.
export function ModernShell({ groups, bottom, quickActions, admin, canSecurity, sidebar, children }: ShellProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(sidebar === "collapsed")
  const [drawer, setDrawer] = useState(false)
  const [palette, setPalette] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const isDesktop = useMediaQuery("(min-width: 1024px)")
  const iconOnly = !isDesktop || collapsed

  useEffect(() => setCollapsed(sidebar === "collapsed"), [sidebar])
  useEffect(() => setDrawer(false), [pathname])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPalette((open) => !open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    setSidebarCollapsed(next).catch(() => {})
  }
  const openPalette = useCallback(() => setPalette(true), [])
  const openReturn = () => {
    setDrawer(false)
    setReturnOpen(true)
  }

  const pages = groups.flatMap((g) => g.items).map(({ href, label, icon }) => ({ href, label, icon }))
  const actions = quickActions.filter((a): a is ShellQuickAction & { href: string } => a.href != null).map(({ href, label, icon }) => ({ href, label, icon }))

  return (
    <ShellContext.Provider value={{ openPalette, quickActions }}>
      <TooltipProvider delay={250}>
        <div className="flex min-h-svh bg-background text-foreground">
          <a href="#admin-main" className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:start-3 focus:top-3">
            Skip to content
          </a>

          {/* Tablet and desktop sidebar */}
          <aside
            data-collapsed={collapsed ? "true" : "false"}
            aria-label="Admin sections"
            className="group/sb sticky top-0 hidden h-svh w-[72px] shrink-0 flex-col border-e bg-sidebar text-sidebar-foreground md:flex lg:w-[248px] lg:data-[collapsed=true]:w-[72px] motion-safe:transition-[width] motion-safe:duration-200"
          >
            <Link href="/admin" className="flex h-16 shrink-0 items-center justify-center gap-2.5 border-b border-transparent px-4 lg:justify-start lg:px-5 lg:group-data-[collapsed=true]/sb:justify-center lg:group-data-[collapsed=true]/sb:px-4" aria-label="TradeLoop Admin — Overview">
              <BrandMark className="size-8" />
              <span className="hidden text-[15px] font-semibold tracking-tight whitespace-nowrap lg:inline lg:group-data-[collapsed=true]/sb:hidden">
                TradeLoop <span className="font-medium text-muted-foreground">Admin</span>
              </span>
            </Link>
            <nav className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-3">
              {groups.map((group, gi) => (
                <div key={group.label} className={cn(gi > 0 && "pt-3 lg:pt-4")}>
                  <p className="hidden px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase lg:block lg:group-data-[collapsed=true]/sb:hidden">{group.label}</p>
                  {gi > 0 && <div className="mx-auto mb-3 h-px w-8 bg-border lg:hidden lg:group-data-[collapsed=true]/sb:block" aria-hidden />}
                  <ul className="space-y-0.5">
                    {group.items.map((item) => (
                      <li key={item.href}>
                        <SidebarLink item={item} active={isActive(item.href, pathname)} iconOnly={iconOnly} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
            <div className="shrink-0 space-y-0.5 border-t p-3">
              <SidebarButton icon={ArrowLeftRight} label="Return to old dashboard" iconOnly={iconOnly} onClick={openReturn} />
              <SidebarButton icon={ArrowLeft} label="Back to app" iconOnly={iconOnly} href="/dashboard" />
              <SidebarButton icon={collapsed ? PanelLeftOpen : PanelLeftClose} label={collapsed ? "Expand sidebar" : "Collapse sidebar"} iconOnly={iconOnly} onClick={toggleCollapsed} className="hidden lg:flex" ariaExpanded={!collapsed} />
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1.5 border-b bg-background/85 px-2 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 sm:px-3 md:h-16 md:gap-3 md:px-6">
              <button type="button" onClick={() => setDrawer(true)} aria-label="Open menu" className="inline-flex size-10 items-center justify-center rounded-lg text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none md:hidden">
                <Menu className="size-5" aria-hidden />
              </button>
              <Link href="/admin" className="flex min-w-0 items-center gap-2 md:hidden">
                <BrandMark className="size-7" />
                <span className="truncate text-[15px] font-semibold tracking-tight">
                  TradeLoop <span className="font-medium text-muted-foreground">Admin</span>
                </span>
              </Link>
              <SearchField onOpen={openPalette} />
              <div className="ms-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
                <button type="button" onClick={openPalette} aria-label="Search" className="inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none md:hidden">
                  <Search className="size-[18px]" aria-hidden />
                </button>
                <ThemeToggle className="max-sm:hidden" />
                <NotificationsBell />
                <ProfileMenu admin={admin} canSecurity={canSecurity} />
              </div>
            </header>
            <main id="admin-main" tabIndex={-1} className="min-w-0 flex-1 pb-[calc(4.25rem+env(safe-area-inset-bottom))] outline-none md:pb-0">
              {children}
            </main>
          </div>

          <BottomNav items={bottom} pathname={pathname} onMore={() => setDrawer(true)} />
          <MobileDrawer open={drawer} onOpenChange={setDrawer} groups={groups} pathname={pathname} onReturn={openReturn} />
          <CommandPalette open={palette} onOpenChange={setPalette} pages={pages} actions={actions} />
          <ReturnToOldDialog open={returnOpen} onOpenChange={setReturnOpen} />
        </div>
      </TooltipProvider>
    </ShellContext.Provider>
  )
}

// --- Sidebar pieces ------------------------------------------------------------------------

const rowClass = (active: boolean) =>
  cn(
    "group/link relative flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
    "justify-center lg:justify-start lg:group-data-[collapsed=true]/sb:justify-center",
    active
      ? "bg-primary/10 font-semibold text-primary dark:bg-primary/15 before:absolute before:inset-y-2 before:-start-3 before:w-[3px] before:rounded-e-full before:bg-primary"
      : "text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:bg-muted/60"
  )
const labelClass = "hidden truncate lg:inline lg:group-data-[collapsed=true]/sb:hidden"

function SidebarLink({ item, active, iconOnly }: { item: ShellNavItem; active: boolean; iconOnly: boolean }) {
  const Icon = NAV_ICONS[item.icon]
  return (
    <Tooltip disabled={!iconOnly}>
      <TooltipTrigger render={<Link href={item.href} aria-current={active ? "page" : undefined} aria-label={iconOnly ? `${item.label}${item.badge ? `, ${item.badge} waiting` : ""}` : undefined} className={rowClass(active)} />}>
        <span className="relative shrink-0">
          <Icon className={cn("size-[18px]", active && "stroke-[2.25]")} aria-hidden />
          {!!item.badge && <span className="absolute -end-1 -top-1 size-2 rounded-full bg-primary ring-2 ring-sidebar lg:hidden lg:group-data-[collapsed=true]/sb:block" aria-hidden />}
        </span>
        <span className={labelClass}>{item.label}</span>
        {!!item.badge && (
          <span className="ms-auto hidden min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] leading-5 font-semibold text-primary-foreground tabular-nums lg:inline lg:group-data-[collapsed=true]/sb:hidden" aria-label={`${item.badge} waiting`}>
            {item.badge}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="right">
        {item.label}
        {item.badge ? ` · ${item.badge}` : ""}
      </TooltipContent>
    </Tooltip>
  )
}

function SidebarButton({ icon: Icon, label, iconOnly, onClick, href, className, ariaExpanded }: { icon: React.ElementType; label: string; iconOnly: boolean; onClick?: () => void; href?: string; className?: string; ariaExpanded?: boolean }) {
  const cls = cn(rowClass(false), className)
  const inner = (
    <>
      <Icon className="size-[18px] shrink-0" aria-hidden />
      <span className={labelClass}>{label}</span>
    </>
  )
  return (
    <Tooltip disabled={!iconOnly}>
      <TooltipTrigger
        render={
          href ? (
            <Link href={href} className={cls} aria-label={iconOnly ? label : undefined} />
          ) : (
            <button type="button" onClick={onClick} className={cls} aria-label={iconOnly ? label : undefined} aria-expanded={ariaExpanded} />
          )
        }
      >
        {inner}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

// --- Header pieces --------------------------------------------------------------------------

function SearchField({ onOpen }: { onOpen: () => void }) {
  const [mac, setMac] = useState(false)
  useEffect(() => setMac(/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)), [])
  return (
    <button
      type="button"
      onClick={onOpen}
      className="hidden h-10 w-full max-w-[460px] items-center gap-2.5 rounded-xl border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:border-foreground/15 hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none md:flex dark:bg-muted/30"
      aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
    >
      <Search className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-start">Search users, trades, tickets, payouts…</span>
      <kbd className="hidden shrink-0 rounded-md border bg-background px-1.5 py-0.5 font-sans text-[11px] font-medium lg:inline">{mac ? "⌘ K" : "Ctrl K"}</kbd>
    </button>
  )
}

function ProfileMenu({ admin, canSecurity }: { admin: ShellProps["admin"]; canSecurity: boolean }) {
  const router = useRouter()
  const signOut = async () => {
    await authClient.signOut()
    router.push("/sign-in")
    router.refresh()
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Account menu for ${admin.name || admin.email}`}
            className="flex h-10 items-center gap-2.5 rounded-lg ps-1 pe-1 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none aria-expanded:bg-muted lg:pe-2"
          />
        }
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground" aria-hidden>
          {initials(admin.name, admin.email)}
        </span>
        <span className="hidden min-w-0 text-start leading-tight lg:block">
          <span className="block max-w-[140px] truncate text-sm font-medium">{admin.name || admin.email}</span>
          <span className="block text-[11px] text-muted-foreground">{admin.role}</span>
        </span>
        <ChevronDown className="hidden size-4 text-muted-foreground lg:block" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-2">
            <span className="block truncate text-sm font-medium text-foreground">{admin.name || admin.email}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">{admin.email}</span>
            <span className="mt-1.5 inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{admin.role}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/settings" />}>
          <UserRound aria-hidden /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/admin/settings?section=appearance" />}>
          <SlidersHorizontal aria-hidden /> Preferences
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/admin/notifications" />}>
          <Bell aria-hidden /> Notifications
        </DropdownMenuItem>
        {canSecurity && (
          <DropdownMenuItem render={<Link href="/admin/security" />}>
            <ShieldCheck aria-hidden /> Security
          </DropdownMenuItem>
        )}
        <DropdownMenuItem render={<Link href="/admin/settings" />}>
          <Settings aria-hidden /> Admin settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/dashboard" />}>
          <ArrowLeft aria-hidden /> Back to app
        </DropdownMenuItem>
        <DropdownMenuItem onClick={signOut}>
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// --- Phone pieces ---------------------------------------------------------------------------

function BottomNav({ items, pathname, onMore }: { items: ShellNavItem[]; pathname: string; onMore: () => void }) {
  return (
    <nav aria-label="Shortcuts" className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const Icon = NAV_ICONS[item.icon]
          const active = isActive(item.href, pathname)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("relative flex h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium focus-visible:bg-muted focus-visible:outline-none", active ? "text-primary" : "text-muted-foreground")}
              >
                {active && <span className="absolute top-0 h-0.5 w-8 rounded-b-full bg-primary" aria-hidden />}
                <span className="relative">
                  <Icon className={cn("size-5", active && "stroke-[2.25]")} aria-hidden />
                  {!!item.badge && <span className="absolute -end-1.5 -top-1 size-2 rounded-full bg-loss ring-2 ring-background" aria-label={`${item.badge} waiting`} />}
                </span>
                <span className="max-w-full truncate px-1">{item.label === "Overview" ? "Home" : item.label}</span>
              </Link>
            </li>
          )
        })}
        <li>
          <button type="button" onClick={onMore} className="flex h-[60px] w-full flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground focus-visible:bg-muted focus-visible:outline-none">
            <LayoutGrid className="size-5" aria-hidden />
            More
          </button>
        </li>
      </ul>
    </nav>
  )
}

function MobileDrawer({ open, onOpenChange, groups, pathname, onReturn }: { open: boolean; onOpenChange: (open: boolean) => void; groups: ShellNavGroup[]; pathname: string; onReturn: () => void }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup className="fixed inset-y-0 start-0 z-50 flex w-[min(320px,86vw)] flex-col bg-sidebar text-sidebar-foreground shadow-xl outline-none duration-200 data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left rtl:data-open:slide-in-from-right rtl:data-closed:slide-out-to-right">
          <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4">
            <DialogPrimitive.Title className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
              <BrandMark className="size-7" />
              TradeLoop <span className="font-medium text-muted-foreground">Admin</span>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close aria-label="Close menu" className="inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
              <X className="size-5" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <nav aria-label="Admin sections" className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {groups.map((group) => (
              <div key={group.label} className="pb-3">
                <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase">{group.label}</p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = NAV_ICONS[item.icon]
                    const active = isActive(item.href, pathname)
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={() => onOpenChange(false)}
                          aria-current={active ? "page" : undefined}
                          className={cn("flex h-11 items-center gap-3 rounded-lg px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", active ? "bg-primary/10 font-semibold text-primary dark:bg-primary/15" : "text-foreground/85 hover:bg-muted")}
                        >
                          <Icon className="size-[18px] shrink-0" aria-hidden />
                          <span className="truncate">{item.label}</span>
                          {!!item.badge && <span className="ms-auto min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] leading-5 font-semibold text-primary-foreground tabular-nums">{item.badge}</span>}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </nav>
          <div className="shrink-0 space-y-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <ThemeChoice size="sm" />
            <button type="button" onClick={onReturn} className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-foreground/85 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
              <ArrowLeftRight className="size-[18px]" aria-hidden /> Return to old dashboard
            </button>
            <Link href="/dashboard" className="flex h-11 items-center gap-3 rounded-lg px-3 text-sm text-foreground/85 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
              <ArrowLeft className="size-[18px]" aria-hidden /> Back to app
            </Link>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
