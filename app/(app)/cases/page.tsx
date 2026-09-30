import type { Metadata } from "next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { Gift } from "lucide-react"
import { auth } from "@/lib/auth"
import { getActiveDropForUser, type RewardView } from "@/lib/cases/queries"
import { rewardLabel, rewardTone } from "@/lib/cases/types"
import { CasesDrop } from "@/components/cases/cases-drop"
import type { CaseClaim, CaseReward, CaseDrop } from "@/components/cases/types"
import { BrandMark } from "@/components/brand-mark"

export const metadata: Metadata = { title: "Cases Drop — TradeLoop" }

function toReward(r: RewardView): CaseReward {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    discountPercent: r.discountPercent,
    subscriptionPlan: r.subscriptionPlan,
    subscriptionMonths: r.subscriptionMonths,
    quantity: r.quantity,
    probability: r.probability,
    remaining: r.remaining,
    label: rewardLabel(r),
    tone: rewardTone(r),
  }
}

export default async function CasesPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect("/sign-in")

  const view = await getActiveDropForUser(session.user.id)

  if (!view) {
    return (
      <div className="flex min-h-full items-center justify-center bg-[#f6f5fc] px-4 py-24 text-center text-slate-900 dark:bg-[#0a0a18] dark:text-white">
        <div className="max-w-md">
          <span className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-black/[0.04] text-violet-500 dark:bg-white/5 dark:text-violet-300">
            <Gift className="size-7" />
          </span>
          <div className="mt-5 flex items-center justify-center gap-2.5">
            <BrandMark className="size-6" alt="TradeLoop" />
            <span className="font-semibold tracking-tight">TradeLoop</span>
          </div>
          <h1 className="mt-3 text-2xl font-bold">No active case drop</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-white/55">Stay tuned for the next TradeLoop drop — free cases with real rewards, dropping soon.</p>
        </div>
      </div>
    )
  }

  const rewards = view.rewards.map(toReward)
  const drop: CaseDrop = {
    id: view.id,
    name: view.name,
    description: view.description,
    status: view.status,
    totalCases: view.totalCases,
    claimedCases: view.claimedCases,
    remaining: view.remaining,
    endAt: view.endAt ? view.endAt.toISOString() : null,
    prizeExpirationDays: view.prizeExpirationDays,
    rewards,
  }

  const initialClaim: CaseClaim | null = view.myClaim
    ? {
        prizeCode: view.myClaim.prizeCode,
        reward: view.myClaim.reward ? toReward(view.myClaim.reward) : null,
        claimedAt: view.myClaim.claimedAt.toISOString(),
        expiresAt: view.myClaim.expiresAt.toISOString(),
        redeemedAt: view.myClaim.redeemedAt ? view.myClaim.redeemedAt.toISOString() : null,
        status: view.myClaim.status === "used" || view.myClaim.status === "expired" || view.myClaim.status === "revoked" ? view.myClaim.status : "active",
      }
    : null

  return <CasesDrop drop={drop} initialClaim={initialClaim} />
}
