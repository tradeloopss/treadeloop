import type React from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { requireAdmin } from "@/lib/admin/guard"
import { openTicketCount } from "@/lib/admin/metrics"
import { roleCan, ROLE_LABELS, type Permissions } from "@/lib/admin/access"
import { AdminNav, type NavItem } from "@/components/admin/admin-nav"
import { BrandMark } from "@/components/brand-mark"

export const metadata: Metadata = { title: "Admin — TradeLoop", robots: { index: false, follow: false } }

const SECTIONS: (NavItem & { needs: Permissions })[] = [
  { href: "/admin", label: "Overview", icon: "overview", needs: { user: ["list"] } },
  { href: "/admin/users", label: "Users", icon: "users", needs: { user: ["list"] } },
  { href: "/admin/support", label: "Support", icon: "support", needs: { support: ["view"] } },
  { href: "/admin/billing", label: "Billing & revenue", icon: "billing", needs: { billing: ["view"] } },
  { href: "/admin/brokers", label: "Broker health", icon: "brokers", needs: { brokers: ["view"] } },
  { href: "/admin/imports", label: "File imports", icon: "imports", needs: { brokers: ["view"] } },
  { href: "/admin/analytics", label: "Analytics", icon: "analytics", needs: { analytics: ["view"] } },
  { href: "/admin/security", label: "Security", icon: "security", needs: { security: ["view"] } },
  { href: "/admin/system", label: "System", icon: "system", needs: { security: ["view"] } },
  { href: "/admin/announcements", label: "Announcements", icon: "announcements", needs: { announcements: ["manage"] } },
  { href: "/admin/templates", label: "Content", icon: "content", needs: { announcements: ["manage"] } },
  { href: "/admin/audit", label: "Audit log", icon: "audit", needs: { audit: ["view"] } },
  { href: "/admin/team", label: "Team & roles", icon: "team", needs: { team: ["manage"] } },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Non-admins (and impersonation sessions) get a 404 from here.
  const admin = await requireAdmin()
  const openTickets = roleCan(admin.role, { support: ["view"] }) ? await openTicketCount() : 0
  const items = SECTIONS.filter((s) => roleCan(admin.role, s.needs)).map(({ href, label, icon }) => ({
    href,
    label,
    icon,
    badge: href === "/admin/support" ? openTickets : undefined,
  }))

  return (
    <div className="flex min-h-svh flex-col bg-background md:flex-row">
      <aside className="shrink-0 border-b bg-sidebar md:sticky md:top-0 md:h-svh md:w-60 md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-2 px-5 pt-5 md:pb-2">
          <div className="flex items-center gap-2">
            <BrandMark className="size-7" />
            <span className="font-semibold tracking-tight">Admin</span>
          </div>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{ROLE_LABELS[admin.role]}</span>
        </div>
        <AdminNav items={items} />
        <div className="hidden px-3 pb-4 md:absolute md:bottom-0 md:block md:w-60">
          <Link href="/dashboard" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeft className="size-4" /> Back to app
          </Link>
          <p className="truncate px-3 pt-1 text-xs text-muted-foreground" title={admin.email}>
            {admin.email}
          </p>
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
