import type { Metadata } from "next"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { getAdminPrefs } from "@/lib/admin/preferences"
import { AdminSettings, type SettingsSection } from "@/components/admin/settings/admin-settings"

export const metadata: Metadata = { title: "Admin settings — TradeLoop" }

// Every staff member's own admin preferences, whatever their role.
export default async function AdminSettingsPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const admin = await requireAdmin()
  const prefs = await getAdminPrefs(admin.id)
  const { section } = await searchParams
  return (
    <AdminSettings
      initial={{ dashboard: prefs.dashboard, sidebar: prefs.sidebar, notify: prefs.notify }}
      section={section === "appearance" || section === "notifications" ? (section as SettingsSection) : "dashboard"}
      links={{ security: roleCan(admin.role, { security: ["view"] }), team: roleCan(admin.role, { team: ["manage"] }), audit: roleCan(admin.role, { audit: ["view"] }) }}
    />
  )
}
