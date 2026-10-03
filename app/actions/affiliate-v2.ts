"use server"

import { revalidatePath } from "next/cache"
import { assertAffiliate } from "@/lib/affiliates/guard"
import { FEEDBACK_MAX, isFeedbackRating, type DashboardVersion } from "@/lib/affiliates/v2/config"
import { portalVersion, recentFeedbackCount, saveFeedback, searchPortal, setDashboardVersion, setLeaderboardPublic, type PortalHit } from "@/lib/affiliates/v2/server"

// The V2 dashboard's own actions. As everywhere in the portal, the affiliate
// comes from the session (assertAffiliate), never from an argument.

export type V2Result = { ok: true } | { ok: false; error: string }

const fail = (err: unknown): V2Result => ({ ok: false, error: err instanceof Error ? err.message : "Something went wrong. Try again." })

// Classic or V2 — remembered with the account, so it follows them to any device.
export async function chooseDashboard(version: DashboardVersion): Promise<V2Result> {
  try {
    const { user, affiliate } = await assertAffiliate()
    if (user.impersonating) throw new Error("The dashboard choice can't be changed while logged in as another user.")
    const next: DashboardVersion = version === "v2" ? "v2" : "classic"
    if (next === "v2" && !(await portalVersion(affiliate)).open) throw new Error("The new dashboard isn't available for your account yet.")
    await setDashboardVersion(affiliate.id, next)
    revalidatePath("/affiliate", "layout")
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

export async function sendDashboardFeedback(input: { rating: string; message?: string; page?: string }): Promise<V2Result> {
  try {
    const { user, affiliate } = await assertAffiliate()
    if (user.impersonating) throw new Error("Feedback can't be sent while logged in as another user.")
    if (!isFeedbackRating(input.rating)) throw new Error("Choose how the new dashboard feels to you.")
    const message = String(input.message ?? "").trim()
    if (message.length > FEEDBACK_MAX) throw new Error(`Keep it under ${FEEDBACK_MAX.toLocaleString("en-US")} characters.`)
    if ((await recentFeedbackCount(affiliate.id, new Date(Date.now() - 3600_000))) >= 10) throw new Error("Thanks — you've sent plenty of feedback this hour. Try again a little later.")
    const page = String(input.page ?? "").replace(/[?#].*$/, "").slice(0, 120) || null
    await saveFeedback(affiliate.id, { rating: input.rating, message: message || null, page })
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// Off unless they choose: shows their first name, last initial, customers and earnings.
export async function setLeaderboardVisibility(on: boolean): Promise<V2Result> {
  try {
    const { user, affiliate } = await assertAffiliate()
    if (user.impersonating) throw new Error("This can't be changed while logged in as another user.")
    await setLeaderboardPublic(affiliate.id, on === true)
    revalidatePath("/affiliate", "layout")
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

export async function searchAffiliatePortal(term: string): Promise<PortalHit[]> {
  const { affiliate } = await assertAffiliate()
  return searchPortal(affiliate.id, typeof term === "string" ? term : "")
}
