"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { journalEntries } from "@/lib/db/schema"
import { and, desc, eq } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

export async function getJournalEntries() {
  const userId = await getUserId()
  return db.select().from(journalEntries).where(eq(journalEntries.userId, userId)).orderBy(desc(journalEntries.date))
}

export async function saveJournalReflection(formData: FormData) {
  const userId = await getUserId()
  const date = String(formData.get("date"))
  const notes = formData.get("notes") ? String(formData.get("notes")) : null
  const mood = formData.get("mood") ? String(formData.get("mood")) : null

  const existing = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.userId, userId), eq(journalEntries.date, date)))

  if (existing.length) {
    await db
      .update(journalEntries)
      .set({ notes, mood })
      .where(and(eq(journalEntries.userId, userId), eq(journalEntries.date, date)))
  } else {
    await db.insert(journalEntries).values({ userId, date, notes, mood })
  }
  revalidatePath("/journal")
}
