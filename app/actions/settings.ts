"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { userSettings, securityEvents, trades, journalEntries } from "@/lib/db/schema"
import { and, desc, eq } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { SECURITY_EVENT_LABELS } from "@/lib/security"
import {
  resolveSettings,
  type ResolvedSettings,
  type PrivacySettings,
  type ThemeSettings,
  type CalculationSettings,
  type OrderGroupingSettings,
  type NotificationSettings,
  type PreferenceSettings,
  type SocialLinks,
} from "@/lib/settings/defaults"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

async function readRow(userId: string) {
  try {
    const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1)
    return row ?? null
  } catch (err) {
    // The table may not exist yet (before the migration runs); render defaults
    // rather than 500 the page.
    console.warn("[settings] could not read user_settings:", err instanceof Error ? err.message : err)
    return null
  }
}

// Upsert the given columns for this user, always bumping updatedAt. Callers
// pass a partial set of the userSettings columns.
type SettingsColumns = Partial<{
  username: string | null
  bio: string | null
  tradingStrategy: string | null
  yearsTrading: number | null
  social: SocialLinks
  privacy: PrivacySettings
  theme: ThemeSettings
  calculations: CalculationSettings
  orderGrouping: OrderGroupingSettings
  notifications: NotificationSettings
  preferences: PreferenceSettings
}>

async function writeSettings(userId: string, patch: SettingsColumns) {
  await db
    .insert(userSettings)
    .values({ userId, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({ target: userSettings.userId, set: { ...patch, updatedAt: new Date() } })
  revalidatePath("/settings")
}

export async function getUserSettings(): Promise<ResolvedSettings> {
  const userId = await getUserId()
  return resolveSettings(await readRow(userId))
}

export async function updateProfileSettings(input: {
  username?: string | null
  bio?: string | null
  tradingStrategy?: string | null
  yearsTrading?: number | null
  social?: SocialLinks
}): Promise<void> {
  const userId = await getUserId()
  const patch: SettingsColumns = {}
  if (input.username !== undefined) patch.username = normalizeUsername(input.username)
  if (input.bio !== undefined) patch.bio = trimOrNull(input.bio, 600)
  if (input.tradingStrategy !== undefined) patch.tradingStrategy = trimOrNull(input.tradingStrategy, 120)
  if (input.yearsTrading !== undefined) patch.yearsTrading = clampYears(input.yearsTrading)
  if (input.social !== undefined) patch.social = input.social
  await writeSettings(userId, patch)
}

export async function updateUsername(username: string): Promise<void> {
  const userId = await getUserId()
  await writeSettings(userId, { username: normalizeUsername(username) })
}

export async function updatePrivacySettings(privacy: PrivacySettings): Promise<void> {
  await writeSettings(await getUserId(), { privacy })
}

export async function updateThemeSettings(theme: ThemeSettings): Promise<void> {
  await writeSettings(await getUserId(), { theme })
}

export async function updateCalculationSettings(calculations: CalculationSettings): Promise<void> {
  await writeSettings(await getUserId(), { calculations })
}

export async function updateOrderGroupingSettings(orderGrouping: OrderGroupingSettings): Promise<void> {
  await writeSettings(await getUserId(), { orderGrouping })
}

export async function updateNotificationSettings(notifications: NotificationSettings): Promise<void> {
  await writeSettings(await getUserId(), { notifications })
}

export async function updatePreferenceSettings(preferences: PreferenceSettings): Promise<void> {
  await writeSettings(await getUserId(), { preferences })
}

export type SecurityActivityEvent = {
  id: number
  category: "login" | "security"
  tone: "success" | "danger" | "muted"
  label: string
  ip: string | null
  at: string // ISO
}

// The user's own recent auth activity for the Login History panel. Read from
// the same security_events the auth hook writes (lib/security.ts).
export async function getSecurityActivity(limit = 25): Promise<SecurityActivityEvent[]> {
  const userId = await getUserId()
  const rows = await db
    .select({ id: securityEvents.id, type: securityEvents.type, ip: securityEvents.ipAddress, createdAt: securityEvents.createdAt })
    .from(securityEvents)
    .where(eq(securityEvents.userId, userId))
    .orderBy(desc(securityEvents.createdAt))
    .limit(limit)
  return rows.map((r) => ({
    id: r.id,
    category: r.type === "sign_in" || r.type === "sign_up" ? "login" : "security",
    tone: r.type === "sign_in" || r.type === "sign_up" ? "success" : r.type.includes("failed") || r.type.includes("blocked") ? "danger" : "muted",
    label: SECURITY_EVENT_LABELS[r.type] ?? r.type,
    ip: r.ip,
    at: r.createdAt.toISOString(),
  }))
}

// A portable JSON snapshot of everything this user owns that the Settings
// section exposes: their settings row, trades and journal entries. Returned as
// a string so the client can offer it as a download (Privacy → Export Data).
export async function exportUserData(): Promise<string> {
  const userId = await getUserId()
  const [settingsRow, tradeRows, journalRows] = await Promise.all([
    readRow(userId),
    db.select().from(trades).where(eq(trades.userId, userId)),
    db.select().from(journalEntries).where(eq(journalEntries.userId, userId)),
  ])
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), settings: settingsRow, trades: tradeRows, journal: journalRows },
    null,
    2,
  )
}

function trimOrNull(v: string | null, max: number): string | null {
  if (v == null) return null
  const t = v.trim().slice(0, max)
  return t === "" ? null : t
}

// A URL-safe @handle: lowercase, letters/digits/._- only, 3–30 chars.
function normalizeUsername(v: string | null): string | null {
  if (v == null) return null
  const t = v
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 30)
  return t === "" ? null : t
}

function clampYears(v: number | null): number | null {
  if (v == null || Number.isNaN(v)) return null
  return Math.max(0, Math.min(80, Math.round(v)))
}
