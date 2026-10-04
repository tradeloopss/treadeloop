"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { assertFeature } from "@/lib/features/server"
import { recentTradeRows } from "@/lib/insights/data"
import { localDay, resolveTimeZone } from "@/lib/timezone"
import { endChallenge, endCooldown, restartChallenge, saveCheckin, saveDayCheckin, saveReview, saveTradeBefore, startChallenge, startCooldown, tradePsych } from "@/lib/psych/server"

// What a trader tells Psychology: how they feel before a trade, what happened
// in it, how the day went. All of it optional, all of it quick. The trader is
// the one the session resolved; the feature's release stage is checked on
// every call.

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string }
const fail = (err: unknown): { ok: false; error: string } => {
  const message = err instanceof Error ? err.message : ""
  return { ok: false, error: !message || message.startsWith("Failed query") ? "Something went wrong. Try again." : message }
}

async function who() {
  const { userId } = await assertFeature("psychology")
  return { userId, day: localDay(new Date(), resolveTimeZone(await headers())) }
}
const refresh = () => {
  revalidatePath("/psychology", "layout")
  revalidatePath("/edge-lab", "layout")
}

// The pre-trade check-in. With `tradeId` it is attached to that trade; without,
// it is kept for the trade that follows it.
export async function submitCheckin(input: unknown, tradeId?: number | null): Promise<Result<{ linked: boolean }>> {
  try {
    const { userId, day } = await who()
    const id = Number(tradeId)
    const saved = await saveCheckin(userId, input, day, Number.isInteger(id) && id > 0 ? id : null)
    refresh()
    return { ok: true, linked: saved.linked }
  } catch (err) {
    return fail(err)
  }
}

export async function submitReview(tradeId: number, input: unknown): Promise<Result<object>> {
  try {
    const { userId } = await who()
    await saveReview(userId, Number(tradeId), input)
    refresh()
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// How the trader felt going into a trade, added afterwards from the trade itself.
export async function submitTradeBefore(tradeId: number, input: unknown): Promise<Result<object>> {
  try {
    const { userId } = await who()
    await saveTradeBefore(userId, Number(tradeId), input)
    refresh()
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

export async function submitDayCheckin(kind: "morning" | "evening", input: unknown): Promise<Result<object>> {
  try {
    const { userId, day } = await who()
    await saveDayCheckin(userId, kind === "evening" ? "evening" : "morning", day, input)
    refresh()
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// What has been said about one trade (for the trade's own window).
export async function getTradePsychology(tradeId: number): Promise<Result<{ psych: { emotionBefore: string | null; confidenceBefore: number | null; focusBefore: number | null; stressBefore: number | null; reason: string | null; planBefore: boolean | null; emotionAfter: string | null; planFollowed: boolean | null; interference: string[]; notes: string | null; reviewed: boolean } | null }>> {
  try {
    const { userId } = await who()
    const p = await tradePsych(userId, Number(tradeId))
    return { ok: true, psych: p ? { emotionBefore: p.emotionBefore, confidenceBefore: p.confidenceBefore, focusBefore: p.focusBefore, stressBefore: p.stressBefore, reason: p.reason, planBefore: p.planBefore, emotionAfter: p.emotionAfter, planFollowed: p.planFollowed, interference: p.interference ?? [], notes: p.notes, reviewed: !!p.reviewedAt } : null }
  } catch (err) {
    return fail(err)
  }
}

// The trader's latest trades, to attach a check-in to one.
export async function recentTrades(): Promise<Result<{ trades: { id: number; symbol: string; side: string; pnl: number; at: string; open: boolean }[] }>> {
  try {
    const { userId } = await who()
    const rows = await recentTradeRows(userId, 12)
    return { ok: true, trades: rows.map((t) => ({ id: t.id, symbol: t.symbol, side: t.side, pnl: Number(t.pnl), at: t.entryTime.toISOString(), open: t.status !== "closed" })) }
  } catch (err) {
    return fail(err)
  }
}

// A cool-down is a reminder the trader sets for themselves; nothing is locked.
export async function beginCooldown(minutes: number): Promise<Result<{ until: string }>> {
  try {
    const { userId, day } = await who()
    const until = await startCooldown(userId, day, Number(minutes) || 30)
    refresh()
    return { ok: true, until: until.toISOString() }
  } catch (err) {
    return fail(err)
  }
}

export async function stopCooldown(): Promise<Result<object>> {
  try {
    const { userId } = await who()
    await endCooldown(userId)
    refresh()
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

export async function challengeAction(action: "start" | "end" | "restart", target: string | number): Promise<Result<object>> {
  try {
    const { userId } = await who()
    if (action === "start") await startChallenge(userId, String(target))
    else if (action === "end") await endChallenge(userId, Number(target))
    else await restartChallenge(userId, Number(target))
    refresh()
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}
