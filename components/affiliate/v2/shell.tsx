"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { ArrowLeft, ArrowLeftRight, ChevronDown, ChevronRight, LayoutGrid, LogOut, Menu, MessageSquareHeart, Moon, Settings, Sparkles, Sun, X } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import type { V2Feature } from "@/lib/affiliates/v2/config"
import { BrandMark } from "@/components/brand-mark"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { affiliateHref } from "@/lib/urls"
import { V2_BOTTOM, V2_EXTRA, V2_MORE_GROUPS, V2_NAV, V2_TITLES, isActiveV2, navKey, type V2NavItem } from "./nav"
import { FeedbackDialog } from "./feedback"
import { SwitchToClassicDialog } from "./switch"
import { NotificationsBell, QuickActions, SearchButton, type V2Notification } from "./header-tools"
import { Avatar, BetaBadge, NewBadge } from "./ui"
import { cn } from "@/lib/utils"

export type V2ShellProps = {
  affiliate: { firstName: string; lastName: string; email: string }
  features: Record<V2Feature, boolean>
  topRate: number | null
  referralUrl: string
  notifications: V2Notification[]
  unread: number
  announcementsUnread: number
  backToApp: string
  children: React.ReactNode
}

// The V2 dashboard's frame. Desktop: a sidebar and a header. Tablet: the
// sidebar shrinks to icons. Phone: a compact header, a bottom bar of the main
// sections, a "More" menu with everything else, and a quick-actions button.
export function V2Shell({ affiliate, features, topRate, referralUrl, notifications, unread, announcementsUnread, backToApp, children }: V2ShellProps) {
  const pathname = usePathname()
  const [more, setMore] = useState(false)
  const [feedback, setFeedback] = useState(false)
  const [classic, setClassic] = useState(false)
  useEffect(() => setMore(false), [pathname])

  const on = (i: V2NavItem) => !i.feature || features[i.feature] !== false
  const nav = V2_NAV.filter(on)
  const all = [...nav, ...V2_EXTRA.filter(on)]
  const byKey = (k: string) => all.find((i) => i.key === k)
  const bottom = V2_BOTTOM.map((k) => byKey(k) ?? (k === "wallet" ? byKey("payouts") : undefined)).filter((i): i is V2NavItem => !!i)
  const key = navKey(pathname)
  const head = V2_TITLES[key]
  const name = `${affiliate.firstName} ${affiliate.lastName}`.trim()
  const signOut = async () => {
    await authClient.signOut().catch(() => null)
    window.location.assign(backToApp.replace(/\/dashboard$/, "/sign-in"))
  }
  const badgeFor = (i: V2NavItem) => (i.key === "announcements" && announcementsUnread ? announcementsUnread : null)

  return (
    <TooltipProvider delay={250}>
      <div className="flex min-h-svh">
        <a href="#v2-main" className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:start-3 focus:top-3">
          Skip to content
        </a>

        {/* Tablet + desktop sidebar */}
        <aside aria-label="Affiliate dashboard" className="sticky top-0 hidden h-svh w-[76px] shrink-0 flex-col border-e bg-sidebar/80 backdrop-blur-xl md:flex lg:w-[248px] dark:bg-[#050d1f]/80">
          <Link href={affiliateHref("/affiliate/v2")} className="flex h-[68px] shrink-0 items-center justify-center gap-2.5 px-4 lg:justify-start lg:px-5" aria-label="TradeLoop affiliate dashboard">
            <BrandMark className="size-9" />
            <span className="hidden min-w-0 lg:block">
              <span className="flex items-center gap-1.5 text-[17px] font-bold tracking-tight">
                tradeloop <BetaBadge />
              </span>
              <span className="block text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Affiliates</span>
            </span>
          </Link>
          <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            <ul className="space-y-1">
              {nav.map((i) => {
                const active = isActiveV2(i.href, pathname)
                const badge = badgeFor(i)
                return (
                  <li key={i.key}>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Link
                            href={affiliateHref(i.href)}
                            aria-current={active ? "page" : undefined}
                            aria-label={i.label}
                            className={cn(
                              "relative flex h-10 items-center justify-center gap-3 rounded-xl px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none lg:justify-start",
                              active ? "v2-nav-active font-semibold" : "text-muted-foreground hover:bg-primary/[0.07] hover:text-foreground"
                            )}
                          />
                        }
                      >
                        <i.icon className="size-[18px] shrink-0" aria-hidden />
                        <span className="hidden flex-1 truncate lg:inline">{i.label}</span>
                        {i.isNew && (
                          <span className="hidden lg:inline">
                            <NewBadge />
                          </span>
                        )}
                        {badge && <span className={cn("hidden min-w-5 rounded-full px-1.5 text-center text-[10px] leading-5 font-bold tabular-nums lg:inline", active ? "bg-white/20" : "bg-primary/15 text-primary")}>{badge}</span>}
                        {(i.isNew || badge) && <span className="absolute end-2 top-2 size-1.5 rounded-full bg-[#d946ef] lg:hidden" aria-hidden />}
                      </TooltipTrigger>
                      <TooltipContent side="right" className="lg:hidden">
                        {i.label}
                        {i.isNew ? " · New" : ""}
                      </TooltipContent>
                    </Tooltip>
                  </li>
                )
              })}
            </ul>
          </nav>
          <div className="hidden shrink-0 px-3 pb-2 lg:block">
            <GrowCard topRate={topRate} />
          </div>
          <div className="shrink-0 border-t p-3">
            <ProfileMenu name={name} email={affiliate.email} onFeedback={() => setFeedback(true)} onClassic={() => setClassic(true)} onSignOut={signOut} backToApp={backToApp} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Phone header */}
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b bg-background/80 px-2 backdrop-blur-xl md:hidden">
            <button type="button" onClick={() => setMore(true)} aria-label="Open menu" className="inline-flex size-11 items-center justify-center rounded-xl text-foreground hover:bg-muted">
              <Menu className="size-5" aria-hidden />
            </button>
            <Link href={affiliateHref("/affiliate/v2")} className="flex items-center gap-2">
              <BrandMark className="size-7" />
              <span className="text-base font-bold tracking-tight">tradeloop</span>
              <BetaBadge />
            </Link>
            <div className="flex items-center">
              <NotificationsBell items={notifications} unread={unread} />
            </div>
          </header>

          {/* Tablet + desktop header */}
          <header className="sticky top-0 z-30 hidden h-[68px] items-center gap-3 border-b bg-background/70 px-5 backdrop-blur-xl md:flex lg:px-7">
            <div className="min-w-0 flex-1">
              {key === "dashboard" ? (
                <>
                  <p className="truncate text-lg font-semibold tracking-tight">Welcome back, {affiliate.firstName}! 👋</p>
                  <p className="truncate text-xs text-muted-foreground">Here&apos;s your affiliate performance at a glance.</p>
                </>
              ) : (
                <>
                  <h1 className="truncate text-lg font-semibold tracking-tight">{head?.title ?? "Affiliate dashboard"}</h1>
                  {head?.description && <p className="truncate text-xs text-muted-foreground">{head.description}</p>}
                </>
              )}
            </div>
            <SearchButton features={features} />
            <QuickActions referralUrl={referralUrl} wallet={features.wallet} variant="header" />
            <button type="button" onClick={() => setFeedback(true)} className="hidden h-10 items-center gap-1.5 rounded-xl border bg-card/70 px-3 text-sm font-medium hover:border-primary/40 xl:inline-flex" title="Send feedback about the beta">
              <MessageSquareHeart className="size-4 text-primary" aria-hidden /> Feedback
            </button>
            <NotificationsBell items={notifications} unread={unread} />
            <ThemeToggle />
          </header>

          <main id="v2-main" tabIndex={-1} className="min-w-0 flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] outline-none md:pb-0">
            {children}
          </main>
        </div>

        {/* Phone bottom bar */}
        <nav aria-label="Main sections" className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
          <ul className="grid" style={{ gridTemplateColumns: `repeat(${bottom.length + 1}, minmax(0, 1fr))` }}>
            {bottom.map((i) => {
              const active = isActiveV2(i.href, pathname)
              return (
                <li key={i.key}>
                  <Link href={affiliateHref(i.href)} aria-current={active ? "page" : undefined} className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium", active ? "text-primary" : "text-muted-foreground")}>
                    <span className={cn("flex h-8 w-12 items-center justify-center rounded-xl transition-colors", active && "v2-nav-active")}>
                      <i.icon className="size-5" aria-hidden />
                    </span>
                    {i.label}
                  </Link>
                </li>
              )
            })}
            <li>
              <button type="button" onClick={() => setMore(true)} className={cn("flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium", more ? "text-primary" : "text-muted-foreground")}>
                <span className="flex h-8 w-12 items-center justify-center rounded-xl">
                  <LayoutGrid className="size-5" aria-hidden />
                </span>
                More
              </button>
            </li>
          </ul>
        </nav>
        <QuickActions referralUrl={referralUrl} wallet={features.wallet} variant="fab" />

        <MoreMenu open={more} onOpenChange={setMore} items={all} name={name} pathname={pathname} onFeedback={() => setFeedback(true)} onClassic={() => setClassic(true)} onSignOut={signOut} topRate={topRate} />
        <FeedbackDialog open={feedback} onOpenChange={setFeedback} />
        <SwitchToClassicDialog open={classic} onOpenChange={setClassic} />
      </div>
    </TooltipProvider>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <button type="button" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label="Toggle dark / light mode" className="relative inline-flex size-10 items-center justify-center rounded-xl border border-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
      <Moon className="size-[18px] dark:hidden" aria-hidden />
      <Sun className="hidden size-[18px] dark:block" aria-hidden />
    </button>
  )
}

// Dark / Light, as a pair (the phone's menu, Settings).
export function ThemePair({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const current = mounted ? resolvedTheme : null
  return (
    <div role="radiogroup" aria-label="Theme" className={cn("grid grid-cols-2 gap-1 rounded-xl border bg-muted/40 p-1", className)}>
      {(
        [
          ["dark", "Dark Mode", Moon],
          ["light", "Light Mode", Sun],
        ] as const
      ).map(([value, label, Icon]) => (
        <button key={value} type="button" role="radio" aria-checked={current === value} onClick={() => setTheme(value)} className={cn("inline-flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors", current === value ? "v2-nav-active" : "text-muted-foreground hover:text-foreground")}>
          <Icon className="size-4" aria-hidden /> {label}
        </button>
      ))}
    </div>
  )
}

function GrowCard({ topRate }: { topRate: number | null }) {
  return (
    <div className="v2-card-glow relative overflow-hidden p-4">
      <div aria-hidden className="pointer-events-none absolute -end-6 -top-6 size-24 rounded-full bg-[radial-gradient(circle,rgb(139_92_246/0.45),transparent_70%)]" />
      <p className="relative text-sm font-bold leading-tight">
        Grow faster
        <br />
        <span className="v2-text-gradient">Earn more</span>
      </p>
      <p className="relative mt-1.5 text-[11px] leading-snug text-muted-foreground">Invite your audience and earn {topRate ? `up to ${topRate}%` : "a commission"} on every payment.</p>
      <Link href={affiliateHref("/affiliate/v2/share")} className="v2-btn relative mt-3 inline-flex h-8 items-center gap-1 rounded-lg px-3 text-xs font-semibold">
        Start sharing <ChevronRight className="size-3.5" aria-hidden />
      </Link>
    </div>
  )
}

function ProfileMenu({ name, email, onFeedback, onClassic, onSignOut, backToApp }: { name: string; email: string; onFeedback: () => void; onClassic: () => void; onSignOut: () => void; backToApp: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button" aria-label={`Account menu for ${name}`} className="flex w-full items-center justify-center gap-3 rounded-xl p-1.5 text-start transition-colors hover:bg-primary/[0.07] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none lg:justify-start lg:border lg:bg-card/60 lg:p-2.5" />}>
        <Avatar name={name} />
        <span className="hidden min-w-0 flex-1 lg:block">
          <span className="block truncate text-sm font-semibold">{name}</span>
          <span className="block truncate text-[11px] text-primary">Affiliate Partner</span>
        </span>
        <ChevronDown className="hidden size-4 text-muted-foreground lg:block" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-2">
            <span className="block truncate text-sm font-medium text-foreground">{name}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">{email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href={affiliateHref("/affiliate/v2/settings")} />}>
          <Settings aria-hidden /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onFeedback}>
          <MessageSquareHeart aria-hidden /> Send feedback
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onClassic}>
          <ArrowLeftRight aria-hidden /> Switch to Classic Dashboard
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<a href={backToApp} />}>
          <ArrowLeft aria-hidden /> Back to the TradeLoop app
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onSignOut}>
          <LogOut aria-hidden /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MoreMenu({ open, onOpenChange, items, name, pathname, onFeedback, onClassic, onSignOut, topRate }: { open: boolean; onOpenChange: (o: boolean) => void; items: V2NavItem[]; name: string; pathname: string; onFeedback: () => void; onClassic: () => void; onSignOut: () => void; topRate: number | null }) {
  const byKey = (k: string) => items.find((i) => i.key === k)
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/50 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup className="fixed inset-y-0 start-0 z-50 flex w-[min(340px,90vw)] flex-col bg-background text-foreground shadow-2xl outline-none data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={name} className="size-10" />
              <div className="min-w-0">
                <DialogPrimitive.Title className="truncate text-sm font-semibold">{name}</DialogPrimitive.Title>
                <p className="text-xs text-primary">Affiliate Partner</p>
              </div>
            </div>
            <DialogPrimitive.Close aria-label="Close menu" className="inline-flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted">
              <X className="size-5" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <nav aria-label="All sections" className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {[{ label: "Main", keys: ["dashboard", "analytics", "referrals"] }, ...V2_MORE_GROUPS].map((g) => {
              const list = g.keys.map(byKey).filter((i): i is V2NavItem => !!i)
              if (!list.length) return null
              return (
                <div key={g.label} className="pb-3">
                  <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{g.label}</p>
                  <ul className="space-y-0.5">
                    {list.map((i) => {
                      const active = isActiveV2(i.href, pathname)
                      return (
                        <li key={i.key}>
                          <Link href={affiliateHref(i.href)} onClick={() => onOpenChange(false)} aria-current={active ? "page" : undefined} className={cn("flex h-11 items-center gap-3 rounded-xl px-3 text-sm", active ? "v2-nav-active font-semibold" : "hover:bg-muted")}>
                            <i.icon className="size-[18px]" aria-hidden />
                            <span className="flex-1">{i.label}</span>
                            {i.isNew && <NewBadge />}
                            <ChevronRight className="size-4 opacity-50" aria-hidden />
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
            <div className="v2-card-glow mx-1 mt-1 p-4">
              <p className="flex items-center gap-1.5 text-sm font-bold">
                <Sparkles className="size-4 text-primary" aria-hidden /> Earn more with TradeLoop
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Refer, earn, grow — {topRate ? `up to ${topRate}%` : "a commission"} on every payment.</p>
            </div>
          </nav>
          <div className="shrink-0 space-y-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <ThemePair />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => (onOpenChange(false), onFeedback())} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-medium hover:bg-muted">
                <MessageSquareHeart className="size-4 text-primary" aria-hidden /> Feedback
              </button>
              <button type="button" onClick={() => (onOpenChange(false), onClassic())} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-medium hover:bg-muted">
                <ArrowLeftRight className="size-4" aria-hidden /> Classic
              </button>
            </div>
            <button type="button" onClick={onSignOut} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-loss hover:bg-loss/10">
              <LogOut className="size-4" aria-hidden /> Log out
            </button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
