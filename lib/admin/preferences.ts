import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { userSettings } from "@/lib/db/schema"
import { NOTICE_CATEGORIES, type NoticeCategory } from "@/lib/admin/command-center-rules"

// An admin's own choices for the admin area, kept with their account
// (user_settings.admin, migration 0035) so they follow them to any device:
//
//   dashboard   "modern" (the command center, the default) or "legacy" (the
//               previous admin shell and overview, kept intact)
//   sidebar     "expanded" or "collapsed" — the modern shell's sidebar on a desktop
//   notify      which kinds of notification the bell shows
//   readAt      notifications up to this moment are read ("Mark all as read")
//   readKeys    notifications read one at a time since then

export type DashboardVersion = "modern" | "legacy"
export type AdminPrefs = {
  dashboard: DashboardVersion
  sidebar: "expanded" | "collapsed"
  notify: Record<NoticeCategory, boolean>
  readAt: string | null
  readKeys: string[]
}

const ALL_ON = Object.fromEntries(NOTICE_CATEGORIES.map((c) => [c.key, true])) as Record<NoticeCategory, boolean>
export const DEFAULT_ADMIN_PREFS: AdminPrefs = { dashboard: "modern", sidebar: "expanded", notify: ALL_ON, readAt: null, readKeys: [] }
export const READ_KEYS_MAX = 300

// Stored values are never trusted as-is.
export function normalizeAdminPrefs(raw: unknown): AdminPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const readAt = typeof r.readAt === "string" && !Number.isNaN(Date.parse(r.readAt)) ? r.readAt : null
  const notify = (r.notify && typeof r.notify === "object" ? r.notify : {}) as Record<string, unknown>
  return {
    dashboard: r.dashboard === "legacy" ? "legacy" : "modern",
    sidebar: r.sidebar === "collapsed" ? "collapsed" : "expanded",
    notify: Object.fromEntries(NOTICE_CATEGORIES.map((c) => [c.key, notify[c.key] !== false])) as Record<NoticeCategory, boolean>,
    readAt,
    readKeys: Array.isArray(r.readKeys) ? [...new Set(r.readKeys.filter((k): k is string => typeof k === "string" && k.length > 0 && k.length <= 120))].slice(-READ_KEYS_MAX) : [],
  }
}

export async function getAdminPrefs(userId: string): Promise<AdminPrefs> {
  try {
    const [row] = await db.select({ admin: userSettings.admin }).from(userSettings).where(eq(userSettings.userId, userId))
    return normalizeAdminPrefs(row?.admin)
  } catch {
    // The admin area must open even if this can't be read.
    return DEFAULT_ADMIN_PREFS
  }
}

// Merges `patch` into the admin's stored choices.
export async function saveAdminPrefs(userId: string, patch: Partial<AdminPrefs>): Promise<AdminPrefs> {
  const current = await getAdminPrefs(userId)
  const next = normalizeAdminPrefs({ ...current, ...patch, notify: { ...current.notify, ...patch.notify } })
  await db
    .insert(userSettings)
    .values({ userId, admin: next })
    .onConflictDoUpdate({ target: userSettings.userId, set: { admin: next, updatedAt: new Date() } })
  return next
}
