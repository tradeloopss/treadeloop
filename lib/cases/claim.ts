import { and, asc, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { dropClaims, dropRewardSlots, dropRewards, drops } from "@/lib/db/schema"
import { makePrizeCode } from "@/lib/cases/codes"
import { DAY_MS } from "@/lib/cases/types"

export type ClaimRow = typeof dropClaims.$inferSelect
export type RewardRow = typeof dropRewards.$inferSelect

export type ClaimResult =
  | { ok: true; alreadyClaimed: boolean; claim: ClaimRow; reward: RewardRow }
  | { ok: false; reason: "no_drop" | "not_active" | "sold_out" | "error"; message: string }

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code
  return code === "23505"
}

// Claim one case from a drop for a user. The whole thing runs in a single
// transaction that locks the drop row FOR UPDATE, so concurrent claims are
// serialised per drop — availability can never race past totalCases and a
// second simultaneous claim for the last case waits and then sees it's gone.
// One-per-user is guaranteed by the pre-check inside that locked section and,
// as a backstop, the UNIQUE(dropId,userId) constraint. Returns the assigned
// reward; if the user already claimed, returns their existing prize unchanged.
export async function claimCase(dropId: number, userId: string): Promise<ClaimResult> {
  try {
    return await db.transaction(async (tx) => {
      const [drop] = await tx.select().from(drops).where(eq(drops.id, dropId)).for("update")
      if (!drop) return { ok: false, reason: "no_drop", message: "This drop is no longer available." }

      const now = new Date()

      // Already claimed? Return the existing prize — never generate a second.
      const [existing] = await tx.select().from(dropClaims).where(and(eq(dropClaims.dropId, dropId), eq(dropClaims.userId, userId)))
      if (existing) {
        const [reward] = await tx.select().from(dropRewards).where(eq(dropRewards.id, existing.rewardId))
        return { ok: true, alreadyClaimed: true, claim: existing, reward }
      }

      const isActive = drop.status === "active" && (!drop.startAt || drop.startAt <= now) && (!drop.endAt || drop.endAt > now)
      if (!isActive) return { ok: false, reason: "not_active", message: "This drop isn't accepting claims right now." }
      if (drop.claimedCases >= drop.totalCases) return { ok: false, reason: "sold_out", message: "All cases have been claimed." }

      // Next available slot in shuffled order — this is the random assignment.
      const [slot] = await tx
        .select()
        .from(dropRewardSlots)
        .where(and(eq(dropRewardSlots.dropId, dropId), eq(dropRewardSlots.status, "available")))
        .orderBy(asc(dropRewardSlots.slotIndex))
        .limit(1)
        .for("update")
      if (!slot) return { ok: false, reason: "sold_out", message: "All cases have been claimed." }

      const [reward] = await tx.select().from(dropRewards).where(eq(dropRewards.id, slot.rewardId))
      if (!reward) return { ok: false, reason: "error", message: "Something went wrong. Please try again." }

      const expiresAt = new Date(now.getTime() + drop.prizeExpirationDays * DAY_MS)

      // Insert the claim with a unique prize code. Each attempt is a SAVEPOINT
      // so a rare code collision rolls back just that insert, not the whole
      // claim transaction.
      let claim: ClaimRow | undefined
      for (let attempt = 0; attempt < 6; attempt++) {
        const prizeCode = makePrizeCode(reward)
        try {
          claim = await tx.transaction(async (sp) => {
            const [row] = await sp
              .insert(dropClaims)
              .values({ dropId, userId, rewardId: reward.id, rewardSlotId: slot.id, prizeCode, claimedAt: now, expiresAt, status: "active" })
              .returning()
            return row
          })
          break
        } catch (e) {
          if (attempt < 5 && isUniqueViolation(e)) continue
          throw e
        }
      }
      if (!claim) return { ok: false, reason: "error", message: "Couldn't generate your prize. Please try again." }

      await tx.update(dropRewardSlots).set({ status: "claimed", claimedBy: userId, claimedAt: now }).where(eq(dropRewardSlots.id, slot.id))
      await tx.update(drops).set({ claimedCases: drop.claimedCases + 1, updatedAt: now }).where(eq(drops.id, dropId))

      return { ok: true, alreadyClaimed: false, claim, reward }
    })
  } catch {
    // Any failure rolls the whole transaction back — no partial claim is ever
    // written (no slot consumed, no counter moved, no orphan code).
    return { ok: false, reason: "error", message: "Something went wrong. Please try again." }
  }
}
