import {
  Award,
  BarChart3,
  Bell,
  CircleDollarSign,

  Goal,
  LayoutDashboard,
  Link2,
  LifeBuoy,
  Megaphone,
  FolderOpen,
  Settings,
  Share2,
  Target,
  Ticket,
  Trophy,
  Users,
  Wallet,
  Banknote,
  type LucideIcon,
} from "lucide-react"
import type { V2Feature } from "@/lib/affiliates/v2/config"

// The V2 dashboard's sections. In-app addresses (affiliateHref turns them into
// the subdomain's). `feature` = hidden when the admin switches that feature off.

export type V2NavItem = { key: string; href: string; label: string; icon: LucideIcon; isNew?: boolean; feature?: V2Feature }

export const V2_BASE = "/affiliate/v2"

export const V2_NAV: V2NavItem[] = [
  { key: "dashboard", href: V2_BASE, label: "Dashboard", icon: LayoutDashboard },
  { key: "analytics", href: `${V2_BASE}/analytics`, label: "Analytics", icon: BarChart3 },
  { key: "referrals", href: `${V2_BASE}/referrals`, label: "Referrals", icon: Users },
  { key: "campaigns", href: `${V2_BASE}/campaigns`, label: "Campaigns", icon: Target },
  { key: "links", href: `${V2_BASE}/links`, label: "Links", icon: Link2 },
  { key: "coupons", href: `${V2_BASE}/coupons`, label: "Coupons", icon: Ticket },
  { key: "earnings", href: `${V2_BASE}/earnings`, label: "Earnings", icon: CircleDollarSign },
  { key: "payouts", href: `${V2_BASE}/payouts`, label: "Payouts", icon: Banknote },
  { key: "wallet", href: `${V2_BASE}/wallet`, label: "Wallet", icon: Wallet, isNew: true, feature: "wallet" },
  { key: "resources", href: `${V2_BASE}/resources`, label: "Resources", icon: FolderOpen },
  { key: "announcements", href: `${V2_BASE}/announcements`, label: "Announcements", icon: Megaphone },
  { key: "achievements", href: `${V2_BASE}/achievements`, label: "Achievements", icon: Award, isNew: true, feature: "achievements" },
  { key: "leaderboard", href: `${V2_BASE}/leaderboard`, label: "Leaderboard", icon: Trophy, isNew: true, feature: "leaderboard" },
  { key: "support", href: `${V2_BASE}/support`, label: "Support", icon: LifeBuoy },
  { key: "settings", href: `${V2_BASE}/settings`, label: "Settings", icon: Settings },
]

// Pages reached from cards and menus rather than the sidebar.
export const V2_EXTRA: V2NavItem[] = [
  { key: "goals", href: `${V2_BASE}/goals`, label: "Goals & challenges", icon: Goal, feature: "goals" },
  { key: "share", href: `${V2_BASE}/share`, label: "Share center", icon: Share2 },
  { key: "activity", href: `${V2_BASE}/activity`, label: "Activity", icon: Bell },
]

// The phone's "More" menu, grouped.
export const V2_MORE_GROUPS: { label: string; keys: string[] }[] = [
  { label: "Growth", keys: ["campaigns", "links", "coupons", "share"] },
  { label: "Finance", keys: ["earnings", "payouts", "wallet"] },
  { label: "Resources", keys: ["resources", "announcements", "goals", "achievements", "leaderboard"] },
  { label: "Account", keys: ["support", "settings"] },
]

export const V2_BOTTOM = ["dashboard", "analytics", "referrals", "wallet"]

// Header titles for each page (the dashboard greets instead).
export const V2_TITLES: Record<string, { title: string; description: string }> = {
  analytics: { title: "Analytics", description: "Where your traffic comes from and what it turns into." },
  referrals: { title: "Referrals", description: "Everyone who signed up through you, and what they're worth." },
  campaigns: { title: "Campaigns", description: "Group your traffic by channel and compare what each brings in." },
  links: { title: "Smart links", description: "Tracking links for every channel, with their results." },
  coupons: { title: "Coupons", description: "Your discount codes and how they perform." },
  earnings: { title: "Earnings", description: "Every commission, and where it is on its way to you." },
  payouts: { title: "Payouts", description: "Withdraw your earnings and follow every payout." },
  wallet: { title: "Wallet", description: "Manage your earnings and withdrawals." },
  resources: { title: "Resources", description: "Banners, copy and assets for promoting TradeLoop." },
  announcements: { title: "Announcements", description: "News and updates about the program." },
  goals: { title: "Goals & challenges", description: "This month's targets, measured on your real results." },
  achievements: { title: "Achievements", description: "Milestones you've reached, and the next ones." },
  leaderboard: { title: "Leaderboard", description: "How the affiliates who choose to appear are doing." },
  share: { title: "Share center", description: "Everything you need to share TradeLoop in one place." },
  activity: { title: "Activity", description: "Everything that happened on your account, newest first." },
  support: { title: "Support", description: "Questions about the program, payouts or your account." },
  settings: { title: "Settings", description: "Your profile, payouts, notifications and dashboard." },
}

export const navKey = (pathname: string) => {
  const m = /^\/affiliate\/v2(?:\/([a-z-]+))?/.exec(inAppPath(pathname))
  return m?.[1] ?? "dashboard"
}



// On the affiliate subdomain the portal sits at the root (/v2/payouts); in the
// app it is under /affiliate. Items carry the in-app path, so compare in that form.
export const inAppPath = (pathname: string) => (/^\/affiliate(\/|$)/.test(pathname) ? pathname : `/affiliate${pathname === "/" ? "" : pathname}`)

export const isActiveV2 = (href: string, pathname: string) => {
  const here = inAppPath(pathname)
  return href === V2_BASE ? here === V2_BASE || here === `${V2_BASE}/` : here === href || here.startsWith(`${href}/`)
}
