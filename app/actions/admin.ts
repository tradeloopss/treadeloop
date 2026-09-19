"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { and, eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { announcements, importEvents, rithmicConnections, subscriptions, supportMessages, supportTickets, twoFactor, user } from "@/lib/db/schema"
import { assertAdmin } from "@/lib/admin/guard"
import { logAdminAction } from "@/lib/admin/audit"
import { isAdminRole, type AdminRole } from "@/lib/admin/access"
import { isOwnerEmail } from "@/lib/subscription"
import { syncRithmicConnection } from "@/lib/rithmic-sync"
import { sendEmail } from "@/lib/email"
import { importCsvText, logImport } from "@/lib/trade-importer"
import * as whop from "@/lib/admin/whop"

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string }

async function run(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn()
    revalidatePath("/admin", "layout")
    return { ok: true, ...(message ? { message } : {}) }
  } catch (err) {
    return { ok: false, error: describeError(err) }
  }
}

// Drizzle wraps database errors as "Failed query: <sql>" and keeps the real
// reason on `cause`; show the reason.
function describeError(err: unknown) {
  if (!(err instanceof Error)) return "Something went wrong"
  const cause = (err as { cause?: unknown }).cause
  return cause instanceof Error && err.message.startsWith("Failed query") ? `Database error: ${cause.message}` : err.message
}

async function getTarget(userId: string) {
  const [row] = await db.select().from(user).where(eq(user.id, userId))
  if (!row) throw new Error("User not found")
  return row
}

// --- Users -------------------------------------------------------------------

export async function suspendUser(userId: string, reason: string, days: number | null) {
  return run(async () => {
    const admin = await assertAdmin({ user: ["ban"] })
    if (userId === admin.id) throw new Error("You can't suspend yourself.")
    const target = await getTarget(userId)
    if (isOwnerEmail(target.email)) throw new Error("Site owners can't be suspended.")
    if (isAdminRole(target.role) && admin.role !== "super_admin") throw new Error("Only a Super Admin can suspend another admin.")
    // banUser also ends every session the user has open.
    await auth.api.banUser({
      body: { userId, banReason: reason.trim() || undefined, banExpiresIn: days ? days * 86400 : undefined },
      headers: await headers(),
    })
    await logAdminAction(admin, "user.suspend", userId, { reason: reason.trim() || null, days })
  })
}

export async function unsuspendUser(userId: string) {
  return run(async () => {
    const admin = await assertAdmin({ user: ["ban"] })
    await auth.api.unbanUser({ body: { userId }, headers: await headers() })
    await logAdminAction(admin, "user.unsuspend", userId)
  })
}

export async function revokeUserSessions(userId: string) {
  return run(async () => {
    const admin = await assertAdmin({ session: ["revoke"] })
    await auth.api.revokeUserSessions({ body: { userId }, headers: await headers() })
    await logAdminAction(admin, "user.revoke_sessions", userId)
  })
}

// Swaps the admin's session for a short-lived one as the target user (the
// admin session is parked in a cookie and restored by stopImpersonating).
// Logged before it happens, so a failure halfway still leaves a record.
export async function impersonateUser(userId: string): Promise<ActionResult> {
  try {
    const admin = await assertAdmin({ user: ["impersonate"] })
    if (userId === admin.id) throw new Error("That's your own account.")
    await logAdminAction(admin, "user.impersonate", userId)
    await auth.api.impersonateUser({ body: { userId }, headers: await headers() })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't log in as this user" }
  }
  redirect("/dashboard")
}

// Called from the banner shown during impersonation, i.e. with the target
// user's session — the acting admin is recorded on it as impersonatedBy.
export async function stopImpersonating() {
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })
  const adminId = session?.session.impersonatedBy
  if (!session || !adminId) redirect("/dashboard")

  const [adminRow] = await db.select({ email: user.email }).from(user).where(eq(user.id, adminId))
  await logAdminAction(
    { id: adminId, email: adminRow?.email ?? "unknown", ip: requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null },
    "user.impersonate_stop",
    session.user.id
  )
  await auth.api.stopImpersonating({ headers: requestHeaders })
  redirect(`/admin/users/${session.user.id}`)
}

// --- Plans -------------------------------------------------------------------

export async function grantPlan(userId: string, plan: "essential" | "pro", days: number, note: string) {
  return run(async () => {
    const admin = await assertAdmin({ billing: ["manage"] })
    if (plan !== "essential" && plan !== "pro") throw new Error("Pick a plan.")
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("Days must be between 1 and 3650.")
    const target = await getTarget(userId)
    const until = new Date(Date.now() + days * 86400_000)
    await db.insert(subscriptions).values({
      userId,
      email: target.email,
      plan,
      status: "active",
      source: "admin",
      currentPeriodEnd: until,
    })
    await logAdminAction(admin, "plan.grant", userId, { plan, days, until: until.toISOString(), note: note.trim() || null })
    return `Granted ${plan === "pro" ? "Pro" : "Essential"} until ${until.toLocaleDateString("en-US", { dateStyle: "medium" })}.`
  })
}

export async function revokeGrant(subscriptionId: number) {
  return run(async () => {
    const admin = await assertAdmin({ billing: ["manage"] })
    const [row] = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.source, "admin")))
    if (!row) throw new Error("Only admin-granted plans can be revoked here; Whop subscriptions are managed in Whop.")
    await db.update(subscriptions).set({ status: "canceled", updatedAt: new Date() }).where(eq(subscriptions.id, row.id))
    await logAdminAction(admin, "plan.revoke_grant", row.userId, { subscriptionId, plan: row.plan })
  })
}

// --- Team --------------------------------------------------------------------

export async function setUserRole(userId: string, role: AdminRole | "user") {
  return run(async () => {
    const admin = await assertAdmin({ team: ["manage"] })
    if (userId === admin.id) throw new Error("You can't change your own role.")
    if (role !== "user" && !isAdminRole(role)) throw new Error("Unknown role.")
    const target = await getTarget(userId)
    if (isOwnerEmail(target.email)) throw new Error("Site owners are always Super Admins.")
    await auth.api.setRole({ body: { userId, role }, headers: await headers() })
    await logAdminAction(admin, "user.set_role", userId, { from: target.role ?? "user", to: role })
  })
}

export async function addTeamMember(email: string, role: AdminRole) {
  const [target] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.trim().toLowerCase()))
  if (!target) return { ok: false, error: "No TradeLoop account uses that email. They need to sign up first." } as ActionResult
  return setUserRole(target.id, role)
}

// --- Brokers -----------------------------------------------------------------

export async function forceRithmicSync(connectionId: number) {
  return run(async () => {
    const admin = await assertAdmin({ brokers: ["sync"] })
    const [connection] = await db.select().from(rithmicConnections).where(eq(rithmicConnections.id, connectionId))
    if (!connection) throw new Error("Connection not found")
    try {
      const { imported } = await syncRithmicConnection(connection, "admin")
      await logAdminAction(admin, "broker.force_sync", connection.userId, { connectionId, broker: "rithmic", imported })
      return `Sync finished — ${imported} new trade${imported === 1 ? "" : "s"} imported.`
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await logAdminAction(admin, "broker.force_sync", connection.userId, { connectionId, broker: "rithmic", error: message })
      throw new Error(`Sync failed: ${message}`)
    }
  })
}

// --- Announcements -------------------------------------------------------------

export async function createAnnouncement(message: string, level: "info" | "warning", endsAt: string | null) {
  return run(async () => {
    const admin = await assertAdmin({ announcements: ["manage"] })
    const text = message.trim()
    if (!text) throw new Error("Write a message first.")
    if (text.length > 280) throw new Error("Keep it under 280 characters.")
    const end = endsAt ? new Date(endsAt) : null
    if (end && Number.isNaN(end.getTime())) throw new Error("That end date isn't valid.")
    const [row] = await db
      .insert(announcements)
      .values({ message: text, level: level === "warning" ? "warning" : "info", endsAt: end, createdBy: admin.email })
      .returning({ id: announcements.id })
    await logAdminAction(admin, "announcement.create", null, { id: row.id, message: text, level, endsAt })
    revalidatePath("/", "layout")
  })
}

export async function setAnnouncementActive(id: number, active: boolean) {
  return run(async () => {
    const admin = await assertAdmin({ announcements: ["manage"] })
    await db.update(announcements).set({ active }).where(eq(announcements.id, id))
    await logAdminAction(admin, "announcement.update", null, { id, active })
    revalidatePath("/", "layout")
  })
}

// --- Security ------------------------------------------------------------------

// For a user who lost their authenticator: removes 2FA so they can sign in
// with just their password, then set it up again.
export async function resetTwoFactor(userId: string) {
  return run(async () => {
    const admin = await assertAdmin({ security: ["manage"] })
    const target = await getTarget(userId)
    if (isAdminRole(target.role) && admin.role !== "super_admin") throw new Error("Only a Super Admin can reset another admin's 2FA.")
    await db.delete(twoFactor).where(eq(twoFactor.userId, userId))
    await db.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, userId))
    await logAdminAction(admin, "user.reset_2fa", userId)
    return "Two-step verification removed. They can sign in with their password and set it up again."
  })
}

export async function sendPasswordResetEmail(userId: string) {
  return run(async () => {
    const admin = await assertAdmin({ security: ["manage"] })
    const target = await getTarget(userId)
    await auth.api.requestPasswordReset({ body: { email: target.email, redirectTo: "/reset-password" } })
    await logAdminAction(admin, "user.send_password_reset", userId)
    return `Reset link sent to ${target.email}.`
  })
}

// --- Support -------------------------------------------------------------------

export async function staffReply(ticketId: number, body: string, status: "waiting" | "closed") {
  return run(async () => {
    const admin = await assertAdmin({ support: ["reply"] })
    const text = body.trim()
    if (!text) throw new Error("Write a reply first.")
    if (text.length > 5000) throw new Error("Keep it under 5,000 characters.")
    const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, ticketId))
    if (!ticket) throw new Error("Request not found")

    await db.insert(supportMessages).values({ ticketId, authorId: admin.id, fromStaff: true, body: text })
    await db.update(supportTickets).set({ status, lastMessageAt: new Date() }).where(eq(supportTickets.id, ticketId))
    await logAdminAction(admin, "support.reply", ticket.userId, { ticketId, status })

    const target = await getTarget(ticket.userId)
    const link = `${process.env.BETTER_AUTH_URL ?? ""}/support/${ticketId}`
    try {
      await sendEmail({
        to: target.email,
        subject: `Re: ${ticket.subject}`,
        text: `TradeLoop support replied to your request "${ticket.subject}":

${text}

Reply here: ${link}`,
      })
      return "Reply sent."
    } catch (err) {
      return `Reply saved — the user will see it in the app, but the email didn't go out: ${err instanceof Error ? err.message : err}`
    }
  })
}

export async function setTicketStatus(ticketId: number, status: "open" | "waiting" | "closed") {
  return run(async () => {
    const admin = await assertAdmin({ support: ["reply"] })
    const [ticket] = await db.update(supportTickets).set({ status }).where(eq(supportTickets.id, ticketId)).returning({ userId: supportTickets.userId })
    if (!ticket) throw new Error("Request not found")
    await logAdminAction(admin, "support.status", ticket.userId, { ticketId, status })
  })
}

// --- Imports & sync jobs ---------------------------------------------------------

// Re-runs a failed import with today's parser, into the same user's account —
// for when a broker changed its export format and the parser has since been
// fixed. The original stays in the log, marked resolved.
export async function retryImport(importId: number) {
  return run(async () => {
    const admin = await assertAdmin({ brokers: ["sync"] })
    const [event] = await db.select().from(importEvents).where(eq(importEvents.id, importId))
    if (!event) throw new Error("Import not found")
    if (event.status !== "failed" || !event.fileContent) throw new Error("Only failed imports with their file kept can be retried.")
    try {
      const result = await importCsvText(event.userId, event.fileContent, event.accountId)
      await logImport({ userId: event.userId, fileName: event.fileName, csvText: event.fileContent, accountId: event.accountId, retryOf: importId, result })
      await db.update(importEvents).set({ resolvedAt: new Date() }).where(eq(importEvents.id, importId))
      await logAdminAction(admin, "import.retry", event.userId, { importId, ...result })
      revalidatePath("/dashboard")
      revalidatePath("/trades")
      return `Imported ${result.imported} trade${result.imported === 1 ? "" : "s"} from ${result.source} (${result.duplicates} already there).`
    } catch (err) {
      await logImport({ userId: event.userId, fileName: event.fileName, csvText: event.fileContent, accountId: event.accountId, retryOf: importId, error: err })
      await logAdminAction(admin, "import.retry", event.userId, { importId, error: err instanceof Error ? err.message : String(err) })
      throw new Error(`Still failing: ${err instanceof Error ? err.message : err}`)
    }
  })
}

export async function dismissImport(importId: number) {
  return run(async () => {
    const admin = await assertAdmin({ brokers: ["sync"] })
    const [event] = await db.update(importEvents).set({ resolvedAt: new Date() }).where(eq(importEvents.id, importId)).returning({ userId: importEvents.userId })
    if (!event) throw new Error("Import not found")
    await logAdminAction(admin, "import.dismiss", event.userId, { importId })
  })
}

// Syncs every Rithmic connection one after another, after the response is
// sent (bounded by the function's max duration; the background job picks up
// anything left). Progress shows up in the sync-runs list as it goes.
export async function resyncAllRithmic() {
  return run(async () => {
    const admin = await assertAdmin({ brokers: ["sync"] })
    const connections = await db.select().from(rithmicConnections)
    if (connections.length === 0) return "There are no Rithmic connections."
    await logAdminAction(admin, "broker.mass_sync", null, { broker: "rithmic", connections: connections.length })
    after(async () => {
      for (const connection of connections) {
        await syncRithmicConnection(connection, "admin").catch(() => {})
      }
    })
    return `Re-syncing ${connections.length} Rithmic connection${connections.length === 1 ? "" : "s"} — results appear below as they finish.`
  })
}

// --- Whop billing ------------------------------------------------------------------

// The subscriptions row for a Whop membership, so local access can follow a
// change made here without waiting for the webhook.
async function localSubscription(membershipId: string) {
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.whopMembershipId, membershipId))
  return row ?? null
}

export async function refundWhopPayment(paymentId: string, partialAmount: number | null, email: string | null) {
  return run(async () => {
    const admin = await assertAdmin({ billing: ["manage"] })
    if (partialAmount != null && (!Number.isFinite(partialAmount) || partialAmount <= 0)) throw new Error("Enter a positive amount.")
    await whop.refundPayment(paymentId, partialAmount)
    const target = email ? (await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase())))[0] : null
    await logAdminAction(admin, "billing.refund", target?.id ?? null, { paymentId, partialAmount, email })
    return partialAmount != null ? `Refunded $${partialAmount.toFixed(2)}.` : "Payment fully refunded."
  })
}

export async function retryWhopPayment(paymentId: string, email: string | null) {
  return run(async () => {
    const admin = await assertAdmin({ billing: ["manage"] })
    await whop.retryPayment(paymentId)
    await logAdminAction(admin, "billing.retry_payment", null, { paymentId, email })
    return "Whop is retrying the charge."
  })
}

export async function pauseWhopMembership(membershipId: string, untilIso: string | null) {
  return run(async () => {
    const admin = await assertAdmin({ billing: ["manage"] })
    await whop.pauseMembership(membershipId, untilIso)
    const local = await localSubscription(membershipId)
    await logAdminAction(admin, "billing.pause", local?.userId ?? null, { membershipId, until: untilIso })
    return untilIso ? `Billing paused until ${new Date(untilIso).toLocaleDateString("en-US", { dateStyle: "medium" })}. Access continues.` : "Billing paused. Access continues until resumed."
  })
}

export async function resumeWhopMembership(membershipId: string) {
  return run(async () => {
    const admin = await assertAdmin({ billing: ["manage"] })
    await whop.resumeMembership(membershipId)
    const local = await localSubscription(membershipId)
    await logAdminAction(admin, "billing.resume", local?.userId ?? null, { membershipId })
    return "Billing resumed."
  })
}

export async function cancelWhopMembership(membershipId: string, atPeriodEnd: boolean, reason: string) {
  return run(async () => {
    const admin = await assertAdmin({ billing: ["manage"] })
    await whop.cancelMembership(membershipId, atPeriodEnd, reason.trim())
    const local = await localSubscription(membershipId)
    if (local && !atPeriodEnd) {
      await db.update(subscriptions).set({ status: "canceled", updatedAt: new Date() }).where(eq(subscriptions.id, local.id))
    }
    await logAdminAction(admin, "billing.cancel", local?.userId ?? null, { membershipId, atPeriodEnd, reason: reason.trim() || null })
    return atPeriodEnd ? "Subscription will end at the current period's end." : "Subscription canceled; access removed."
  })
}

export async function extendWhopMembership(membershipId: string, days: number) {
  return run(async () => {
    const admin = await assertAdmin({ billing: ["manage"] })
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("Days must be between 1 and 365.")
    await whop.extendMembership(membershipId, days)
    const local = await localSubscription(membershipId)
    if (local) {
      const base = local.currentPeriodEnd && local.currentPeriodEnd.getTime() > Date.now() ? local.currentPeriodEnd : new Date()
      await db
        .update(subscriptions)
        .set({ currentPeriodEnd: new Date(base.getTime() + days * 86400_000), status: local.status === "canceled" || local.status === "expired" ? "active" : local.status, updatedAt: new Date() })
        .where(eq(subscriptions.id, local.id))
    }
    await logAdminAction(admin, "billing.extend", local?.userId ?? null, { membershipId, days })
    return `Extended by ${days} day${days === 1 ? "" : "s"}; the next charge moves out by the same amount.`
  })
}

export async function createWhopPromoCode(input: {
  code: string
  promoType: "percentage" | "flat_amount"
  amountOff: number
  durationMonths: number
  newUsersOnly: boolean
  onePerCustomer: boolean
  stock: number | null
  expiresAt: string | null
}) {
  return run(async () => {
    const admin = await assertAdmin({ billing: ["manage"] })
    const code = input.code.trim().toUpperCase()
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new Error("Codes are 3–32 letters, numbers, dashes or underscores.")
    if (!Number.isFinite(input.amountOff) || input.amountOff <= 0) throw new Error("Enter a discount amount.")
    if (input.promoType === "percentage" && input.amountOff > 100) throw new Error("A percentage can't exceed 100.")
    if (!Number.isInteger(input.durationMonths) || input.durationMonths < 1) throw new Error("Duration is at least 1 month.")
    await whop.createPromoCode({ ...input, code })
    await logAdminAction(admin, "billing.promo_create", null, { ...input, code })
    return `Promo code ${code} created.`
  })
}

export async function deleteWhopPromoCode(id: string, code: string | null) {
  return run(async () => {
    const admin = await assertAdmin({ billing: ["manage"] })
    await whop.deletePromoCode(id)
    await logAdminAction(admin, "billing.promo_delete", null, { id, code })
  })
}
