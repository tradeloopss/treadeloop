"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import {
  Activity,
  ArrowLeft,
  Banknote,
  BarChart3,
  BookMarked,
  BookOpen,
  Bot,
  Brain,
  Building2,
  CalendarDays,
  CandlestickChart,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CirclePlus,
  Copy,
  CreditCard,
  FlaskConical,
  Gauge,
  Gift,
  Handshake,
  HeartPulse,
  HelpCircle,
  LayoutDashboard,
  ListChecks,
  Lock,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  NotebookPen,
  Plug,
  Rewind,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react"
import { BrandMark } from "@/components/brand-mark"
import { ComingSoonBadge } from "@/components/coming-soon-badge"
import { LanguageSwitcher } from "@/components/language-switcher"
import { LOCALE_CHOICE_OFFERED } from "@/lib/i18n"
import { useT } from "@/components/locale-provider"
import { QUICK_NAV, itemForPath, resolveNavigation, sectionForPath, type FeatureStage, type NavIcon, type ResolvedItem, type ResolvedSection, type SectionId } from "@/lib/navigation"
import { affiliateHref } from "@/lib/urls"

// The app's navigation. What it lists comes from lib/navigation.ts; this file
// only decides how it is laid out:
//   desktop (1200px+)  a narrow rail of the six product areas, and beside it
//                      the pages of the selected one; collapsible to the rail
//   tablet (768–1199)  the rail, with the pages opening over the content
//   phone              a menu that shows the six areas first, then the pages
//                      of the one tapped, then closes on the page chosen

const ICONS: Record<NavIcon, LucideIcon> = {
  journal: BookOpen,
  accounts: Users,
  propsync: ShieldCheck,
  edge: Brain,
  backtesting: CandlestickChart,
  agents: Bot,
  dashboard: LayoutDashboard,
  notebook: NotebookPen,
  trades: ListChecks,
  calendar: CalendarDays,
  reports: BarChart3,
  playbooks: BookMarked,
  tradeManager: Activity,
  copy: Copy,
  propfirm: Building2,
  tracker: Gauge,
  payouts: Banknote,
  overview: Target,
  discovery: Sparkles,
  psychology: HeartPulse,
  edgeJournal: ScrollText,
  tests: FlaskConical,
  replay: Rewind,
}

const COLLAPSED_KEY = "sidebarCollapsed"
const QUICK_LABELS: Record<string, string> = { dashboard: "Overview", trades: "Trades", "edge-overview": "Edge", psychology: "Psychology" }
// The brand's purple running into blue: the mark of the selected product area.
const GRADIENT = "bg-[linear-gradient(135deg,var(--primary),#3b82f6)]"

type T = (key: string, vars?: Record<string, string | number>) => string

function ItemBadge({ badge, t }: { badge: ResolvedItem["badge"]; t: T }) {
  if (!badge || badge === "soon") return null
  return (
    <span className={cn("ms-auto shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase", badge === "beta" ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground")}>
      {badge === "pro" ? t("Pro") : badge === "beta" ? t("Beta") : t("Admin")}
    </span>
  )
}

// One page of a product area. A page that isn't released is drawn as plain,
// muted text: no link, no handler, out of the tab order and deaf to the pointer.
function PageRow({ item, active, roomy, hideBadge, t }: { item: ResolvedItem; active: boolean; roomy?: boolean; hideBadge?: boolean; t: T }) {
  const Icon = ICONS[item.icon]
  if (!item.enabled)
    return (
      <div aria-disabled="true" tabIndex={-1} className={cn("pointer-events-none flex items-start gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground/60 select-none", roomy ? "py-3" : "py-2")}>
        <Icon className="mt-0.5 size-4 shrink-0" />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="truncate">{t(item.label)}</span>
          <ComingSoonBadge />
        </span>
      </div>
    )
  return (
    <Link
      href={item.href!}
      aria-current={active ? "page" : undefined}
      title={item.description}
      className={cn(
        "relative flex items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        roomy ? "py-3" : "py-2",
        active ? "bg-primary/12 text-foreground before:absolute before:inset-y-2 before:start-0 before:w-[3px] before:rounded-full before:bg-[linear-gradient(180deg,var(--primary),#3b82f6)]" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active && "text-primary")} />
      <span className="min-w-0 flex-1 truncate">{t(item.label)}</span>
      {!hideBadge && <ItemBadge badge={item.badge} t={t} />}
      {roomy && <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 rtl:rotate-180" />}
    </Link>
  )
}

// The release stage shared by every open page of an area ("Admin", "Beta"):
// said once beside the area's name rather than on each of its pages.
const sharedStage = (section: ResolvedSection) => {
  const open = section.items.filter((i) => i.enabled)
  const first = open[0]?.badge
  return open.length > 1 && (first === "admin" || first === "beta") && open.every((i) => i.badge === first) ? first : null
}

// Level 2: the pages of one product area.
function SectionPages({ section, activeId, pathname, roomy, t }: { section: ResolvedSection; activeId: string | null; pathname: string; roomy?: boolean; t: T }) {
  const stage = sharedStage(section)
  return (
    <>
      {section.action && (
        <div className="px-3 pb-1">
          <Link
            href={section.action.href}
            className={cn("flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90", pathname === section.action.href && "ring-2 ring-primary/40 ring-offset-2 ring-offset-sidebar")}
          >
            <CirclePlus className="size-4 shrink-0" />
            {t(section.action.label)}
          </Link>
        </div>
      )}
      <nav aria-label={t(section.label)} className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
        {section.items.map((item) => (
          <PageRow key={item.id} item={item} active={item.id === activeId} roomy={roomy} hideBadge={!!stage && item.badge === stage} t={t} />
        ))}
      </nav>
    </>
  )
}

// Theme, help, accounts, billing, settings, sign out: everything that belongs
// to the person rather than to a product area.
function UserMenu({ userName, userImage, isAdmin, showName }: { userName: string; userImage?: string | null; isAdmin: boolean; showName?: boolean }) {
  const router = useRouter()
  const t = useT()
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  async function handleSignOut() {
    await authClient.signOut()
    router.push("/sign-in")
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button type="button" aria-label={t("Account menu")} className={cn("flex min-w-0 items-center gap-3 rounded-md hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", showName ? "w-full px-2 py-2 text-start" : "p-1")}>
            <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-sm font-medium text-primary">
              {userImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={userImage} alt="" className="size-full object-cover" />
              ) : (
                userName.charAt(0).toUpperCase()
              )}
            </span>
            {showName && <span className="truncate text-sm font-medium">{userName}</span>}
          </button>
        }
      />
      <DropdownMenuContent side="top" align="start" className="w-64">
        <div className="flex items-center justify-between px-1.5 py-1">
          <span className="text-sm">{t("Theme")}</span>
          <div className="flex items-center gap-0.5 rounded-full bg-muted p-0.5">
            <button type="button" onClick={() => setTheme("dark")} aria-label={t("Dark mode")} className={cn("flex size-6 items-center justify-center rounded-full transition-colors", mounted && resolvedTheme === "dark" ? "bg-background shadow-sm" : "text-muted-foreground")}>
              <Moon className="size-3.5" />
            </button>
            <button type="button" onClick={() => setTheme("light")} aria-label={t("Light mode")} className={cn("flex size-6 items-center justify-center rounded-full transition-colors", mounted && resolvedTheme === "light" ? "bg-background shadow-sm" : "text-muted-foreground")}>
              <Sun className="size-3.5" />
            </button>
          </div>
        </div>

        {LOCALE_CHOICE_OFFERED && (
          <div className="flex items-center justify-between px-1.5 py-1">
            <span className="text-sm">{t("Language")}</span>
            <LanguageSwitcher className="-me-2" />
          </div>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem render={<Link href="/support" />}>
          <HelpCircle className="size-4" />
          {t("Help & support")}
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/accounts" />}>
          <Wallet className="size-4" />
          {t("Accounts")}
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/billing" />}>
          <CreditCard className="size-4" />
          {t("Billing")}
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/settings" />}>
          <Plug className="size-4" />
          {t("Settings")}
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/cases" />}>
          <Gift className="size-4" />
          {t("Cases Drop")}
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={affiliateHref("/affiliate")} />}>
          <Handshake className="size-4" />
          {t("Affiliate program")}
        </DropdownMenuItem>
        {isAdmin && (
          <DropdownMenuItem render={<Link href="/admin" />}>
            <ShieldCheck className="size-4" />
            {t("Admin panel")}
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
          <LogOut className="size-4" />
          {t("Logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DashboardSidebar({
  userName,
  userImage,
  isAdmin = false,
  isPro = false,
  hasBeta = false,
  insights,
}: {
  userName: string
  userImage?: string | null
  isAdmin?: boolean
  isPro?: boolean
  // can use features still in beta (lib/beta.ts)
  hasBeta?: boolean
  // the staged features this user may open, with their release stage
  insights?: { edge_lab?: FeatureStage; psychology?: FeatureStage }
}) {
  const pathname = usePathname()
  const t = useT()
  const sections = useMemo(() => resolveNavigation({ isAdmin, isPro, hasBeta, features: { edge_lab: insights?.edge_lab, psychology: insights?.psychology } }), [isAdmin, isPro, hasBeta, insights?.edge_lab, insights?.psychology])

  // The product area the current page belongs to, and the one whose pages are
  // shown — the same until another area is picked to look into.
  const routeSection = sectionForPath(pathname)
  const activeId = itemForPath(pathname)?.item.id ?? null
  const [selected, setSelected] = useState<SectionId>(routeSection ?? "journal")
  // Level 2 opened over the content (tablet, or desktop with the menu collapsed)
  const [flyout, setFlyout] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [desktop, setDesktop] = useState(true)
  // the phone's menu, and which area's pages it is showing (null = the six areas)
  const [menu, setMenu] = useState(false)
  const [pane, setPane] = useState<SectionId | null>(null)
  const [lastPane, setLastPane] = useState<SectionId>("journal")

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1")
    } catch {
      // private browsing / storage disabled — stay expanded
    }
    const wide = window.matchMedia("(min-width: 1200px)")
    setDesktop(wide.matches)
    const onChange = (e: MediaQueryListEvent) => setDesktop(e.matches)
    wide.addEventListener("change", onChange)
    return () => wide.removeEventListener("change", onChange)
  }, [])

  // A new page: follow it (refresh, a direct link, back and forward included),
  // and get out of the way.
  useEffect(() => {
    const next = sectionForPath(pathname)
    if (next) setSelected(next)
    setFlyout(false)
    setMenu(false)
  }, [pathname])

  useEffect(() => {
    if (!flyout && !menu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      setFlyout(false)
      setMenu(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [flyout, menu])

  function toggleCollapsed() {
    setFlyout(false)
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

  const pick = (id: SectionId) => {
    setFlyout((open) => (id === selected ? !open : true))
    setSelected(id)
  }
  const openPane = (id: SectionId) => {
    setLastPane(id)
    setPane(id)
  }

  const current = sections.find((s) => s.id === selected) ?? sections[0]
  const shown = sections.find((s) => s.id === (pane ?? lastPane)) ?? sections[0]
  const docked = desktop && !collapsed
  const quick = QUICK_NAV.map((id) => sections.flatMap((s) => s.items).find((i) => i.id === id)).filter((i): i is ResolvedItem => !!i?.enabled)
  const bottomBar = quick.some((i) => i.feature)

  return (
    <TooltipProvider>
      {/* ---------------------------------------------------------------- phone */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-sidebar px-4 text-sidebar-foreground md:hidden">
        <Link href="/dashboard" className="flex items-center gap-2">
          <BrandMark className="size-7" />
          <span className="font-semibold tracking-tight">TradeLoop</span>
        </Link>
        <button
          type="button"
          onClick={() => {
            setPane(null)
            setMenu(true)
          }}
          aria-label={t("Open menu")}
          aria-expanded={menu}
          aria-controls="app-menu"
          className="flex size-9 items-center justify-center rounded-md hover:bg-sidebar-accent/60"
        >
          <Menu className="size-5" />
        </button>
      </header>

      {menu && <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setMenu(false)} aria-hidden="true" />}

      <aside
        id="app-menu"
        role="dialog"
        aria-modal="true"
        aria-label={t("Menu")}
        inert={!menu || undefined}
        className={cn("fixed inset-y-0 start-0 z-50 flex w-80 max-w-[88vw] flex-col bg-sidebar text-sidebar-foreground shadow-2xl transition-transform duration-200 md:hidden", menu ? "translate-x-0" : "-translate-x-full rtl:translate-x-full")}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
          {pane ? (
            <button type="button" onClick={() => setPane(null)} className="-ms-2 flex items-center gap-2 rounded-md px-2 py-1.5 font-semibold hover:bg-sidebar-accent/60">
              <ArrowLeft className="size-5 rtl:rotate-180" aria-hidden />
              <span className="sr-only">{t("Back to all areas")}: </span>
              {t(shown.label)}
              <ItemBadge badge={sharedStage(shown)} t={t} />
            </button>
          ) : (
            <span className="flex items-center gap-2">
              <BrandMark className="size-7" />
              <span className="font-semibold tracking-tight">TradeLoop</span>
            </span>
          )}
          <button type="button" onClick={() => setMenu(false)} aria-label={t("Close menu")} className="flex size-9 items-center justify-center rounded-md hover:bg-sidebar-accent/60">
            <X className="size-5" />
          </button>
        </div>

        {/* Level 1, then Level 2: one slides out as the other slides in. */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <nav aria-label={t("Product areas")} inert={!!pane || undefined} className={cn("absolute inset-0 flex flex-col gap-1 overflow-y-auto p-3 transition-transform duration-200", pane ? "-translate-x-full rtl:translate-x-full" : "translate-x-0")}>
            {sections.map((s) => {
              const Icon = ICONS[s.icon]
              const here = s.id === routeSection
              if (!s.enabled)
                return (
                  <div key={s.id} aria-disabled="true" tabIndex={-1} className="pointer-events-none flex items-center gap-3 rounded-xl px-3 py-3.5 text-muted-foreground/60 select-none">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                      <Icon className="size-5" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="font-medium">{t(s.label)}</span>
                      <ComingSoonBadge />
                    </span>
                    <Lock className="size-4 shrink-0" />
                  </div>
                )
              return (
                <button key={s.id} type="button" onClick={() => openPane(s.id)} aria-current={here ? "true" : undefined} className="flex items-center gap-3 rounded-xl px-3 py-3.5 text-start hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                  <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", here ? `${GRADIENT} text-white shadow-[0_6px_16px_-6px_var(--primary)]` : "bg-muted/60 text-muted-foreground")}>
                    <Icon className="size-5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">{t(s.label)}</span>
                    <span className="truncate text-xs text-muted-foreground">{t(s.tagline)}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
                </button>
              )
            })}
          </nav>
          <div inert={!pane || undefined} className={cn("absolute inset-0 flex flex-col pt-3 transition-transform duration-200", pane ? "translate-x-0" : "translate-x-full rtl:-translate-x-full")}>
            <SectionPages section={shown} activeId={activeId} pathname={pathname} roomy t={t} />
          </div>
        </div>

        <div className="shrink-0 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <UserMenu userName={userName} userImage={userImage} isAdmin={isAdmin} showName />
        </div>
      </aside>

      {/* ------------------------------------------------- tablet and desktop */}
      {flyout && <div className={cn("fixed inset-0 z-30 hidden md:block", !collapsed && "min-[1200px]:hidden")} onClick={() => setFlyout(false)} aria-hidden="true" />}

      <aside className="relative z-40 hidden shrink-0 text-sidebar-foreground md:flex">
        {/* Level 1: the product areas */}
        <div className="flex w-[76px] shrink-0 flex-col items-center border-e bg-sidebar py-3">
          <Link href="/dashboard" aria-label="TradeLoop" className="mb-3 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <BrandMark className="size-8" />
          </Link>
          <nav aria-label={t("Product areas")} className="flex flex-1 flex-col items-center gap-1 overflow-y-auto">
            {sections.map((s) => {
              const Icon = ICONS[s.icon]
              const on = s.id === selected
              if (!s.enabled)
                return (
                  <div key={s.id} aria-disabled="true" tabIndex={-1} title={`${t(s.label)} — ${t("Coming soon")}`} className="flex w-16 flex-col items-center gap-1 rounded-xl px-1 py-2 text-center text-[10px] leading-tight font-medium text-muted-foreground/50 select-none">
                    <Icon className="size-5" />
                    <span>{t(s.label)}</span>
                    <ComingSoonBadge short className="px-1 text-[8px] leading-3" />
                  </div>
                )
              return (
                <Tooltip key={s.id}>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={() => pick(s.id)}
                        aria-label={t(s.label)}
                        aria-expanded={on && (docked || flyout)}
                        aria-controls="app-pages"
                        aria-current={s.id === routeSection ? "true" : undefined}
                        className={cn(
                          "relative flex w-16 flex-col items-center gap-1 rounded-xl px-1 py-2 text-center text-[10px] leading-tight font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                          on ? `${GRADIENT} text-white shadow-[0_8px_20px_-8px_var(--primary)]` : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                        )}
                      >
                        <Icon className="size-5" />
                        <span>{t(s.label)}</span>
                        {/* the area the open page is in, while another is being looked at */}
                        {!on && s.id === routeSection && <span className="absolute end-1.5 top-1.5 size-1.5 rounded-full bg-primary" aria-hidden />}
                      </button>
                    }
                  />
                  <TooltipContent side="inline-end">
                    {t(s.label)} — {t(s.tagline)}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </nav>
          <div className="flex flex-col items-center gap-1 pt-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Link href="/settings" aria-label={t("Settings")} aria-current={pathname.startsWith("/settings") ? "page" : undefined} className={cn("flex size-10 items-center justify-center rounded-xl transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", pathname.startsWith("/settings") ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground")}>
                    <Settings className="size-5" />
                  </Link>
                }
              />
              <TooltipContent side="inline-end">{t("Settings")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button type="button" onClick={toggleCollapsed} aria-label={collapsed ? t("Expand sidebar") : t("Collapse sidebar")} aria-pressed={collapsed} className="hidden size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none min-[1200px]:flex">
                    {collapsed ? <ChevronsRight className="size-5 rtl:rotate-180" /> : <ChevronsLeft className="size-5 rtl:rotate-180" />}
                  </button>
                }
              />
              <TooltipContent side="inline-end">{collapsed ? t("Expand sidebar") : t("Collapse sidebar")}</TooltipContent>
            </Tooltip>
            <UserMenu userName={userName} userImage={userImage} isAdmin={isAdmin} />
          </div>
        </div>

        {/* Level 2: the pages of the selected area. Beside the rail on a wide
            screen; over the content on a tablet, or when collapsed. */}
        <div
          id="app-pages"
          className={cn("w-56 flex-col border-e bg-sidebar", flyout ? "absolute inset-y-0 start-[76px] z-40 flex shadow-2xl" : "hidden", !collapsed && "min-[1200px]:static min-[1200px]:z-auto min-[1200px]:flex min-[1200px]:shadow-none")}
        >
          <div className="px-4 pt-4 pb-3">
            <p className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-foreground/80 uppercase">
              {t(current.label)}
              <ItemBadge badge={sharedStage(current)} t={t} />
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t(current.tagline)}</p>
          </div>
          <SectionPages section={current} activeId={activeId} pathname={pathname} t={t} />
        </div>
      </aside>

      {/* The phone's bottom bar, for users who have the insight features: the
          few places they move between, and the full menu one tap away. */}
      {bottomBar && (
        <nav aria-label={t("Quick navigation")} className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-sidebar pb-[env(safe-area-inset-bottom)] text-sidebar-foreground md:hidden">
          {quick.map((item) => {
            const Icon = ICONS[item.icon]
            const on = item.id === activeId
            return (
              <Link key={item.id} href={item.href!} aria-current={on ? "page" : undefined} className={cn("flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium", on ? "text-primary" : "text-muted-foreground")}>
                <Icon className="size-5 shrink-0" />
                <span className="max-w-full truncate">{t(QUICK_LABELS[item.id] ?? item.label)}</span>
              </Link>
            )
          })}
          <button
            type="button"
            onClick={() => {
              setPane(null)
              setMenu(true)
            }}
            className="flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium text-muted-foreground"
          >
            <MoreHorizontal className="size-5 shrink-0" />
            <span>{t("More")}</span>
          </button>
        </nav>
      )}
    </TooltipProvider>
  )
}
