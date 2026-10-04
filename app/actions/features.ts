"use server"

import { and, eq, gte, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { featureFeedback } from "@/lib/db/schema"
import { assertAdmin } from "@/lib/admin/guard"
import { logAdminAction } from "@/lib/admin/audit"
import { STAGE_LABELS, featureLabel, isFeatureKey, isStage } from "@/lib/features/release"
import { assertFeature, getReleases, saveRelease } from "@/lib/features/server"

type Result = { ok: true; message?: string } | { ok: false; error: string }
const fail = (err: unknown): Result => ({ ok: false, error: err instanceof Error && !err.message.startsWith("Failed query") ? err.message : "Something went wrong. Try again." })

// Admin: move a feature between "admin test only" and "beta". Recorded in the
// audit log; takes effect on the next page anyone loads.
export async function setFeatureStage(feature: string, stage: string): Promise<Result> {
  try {
    const admin = await assertAdmin({ team: ["manage"] })
    if (!isFeatureKey(feature) || !isStage(stage)) throw new Error("That isn't a release stage.")
    const before = (await getReleases())[feature]
    if (before === stage) return { ok: true, message: `${featureLabel(feature)} is already ${STAGE_LABELS[stage].toLowerCase()}.` }
    await saveRelease(feature, stage)
    await logAdminAction(admin, "feature.release", null, { feature, from: before, to: stage })
    revalidatePath("/", "layout")
    return { ok: true, message: stage === "beta" ? `${featureLabel(feature)} is now in beta for every user.` : `${featureLabel(feature)} is back to admin test only.` }
  } catch (err) {
    return fail(err)
  }
}

const RATINGS = ["love", "good", "improve", "difficult"]

// "Help us improve" on a beta feature: a rating and, optionally, a few words.
export async function sendFeatureFeedback(input: { feature: string; rating?: string | null; message?: string | null; page?: string | null }): Promise<Result> {
  try {
    if (!isFeatureKey(input.feature)) throw new Error("That feature doesn't exist.")
    const { userId } = await assertFeature(input.feature)
    const rating = RATINGS.includes(String(input.rating)) ? String(input.rating) : null
    const message = typeof input.message === "string" && input.message.trim() ? input.message.trim().slice(0, 2000) : null
    if (!rating && !message) throw new Error("Choose a rating or write a few words first.")
    // a soft brake on a stuck button: a handful an hour is plenty
    const [recent] = await db.select({ n: sql<number>`count(*)::int` }).from(featureFeedback).where(and(eq(featureFeedback.userId, userId), gte(featureFeedback.createdAt, new Date(Date.now() - 3_600_000))))
    if ((recent?.n ?? 0) >= 6) throw new Error("Thanks — you've sent several already. Try again in a little while.")
    await db.insert(featureFeedback).values({ userId, feature: input.feature, rating, message, page: typeof input.page === "string" ? input.page.slice(0, 200) : null })
    return { ok: true, message: "Thanks — your feedback was sent to the team." }
  } catch (err) {
    return fail(err)
  }
}
