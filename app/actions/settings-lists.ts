"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { csvSchemas, tradeTemplates } from "@/lib/db/schema"
import { and, asc, eq } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

export type CsvSchemaInput = {
  name: string
  broker: string | null
  delimiter: string
  dateFormat: string | null
  mapping: Record<string, string>
}

export type CsvSchemaRow = CsvSchemaInput & { id: number }
export type TradeTemplateRow = {
  id: number
  name: string
  symbol: string | null
  side: string | null
  quantity: string | null
  fields: Record<string, unknown>
}

// --- CSV schemas ------------------------------------------------------------

export async function listCsvSchemas(): Promise<CsvSchemaRow[]> {
  const userId = await getUserId()
  try {
    const rows = await db.select().from(csvSchemas).where(eq(csvSchemas.userId, userId)).orderBy(asc(csvSchemas.name))
    return rows.map((r) => ({ id: r.id, name: r.name, broker: r.broker, delimiter: r.delimiter, dateFormat: r.dateFormat, mapping: r.mapping }))
  } catch (err) {
    console.warn("[settings] could not read csv_schemas:", err instanceof Error ? err.message : err)
    return []
  }
}

export async function createCsvSchema(input: CsvSchemaInput): Promise<void> {
  const userId = await getUserId()
  const name = input.name.trim()
  if (!name) throw new Error("Name is required")
  await db.insert(csvSchemas).values({
    userId,
    name,
    broker: input.broker?.trim() || null,
    delimiter: input.delimiter || ",",
    dateFormat: input.dateFormat?.trim() || null,
    mapping: input.mapping,
  })
  revalidatePath("/settings/csv-schemas")
}

export async function updateCsvSchema(id: number, input: CsvSchemaInput): Promise<void> {
  const userId = await getUserId()
  const name = input.name.trim()
  if (!name) throw new Error("Name is required")
  await db
    .update(csvSchemas)
    .set({
      name,
      broker: input.broker?.trim() || null,
      delimiter: input.delimiter || ",",
      dateFormat: input.dateFormat?.trim() || null,
      mapping: input.mapping,
      updatedAt: new Date(),
    })
    .where(and(eq(csvSchemas.id, id), eq(csvSchemas.userId, userId)))
  revalidatePath("/settings/csv-schemas")
}

export async function deleteCsvSchema(id: number): Promise<void> {
  const userId = await getUserId()
  await db.delete(csvSchemas).where(and(eq(csvSchemas.id, id), eq(csvSchemas.userId, userId)))
  revalidatePath("/settings/csv-schemas")
}

// --- Trade templates --------------------------------------------------------

export type TradeTemplateInput = {
  name: string
  symbol: string | null
  side: string | null
  quantity: number | null
  fields: Record<string, unknown>
}

export async function listTradeTemplates(): Promise<TradeTemplateRow[]> {
  const userId = await getUserId()
  try {
    const rows = await db
      .select()
      .from(tradeTemplates)
      .where(eq(tradeTemplates.userId, userId))
      .orderBy(asc(tradeTemplates.sortOrder), asc(tradeTemplates.name))
    return rows.map((r) => ({ id: r.id, name: r.name, symbol: r.symbol, side: r.side, quantity: r.quantity, fields: r.fields ?? {} }))
  } catch (err) {
    console.warn("[settings] could not read trade_templates:", err instanceof Error ? err.message : err)
    return []
  }
}

export async function createTradeTemplate(input: TradeTemplateInput): Promise<void> {
  const userId = await getUserId()
  const name = input.name.trim()
  if (!name) throw new Error("Name is required")
  await db.insert(tradeTemplates).values({
    userId,
    name,
    symbol: input.symbol?.trim() || null,
    side: input.side || null,
    quantity: input.quantity == null ? null : String(input.quantity),
    fields: input.fields,
  })
  revalidatePath("/settings/trade-templates")
}

export async function updateTradeTemplate(id: number, input: TradeTemplateInput): Promise<void> {
  const userId = await getUserId()
  const name = input.name.trim()
  if (!name) throw new Error("Name is required")
  await db
    .update(tradeTemplates)
    .set({
      name,
      symbol: input.symbol?.trim() || null,
      side: input.side || null,
      quantity: input.quantity == null ? null : String(input.quantity),
      fields: input.fields,
      updatedAt: new Date(),
    })
    .where(and(eq(tradeTemplates.id, id), eq(tradeTemplates.userId, userId)))
  revalidatePath("/settings/trade-templates")
}

export async function deleteTradeTemplate(id: number): Promise<void> {
  const userId = await getUserId()
  await db.delete(tradeTemplates).where(and(eq(tradeTemplates.id, id), eq(tradeTemplates.userId, userId)))
  revalidatePath("/settings/trade-templates")
}
