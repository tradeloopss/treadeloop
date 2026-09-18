"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { trades, user } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { headers } from "next/headers"
import { randomBytes } from "node:crypto"
import { revalidatePath } from "next/cache"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

// Turns on a public P&L card link and returns its token — generates a fresh
// one each time, so an old leaked link stops working once re-shared.
export async function shareTrade(tradeId: number): Promise<string> {
  const userId = await getUserId()
  const token = randomBytes(12).toString("hex")
  const [updated] = await db
    .update(trades)
    .set({ shareToken: token })
    .where(and(eq(trades.id, tradeId), eq(trades.userId, userId)))
    .returning({ shareToken: trades.shareToken })
  if (!updated) throw new Error("Trade not found")
  revalidatePath("/trades")
  return updated.shareToken!
}

export async function unshareTrade(tradeId: number) {
  const userId = await getUserId()
  await db.update(trades).set({ shareToken: null }).where(and(eq(trades.id, tradeId), eq(trades.userId, userId)))
  revalidatePath("/trades")
}

export interface SharedTradeCard {
  symbol: string
  market: string
  side: string
  status: string
  quantity: number
  entryPrice: number
  exitPrice: number | null
  pnl: number
  fees: number
  rMultiple: number | null
  entryTime: string
  exitTime: string | null
  traderName: string
  traderImage: string | null
}

// Public lookup by share token — no ownership check, deliberately excludes
// userId/notes/account so a shared card only ever exposes what's on the card.
export async function getSharedTrade(token: string): Promise<SharedTradeCard | null> {
  const [row] = await db
    .select({
      symbol: trades.symbol,
      market: trades.market,
      side: trades.side,
      status: trades.status,
      quantity: trades.quantity,
      entryPrice: trades.entryPrice,
      exitPrice: trades.exitPrice,
      pnl: trades.pnl,
      fees: trades.fees,
      rMultiple: trades.rMultiple,
      entryTime: trades.entryTime,
      exitTime: trades.exitTime,
      traderName: user.name,
      traderImage: user.image,
    })
    .from(trades)
    .innerJoin(user, eq(trades.userId, user.id))
    .where(eq(trades.shareToken, token))
  if (!row) return null
  return {
    symbol: row.symbol,
    market: row.market,
    side: row.side,
    status: row.status,
    quantity: Number(row.quantity),
    entryPrice: Number(row.entryPrice),
    exitPrice: row.exitPrice == null ? null : Number(row.exitPrice),
    pnl: Number(row.pnl),
    fees: Number(row.fees),
    rMultiple: row.rMultiple == null ? null : Number(row.rMultiple),
    entryTime: row.entryTime.toISOString(),
    exitTime: row.exitTime == null ? null : row.exitTime.toISOString(),
    traderName: row.traderName,
    traderImage: row.traderImage,
  }
}
