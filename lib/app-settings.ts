import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { appSettings } from "@/lib/db/schema"

// Tiny typed wrapper over the app_settings key/value table for global,
// admin-tunable settings. Values are JSON.

export async function getAppSetting<T = unknown>(key: string): Promise<T | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1)
  return row ? (row.value as T) : null
}

export async function setAppSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
}

// --- Rithmic auto-sync interval ---------------------------------------------
// How long a Rithmic connection is left before background sync re-syncs it.
// The VPS timer hits the sync endpoint every 60s regardless; this interval is
// the per-connection skip window, so a larger value means each account syncs
// less often (e.g. "every 5 hours" = don't re-sync a connection synced in the
// last ~5h).

export const RITHMIC_SYNC_INTERVAL_KEY = "rithmic_autosync_interval_ms"
export const DEFAULT_RITHMIC_SYNC_INTERVAL_MS = 60_000
// Rithmic throttles cloud IPs, so never tighter than 1 minute; 24h is plenty loose.
const MIN_INTERVAL_MS = 60_000
const MAX_INTERVAL_MS = 24 * 60 * 60_000

// The choices the admin UI offers (label + milliseconds).
export const RITHMIC_SYNC_INTERVAL_OPTIONS: { label: string; ms: number }[] = [
  { label: "Every 1 minute", ms: 60_000 },
  { label: "Every 5 minutes", ms: 5 * 60_000 },
  { label: "Every 15 minutes", ms: 15 * 60_000 },
  { label: "Every 30 minutes", ms: 30 * 60_000 },
  { label: "Every hour", ms: 60 * 60_000 },
  { label: "Every 5 hours", ms: 5 * 60 * 60_000 },
]

export function clampRithmicInterval(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_RITHMIC_SYNC_INTERVAL_MS
  return Math.min(Math.max(Math.round(ms), MIN_INTERVAL_MS), MAX_INTERVAL_MS)
}

// Short in-process cache so the sync loop (runs ~every 60s) doesn't hit the DB
// every tick; a change still takes effect within the TTL.
let cache: { ms: number; at: number } | null = null
const CACHE_TTL_MS = 30_000

export async function getRithmicSyncIntervalMs(): Promise<number> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.ms
  let ms = DEFAULT_RITHMIC_SYNC_INTERVAL_MS
  try {
    const stored = await getAppSetting<number>(RITHMIC_SYNC_INTERVAL_KEY)
    if (typeof stored === "number") ms = clampRithmicInterval(stored)
  } catch {
    // Table missing (pre-migration) or a DB blip — fall back to the default.
  }
  cache = { ms, at: Date.now() }
  return ms
}

export async function setRithmicSyncIntervalMs(ms: number): Promise<number> {
  const clamped = clampRithmicInterval(ms)
  await setAppSetting(RITHMIC_SYNC_INTERVAL_KEY, clamped)
  cache = { ms: clamped, at: Date.now() }
  return clamped
}
