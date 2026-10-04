// What a trader can say about a trade or a day — the choices on the check-in
// and review screens, and what a saved answer is allowed to be. Pure; shared
// by the screens, the server and the analysis.

export const EMOTIONS = [
  { key: "calm", label: "Calm" },
  { key: "confident", label: "Confident" },
  { key: "neutral", label: "Neutral" },
  { key: "anxious", label: "Anxious" },
  { key: "frustrated", label: "Frustrated" },
  { key: "fomo", label: "FOMO" },
  { key: "fearful", label: "Fearful" },
  { key: "greedy", label: "Greedy" },
] as const
export type EmotionKey = (typeof EMOTIONS)[number]["key"]
export const emotionLabel = (key: string | null | undefined) => EMOTIONS.find((e) => e.key === key)?.label ?? (key ? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—")

export const REASONS = [
  { key: "valid_setup", label: "Valid setup" },
  { key: "following_plan", label: "Following plan" },
  { key: "fomo", label: "FOMO" },
  { key: "revenge", label: "Revenge" },
  { key: "boredom", label: "Boredom" },
  { key: "making_back_losses", label: "Making back losses" },
  { key: "other", label: "Other" },
] as const
export type ReasonKey = (typeof REASONS)[number]["key"]
export const reasonLabel = (key: string | null | undefined) => REASONS.find((r) => r.key === key)?.label ?? "—"

export const INTERFERENCE = [
  { key: "moved_sl", label: "Moved stop" },
  { key: "moved_tp", label: "Moved target" },
  { key: "closed_early", label: "Closed early" },
  { key: "added", label: "Added to position" },
  { key: "revenge", label: "Revenge trade" },
] as const
export type InterferenceKey = (typeof INTERFERENCE)[number]["key"]
export const interferenceLabel = (key: string) => INTERFERENCE.find((i) => i.key === key)?.label ?? key

const one = <T extends { key: string }>(list: readonly T[], v: unknown) => (typeof v === "string" && list.some((i) => i.key === v) ? v : null)
const scale = (v: unknown) => {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null
}
const bool = (v: unknown) => (v === true || v === false ? v : null)
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null)

// The pre-trade check-in, as sent by the browser → what is stored. Anything
// that isn't one of the offered answers is dropped, never guessed.
export type CheckinInput = { emotion: string | null; confidence: number | null; focus: number | null; stress: number | null; reason: string | null; planFollowing: boolean | null }
export function cleanCheckin(raw: unknown): CheckinInput {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  return { emotion: one(EMOTIONS, r.emotion), confidence: scale(r.confidence), focus: scale(r.focus), stress: scale(r.stress), reason: one(REASONS, r.reason), planFollowing: bool(r.planFollowing) }
}
export const checkinEmpty = (c: CheckinInput) => c.emotion == null && c.confidence == null && c.focus == null && c.stress == null && c.reason == null && c.planFollowing == null

// The post-trade review.
export type ReviewInput = { emotionAfter: string | null; planFollowed: boolean | null; interference: string[]; notes: string | null }
export function cleanReview(raw: unknown): ReviewInput {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const list = Array.isArray(r.interference) ? r.interference : []
  return { emotionAfter: one(EMOTIONS, r.emotionAfter), planFollowed: bool(r.planFollowed), interference: [...new Set(list.filter((i): i is string => typeof i === "string" && INTERFERENCE.some((x) => x.key === i)))], notes: text(r.notes, 1000) }
}

// The end-of-day review's three questions.
export const DAY_QUESTIONS = [
  { key: "best", label: "Best psychological moment" },
  { key: "challenge", label: "Biggest challenge" },
  { key: "change", label: "What will I change tomorrow?" },
] as const
export function cleanAnswers(raw: unknown): Record<string, string> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const q of DAY_QUESTIONS) {
    const v = text(r[q.key], 500)
    if (v) out[q.key] = v
  }
  return out
}

// Challenges a trader can set themselves. Each is judged from the trades and
// the reviews — never from the trader's say-so alone, where it can be measured.
export const CHALLENGES = [
  { key: "no_revenge", title: "7 days without revenge trading", description: "No trade opened within 10 minutes of a loss, and none marked as revenge.", days: 7 },
  { key: "no_fomo", title: "No FOMO entries", description: "No trade checked in as FOMO or tagged as one.", days: 7 },
  { key: "never_move_stop", title: "Never move the stop", description: "No reviewed trade where the stop was moved.", days: 7 },
  { key: "follow_plan", title: "Follow the trading plan", description: "Every reviewed trade followed the plan.", days: 7 },
  { key: "stop_after_daily_loss", title: "Stop after the daily loss", description: "No trade taken after two losses in one day.", days: 7 },
  { key: "respect_risk", title: "Respect the risk size", description: "No trade risking more than one and a half times your usual amount.", days: 7 },
] as const
export type ChallengeKey = (typeof CHALLENGES)[number]["key"]
export const isChallengeKey = (v: unknown): v is ChallengeKey => typeof v === "string" && CHALLENGES.some((c) => c.key === v)
