import { lt } from "drizzle-orm"
import { db } from "@/lib/db"
import { apiUsage, requestTimings } from "@/lib/db/schema"

// Lightweight usage/timing records for the admin System page. Both writers
// swallow their own errors — telemetry must never break the feature it
// measures — and prune rows older than KEEP_DAYS on roughly 1 in 200 writes.
const KEEP_DAYS = 14

export async function recordApiUsage(entry: {
  provider: "anthropic" | "metaapi"
  operation: string
  userId?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  startedAt: number
  error?: unknown
}) {
  try {
    await db.insert(apiUsage).values({
      provider: entry.provider,
      operation: entry.operation,
      userId: entry.userId ?? null,
      inputTokens: entry.inputTokens ?? null,
      outputTokens: entry.outputTokens ?? null,
      status: entry.error === undefined ? "ok" : "error",
      error: entry.error === undefined ? null : (entry.error instanceof Error ? entry.error.message : String(entry.error)).slice(0, 500),
      durationMs: Date.now() - entry.startedAt,
    })
    if (Math.random() < 1 / 200) await db.delete(apiUsage).where(lt(apiUsage.createdAt, new Date(Date.now() - KEEP_DAYS * 86400_000)))
  } catch (err) {
    console.error("[telemetry] could not record api usage", err)
  }
}

// Called from the app layout with how long the page's server work took.
// Sampled at 1 in 4 so it costs almost nothing per request.
export async function recordRequestTiming(route: string, durationMs: number, status = 200) {
  if (Math.random() > 0.25) return
  try {
    await db.insert(requestTimings).values({ route, durationMs: Math.round(durationMs), status })
    if (Math.random() < 1 / 200) await db.delete(requestTimings).where(lt(requestTimings.createdAt, new Date(Date.now() - KEEP_DAYS * 86400_000)))
  } catch (err) {
    console.error("[telemetry] could not record timing", err)
  }
}

// List prices per million tokens, for the estimated-cost column. Update if
// the model or its pricing changes.
export const ANTHROPIC_PRICE_PER_M = { input: 5, output: 25 }
