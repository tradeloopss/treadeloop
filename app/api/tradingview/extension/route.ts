import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { tradingviewPairings } from "@/lib/db/schema"
import { parseExtensionSync, TradingViewExtensionError } from "@/lib/tradingview-extension"
import { syncExtensionPayload, touchPairing } from "@/lib/tradingview-extension-sync"

// Where the TradeLoop browser extension reports in. It runs inside the
// trader's own TradingView tab, reads the paper account's fills there and
// posts them here with the pairing token from the pairing page — a bearer
// token that stands for that browser and nothing else. Nothing of the
// trader's TradingView login ever reaches this server.
//
// The call comes from a page on tradingview.com, so it's cross-origin and
// the browser asks first: the OPTIONS answer below lets any origin through,
// which is safe because the token in the Authorization header is the whole
// credential and no cookie is involved.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
}

// How long the extension should wait before looking at TradingView again.
// A fill placed on the chart shows up in the journal within this.
const POLL_SECONDS = 60

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS })
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? ""
  const match = header.match(/^Bearer\s+([A-Za-z0-9_-]{16,128})$/i)
  return match ? match[1] : null
}

async function pairingFor(request: Request) {
  const token = bearerToken(request)
  if (!token) return null
  const [pairing] = await db.select().from(tradingviewPairings).where(eq(tradingviewPairings.token, token))
  return pairing ?? null
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

// The extension's check-in: on the pairing page right after it has picked
// the code up (which claims the code), and whenever its popup wants to know
// whether it's still paired. An unknown token is the answer "not paired" —
// the trader may have unpaired this browser from the journal.
export async function GET(request: Request) {
  const pairing = await pairingFor(request)
  if (!pairing) return json({ ok: false, paired: false, error: "This browser isn't paired with TradeLoop." }, 401)

  const url = new URL(request.url)
  await touchPairing(pairing, {
    browser: url.searchParams.get("browser")?.slice(0, 120) || null,
    extensionVersion: url.searchParams.get("version")?.slice(0, 40) || null,
  })
  return json({ ok: true, paired: true, pollSeconds: POLL_SECONDS })
}

export async function POST(request: Request) {
  const pairing = await pairingFor(request)
  if (!pairing) return json({ ok: false, paired: false, error: "This browser isn't paired with TradeLoop." }, 401)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: "The sync body isn't JSON." }, 400)
  }

  let payload
  try {
    payload = parseExtensionSync(body)
  } catch (err) {
    const message = err instanceof TradingViewExtensionError ? err.message : "Could not read that sync."
    await db.update(tradingviewPairings).set({ lastSeenAt: new Date(), lastStatus: "error", lastError: message }).where(eq(tradingviewPairings.id, pairing.id))
    return json({ ok: false, error: message }, 400)
  }

  try {
    const accounts = await syncExtensionPayload(pairing, payload)
    return json({ ok: true, accounts, pollSeconds: POLL_SECONDS })
  } catch (err) {
    console.error("[tradingview-extension] sync failed", err)
    // 500 so the extension keeps the fills and tries again next round.
    return json({ ok: false, error: "Could not record those fills." }, 500)
  }
}
