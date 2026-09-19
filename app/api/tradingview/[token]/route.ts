import { NextResponse } from "next/server"
import { eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { tradingviewConnections } from "@/lib/db/schema"
import { parseTradingViewAlert, TradingViewAlertError } from "@/lib/tradingview-webhook"
import { recordTradingViewFill } from "@/lib/tradingview-sync"

// Where a TradingView alert's webhook points. The token in the path is the
// whole credential — TradingView sends no signature and no secret of its
// own, so the URL is treated like a password: 32 random bytes, only ever
// shown to the trader who minted it, and revoked by deleting the connection.
//
// TradingView gives up on a webhook that doesn't answer quickly and retries,
// so this stays a single insert plus a rebuild of one connection's fills,
// and it answers 200 for anything it has already stored.

// A delivery TradingView will never send again should not keep the trader
// guessing, so a rejected alert is recorded on the connection for the UI to
// show rather than only logged here.
async function recordFailure(connectionId: number, message: string) {
  await db
    .update(tradingviewConnections)
    .set({ lastEventAt: new Date(), lastStatus: "error", lastError: message.slice(0, 500), eventCount: sql`${tradingviewConnections.eventCount} + 1` })
    .where(eq(tradingviewConnections.id, connectionId))
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const [connection] = await db.select().from(tradingviewConnections).where(eq(tradingviewConnections.webhookToken, token))
  // An unknown token says nothing about whether it was ever valid — a
  // revoked connection and a typo answer the same way.
  if (!connection) return NextResponse.json({ error: "Unknown webhook" }, { status: 404 })

  const rawBody = await request.text()

  let fill
  try {
    fill = parseTradingViewAlert(rawBody)
  } catch (err) {
    const message = err instanceof TradingViewAlertError ? err.message : "Could not read that alert."
    await recordFailure(connection.id, message)
    // 400, not 500: TradingView retrying this exact body would fail the same
    // way, and the trader has the reason waiting on the connection.
    return NextResponse.json({ error: message }, { status: 400 })
  }

  try {
    const imported = await recordTradingViewFill(connection, fill)
    await db
      .update(tradingviewConnections)
      .set({ lastEventAt: new Date(), lastStatus: "ok", lastError: null, eventCount: sql`${tradingviewConnections.eventCount} + 1` })
      .where(eq(tradingviewConnections.id, connection.id))
    return NextResponse.json({ ok: true, symbol: fill.symbol, action: fill.action, trades: imported })
  } catch (err) {
    console.error("[tradingview] could not record fill", err)
    await recordFailure(connection.id, err instanceof Error ? err.message : "Could not record that fill.")
    // 500 so TradingView's retry gets another go at what may be a blip.
    return NextResponse.json({ error: "Could not record that fill." }, { status: 500 })
  }
}

// TradingView's alert dialog pings the URL when it's saved; answering the
// GET tells the trader the address is live before any alert fires.
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const [connection] = await db.select({ id: tradingviewConnections.id }).from(tradingviewConnections).where(eq(tradingviewConnections.webhookToken, token))
  if (!connection) return NextResponse.json({ error: "Unknown webhook" }, { status: 404 })
  return NextResponse.json({ ok: true, ready: true })
}
