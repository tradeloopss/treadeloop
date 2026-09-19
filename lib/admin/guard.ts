import { cache } from "react"
import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { user } from "@/lib/db/schema"
import { isOwnerEmail } from "@/lib/subscription"
import { isAdminRole, roleCan, type AdminRole, type Permissions } from "@/lib/admin/access"

export interface AdminContext {
  id: string
  email: string
  name: string
  role: AdminRole
  ip: string | null
}

// The signed-in admin for this request, or null. Cached per request so a
// page and its actions share one lookup.
export const getAdmin = cache(async (): Promise<AdminContext | null> => {
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (!session?.user) return null
  // A "log in as user" session belongs to the target user, never to an admin,
  // even though an admin opened it.
  if (session.session.impersonatedBy) return null

  let role = session.user.role
  // Site owners (OWNER_EMAILS) are always super admins. The stored role is
  // promoted too, so the Better Auth admin plugin's own endpoints agree.
  if (isOwnerEmail(session.user.email) && role !== "super_admin") {
    await db.update(user).set({ role: "super_admin" }).where(eq(user.id, session.user.id))
    role = "super_admin"
  }
  if (!isAdminRole(role)) return null

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role,
    ip: requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  }
})

// For admin pages: anyone who isn't an admin with these permissions gets a
// 404, so the admin area doesn't advertise that it exists.
export async function requireAdmin(permissions?: Permissions): Promise<AdminContext> {
  const admin = await getAdmin()
  if (!admin || (permissions && !roleCan(admin.role, permissions))) notFound()
  return admin
}

// For server actions, which report failures instead of rendering a 404.
export async function assertAdmin(permissions: Permissions): Promise<AdminContext> {
  const admin = await getAdmin()
  if (!admin || !roleCan(admin.role, permissions)) throw new Error("You don't have permission to do that.")
  return admin
}
