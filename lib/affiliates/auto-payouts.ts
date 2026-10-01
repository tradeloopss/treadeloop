import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliates } from "@/lib/db/schema"
import { releaseHolds } from "./commissions"
import type { AutoSkip } from "./payout-engine"
import { createPayout, type CreateResult } from "./payouts"
import { getPayoutSettings } from "./program"

// The automatic payout worker. It only PICKS candidates here; whether a payout
// is actually created is decided again inside createPayout(), under the
// database lock, from the settings and switches as they are at that instant.
// So flipping any switch — the global one, the emergency pause, or one
// affiliate's — stops the very next payout, and running this twice in a
// period creates one payout, not two.

export type AutoRun = { created: number; skipped: Partial<Record<AutoSkip, number>>; halted: "paused" | "auto_off" | null; errors: number }

export async function autoPayoutFor(affiliateId: number, now = new Date()): Promise<CreateResult> {
  // Clear anything whose hold has passed first, so the balance is current.
  await releaseHolds({ affiliateId, now })
  return createPayout({ mode: "automatic", affiliateId, now })
}

export async function runAutoPayouts(now = new Date()): Promise<AutoRun> {
  const run: AutoRun = { created: 0, skipped: {}, halted: null, errors: 0 }
  const settings = await getPayoutSettings()
  // Checked here to save the work — and again, per payout, inside the lock.
  if (settings.paused) return { ...run, halted: "paused" }
  if (!settings.autoPayouts) return { ...run, halted: "auto_off" }

  const candidates = await db
    .select({ id: affiliates.id })
    .from(affiliates)
    .where(and(eq(affiliates.status, "approved"), eq(affiliates.autoPayout, true), eq(affiliates.autoPayoutAllowed, true)))
    .orderBy(affiliates.id)
    .limit(1000)
  for (const c of candidates) {
    try {
      const result = await autoPayoutFor(c.id, now)
      if (result.created) run.created++
      else if ("skipped" in result) run.skipped[result.skipped] = (run.skipped[result.skipped] ?? 0) + 1
    } catch (e) {
      run.errors++
      console.error("[affiliates] automatic payout failed for", c.id, e instanceof Error ? e.message : e)
    }
  }
  return run
}
