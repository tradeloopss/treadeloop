import { randomInt } from "node:crypto"

// Unambiguous alphabet for prize codes — no 0/O, 1/I/L to avoid transcription
// errors when a user types a code.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// The middle segment of a prize code, chosen from the reward so codes read
// meaningfully (TL-45-…, TL-ESS-…, TL-70-…).
export function codeTag(reward: { type: string; discountPercent?: number | null; subscriptionPlan?: string | null }): string {
  if (reward.type === "discount" && reward.discountPercent != null) return String(reward.discountPercent)
  if (reward.type === "free_subscription") return (reward.subscriptionPlan ?? "sub").slice(0, 3).toUpperCase()
  if (reward.type === "free_month") return "1MO"
  return "TL"
}

function randomSuffix(len = 6): string {
  let out = ""
  for (let i = 0; i < len; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}

// A candidate prize code, e.g. TL-45-X8K29P. Uniqueness is enforced by the DB
// and retried by the caller (lib/cases/claim.ts) on the rare collision.
export function makePrizeCode(reward: { type: string; discountPercent?: number | null; subscriptionPlan?: string | null }): string {
  return `TL-${codeTag(reward)}-${randomSuffix(6)}`
}
