// TradeLoop's main navigation, in one place: the six product areas (Level 1)
// and the pages of each (Level 2). The sidebar, the phone menu and the bottom
// bar are all drawn from this list — add a page here and it appears in each.
//
// A page that isn't released is still listed, with `comingSoon`: it is shown
// muted and cannot be opened (no link is rendered for it at all). What a user
// may open is decided by `resolveNavigation` from who they are; the pages
// themselves check again on their own.

export type NavIcon =
  | "journal"
  | "accounts"
  | "propsync"
  | "edge"
  | "backtesting"
  | "agents"
  | "dashboard"
  | "notebook"
  | "trades"
  | "calendar"
  | "reports"
  | "playbooks"
  | "tradeManager"
  | "copy"
  | "propfirm"
  | "tracker"
  | "payouts"
  | "overview"
  | "discovery"
  | "psychology"
  | "edgeJournal"
  | "tests"
  | "replay"

export type SectionId = "journal" | "account-manager" | "propsync" | "edge-lab" | "copy-trading" | "backtesting" | "agents"
export type FeatureStage = "admin" | "beta"

export type NavItem = {
  id: string
  label: string
  icon: NavIcon
  // null = there is no page yet
  href: string | null
  // other pages that belong to this entry (its own sub-pages)
  match?: string[]
  // only the address itself counts, not what is under it
  exact?: boolean
  description?: string
  // not released: listed, muted, and impossible to open
  comingSoon?: boolean
  // who may open a coming-soon page anyway, to test it before release
  preview?: ("admin" | "beta")[]
  // the plan the page is part of (the page itself explains and offers it)
  plan?: "pro"
  // a feature released in stages from the admin panel (lib/features)
  feature?: "edge_lab" | "psychology" | "copy_trading"
  // its own pages, listed under it only while the trader is inside it
  children?: { id: string; label: string; href: string; exact?: boolean }[]
}

export type NavSection = {
  id: SectionId
  label: string
  icon: NavIcon
  // what the area is for, in a line
  tagline: string
  // the area's own primary action, above its pages
  action?: { label: string; href: string }
  // pages that belong to the area without being listed in it
  match?: string[]
  // the whole area is still to come: it is shown, and cannot be opened
  comingSoon?: boolean
  items: NavItem[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "journal",
    label: "Journal",
    icon: "journal",
    tagline: "Record and understand your trades.",
    action: { label: "Add Trade", href: "/add-trade" },
    match: ["/add-trade"],
    items: [
      { id: "dashboard", label: "Dashboard", icon: "dashboard", href: "/dashboard" },
      { id: "journal", label: "Journal", icon: "notebook", href: "/journal" },
      { id: "trades", label: "Trades", icon: "trades", href: "/trades" },
      { id: "calendar", label: "Calendar", icon: "calendar", href: "/calendar" },
      { id: "reports", label: "Reports", icon: "reports", href: "/reports" },
      { id: "playbooks", label: "Playbooks", icon: "playbooks", href: "/playbooks" },
    ],
  },
  {
    id: "account-manager",
    label: "Account Manager",
    icon: "accounts",
    tagline: "Manage your live trading accounts.",
    items: [
      { id: "trade-manager", label: "Trade Manager", icon: "tradeManager", href: "/trade-manager", plan: "pro" },
    ],
  },
  {
    id: "propsync",
    label: "PropSync",
    icon: "propsync",
    tagline: "Manage your prop firm trading.",
    items: [
      { id: "prop-firm", label: "Prop Firm", icon: "propfirm", href: "/propfirm" },
      { id: "propsync-tracker", label: "PropSync Tracker", icon: "tracker", href: "/propfirm-max", comingSoon: true, preview: ["admin"] },
      { id: "payouts", label: "Payouts", icon: "payouts", href: "/payouts" },
    ],
  },
  {
    id: "edge-lab",
    label: "Edge Lab",
    icon: "edge",
    tagline: "Discover and improve your trading edge.",
    // Still to add as they are built: Market Conditions, Setup Analysis,
    // Behavior Analysis, Edge Reports. Until then Regimes and Setups live
    // inside Edge Discovery and Edge Journal, as tabs.
    items: [
      { id: "edge-overview", label: "Edge Overview", icon: "overview", href: "/edge-lab", exact: true, feature: "edge_lab", description: "Understand your strongest trading patterns" },
      { id: "edge-discovery", label: "Edge Discovery", icon: "discovery", href: "/edge-lab/discover", match: ["/edge-lab/regimes"], feature: "edge_lab", description: "Find what actually gives you an edge" },
      { id: "psychology", label: "Psychology", icon: "psychology", href: "/psychology", feature: "psychology", description: "Understand your behavior and decision-making" },
      { id: "edge-journal", label: "Edge Journal", icon: "edgeJournal", href: "/edge-lab/setups", match: ["/edge-lab/monitor"], feature: "edge_lab", description: "Track patterns behind your best and worst trades" },
      { id: "edge-tests", label: "Edge Tests", icon: "tests", href: "/edge-lab/hypotheses", match: ["/edge-lab/robustness"], feature: "edge_lab", description: "Validate whether an edge is repeatable" },
    ],
  },
  {
    // Its own product area, below Edge Lab. Its pages are the second level,
    // like every other section; the Cockpit is where a group is run.
    id: "copy-trading",
    label: "Copy Trading",
    icon: "copy",
    tagline: "Copy a leader account to its followers.",
    items: [
      { id: "copy-dashboard", label: "Copy Dashboard", icon: "overview", href: "/copy-trading", exact: true, feature: "copy_trading", description: "Your groups, followers and copy activity" },
      { id: "copy-connection", label: "Connection", icon: "accounts", href: "/copy-trading/connection", feature: "copy_trading", description: "Connect the accounts you copy to and from" },
      { id: "copy-cockpit", label: "Cockpit", icon: "copy", href: "/copy-trading/cockpit", feature: "copy_trading", description: "Run a copy group: followers, orders and risk" },
      { id: "copy-risk", label: "Risk Management", icon: "tests", href: "/copy-trading/risk-management", feature: "copy_trading", description: "The limits that guard every copied order" },
      { id: "copy-friends", label: "Friends", icon: "agents", href: "/copy-trading/friends", feature: "copy_trading", description: "Strategies you share with friends" },
    ],
  },
  {
    id: "backtesting",
    label: "Backtesting",
    icon: "backtesting",
    tagline: "Validate and replay strategies.",
    items: [
      { id: "backtesting", label: "Backtesting", icon: "backtesting", href: "/backtest", comingSoon: true, preview: ["admin", "beta"] },
      { id: "replay", label: "Replay", icon: "replay", href: "/replay", comingSoon: true, preview: ["admin"] },
    ],
  },
  {
    id: "agents",
    label: "Agents",
    icon: "agents",
    tagline: "Future AI trading assistants.",
    comingSoon: true,
    items: [{ id: "agents", label: "Agents", icon: "agents", href: null, comingSoon: true }],
  },
]

// The phone's bottom bar: the few places a trader moves between most.
export const QUICK_NAV = ["dashboard", "trades", "edge-overview", "psychology"]

export type NavContext = {
  isAdmin: boolean
  isPro: boolean
  // an affiliate perk: features still in beta are open to them (lib/beta.ts)
  hasBeta: boolean
  // the staged features this user may open, with the stage each is at
  features: { edge_lab?: FeatureStage; psychology?: FeatureStage; copy_trading?: FeatureStage }
}

export type NavBadge = "soon" | "pro" | "admin" | "beta" | null
export type ResolvedItem = NavItem & { enabled: boolean; badge: NavBadge }
export type ResolvedSection = Omit<NavSection, "items"> & { enabled: boolean; items: ResolvedItem[] }

export function resolveItem(item: NavItem, ctx: NavContext): ResolvedItem {
  const off: ResolvedItem = { ...item, enabled: false, badge: "soon" }
  if (!item.href) return off
  if (item.feature) {
    const stage = ctx.features[item.feature]
    return stage ? { ...item, enabled: true, badge: stage } : off
  }
  if (item.comingSoon) {
    if (ctx.isAdmin && item.preview?.includes("admin")) return { ...item, enabled: true, badge: "admin" }
    if (ctx.hasBeta && item.preview?.includes("beta")) return { ...item, enabled: true, badge: "beta" }
    return off
  }
  return { ...item, enabled: true, badge: item.plan === "pro" && !ctx.isPro ? "pro" : null }
}

export const resolveNavigation = (ctx: NavContext): ResolvedSection[] => NAV_SECTIONS.map((s) => ({ ...s, enabled: !s.comingSoon, items: s.items.map((i) => resolveItem(i, ctx)) }))

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`)

export function itemMatches(item: NavItem, pathname: string): boolean {
  if (!item.href) return false
  if (item.exact ? pathname === item.href : under(pathname, item.href)) return true
  return !!item.match?.some((m) => under(pathname, m))
}

// The page the address belongs to. The most specific entry wins, so
// /edge-lab/discover is Edge Discovery and never Edge Overview.
export function itemForPath(pathname: string): { section: NavSection; item: NavItem } | null {
  let best: { section: NavSection; item: NavItem; length: number } | null = null
  for (const section of NAV_SECTIONS)
    for (const item of section.items) {
      if (!itemMatches(item, pathname)) continue
      const length = Math.max(...[item.href!, ...(item.match ?? [])].filter((h) => under(pathname, h)).map((h) => h.length))
      if (!best || length > best.length) best = { section, item, length }
    }
  return best ? { section: best.section, item: best.item } : null
}

// The product area the address belongs to — after a refresh, a direct link or
// the browser's back button alike. null for pages outside the six (Settings).
export function sectionForPath(pathname: string): SectionId | null {
  const found = itemForPath(pathname)
  if (found) return found.section.id
  return NAV_SECTIONS.find((s) => s.match?.some((m) => under(pathname, m)))?.id ?? null
}
