import { and, desc, eq, isNull } from "drizzle-orm"
import { randomBytes } from "node:crypto"
import { db } from "@/lib/db"
import { tradingviewPairings } from "@/lib/db/schema"

// Where the TradeLoop extension is published, when it is. Until then the
// pairing page offers the packaged extension from /extension/ to load by
// hand.
export const EXTENSION_STORE_URL = process.env.NEXT_PUBLIC_TRADELOOP_EXTENSION_URL ?? null
export const EXTENSION_DOWNLOAD_PATH = "/extension/tradeloop-tradingview.zip"

// The origin the bookmarklet and pairing page post to — the app's own URL,
// mirroring resolveBaseUrl in app/actions/tradingview.ts so a pairing minted
// on a preview deployment posts back to that deployment.
export function pairingBaseUrl(): string {
  return (
    process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000")
  )
}

// The pairing page hands the extension a code by rendering it into the page
// for the extension's content script to read. A code is single-use in the
// sense that its first check-in claims it (lastSeenAt set); one unclaimed
// code per user is kept, so reloading the page shows the same code and a
// second browser gets a fresh one once the first has paired.
export async function freshPairingFor(userId: string): Promise<{ id: number; token: string }> {
  const [unclaimed] = await db
    .select({ id: tradingviewPairings.id, token: tradingviewPairings.token })
    .from(tradingviewPairings)
    .where(and(eq(tradingviewPairings.userId, userId), isNull(tradingviewPairings.lastSeenAt)))
    .orderBy(desc(tradingviewPairings.createdAt))
  if (unclaimed) return unclaimed

  const [created] = await db
    .insert(tradingviewPairings)
    .values({ userId, token: randomBytes(24).toString("base64url") })
    .returning({ id: tradingviewPairings.id, token: tradingviewPairings.token })
  return created
}

// A rough name for the browser, from its user agent, for the pairing list.
export function describeBrowser(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null
  const ua = userAgent
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Brave/.test(ua) ? "Brave" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser"
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /CrOS/.test(ua) ? "ChromeOS" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : null
  return os ? `${browser} on ${os}` : browser
}
