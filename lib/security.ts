import type { BetterAuthPlugin } from "better-auth"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { and, desc, eq, gt, ne } from "drizzle-orm"
import { db } from "@/lib/db"
import { securityEvents, session, user } from "@/lib/db/schema"

export const SECURITY_EVENT_LABELS: Record<string, string> = {
  sign_up: "Signed up",
  sign_in: "Signed in",
  sign_in_failed: "Failed sign-in",
  sign_in_blocked: "Blocked sign-in",
  two_factor_challenge: "Asked for 2FA code",
  two_factor_failed: "Wrong 2FA code",
  two_factor_enabled: "Turned on 2FA",
  two_factor_disabled: "Turned off 2FA",
  password_reset_requested: "Requested password reset",
  password_reset: "Reset password",
  password_reset_failed: "Failed password reset",
  password_changed: "Changed password",
  password_change_failed: "Failed password change",
}

type Event = { type: keyof typeof SECURITY_EVENT_LABELS; userId?: string | null; email?: string | null; ip: string | null; userAgent: string | null; details?: Record<string, unknown> }

export async function recordSecurityEvent(e: Event) {
  await db.insert(securityEvents).values({
    type: e.type,
    userId: e.userId ?? null,
    email: e.email?.toLowerCase() ?? null,
    ipAddress: e.ip,
    userAgent: e.userAgent,
    details: e.details ?? null,
  })
}

async function userIdForEmail(email: unknown) {
  if (typeof email !== "string" || !email) return null
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()))
  return row?.id ?? null
}

// A sign-in from an IP this user has never had a session from before.
async function isNewIp(userId: string, sessionId: string, ip: string | null) {
  if (!ip) return false
  const [seen] = await db
    .select({ id: session.id })
    .from(session)
    .where(and(eq(session.userId, userId), eq(session.ipAddress, ip), ne(session.id, sessionId)))
    .limit(1)
  if (seen) return false
  const [other] = await db.select({ id: session.id }).from(session).where(and(eq(session.userId, userId), ne(session.id, sessionId))).limit(1)
  return Boolean(other) // a first-ever sign-in isn't "new IP"
}

// During the second step of a sign-in nobody is signed in yet, so a wrong
// code is attributed to the account whose password sign-in was just
// challenged from the same IP (within the 2FA cookie's 10-minute life).
async function pendingChallenger(ip: string | null) {
  if (!ip) return null
  const [row] = await db
    .select({ userId: securityEvents.userId, email: securityEvents.email })
    .from(securityEvents)
    .where(and(eq(securityEvents.type, "two_factor_challenge"), eq(securityEvents.ipAddress, ip), gt(securityEvents.createdAt, new Date(Date.now() - 10 * 60_000))))
    .orderBy(desc(securityEvents.createdAt))
    .limit(1)
  return row ?? null
}

const TWO_FACTOR_VERIFY = ["/two-factor/verify-totp", "/two-factor/verify-backup-code", "/two-factor/verify-otp"]

// Runs after every Better Auth endpoint; only the paths below are recorded.
// Never throws — a logging failure must not break sign-in.
const securityHook = createAuthMiddleware(async (ctx) => {
  const path = ctx.path
  const tracked =
    path === "/sign-in/email" ||
    path === "/sign-up/email" ||
    path.startsWith("/callback/") ||
    TWO_FACTOR_VERIFY.includes(path) ||
    path === "/two-factor/disable" ||
    path === "/request-password-reset" ||
    path === "/reset-password" ||
    path === "/change-password"
  if (!tracked) return

  try {
    const returned = ctx.context.returned as unknown
    const failed = returned instanceof APIError
    const status = failed ? (returned as APIError).statusCode : 200
    const headers = ctx.request?.headers ?? ctx.headers
    const ip = headers?.get("x-forwarded-for")?.split(",")[0]?.trim() || headers?.get("x-real-ip") || null
    const userAgent = headers?.get("user-agent") ?? null
    const body = (ctx.body ?? {}) as Record<string, unknown>
    const email = typeof body.email === "string" ? body.email : null
    const newSession = ctx.context.newSession
    const base = { ip, userAgent }

    if (path === "/sign-in/email") {
      if (failed) {
        await recordSecurityEvent({
          ...base,
          type: status === 403 ? "sign_in_blocked" : "sign_in_failed",
          email,
          userId: await userIdForEmail(email),
          details: { status, reason: (returned as APIError).message },
        })
      } else if ((returned as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
        await recordSecurityEvent({ ...base, type: "two_factor_challenge", email, userId: await userIdForEmail(email) })
      } else if (newSession) {
        const fresh = await isNewIp(newSession.user.id, newSession.session.id, ip)
        await recordSecurityEvent({ ...base, type: "sign_in", userId: newSession.user.id, email: newSession.user.email, details: { method: "password", newIp: fresh } })
      }
    } else if (path.startsWith("/callback/")) {
      if (newSession) {
        const fresh = await isNewIp(newSession.user.id, newSession.session.id, ip)
        await recordSecurityEvent({ ...base, type: "sign_in", userId: newSession.user.id, email: newSession.user.email, details: { method: path.slice("/callback/".length), newIp: fresh } })
      }
    } else if (path === "/sign-up/email") {
      if (newSession) await recordSecurityEvent({ ...base, type: "sign_up", userId: newSession.user.id, email: newSession.user.email })
    } else if (TWO_FACTOR_VERIFY.includes(path)) {
      const current = ctx.context.session
      if (failed) {
        const who = current ? { userId: current.user.id, email: current.user.email } : await pendingChallenger(ip)
        await recordSecurityEvent({ ...base, type: "two_factor_failed", userId: who?.userId ?? null, email: who?.email ?? null, details: { status, during: current ? "setup" : "sign-in" } })
      } else if (newSession && !current) {
        // Second step of a sign-in.
        const fresh = await isNewIp(newSession.user.id, newSession.session.id, ip)
        await recordSecurityEvent({ ...base, type: "sign_in", userId: newSession.user.id, email: newSession.user.email, details: { method: "password + 2FA", newIp: fresh } })
      } else if (current) {
        // Verifying the first code while signed in is what turns 2FA on.
        await recordSecurityEvent({ ...base, type: "two_factor_enabled", userId: current.user.id, email: current.user.email })
      }
    } else if (path === "/two-factor/disable" && !failed) {
      const current = ctx.context.session
      await recordSecurityEvent({ ...base, type: "two_factor_disabled", userId: current?.user.id ?? null, email: current?.user.email ?? null })
    } else if (path === "/request-password-reset") {
      await recordSecurityEvent({ ...base, type: "password_reset_requested", email, userId: await userIdForEmail(email) })
    } else if (path === "/reset-password") {
      await recordSecurityEvent({ ...base, type: failed ? "password_reset_failed" : "password_reset", details: failed ? { status } : undefined })
    } else if (path === "/change-password") {
      const current = ctx.context.session
      await recordSecurityEvent({ ...base, type: failed ? "password_change_failed" : "password_changed", userId: current?.user.id ?? null, email: current?.user.email ?? null })
    }
  } catch (err) {
    console.error("[security] could not record event", err)
  }
})

// Registered as a plugin listed after twoFactor so this hook sees the final
// response: user-level hooks run before plugin hooks, i.e. before the
// two-factor plugin swaps a password sign-in for its "enter your code" step,
// which would otherwise be logged as a successful sign-in.
export const securityEventsPlugin = () =>
  ({
    id: "security-events",
    hooks: { after: [{ matcher: () => true, handler: securityHook }] },
  }) satisfies BetterAuthPlugin
