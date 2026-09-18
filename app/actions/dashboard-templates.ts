"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { dashboardTemplates } from "@/lib/db/schema"
import { and, asc, eq } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import {
  DEFAULT_TEMPLATE,
  MAX_STAT_WIDGETS,
  sanitizeLayout,
  type DashboardTemplate,
} from "@/lib/dashboard-widgets"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

export async function getTemplates(): Promise<DashboardTemplate[]> {
  const userId = await getUserId()
  const rows = await db
    .select()
    .from(dashboardTemplates)
    .where(eq(dashboardTemplates.userId, userId))
    .orderBy(asc(dashboardTemplates.createdAt))

  return rows.map((row) => {
    const { stats, panels } = sanitizeLayout(row.statWidgets, row.panelWidgets)
    return { id: row.id, name: row.name, statWidgets: stats, panelWidgets: panels, isActive: row.isActive }
  })
}

// No row flagged active means the trader is on the built-in Default layout,
// which is a real choice in the menu rather than just a starting state.
export async function getActiveTemplate(): Promise<DashboardTemplate> {
  const templates = await getTemplates()
  return templates.find((t) => t.isActive) ?? DEFAULT_TEMPLATE
}

export async function selectDefaultTemplate() {
  const userId = await getUserId()
  await db.update(dashboardTemplates).set({ isActive: false }).where(eq(dashboardTemplates.userId, userId))
  revalidatePath("/dashboard")
}

function validate(name: string, statWidgets: string[], panelWidgets: string[]) {
  const trimmed = name.trim()
  if (!trimmed) throw new Error("Give the template a name")
  const { stats, panels } = sanitizeLayout(statWidgets, panelWidgets)
  if (stats.length === 0 && panels.length === 0) throw new Error("Pick at least one widget")
  if (statWidgets.length > MAX_STAT_WIDGETS) {
    throw new Error(`The top row holds at most ${MAX_STAT_WIDGETS} widgets`)
  }
  return { name: trimmed.slice(0, 60), stats, panels }
}

export async function createTemplate(name: string, statWidgets: string[], panelWidgets: string[]): Promise<number> {
  const userId = await getUserId()
  const clean = validate(name, statWidgets, panelWidgets)

  const [row] = await db
    .insert(dashboardTemplates)
    .values({ userId, name: clean.name, statWidgets: clean.stats, panelWidgets: clean.panels, isActive: true })
    .returning({ id: dashboardTemplates.id })

  // A new template becomes the one on screen, so every other one steps down.
  await db
    .update(dashboardTemplates)
    .set({ isActive: false })
    .where(and(eq(dashboardTemplates.userId, userId), eq(dashboardTemplates.isActive, true)))
  await db.update(dashboardTemplates).set({ isActive: true }).where(eq(dashboardTemplates.id, row.id))

  revalidatePath("/dashboard")
  return row.id
}

export async function updateTemplate(id: number, name: string, statWidgets: string[], panelWidgets: string[]) {
  const userId = await getUserId()
  const clean = validate(name, statWidgets, panelWidgets)

  const result = await db
    .update(dashboardTemplates)
    .set({ name: clean.name, statWidgets: clean.stats, panelWidgets: clean.panels, updatedAt: new Date() })
    .where(and(eq(dashboardTemplates.id, id), eq(dashboardTemplates.userId, userId)))
    .returning({ id: dashboardTemplates.id })
  if (result.length === 0) throw new Error("Template not found")

  revalidatePath("/dashboard")
}

export async function activateTemplate(id: number) {
  const userId = await getUserId()
  const [target] = await db
    .select({ id: dashboardTemplates.id })
    .from(dashboardTemplates)
    .where(and(eq(dashboardTemplates.id, id), eq(dashboardTemplates.userId, userId)))
  if (!target) throw new Error("Template not found")

  await db.update(dashboardTemplates).set({ isActive: false }).where(eq(dashboardTemplates.userId, userId))
  await db.update(dashboardTemplates).set({ isActive: true }).where(eq(dashboardTemplates.id, id))
  revalidatePath("/dashboard")
}

export async function deleteTemplate(id: number) {
  const userId = await getUserId()
  const [removed] = await db
    .delete(dashboardTemplates)
    .where(and(eq(dashboardTemplates.id, id), eq(dashboardTemplates.userId, userId)))
    .returning({ wasActive: dashboardTemplates.isActive })
  if (!removed) throw new Error("Template not found")

  // Deleting the template on screen falls back to Default rather than picking
  // some other saved template on the trader's behalf.
  revalidatePath("/dashboard")
}
