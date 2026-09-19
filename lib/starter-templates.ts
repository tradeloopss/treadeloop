import { asc, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { playbooks, starterPlaybooks, starterTagGroups, tagGroups, tagOptions, userOnboarding } from "@/lib/db/schema"

// Gives a new user the admin-defined starter tags and playbooks, once.
// Called from the app layout on each request; the user_onboarding row makes
// every call after the first a single indexed lookup. Never throws — a
// seeding failure must not block the app.
export async function seedStarterTemplates(userId: string): Promise<void> {
  try {
    const [done] = await db.select({ userId: userOnboarding.userId }).from(userOnboarding).where(eq(userOnboarding.userId, userId))
    if (done) return
    // Claim first so two concurrent requests don't both seed.
    const claimed = await db.insert(userOnboarding).values({ userId }).onConflictDoNothing().returning({ userId: userOnboarding.userId })
    if (claimed.length === 0) return

    const [groups, books] = await Promise.all([
      db.select().from(starterTagGroups).orderBy(asc(starterTagGroups.sortOrder), asc(starterTagGroups.id)),
      db.select().from(starterPlaybooks).orderBy(asc(starterPlaybooks.sortOrder), asc(starterPlaybooks.id)),
    ])
    for (const [i, g] of groups.entries()) {
      const [group] = await db.insert(tagGroups).values({ userId, name: g.name, color: g.color, sortOrder: i }).returning({ id: tagGroups.id })
      if (g.options.length) {
        await db.insert(tagOptions).values(g.options.map((name, j) => ({ userId, groupId: group.id, name, sortOrder: j })))
      }
    }
    if (books.length) {
      await db.insert(playbooks).values(books.map((b) => ({ userId, name: b.name, description: b.description, rules: b.rules })))
    }
  } catch (err) {
    console.error("[starter-templates] could not seed", err)
  }
}
