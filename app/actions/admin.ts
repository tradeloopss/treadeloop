"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { and, eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { announcements, rithmicConnections, subscriptions, user } from "@/lib/db/schema"
import { assertAdmin } from "@/lib/admin/guard"
import { logAdminAction } from "@/lib/admin/audit"
import { isAdminRole, type AdminRole } from "@/lib/admin/access"
import { isOwnerEmail } from "@/lib/subscription"
import { syncRithmicConnection } from "@/lib/rithmic-sync"

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string }

async function run(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn()
    revalidatePath("/admin", "layout")
    return { ok: true, ...(message ? { message } : {}) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" }
  }
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
      const { imported } = await syncRithmicConnection(connection)
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
