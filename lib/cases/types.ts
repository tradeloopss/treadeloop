// Shared types + small pure helpers for the Cases Drop feature. Kept free of
// server-only imports so both server and client components can use them.

export type DropStatus = "draft" | "active" | "paused" | "ended"
export type RewardType = "discount" | "free_subscription" | "free_month" | "custom"
export type ClaimStatus = "active" | "used" | "expired" | "revoked"

export const DAY_MS = 24 * 60 * 60 * 1000

// A reward as configured on a drop (admin form / create + edit).
export type RewardInput = {
  name: string
  type: RewardType
  discountPercent?: number | null
  subscriptionPlan?: string | null
  subscriptionMonths?: number | null
  quantity: number
  probability: number
}

// The effective status of a claim: an active prize whose expiry has passed
// reads as "expired" even before a job flips the stored column.
export function effectiveClaimStatus(status: string, expiresAt: Date | string, now: Date = new Date()): ClaimStatus {
  const s = status as ClaimStatus
  if (s === "active" && new Date(expiresAt).getTime() <= now.getTime()) return "expired"
  return s
}

// Whole days remaining until expiry (never negative). 0 = expires today.
export function daysUntil(expiresAt: Date | string, now: Date = new Date()): number {
  const ms = new Date(expiresAt).getTime() - now.getTime()
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS)
}

// A short human label for a reward, used across the reveal, cards and tables.
export function rewardLabel(r: { type: string; name?: string | null; discountPercent?: number | null; subscriptionMonths?: number | null; subscriptionPlan?: string | null }): string {
  if (r.name) return r.name
  if (r.type === "discount" && r.discountPercent != null) return `${r.discountPercent}% OFF`
  if (r.type === "free_subscription") return `${r.subscriptionMonths ?? 1} Month Free ${(r.subscriptionPlan ?? "").toUpperCase() || "Plan"}`.trim()
  if (r.type === "free_month") return `${r.subscriptionMonths ?? 1} Month Free`
  return "Reward"
}

// A visual tone key for a reward (used to colour the reveal + cards). The big
// free-subscription prize gets the brightest treatment.
export function rewardTone(r: { type: string; discountPercent?: number | null }): "legendary" | "epic" | "rare" | "common" {
  if (r.type === "free_subscription" || r.type === "free_month") return "legendary"
  const p = r.discountPercent ?? 0
  if (p >= 70) return "epic"
  if (p >= 55) return "rare"
  return "common"
}

// Validate a reward set for a drop of `totalCases`: quantities must sum to the
// case count and probabilities to 100. Returns the problems (empty = valid).
export function validateRewards(totalCases: number, rewards: RewardInput[]): string[] {
  const problems: string[] = []
  if (!Number.isFinite(totalCases) || totalCases < 1) problems.push("Total cases must be at least 1.")
  if (rewards.length === 0) problems.push("Add at least one reward.")
  for (const r of rewards) {
    if (!r.name?.trim()) problems.push("Every reward needs a name.")
    if (!Number.isInteger(r.quantity) || r.quantity < 0) problems.push(`"${r.name || "Reward"}" quantity must be a whole number.`)
    if (r.type === "discount" && (r.discountPercent == null || r.discountPercent < 1 || r.discountPercent > 100))
      problems.push(`"${r.name || "Reward"}" needs a discount percentage between 1 and 100.`)
  }
  const qty = rewards.reduce((s, r) => s + (r.quantity || 0), 0)
  if (qty !== totalCases) problems.push(`Reward quantities add up to ${qty}, but the drop has ${totalCases} cases.`)
  const prob = rewards.reduce((s, r) => s + (r.probability || 0), 0)
  if (prob !== 100) problems.push(`Probabilities add up to ${prob}%, they must total 100%.`)
  return problems
}
