// The rules for the verification codes that guard an affiliate's money: a
// 6-digit code is needed to confirm a payout and to add a payout method. Pure —
// lib/affiliates/action-codes.ts applies them against the database.
//
// What they are for: someone who gets into an account (a stolen session, an
// unlocked phone, a reused password) still can't send its money anywhere
// without a second thing they don't have — the affiliate's inbox, or their
// authenticator app.

export type CodePurpose = "payout" | "method"
// email = a code sent to the affiliate's address; app = the authenticator app
// of an account that has two-factor sign-in switched on.
export type CodeChannel = "email" | "app"

export const CODE_DIGITS = 6
export const CODE_TTL_MS = 10 * 60_000
// Wrong tries before a code is dead and a new one has to be asked for.
export const MAX_CODE_ATTEMPTS = 5
// The least time between two codes being emailed.
export const RESEND_AFTER_MS = 30_000
// Codes per purpose per hour. With five tries each that is at most forty
// guesses an hour at a one-in-a-million code.
export const MAX_CODES_PER_HOUR = 8

// "123 456" typed or pasted → "123456". Never more than six digits.
export const cleanCode = (text: unknown) => String(text ?? "").replace(/\D/g, "").slice(0, CODE_DIGITS)
export const isCode = (text: string) => /^\d{6}$/.test(text)

// What a code is for. A code asked for one payout can't confirm another
// amount or another destination; one asked for adding PayPal can't add a wallet.
export const payoutSubject = (methodId: number, amount: number) => `${methodId}:${amount.toFixed(2)}`
export const methodSubject = (type: string) => type

export type CodeRow = { subject: string; channel: string; attempts: number; expiresAt: Date; usedAt: Date | null; createdAt: Date }

// Still usable: not spent, not expired, not out of tries.
export const codeLive = (c: Pick<CodeRow, "attempts" | "expiresAt" | "usedAt">, now: Date) => !c.usedAt && c.expiresAt.getTime() > now.getTime() && c.attempts < MAX_CODE_ATTEMPTS

// Whether another code may be issued now, from the ones issued in the last
// hour for the same purpose. An authenticator code costs nothing to "send", so
// only the hourly cap applies to it.
export function issueProblem(recent: Pick<CodeRow, "createdAt">[], channel: CodeChannel, now: Date): { reason: "wait" | "hour"; retryAt: Date } | null {
  const hourAgo = now.getTime() - 3_600_000
  const inHour = recent.map((r) => r.createdAt.getTime()).filter((t) => t > hourAgo).sort((a, b) => a - b)
  if (inHour.length >= MAX_CODES_PER_HOUR) return { reason: "hour", retryAt: new Date(inHour[inHour.length - MAX_CODES_PER_HOUR] + 3_600_000) }
  const last = inHour[inHour.length - 1]
  if (channel === "email" && last != null && last + RESEND_AFTER_MS > now.getTime()) return { reason: "wait", retryAt: new Date(last + RESEND_AFTER_MS) }
  return null
}

const seconds = (until: Date, now: Date) => Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000))
export function issueProblemText(p: { reason: "wait" | "hour"; retryAt: Date }, now: Date): string {
  if (p.reason === "wait") return `You can ask for a new code in ${seconds(p.retryAt, now)} seconds.`
  const minutes = Math.max(1, Math.ceil((p.retryAt.getTime() - now.getTime()) / 60_000))
  return `Too many codes were requested. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`
}

// After a wrong try: what to say, given how many tries have now been used.
export function wrongCodeText(attempts: number): string {
  const left = MAX_CODE_ATTEMPTS - attempts
  return left <= 0 ? "Too many wrong codes. Ask for a new code." : `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.`
}
