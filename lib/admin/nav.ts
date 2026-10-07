import type { Permissions } from "@/lib/admin/access"

// Every admin section, in one place, for both dashboards. A link is shown
// only to roles with its permission (the page checks again on its own).

export type NavIcon =
  | "overview"
  | "users"
  | "billing"
  | "brokers"
  | "analytics"
  | "announcements"
  | "audit"
  | "team"
  | "support"
  | "security"
  | "imports"
  | "content"
  | "system"
  | "propRules"
  | "cases"
  | "affiliates"
  | "settings"
  | "features"
  | "providers"

export type NavLink = { href: string; label: string; icon: NavIcon; needs?: Permissions }

const L = {
  overview: { href: "/admin", label: "Overview", icon: "overview", needs: { user: ["list"] } },
  users: { href: "/admin/users", label: "Users", icon: "users", needs: { user: ["list"] } },
  support: { href: "/admin/support", label: "Support", icon: "support", needs: { support: ["view"] } },
  billing: { href: "/admin/billing", label: "Billing & revenue", icon: "billing", needs: { billing: ["view"] } },
  cases: { href: "/admin/cases", label: "Cases Drop", icon: "cases", needs: { cases: ["view"] } },
  affiliates: { href: "/admin/affiliates", label: "Affiliates", icon: "affiliates", needs: { affiliates: ["view"] } },
  brokers: { href: "/admin/brokers", label: "Broker health", icon: "brokers", needs: { brokers: ["view"] } },
  propRules: { href: "/admin/prop-rules", label: "Prop rules", icon: "propRules", needs: { brokers: ["view"] } },
  providers: { href: "/admin/providers", label: "Provider rules", icon: "providers", needs: { brokers: ["view"] } },
  imports: { href: "/admin/imports", label: "File imports", icon: "imports", needs: { brokers: ["view"] } },
  analytics: { href: "/admin/analytics", label: "Analytics", icon: "analytics", needs: { analytics: ["view"] } },
  security: { href: "/admin/security", label: "Security", icon: "security", needs: { security: ["view"] } },
  system: { href: "/admin/system", label: "System", icon: "system", needs: { security: ["view"] } },
  announcements: { href: "/admin/announcements", label: "Announcements", icon: "announcements", needs: { announcements: ["manage"] } },
  content: { href: "/admin/templates", label: "Content", icon: "content", needs: { announcements: ["manage"] } },
  audit: { href: "/admin/audit", label: "Audit log", icon: "audit", needs: { audit: ["view"] } },
  team: { href: "/admin/team", label: "Team & roles", icon: "team", needs: { team: ["manage"] } },
  features: { href: "/admin/features", label: "Feature releases", icon: "features", needs: { team: ["manage"] } },
  // Every admin's own preferences: no permission beyond being staff.
  settings: { href: "/admin/settings", label: "Settings", icon: "settings" },
} satisfies Record<string, NavLink>

// The previous dashboard's sidebar, in its original order.
export const LEGACY_SECTIONS: NavLink[] = [
  L.overview,
  L.users,
  L.support,
  L.billing,
  L.cases,
  L.affiliates,
  L.brokers,
  L.propRules,
  L.providers,
  L.imports,
  L.analytics,
  L.security,
  L.system,
  L.announcements,
  L.content,
  L.audit,
  L.team,
  L.features,
]

// The command center's sidebar: the same sections, grouped, plus Settings.
export const NAV_GROUPS: { label: string; items: NavLink[] }[] = [
  { label: "Overview", items: [L.overview, L.analytics] },
  { label: "Users", items: [L.users, L.security, L.team] },
  { label: "Revenue", items: [L.billing, L.affiliates, L.cases] },
  { label: "Trading", items: [L.brokers, L.propRules, L.providers, L.imports] },
  { label: "Support", items: [L.support] },
  { label: "Content", items: [L.announcements, L.content] },
  { label: "System", items: [L.audit, L.system, L.features, L.settings] },
]

// The phone's bottom bar: shortcuts only — the full menu is one tap away ("More").
export const BOTTOM_NAV = ["/admin", "/admin/analytics", "/admin/users", "/admin/support"]

export type QuickAction = { key: string; label: string; href: string | null; icon: NavIcon; needs?: Permissions }
// href null = opens the command palette.
export const QUICK_ACTIONS: QuickAction[] = [
  { key: "search-user", label: "Search for a user", href: null, icon: "users", needs: { user: ["list"] } },
  { key: "review-payouts", label: "Review payouts", href: "/admin/affiliates/payouts?tab=pending", icon: "billing", needs: { affiliates: ["view"] } },
  { key: "review-affiliates", label: "Review affiliate applications", href: "/admin/affiliates/applications", icon: "affiliates", needs: { affiliates: ["view"] } },
  { key: "open-support", label: "Open support", href: "/admin/support", icon: "support", needs: { support: ["view"] } },
  { key: "announcement", label: "Create an announcement", href: "/admin/announcements", icon: "announcements", needs: { announcements: ["manage"] } },
  { key: "audit", label: "View the audit log", href: "/admin/audit", icon: "audit", needs: { audit: ["view"] } },
]

export const isActive = (href: string, pathname: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`))
