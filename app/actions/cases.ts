"use server"

import { headers } from "next/headers"
import { eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { dropClaims } from "@/lib/db/schema"
import { claimCase } from "@/lib/cases/claim"
import { fulfillPrize } from "@/lib/cases/fulfill"
import { effectiveClaimStatus, rewardLabel, rewardTone } from "@/lib/cases/types"

export type FulfillmentKind = "coupon" | "granted" | "none"

export type ClaimActionResult =
  | {
      ok: true
      alreadyClaimed: boolean
      prizeCode: string
      claimedAt: string
      expiresAt: string
      redeemedAt: string | null
      status: "active" | "used" | "expired" | "revoked"
      // How the prize was provisioned: a discount becomes a real coupon,
      // a free subscription is granted on the spot. `fulfilled` is false only
      // if provisioning errored (the prize still exists; an admin can re-run it).
      fulfillment: FulfillmentKind
      fulfilled: boolean
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

function kindFor(type: string): FulfillmentKind {
  if (type === "discount") return "coupon"
  if (type === "free_subscription" || type === "free_month") return "granted"
  return "none"
}

// Claim the current active drop's case for the signed-in user. All the real
// work (availability, one-per-user, slot assignment, prize code, expiry) is in
// the transaction; a fresh claim is then provisioned (coupon / plan grant).
export async function claimActiveCase(dropId: number): Promise<ClaimActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: "Please sign in to claim your case." }

  const result = await claimCase(dropId, session.user.id)
  if (!result.ok) return { ok: false, error: result.message }

  const r = result.reward
  const fulfillment = kindFor(r.type)
  let fulfilled = true

  // Only a brand-new claim is provisioned; an already-existing claim was
  // handled when it was first made.
  if (!result.alreadyClaimed && fulfillment !== "none") {
    const outcome = await fulfillPrize({ userId: session.user.id, userEmail: session.user.email, reward: r })
    fulfilled = outcome.status !== "failed"
    await db
      .update(dropClaims)
      .set({ fulfillmentStatus: outcome.status, fulfillmentRef: outcome.ref })
      .where(eq(dropClaims.id, result.claim.id))
  } else if (result.alreadyClaimed) {
    fulfilled = result.claim.fulfillmentStatus !== "failed"
  }

  return {
    ok: true,
    alreadyClaimed: result.alreadyClaimed,
    prizeCode: result.claim.prizeCode,
    claimedAt: result.claim.claimedAt.toISOString(),
    expiresAt: result.claim.expiresAt.toISOString(),
    redeemedAt: result.claim.redeemedAt ? result.claim.redeemedAt.toISOString() : null,
    status: effectiveClaimStatus(result.claim.status, result.claim.expiresAt),
    fulfillment,
    fulfilled,
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
