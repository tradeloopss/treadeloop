import { createHmac, randomInt, timingSafeEqual } from "node:crypto"
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliateActionCodes, affiliates } from "@/lib/db/schema"
import { CODE_DIGITS, CODE_TTL_MS, MAX_CODE_ATTEMPTS, RESEND_AFTER_MS, cleanCode, codeLive, isCode, issueProblem, issueProblemText, wrongCodeText, type CodeChannel, type CodePurpose } from "./action-code-rules"
import { recordSignal } from "./fraud"

// The verification codes behind "confirm a payout" and "add a payout method"
// (rules: action-code-rules.ts). Everything is decided here, on the server:
// the browser only ever sends six digits, and is told yes or no.
//
// A code is single-use, lives ten minutes, dies after five wrong tries, and is
// tied to what it was asked for. An emailed code is stored only as a keyed
// hash, so the table can't be read back into codes.

// A refusal the affiliate should read as it is written.
export class CodeError extends Error {}

function secret(): string {
  const value = process.env.BETTER_AUTH_SECRET || process.env.BROKER_CREDENTIALS_KEY
  if (!value) throw new Error("A server secret (BETTER_AUTH_SECRET) is required for verification codes.")
  return value
}
const hashCode = (affiliateId: number, purpose: string, code: string) => createHmac("sha256", secret()).update(`affiliate-code:${affiliateId}:${purpose}:${code}`).digest("hex")
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export type IssuedCode = {
  id: number
  // The code to email — only when a new one was made for the email channel.
  // null for the authenticator app, and when a code that is still good was
  // asked for again (it is already in their inbox; it isn't sent twice).
  code: string | null
  reused: boolean
  expiresAt: Date
  // when another code may be asked for
  resendAt: Date
}

// Starts (or continues) a verification. `force` = "send me a new code".
export async function issueCode(input: { affiliateId: number; purpose: CodePurpose; subject: string; channel: CodeChannel; force?: boolean; now?: Date }): Promise<IssuedCode> {
  const now = input.now ?? new Date()
  const mine = and(eq(affiliateActionCodes.affiliateId, input.affiliateId), eq(affiliateActionCodes.purpose, input.purpose))
  return db.transaction(async (tx) => {
    // One at a time per affiliate: two requests arriving together issue one code.
    const [aff] = await tx.select({ id: affiliates.id }).from(affiliates).where(eq(affiliates.id, input.affiliateId)).for("update")
    if (!aff) throw new CodeError("Affiliate account not found.")
    const recent = await tx
      .select()
      .from(affiliateActionCodes)
      .where(and(mine, gt(affiliateActionCodes.createdAt, new Date(now.getTime() - 3_600_000))))
      .orderBy(desc(affiliateActionCodes.createdAt), desc(affiliateActionCodes.id))
    const live = recent.find((c) => c.subject === input.subject && c.channel === input.channel && codeLive(c, now))
    if (live && !input.force) return { id: live.id, code: null, reused: true, expiresAt: live.expiresAt, resendAt: new Date(live.createdAt.getTime() + RESEND_AFTER_MS) }

    const problem = issueProblem(recent, input.channel, now)
    if (problem) throw new CodeError(issueProblemText(problem, now))
    // Only the newest code works: whatever was asked for before it is retired.
    await tx.update(affiliateActionCodes).set({ expiresAt: now }).where(and(mine, isNull(affiliateActionCodes.usedAt), gt(affiliateActionCodes.expiresAt, now)))
    const code = input.channel === "email" ? String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, "0") : null
    const expiresAt = new Date(now.getTime() + CODE_TTL_MS)
    const [row] = await tx
      .insert(affiliateActionCodes)
      .values({ affiliateId: input.affiliateId, purpose: input.purpose, channel: input.channel, subject: input.subject, codeHash: code ? hashCode(input.affiliateId, input.purpose, code) : null, expiresAt, createdAt: now })
      .returning({ id: affiliateActionCodes.id })
    return { id: row.id, code, reused: false, expiresAt, resendAt: new Date(now.getTime() + RESEND_AFTER_MS) }
  })
}

// A code whose email couldn't be sent never existed: it mustn't count toward
// the limits, or block asking again.
export async function discardCode(id: number): Promise<void> {
  await db.delete(affiliateActionCodes).where(and(eq(affiliateActionCodes.id, id), isNull(affiliateActionCodes.usedAt)))
}

// Checks the code and, when it is right, SPENDS it — in that order, each in
// one statement, so neither a burst of guesses nor two tabs can get more out
// of a code than five tries and one use.
// `checkApp` verifies an authenticator code (the caller knows the account).
export async function claimCode(input: { affiliateId: number; purpose: CodePurpose; subject: string; code: unknown; checkApp?: (code: string) => Promise<boolean>; now?: Date }): Promise<{ id: number }> {
  const now = input.now ?? new Date()
  const code = cleanCode(input.code)
  if (!isCode(code)) throw new CodeError("Enter the 6-digit verification code.")
  const [row] = await db
    .select()
    .from(affiliateActionCodes)
    .where(and(eq(affiliateActionCodes.affiliateId, input.affiliateId), eq(affiliateActionCodes.purpose, input.purpose), eq(affiliateActionCodes.subject, input.subject)))
    .orderBy(desc(affiliateActionCodes.createdAt), desc(affiliateActionCodes.id))
    .limit(1)
  if (!row) throw new CodeError("Ask for a verification code first.")
  if (row.usedAt) throw new CodeError("That code was already used. Ask for a new code.")
  if (row.expiresAt.getTime() <= now.getTime()) throw new CodeError("That code has expired. Ask for a new code.")
  if (row.attempts >= MAX_CODE_ATTEMPTS) throw new CodeError(wrongCodeText(row.attempts))

  // The try is counted before the code is looked at.
  const [tried] = await db
    .update(affiliateActionCodes)
    .set({ attempts: sql`${affiliateActionCodes.attempts} + 1` })
    .where(and(eq(affiliateActionCodes.id, row.id), lt(affiliateActionCodes.attempts, MAX_CODE_ATTEMPTS), isNull(affiliateActionCodes.usedAt)))
    .returning({ attempts: affiliateActionCodes.attempts })
  if (!tried) throw new CodeError(wrongCodeText(MAX_CODE_ATTEMPTS))

  const right = row.channel === "app" ? !!input.checkApp && (await input.checkApp(code)) : !!row.codeHash && sameHash(row.codeHash, hashCode(input.affiliateId, input.purpose, code))
  if (!right) {
    // Five wrong codes in a row is worth a person's look — and until someone
    // has looked, nothing is sent to this affiliate automatically.
    if (tried.attempts >= MAX_CODE_ATTEMPTS) await recordSignal(input.affiliateId, { type: "payout_code_failed", risk: "medium", details: { purpose: input.purpose, channel: row.channel } }, { key: `code${row.id}` })
    throw new CodeError(wrongCodeText(tried.attempts))
  }
  const [claimed] = await db
    .update(affiliateActionCodes)
    .set({ usedAt: now })
    .where(and(eq(affiliateActionCodes.id, row.id), isNull(affiliateActionCodes.usedAt)))
    .returning({ id: affiliateActionCodes.id })
  if (!claimed) throw new CodeError("That code was already used. Ask for a new code.")
  return { id: row.id }
}

// The action the code was for was refused (below the minimum, a payout already
// in progress…): nothing happened, so the code is given back for another go.
export async function releaseCode(id: number): Promise<void> {
  await db.update(affiliateActionCodes).set({ usedAt: null }).where(eq(affiliateActionCodes.id, id))
}

// Housekeeping: a code is of no use a week later.
export async function pruneActionCodes(now = new Date()): Promise<number> {
  const rows = await db
    .delete(affiliateActionCodes)
    .where(lt(affiliateActionCodes.createdAt, new Date(now.getTime() - 7 * 86_400_000)))
    .returning({ id: affiliateActionCodes.id })
  return rows.length
}
