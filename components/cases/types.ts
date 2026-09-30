// Plain, serialisable shapes passed from the server page to the client Cases
// Drop components (dates are ISO strings).

export type CaseTone = "legendary" | "epic" | "rare" | "common"

export type CaseReward = {
  id: number
  name: string
  type: string
  discountPercent: number | null
  subscriptionPlan: string | null
  subscriptionMonths: number | null
  quantity: number
  probability: number
  remaining: number
  label: string
  tone: CaseTone
}

export type CaseClaim = {
  prizeCode: string
  reward: CaseReward | null
  claimedAt: string
  expiresAt: string
  redeemedAt: string | null
  status: "active" | "used" | "expired" | "revoked"
  // Free-month prizes: access runs until this date; extended = stacked onto
  // an existing subscription.
  grantedUntil?: string | null
  grantExtended?: boolean
}

export type CaseDrop = {
  id: number
  name: string
  description: string | null
  status: "draft" | "active" | "paused" | "ended"
  totalCases: number
  claimedCases: number
  remaining: number
  endAt: string | null
  prizeExpirationDays: number
  rewards: CaseReward[]
}

export const TONE_ACCENT: Record<CaseTone, string> = {
  legendary: "text-amber-500 dark:text-amber-300",
  epic: "text-fuchsia-600 dark:text-fuchsia-400",
  rare: "text-sky-600 dark:text-sky-400",
  common: "text-indigo-600 dark:text-indigo-300",
}

export const TONE_RING: Record<CaseTone, string> = {
  legendary: "ring-amber-300/40 shadow-[0_0_50px_-8px_rgba(251,191,36,0.5)]",
  epic: "ring-fuchsia-400/40 shadow-[0_0_50px_-8px_rgba(232,121,249,0.5)]",
  rare: "ring-sky-400/40 shadow-[0_0_50px_-8px_rgba(56,189,248,0.5)]",
  common: "ring-indigo-400/40 shadow-[0_0_50px_-8px_rgba(129,140,248,0.5)]",
}
