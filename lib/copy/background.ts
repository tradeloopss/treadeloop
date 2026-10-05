import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { copyGroups, copyPositions, metatraderConnections, user } from "@/lib/db/schema"
import { getAppSetting } from "@/lib/app-settings"
import { isAdminRole } from "@/lib/admin/roles"
import { canUseFeature, normalizeReleases } from "@/lib/features/release"
import { recordHeartbeat } from "@/lib/heartbeat"
import { isOwnerEmail } from "@/lib/subscription"
import { DEFAULT_TIME_ZONE } from "@/lib/timezone"
import { BACKGROUND_SETTING, engineMode, runEngine } from "./server"

// Copy Trading with nobody watching: one pass of the engine for every trader
// who has a group switched on. A timer on the sync server calls it every few
// seconds (app/api/cron/copy-engine), so copying no longer depends on a Copy
// Trading page being open.
//
// It is the same engine the pages run — same rules, same sizing, same
// idempotency — so a page and the timer looking at the same leader at the same
// moment still produce each copy once.

// How often a leader's MetaTrader connection is re-read while its group is
// copying. The worker's own pace is once a minute, which is too slow to copy
// from; this asks for the leader sooner. Followers keep the normal pace.
// Not faster than this: the worker shares two MetaTrader terminals between
// every account, and at 15 seconds the extra logins made other accounts'
// syncs fail several times as often (seen in production, 2026-10-05).
export const LEADER_SYNC_SECONDS = 30
// Traders handled in one pass, and how long a pass may take.
const MAX_TRADERS = 50

export type BackgroundResult = { enabled: boolean; mode: "simulation" | "live"; traders: number; ran: number; failed: number; skipped: number; ms: number }

export async function backgroundEnabled(): Promise<boolean> {
  return (await getAppSetting<boolean>(BACKGROUND_SETTING).catch(() => null)) !== false
}

export async function runBackground(budgetMs = 40_000): Promise<BackgroundResult> {
  const startedAt = Date.now()
  const mode = await engineMode()
  const result: BackgroundResult = { enabled: await backgroundEnabled(), mode, traders: 0, ran: 0, failed: 0, skipped: 0, ms: 0 }
  if (!result.enabled) return result

  const groups = await db.select({ userId: copyGroups.userId, leaderAccountId: copyGroups.leaderAccountId, timeZone: copyGroups.timeZone }).from(copyGroups).where(eq(copyGroups.status, "active"))
  // and anyone with a live position the engine touched in the last day: a close that is owed is settled even after copying is paused
  const owed = await db.selectDistinct({ userId: copyPositions.userId }).from(copyPositions).where(and(eq(copyPositions.simulated, false), eq(copyPositions.role, "follower"), gte(copyPositions.updatedAt, new Date(Date.now() - 24 * 3_600_000)))).catch(() => [])
  const traders = [...new Set([...groups.map((g) => g.userId), ...owed.map((o) => o.userId)])].slice(0, MAX_TRADERS)
  result.traders = traders.length
  if (!traders.length) {
    await recordHeartbeat("copy_engine")
    return { ...result, ms: Date.now() - startedAt }
  }

  // Only for who may use the feature today: a group left switched on by someone
  // the feature has since been closed to is not copied behind their back.
  const stage = normalizeReleases(await getAppSetting("feature_releases").catch(() => null)).copy_trading
  const rows = await db.select({ id: user.id, role: user.role, email: user.email, banned: user.banned }).from(user).where(inArray(user.id, traders))
  const allowed = new Set(rows.filter((u) => !u.banned && canUseFeature(stage, isAdminRole(u.role) || isOwnerEmail(u.email))).map((u) => u.id))

  // Ask the MetaTrader worker for these leaders sooner than its usual minute.
  const leaders = [...new Set(groups.filter((g) => allowed.has(g.userId)).map((g) => g.leaderAccountId))]
  if (leaders.length)
    await db
      .update(metatraderConnections)
      .set({ nextSyncAt: sql`${metatraderConnections.lastSyncedAt} + make_interval(secs => ${LEADER_SYNC_SECONDS})` })
      .where(and(inArray(metatraderConnections.accountId, leaders), eq(metatraderConnections.status, "connected"), isNotNull(metatraderConnections.lastSyncedAt), sql`(${metatraderConnections.copySlot} is null or ${metatraderConnections.copySeenAt} is null or ${metatraderConnections.copySeenAt} < now() - interval '20 seconds')`, sql`${metatraderConnections.nextSyncAt} > ${metatraderConnections.lastSyncedAt} + make_interval(secs => ${LEADER_SYNC_SECONDS})`))
      .catch((e) => console.error("[copy-engine] leader nudge failed:", e instanceof Error ? e.message : e))

  const failed: string[] = []
  for (const userId of traders) {
    if (!allowed.has(userId) || Date.now() - startedAt > budgetMs) {
      result.skipped++
      continue
    }
    try {
      await runEngine(userId, groups.find((g) => g.userId === userId && g.timeZone)?.timeZone ?? DEFAULT_TIME_ZONE)
      result.ran++
    } catch (e) {
      // one trader's failure never stops the others
      result.failed++
      failed.push("a trader's pass")
      console.error("[copy-engine] pass failed for a trader:", e instanceof Error ? e.message : e)
    }
  }
  await recordHeartbeat("copy_engine", failed.slice(0, 1))
  return { ...result, ms: Date.now() - startedAt }
}
