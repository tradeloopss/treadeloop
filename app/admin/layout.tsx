import type React from "react"
import type { Metadata } from "next"
import { requireAdmin } from "@/lib/admin/guard"
import { openTicketCount } from "@/lib/admin/metrics"
import { roleCan, ROLE_LABELS } from "@/lib/admin/access"
import { BOTTOM_NAV, LEGACY_SECTIONS, NAV_GROUPS, QUICK_ACTIONS, type NavLink } from "@/lib/admin/nav"
import { getAdminPrefs } from "@/lib/admin/preferences"
import { LegacyShell } from "@/components/admin/shell/legacy-shell"
import { ModernShell } from "@/components/admin/shell/modern-shell"

export const metadata: Metadata = { title: "Admin — TradeLoop", robots: { index: false, follow: false } }

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Non-admins (and impersonation sessions) get a 404 from here.
  const admin = await requireAdmin()
  const [openTickets, prefs] = await Promise.all([roleCan(admin.role, { support: ["view"] }) ? openTicketCount() : Promise.resolve(0), getAdminPrefs(admin.id)])
  const allowed = (link: NavLink) => !link.needs || roleCan(admin.role, link.needs)
  const item = ({ href, label, icon }: NavLink) => ({ href, label, icon, badge: href === "/admin/support" ? openTickets : undefined })

  // Each admin's own choice (Admin Settings); the command center unless they chose the old one.
  if (prefs.dashboard === "legacy") {
    return (
      <LegacyShell items={LEGACY_SECTIONS.filter(allowed).map(item)} roleLabel={ROLE_LABELS[admin.role]} email={admin.email}>
        {children}
      </LegacyShell>
    )
  }

  const groups = NAV_GROUPS.map((g) => ({ label: g.label, items: g.items.filter(allowed).map(item) })).filter((g) => g.items.length > 0)
  const all = groups.flatMap((g) => g.items)
  return (
    <ModernShell
      groups={groups}
      bottom={BOTTOM_NAV.map((href) => all.find((i) => i.href === href)).filter((i) => i != null)}
      quickActions={QUICK_ACTIONS.filter((a) => !a.needs || roleCan(admin.role, a.needs)).map(({ key, label, href, icon }) => ({ key, label, href, icon }))}
      admin={{ name: admin.name, email: admin.email, role: ROLE_LABELS[admin.role] }}
      canSecurity={roleCan(admin.role, { security: ["view"] })}
      sidebar={prefs.sidebar}
    >
      {children}
    </ModernShell>
  )
}
