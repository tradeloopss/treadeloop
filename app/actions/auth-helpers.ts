"use server"

import { randomInt, randomUUID } from "node:crypto"
import { and, eq, gt } from "drizzle-orm"
import { db } from "@/lib/db"
import { user, userSettings, verification } from "@/lib/db/schema"
import { sendEmail } from "@/lib/email"

// Resolves a sign-in identifier (email or @handle) to the account email so the
// login form can accept either. Anything with "@" is treated as an email and
// returned as-is; otherwise we look up the handle in user_settings.username.
// Returns null when no account matches (the caller shows the generic
// invalid-credentials message, so this never confirms whether a handle exists).
export async function resolveLoginEmail(identifier: string): Promise<string | null> {
  const id = identifier.trim()
  if (!id) return null
  if (id.includes("@")) return id
  const handle = id.replace(/^@+/, "").toLowerCase()
  if (!handle) return null
  try {
    const [row] = await db
      .select({ email: user.email })
      .from(userSettings)
      .innerJoin(user, eq(user.id, userSettings.userId))
      .where(and(eq(userSettings.username, handle)))
      .limit(1)
    return row?.email ?? null
  } catch {
    return null
  }
}

// --- Sign-up email verification (code before account creation) --------------
// A 6-digit code is emailed and stored in the verification table under a
// distinct identifier, so ownership of the email is confirmed BEFORE the
// account is created. Verifies the send transport (Resend) directly rather
// than relying on a plugin's post-signup flow.

const OTP_TTL_MS = 10 * 60 * 1000
const otpId = (email: string) => `signup-otp:${email.trim().toLowerCase()}`

export async function sendSignupOtp(email: string): Promise<{ ok: boolean; error?: string }> {
  const e = email.trim().toLowerCase()
  if (!e || !e.includes("@")) return { ok: false, error: "Enter a valid email address." }

  // Don't start verification for an email that already has an account.
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, e)).limit(1)
  if (existing) return { ok: false, error: "An account with this email already exists — try signing in instead." }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0")
  const id = otpId(e)
  try {
    await db.delete(verification).where(eq(verification.identifier, id))
    await db.insert(verification).values({ id: randomUUID(), identifier: id, value: code, expiresAt: new Date(Date.now() + OTP_TTL_MS) })
    await sendEmail({
      to: e,
      subject: "Your TradeLoop verification code",
      text: `Your TradeLoop verification code is ${code}

It expires in 10 minutes. If you didn't try to create a TradeLoop account, you can ignore this email.`,
    })
    return { ok: true }
  } catch (err) {
    console.error("[signup-otp] send failed:", err instanceof Error ? err.message : err)
    return { ok: false, error: "We couldn't send the code right now. Please try again in a moment." }
  }
}

export async function verifySignupOtp(email: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const e = email.trim().toLowerCase()
  const id = otpId(e)
  const clean = code.replace(/\s/g, "")
  const [row] = await db
    .select({ value: verification.value })
    .from(verification)
    .where(and(eq(verification.identifier, id), gt(verification.expiresAt, new Date())))
    .limit(1)
  if (!row) return { ok: false, error: "That code has expired — request a new one." }
  if (row.value !== clean) return { ok: false, error: "That code isn't right. Check it and try again." }
  // Consume the code so it can't be reused.
  await db.delete(verification).where(eq(verification.identifier, id))
  return { ok: true }
}
