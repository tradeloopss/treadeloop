"use server"

import { revalidatePath } from "next/cache"
import { getAdmin } from "@/lib/admin/guard"
import { logAdminAction } from "@/lib/admin/audit"
import { DEFAULT_ADMIN_PREFS, READ_KEYS_MAX, getAdminPrefs, saveAdminPrefs, type AdminPrefs, type DashboardVersion } from "@/lib/admin/preferences"
import { capabilities, notifications, search, type SearchHit } from "@/lib/admin/command-center"
import { NOTICE_CATEGORIES, type AdminNotice, type NoticeCategory } from "@/lib/admin/command-center-rules"

// The admin shell's own actions: the dashboard version, the sidebar, the
// notification bell and the command palette. Any staff member may use them
// for themselves; what they return is limited to what their role can see.

async function staff() {
  const admin = await getAdmin()
  if (!admin) throw new Error("You don't have permission to do that.")
  return admin
}

export async function setDashboardVersion(version: DashboardVersion): Promise<{ dashboard: DashboardVersion }> {
  const admin = await staff()
  const next: DashboardVersion = version === "legacy" ? "legacy" : "modern"
  const before = await getAdminPrefs(admin.id)
  if (before.dashboard !== next) {
    await saveAdminPrefs(admin.id, { dashboard: next })
    await logAdminAction(admin, "admin.dashboard_version", null, { from: before.dashboard, to: next })
  }
  revalidatePath("/admin", "layout")
  return { dashboard: next }
}

export type AdminSettingsInput = { dashboard?: DashboardVersion; sidebar?: AdminPrefs["sidebar"]; notify?: Partial<Record<NoticeCategory, boolean>> }

export async function saveAdminSettings(input: AdminSettingsInput): Promise<AdminPrefs> {
  const admin = await staff()
  const before = await getAdminPrefs(admin.id)
  const notify = { ...before.notify }
  for (const c of NOTICE_CATEGORIES) if (typeof input.notify?.[c.key] === "boolean") notify[c.key] = input.notify[c.key]!
  const next = await saveAdminPrefs(admin.id, {
    dashboard: input.dashboard === "legacy" || input.dashboard === "modern" ? input.dashboard : before.dashboard,
    sidebar: input.sidebar === "collapsed" || input.sidebar === "expanded" ? input.sidebar : before.sidebar,
    notify,
  })
  if (before.dashboard !== next.dashboard) await logAdminAction(admin, "admin.dashboard_version", null, { from: before.dashboard, to: next.dashboard })
  revalidatePath("/admin", "layout")
  return next
}

// The collapse button on the sidebar: remembered, nothing else to log.
export async function setSidebarCollapsed(collapsed: boolean): Promise<void> {
  const admin = await staff()
  await saveAdminPrefs(admin.id, { sidebar: collapsed ? "collapsed" : "expanded" })
}

export type BellItem = AdminNotice & { unread: boolean }

export async function loadAdminNotifications(): Promise<{ items: BellItem[]; unread: number }> {
  const admin = await staff()
  try {
    return await notifications(capabilities(admin.role), await getAdminPrefs(admin.id))
  } catch (e) {
    console.error("[admin] notifications failed:", e instanceof Error ? e.message : e)
    throw new Error("Couldn't load notifications.")
  }
}

export async function markAdminNotificationRead(key: string): Promise<void> {
  const admin = await staff()
  if (typeof key !== "string" || !key || key.length > 120) return
  const prefs = await getAdminPrefs(admin.id)
  if (prefs.readKeys.includes(key)) return
  await saveAdminPrefs(admin.id, { readKeys: [...prefs.readKeys, key].slice(-READ_KEYS_MAX) })
}

export async function markAllAdminNotificationsRead(): Promise<void> {
  const admin = await staff()
  // Everything up to now is read; the one-by-one list can start over.
  await saveAdminPrefs(admin.id, { readAt: new Date().toISOString(), readKeys: DEFAULT_ADMIN_PREFS.readKeys })
}

export async function searchAdmin(term: string): Promise<SearchHit[]> {
  const admin = await staff()
  if (typeof term !== "string") return []
  try {
    return await search(capabilities(admin.role), term)
  } catch (e) {
    console.error("[admin] search failed:", e instanceof Error ? e.message : e)
    throw new Error("Search isn't available right now.")
  }
}
