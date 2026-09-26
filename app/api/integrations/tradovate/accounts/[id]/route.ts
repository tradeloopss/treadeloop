// One Tradovate account (by its provider_accounts id) with, on request, its
// open positions, recent orders and recent executions:
//   GET /api/integrations/tradovate/accounts/12?include=positions,orders,executions&limit=100
// Scoped to the signed-in user's own connections.
import { and, desc, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { providerAccounts, providerExecutions, providerOrders, providerPositions, tradingConnections } from "@/lib/db/schema"
import { sessionUserId } from "@/lib/tradovate/route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await sessionUserId()
  if (!userId) return Response.json({ error: "Sign in again." }, { status: 401 })
  const id = Number((await params).id)
  if (!Number.isInteger(id)) return Response.json({ error: "Not found." }, { status: 404 })
  const [row] = await db
    .select({ account: providerAccounts })
    .from(providerAccounts)
    .innerJoin(tradingConnections, eq(tradingConnections.id, providerAccounts.connectionId))
    .where(and(eq(providerAccounts.id, id), eq(tradingConnections.userId, userId)))
  if (!row) return Response.json({ error: "Not found." }, { status: 404 })
  const a = row.account
  const url = new URL(req.url)
  const include = new Set((url.searchParams.get("include") ?? "").split(",").map((s) => s.trim()))
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100))

  const { metadata: _metadata, ...account } = a
  const positions = include.has("positions")
    ? await db
        .select()
        .from(providerPositions)
        .where(and(eq(providerPositions.connectionId, a.connectionId), eq(providerPositions.environment, a.environment), eq(providerPositions.providerAccountId, a.providerAccountId)))
    : undefined
  const orders = include.has("orders")
    ? (
        await db
          .select()
          .from(providerOrders)
          .where(and(eq(providerOrders.connectionId, a.connectionId), eq(providerOrders.environment, a.environment), eq(providerOrders.providerAccountId, a.providerAccountId)))
          .orderBy(desc(providerOrders.submittedAt))
          .limit(limit)
      ).map(({ rawData: _raw, ...o }) => o)
    : undefined
  const executions = include.has("executions")
    ? (
        await db
          .select()
          .from(providerExecutions)
          .where(and(eq(providerExecutions.connectionId, a.connectionId), eq(providerExecutions.environment, a.environment), eq(providerExecutions.providerAccountId, a.providerAccountId)))
          .orderBy(desc(providerExecutions.timestamp))
          .limit(limit)
      ).map(({ rawData: _raw, ...e }) => e)
    : undefined
  return Response.json({ account, ...(positions ? { positions } : {}), ...(orders ? { orders } : {}), ...(executions ? { executions } : {}) })
}
