import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { psychChallenges, psychCheckins, tradePsychology, trades } from "@/lib/db/schema"
import type { DayCheckin } from "./engine"
import { CHALLENGES, checkinEmpty, cleanAnswers, cleanCheckin, cleanReview, isChallengeKey, type ChallengeKey, type CheckinInput } from "./rules"

// Psychology's server side: what a trader says before a trade, after it, and
// about the day. What they say is attached to the existing trade row by its id
// (trade_psychology) — the trade itself is never copied or changed.
// Every query is scoped by the user id the session resolved.

// A pre-trade check-in belongs to the trade opened within this long after it.
const LINK_BEFORE_MS = 2 * 60_000
const LINK_AFTER_MS = 45 * 60_000

async function ownTrade(userId: string, tradeId: number) {
  const [t] = await db.select({ id: trades.id, entryTime: trades.entryTime }).from(trades).where(and(eq(trades.id, tradeId), eq(trades.userId, userId))).limit(1)
  if (!t) throw new Error("That trade no longer exists.")
  return t
}

async function setBefore(userId: string, tradeId: number, c: CheckinInput, checkinId: number | null): Promise<void> {
  const values = { emotionBefore: c.emotion, confidenceBefore: c.confidence, focusBefore: c.focus, stressBefore: c.stress, reason: c.reason, planBefore: c.planFollowing, checkinId, updatedAt: new Date() }
  await db.insert(tradePsychology).values({ userId, tradeId, ...values }).onConflictDoUpdate({ target: tradePsychology.tradeId, set: values })
}

// The pre-trade check-in. With a trade (logged by hand, or picked from the
// list) it is attached at once; without one it waits for the trade it was for.
export async function saveCheckin(userId: string, raw: unknown, day: string, tradeId?: number | null): Promise<{ id: number; linked: boolean }> {
  const c = cleanCheckin(raw)
  if (checkinEmpty(c)) throw new Error("Choose at least one answer, or skip the check-in.")
  if (tradeId) await ownTrade(userId, tradeId)
  const [row] = await db.insert(psychCheckins).values({ userId, kind: "pre_trade", day, emotion: c.emotion, confidence: c.confidence, focus: c.focus, stress: c.stress, reason: c.reason, planFollowing: c.planFollowing, tradeId: tradeId ?? null }).returning({ id: psychCheckins.id })
  if (tradeId) await setBefore(userId, tradeId, c, row.id)
  return { id: row.id, linked: !!tradeId }
}

// Check-ins still waiting for their trade: each goes to the first trade opened
// shortly after it that nothing has been said about yet. Called when the pages
// load — the trade usually arrives later, from the broker.
export async function linkCheckins(userId: string): Promise<number> {
  const waiting = await db
    .select()
    .from(psychCheckins)
    .where(and(eq(psychCheckins.userId, userId), eq(psychCheckins.kind, "pre_trade"), isNull(psychCheckins.tradeId), gte(psychCheckins.createdAt, new Date(Date.now() - 14 * 86_400_000))))
    .orderBy(psychCheckins.createdAt)
  if (!waiting.length) return 0
  let linked = 0
  for (const c of waiting) {
    const at = c.createdAt.getTime()
    const candidates = await db
      .select({ id: trades.id })
      .from(trades)
      .leftJoin(tradePsychology, eq(tradePsychology.tradeId, trades.id))
      .where(and(eq(trades.userId, userId), gte(trades.entryTime, new Date(at - LINK_BEFORE_MS)), lte(trades.entryTime, new Date(at + LINK_AFTER_MS)), or(isNull(tradePsychology.id), isNull(tradePsychology.checkinId))))
      .orderBy(trades.entryTime)
      .limit(1)
    if (!candidates.length) continue
    await setBefore(userId, candidates[0].id, { emotion: c.emotion, confidence: c.confidence, focus: c.focus, stress: c.stress, reason: c.reason, planFollowing: c.planFollowing }, c.id)
    await db.update(psychCheckins).set({ tradeId: candidates[0].id }).where(eq(psychCheckins.id, c.id))
    linked++
  }
  return linked
}

// The post-trade review.
export async function saveReview(userId: string, tradeId: number, raw: unknown): Promise<void> {
  await ownTrade(userId, tradeId)
  const r = cleanReview(raw)
  const values = { emotionAfter: r.emotionAfter, planFollowed: r.planFollowed, interference: r.interference, notes: r.notes, reviewedAt: new Date(), updatedAt: new Date() }
  await db.insert(tradePsychology).values({ userId, tradeId, ...values }).onConflictDoUpdate({ target: tradePsychology.tradeId, set: values })
}

// A check-in added to a trade afterwards (from the trade's own page).
export async function saveTradeBefore(userId: string, tradeId: number, raw: unknown): Promise<void> {
  await ownTrade(userId, tradeId)
  const c = cleanCheckin(raw)
  if (checkinEmpty(c)) throw new Error("Choose at least one answer.")
  await setBefore(userId, tradeId, c, null)
}

export async function tradePsych(userId: string, tradeId: number) {
  const [row] = await db.select().from(tradePsychology).where(and(eq(tradePsychology.tradeId, tradeId), eq(tradePsychology.userId, userId))).limit(1)
  return row ?? null
}

// Recently closed trades nobody has reviewed yet — offered, never demanded.
export async function pendingReviews(userId: string, limit = 8) {
  return db
    .select({ id: trades.id, symbol: trades.symbol, side: trades.side, pnl: trades.pnl, exitTime: trades.exitTime, entryTime: trades.entryTime })
    .from(trades)
    .leftJoin(tradePsychology, eq(tradePsychology.tradeId, trades.id))
    .where(and(eq(trades.userId, userId), eq(trades.status, "closed"), gte(trades.entryTime, new Date(Date.now() - 7 * 86_400_000)), or(isNull(tradePsychology.id), isNull(tradePsychology.reviewedAt)), or(isNull(trades.source), sql`${trades.source} <> 'backtest'`)))
    .orderBy(desc(trades.entryTime))
    .limit(limit)
}

// --- the day ----------------------------------------------------------------

// The morning check-in and the end-of-day review: one of each per day, the
// latest answer replacing the earlier one.
export async function saveDayCheckin(userId: string, kind: "morning" | "evening", day: string, raw: unknown): Promise<void> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const c = cleanCheckin(r)
  const answers = kind === "evening" ? cleanAnswers(r.answers) : {}
  if (checkinEmpty(c) && !Object.keys(answers).length) throw new Error("Add at least one answer.")
  const values = { emotion: c.emotion, confidence: c.confidence, focus: c.focus, stress: c.stress, answers: Object.keys(answers).length ? answers : null }
  const [existing] = await db.select({ id: psychCheckins.id }).from(psychCheckins).where(and(eq(psychCheckins.userId, userId), eq(psychCheckins.kind, kind), eq(psychCheckins.day, day))).limit(1)
  if (existing) await db.update(psychCheckins).set(values).where(eq(psychCheckins.id, existing.id))
  else await db.insert(psychCheckins).values({ userId, kind, day, ...values })
}

export type DayRow = DayCheckin & { id: number; answers: Record<string, string> | null; createdAt: Date }

// Morning and evening check-ins since a day (for the scores, the timeline, the week).
export async function dayCheckins(userId: string, sinceDay: string): Promise<DayRow[]> {
  const rows = await db
    .select()
    .from(psychCheckins)
    .where(and(eq(psychCheckins.userId, userId), inArray(psychCheckins.kind, ["morning", "evening"]), gte(psychCheckins.day, sinceDay)))
    .orderBy(psychCheckins.createdAt)
  return rows.map((r) => ({ id: r.id, day: r.day, kind: r.kind, confidence: r.confidence, focus: r.focus, stress: r.stress, emotion: r.emotion, answers: r.answers, createdAt: r.createdAt }))
}

// The stress the trader last reported today (a check-in before a trade, or the morning's).
export async function latestStress(userId: string, day: string): Promise<number | null> {
  const [row] = await db
    .select({ stress: psychCheckins.stress })
    .from(psychCheckins)
    .where(and(eq(psychCheckins.userId, userId), eq(psychCheckins.day, day), inArray(psychCheckins.kind, ["pre_trade", "morning"]), sql`${psychCheckins.stress} is not null`))
    .orderBy(desc(psychCheckins.createdAt))
    .limit(1)
  return row?.stress ?? null
}

// --- cool-down ---------------------------------------------------------------
// Optional, and only a reminder: nothing in the app is locked while it runs.

export async function startCooldown(userId: string, day: string, minutes: number): Promise<Date> {
  const until = new Date(Date.now() + Math.max(5, Math.min(240, Math.round(minutes))) * 60_000)
  await db.insert(psychCheckins).values({ userId, kind: "cooldown", day, answers: { until: until.toISOString() } })
  return until
}
export async function endCooldown(userId: string): Promise<void> {
  await db.delete(psychCheckins).where(and(eq(psychCheckins.userId, userId), eq(psychCheckins.kind, "cooldown")))
}
export async function activeCooldown(userId: string): Promise<Date | null> {
  const [row] = await db.select({ answers: psychCheckins.answers }).from(psychCheckins).where(and(eq(psychCheckins.userId, userId), eq(psychCheckins.kind, "cooldown"))).orderBy(desc(psychCheckins.createdAt)).limit(1)
  const until = row?.answers?.until ? new Date(row.answers.until) : null
  return until && until.getTime() > Date.now() ? until : null
}

// --- challenges --------------------------------------------------------------

export async function challenges(userId: string) {
  return db.select().from(psychChallenges).where(and(eq(psychChallenges.userId, userId), eq(psychChallenges.status, "active"))).orderBy(desc(psychChallenges.startedAt))
}

export async function startChallenge(userId: string, key: string): Promise<void> {
  if (!isChallengeKey(key)) throw new Error("That challenge doesn't exist.")
  const active = await challenges(userId)
  if (active.some((c) => c.key === key)) return
  if (active.length >= CHALLENGES.length) throw new Error("Every challenge is already running.")
  await db.insert(psychChallenges).values({ userId, key: key as ChallengeKey, days: CHALLENGES.find((c) => c.key === key)!.days })
}

export async function endChallenge(userId: string, id: number): Promise<void> {
  await db.update(psychChallenges).set({ status: "ended", endedAt: new Date() }).where(and(eq(psychChallenges.id, id), eq(psychChallenges.userId, userId)))
}

// Starting again: the old run is closed and a new one begins today.
export async function restartChallenge(userId: string, id: number): Promise<void> {
  const [row] = await db.select().from(psychChallenges).where(and(eq(psychChallenges.id, id), eq(psychChallenges.userId, userId))).limit(1)
  if (!row) return
  await endChallenge(userId, id)
  await db.insert(psychChallenges).values({ userId, key: row.key, days: row.days })
}
