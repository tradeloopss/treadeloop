"use server"

import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { getProvider } from "@/lib/market-data"
import type { Candle, InstrumentInfo } from "@/lib/market-data/types"

async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

// Returns bars for [from, to] (unix seconds) from the given provider. The
// replay engine calls this in chunks and steps the returned array in memory —
// never one request per candle. Look-ahead is enforced downstream by the replay
// cursor (only candles at/under currentTime are ever rendered), and the client
// requests bounded windows so years of data never load at once.
export async function getBacktestCandles(params: {
  provider?: string
  symbol: string
  timeframe: string
  from: number
  to: number
}): Promise<{ ok: true; candles: Candle[] } | { ok: false; error: string }> {
  await requireUser()
  try {
    const candles = await getProvider(params.provider).getCandles({
      symbol: params.symbol,
      timeframe: params.timeframe,
      from: params.from,
      to: params.to,
    })
    return { ok: true, candles }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not load market data" }
  }
}

export async function getBacktestSymbols(provider?: string): Promise<InstrumentInfo[]> {
  await requireUser()
  return getProvider(provider).getSymbols()
}
