"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { tagGroups, tagOptions } from "@/lib/db/schema"
import { and, asc, eq } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

export async function getTagGroups() {
  const userId = await getUserId()
  const [groups, options] = await Promise.all([
    db.select().from(tagGroups).where(eq(tagGroups.userId, userId)).orderBy(asc(tagGroups.sortOrder), asc(tagGroups.id)),
    db.select().from(tagOptions).where(eq(tagOptions.userId, userId)).orderBy(asc(tagOptions.sortOrder), asc(tagOptions.id)),
  ])
  return groups.map((g) => ({ ...g, tags: options.filter((t) => t.groupId === g.id) }))
}

export async function createTagGroup(name: string, color: string) {
  const userId = await getUserId()
  const trimmed = name.trim()
  if (!trimmed) return
  const existing = await db.select().from(tagGroups).where(eq(tagGroups.userId, userId))
  await db.insert(tagGroups).values({ userId, name: trimmed, color, sortOrder: existing.length })
  revalidatePath("/settings")
}

export async function renameTagGroup(id: number, name: string) {
  const userId = await getUserId()
  const trimmed = name.trim()
  if (!trimmed) return
  await db.update(tagGroups).set({ name: trimmed }).where(and(eq(tagGroups.id, id), eq(tagGroups.userId, userId)))
  revalidatePath("/settings")
}

export async function deleteTagGroup(id: number) {
  const userId = await getUserId()
  await db.delete(tagOptions).where(and(eq(tagOptions.groupId, id), eq(tagOptions.userId, userId)))
  await db.delete(tagGroups).where(and(eq(tagGroups.id, id), eq(tagGroups.userId, userId)))
  revalidatePath("/settings")
}

export async function addTagOption(groupId: number, name: string) {
  const userId = await getUserId()
  const trimmed = name.trim()
  if (!trimmed) return
  const existing = await db.select().from(tagOptions).where(and(eq(tagOptions.groupId, groupId), eq(tagOptions.userId, userId)))
  if (existing.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) return
  await db.insert(tagOptions).values({ userId, groupId, name: trimmed, sortOrder: existing.length })
  revalidatePath("/settings")
}

export async function deleteTagOption(id: number) {
  const userId = await getUserId()
  await db.delete(tagOptions).where(and(eq(tagOptions.id, id), eq(tagOptions.userId, userId)))
  revalidatePath("/settings")
}
