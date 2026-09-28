"use server"

import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { user, userSettings } from "@/lib/db/schema"

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
