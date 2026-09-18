"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { playbooks, playbookShares, user, trades } from "@/lib/db/schema"
import { and, desc, eq, inArray, or } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { randomBytes } from "node:crypto"
import { requirePro } from "@/lib/subscription"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

export async function getPlaybooks() {
  const userId = await getUserId()
  return db.select().from(playbooks).where(eq(playbooks.userId, userId)).orderBy(desc(playbooks.createdAt))
}

export async function createPlaybook(formData: FormData) {
  const userId = await getUserId()
  const rules = String(formData.get("rules") ?? "")
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean)
  await db.insert(playbooks).values({
    userId,
    name: String(formData.get("name") ?? "New Playbook"),
    description: formData.get("description") ? String(formData.get("description")) : null,
    rules,
  })
  revalidatePath("/playbooks")
}

export async function deletePlaybook(id: number) {
  const userId = await getUserId()
  await db.delete(playbooks).where(and(eq(playbooks.id, id), eq(playbooks.userId, userId)))
  revalidatePath("/playbooks")
}

// Turns sharing on and returns the token for /p/<token> — generates a fresh
// one each time it's (re-)enabled, so an old leaked link stops working once
// the owner disables and re-enables sharing.
export async function sharePlaybook(id: number) {
  const userId = await getUserId()
  await requirePro(userId, "Playbook sharing")
  const token = randomBytes(12).toString("hex")
  const [updated] = await db
    .update(playbooks)
    .set({ shareToken: token })
    .where(and(eq(playbooks.id, id), eq(playbooks.userId, userId)))
    .returning({ shareToken: playbooks.shareToken })
  if (!updated) throw new Error("Playbook not found")
  revalidatePath("/playbooks")
  return updated.shareToken!
}

export async function unsharePlaybook(id: number) {
  const userId = await getUserId()
  await db
    .update(playbooks)
    .set({ shareToken: null })
    .where(and(eq(playbooks.id, id), eq(playbooks.userId, userId)))
  revalidatePath("/playbooks")
}

// Public lookup by share token — no ownership check, deliberately excludes
// userId/trades so a shared link only ever exposes the strategy itself.
export async function getSharedPlaybook(token: string) {
  const [pb] = await db.select().from(playbooks).where(eq(playbooks.shareToken, token))
  if (!pb) return null
  return { name: pb.name, description: pb.description, rules: pb.rules }
}

// Copies a shared playbook's strategy into the signed-in visitor's own
// playbooks — the "use this playbook" action on the public share page.
export async function clonePlaybook(token: string) {
  const userId = await getUserId()
  const [source] = await db.select().from(playbooks).where(eq(playbooks.shareToken, token))
  if (!source) throw new Error("This shared playbook no longer exists")
  await db.insert(playbooks).values({
    userId,
    name: source.name,
    description: source.description,
    rules: source.rules,
  })
  revalidatePath("/playbooks")
}

// Copies a playbook that's been directly shared with the current user (via
// playbookShares, not a public link) into their own playbooks.
export async function cloneSharedPlaybook(playbookId: number) {
  const userId = await getUserId()
  const [share] = await db
    .select()
    .from(playbookShares)
    .where(and(eq(playbookShares.playbookId, playbookId), eq(playbookShares.sharedWithUserId, userId)))
  if (!share) throw new Error("This playbook isn't shared with you")

  const [source] = await db.select().from(playbooks).where(eq(playbooks.id, playbookId))
  if (!source) throw new Error("This playbook no longer exists")

  await db.insert(playbooks).values({
    userId,
    name: source.name,
    description: source.description,
    rules: source.rules,
  })
  revalidatePath("/playbooks")
}

// --- Direct sharing with other TradeLoop users (by email) -----------------

export async function shareWithUser(playbookId: number, email: string) {
  const userId = await getUserId()
  await requirePro(userId, "Playbook sharing")
  const [owned] = await db
    .select()
    .from(playbooks)
    .where(and(eq(playbooks.id, playbookId), eq(playbooks.userId, userId)))
  if (!owned) throw new Error("Playbook not found")

  const trimmedEmail = email.trim().toLowerCase()
  const [target] = await db.select().from(user).where(eq(user.email, trimmedEmail))
  if (!target) throw new Error("No TradeLoop account found with that email")
  if (target.id === userId) throw new Error("That's your own account")

  const existing = await db
    .select()
    .from(playbookShares)
    .where(and(eq(playbookShares.playbookId, playbookId), eq(playbookShares.sharedWithUserId, target.id)))
  if (existing.length === 0) {
    await db.insert(playbookShares).values({ playbookId, ownerId: userId, sharedWithUserId: target.id })
  }
  revalidatePath("/playbooks")
  return { id: target.id, name: target.name, email: target.email, image: target.image }
}

// Removes a share — usable by the owner (revoking someone's access) or by
// the recipient themselves (leaving a playbook shared with them).
export async function removePlaybookShare(playbookId: number, sharedWithUserId: string) {
  const userId = await getUserId()
  await db
    .delete(playbookShares)
    .where(
      and(
        eq(playbookShares.playbookId, playbookId),
        eq(playbookShares.sharedWithUserId, sharedWithUserId),
        or(eq(playbookShares.ownerId, userId), eq(playbookShares.sharedWithUserId, userId)),
      ),
    )
  revalidatePath("/playbooks")
}

// Every share across all of the current user's own playbooks, for the "My
// Playbook" table's shared-with column — one query instead of N.
export async function getPlaybookSharesForOwner() {
  const userId = await getUserId()
  return db
    .select({
      playbookId: playbookShares.playbookId,
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(playbookShares)
    .innerJoin(user, eq(playbookShares.sharedWithUserId, user.id))
    .where(eq(playbookShares.ownerId, userId))
}

// Playbooks other people have shared with the current user, for the
// "Shared Playbook" tab — includes the owner's own performance with that
// playbook (a rollup, not individual trades) so it can be evaluated before
// adopting it.
export async function getSharedWithMePlaybooks() {
  const userId = await getUserId()
  const shared = await db
    .select({
      id: playbooks.id,
      name: playbooks.name,
      description: playbooks.description,
      rules: playbooks.rules,
      ownerId: playbooks.userId,
      ownerName: user.name,
    })
    .from(playbookShares)
    .innerJoin(playbooks, eq(playbookShares.playbookId, playbooks.id))
    .innerJoin(user, eq(playbooks.userId, user.id))
    .where(eq(playbookShares.sharedWithUserId, userId))
    .orderBy(desc(playbookShares.createdAt))

  if (shared.length === 0) return []

  const ids = shared.map((s) => s.id)
  const linked = await db
    .select({ playbookId: trades.playbookId, pnl: trades.pnl })
    .from(trades)
    .where(and(inArray(trades.playbookId, ids), eq(trades.status, "closed")))

  return shared.map((s) => {
    const list = linked.filter((t) => t.playbookId === s.id)
    const wins = list.filter((t) => Number(t.pnl) > 0).length
    return {
      ...s,
      trades: list.length,
      netPnl: list.reduce((sum, t) => sum + Number(t.pnl), 0),
      winRate: list.length ? (wins / list.length) * 100 : 0,
    }
  })
}
