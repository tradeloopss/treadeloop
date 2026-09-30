"use server"

import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { claimCase } from "@/lib/cases/claim"
import { effectiveClaimStatus, rewardLabel, rewardTone } from "@/lib/cases/types"

export type ClaimActionResult =
  | {
      ok: true
      alreadyClaimed: boolean
      prizeCode: string
      claimedAt: string
      expiresAt: string
      redeemedAt: string | null
      status: "active" | "used" | "expired" | "revoked"
      reward: {
        id: number
        name: string
        type: string
        discountPercent: number | null
        subscriptionPlan: string | null
        subscriptionMonths: number | null
        label: string
        tone: "legendary" | "epic" | "rare" | "common"
      }
    }
  | { ok: false; error: string }

// Claim the current active drop's case for the signed-in user. All the real
// work (availability, one-per-user, slot assignment, prize code, expiry) is in
// the transaction — this just authenticates and serialises the result.
export async function claimActiveCase(dropId: number): Promise<ClaimActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: "Please sign in to claim your case." }

  const result = await claimCase(dropId, session.user.id)
  if (!result.ok) return { ok: false, error: result.message }

  const r = result.reward
  return {
    ok: true,
    alreadyClaimed: result.alreadyClaimed,
    prizeCode: result.claim.prizeCode,
    claimedAt: result.claim.claimedAt.toISOString(),
    expiresAt: result.claim.expiresAt.toISOString(),
    redeemedAt: result.claim.redeemedAt ? result.claim.redeemedAt.toISOString() : null,
    status: effectiveClaimStatus(result.claim.status, result.claim.expiresAt),
    reward: {
      id: r.id,
      name: r.name,
      type: r.type,
      discountPercent: r.discountPercent,
      subscriptionPlan: r.subscriptionPlan,
      subscriptionMonths: r.subscriptionMonths,
      label: rewardLabel(r),
      tone: rewardTone(r),
    },
  }
}
