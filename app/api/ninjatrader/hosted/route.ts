// POST — operator only (Bearer: NINJATRADER_RELAY_SECRET). Issues the read-only
// TradeLoop sync add-on for a user whose NinjaTrader TradeLoop hosts on the
// Windows VPS, with a fresh personal key written in. The VPS places it in that
// user's own NinjaTrader session; the user still signs into their own account
// once themselves. This is the same read-only add-on a user would download for
// their own PC — nothing here logs anyone in or holds a broker password.
//
// Gated by the relay secret (an operator secret, never on a client), so only
// the VPS orchestrator can mint these.
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { user } from "@/lib/db/schema"
import { isPro } from "@/lib/subscription"
import { keyFromAuthorization } from "@/lib/ninjatrader/keys"
import { checkRelaySecret, relayConfigured } from "@/lib/ninjatrader/relay"
import { createDeviceKey } from "@/lib/ninjatrader/connections"
import { addonSource } from "@/lib/ninjatrader/addon-source"
import { tlog } from "@/lib/tradovate/log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status })

function syncUrl(): string {
  const base = (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "https://www.tradeloop.pro").trim().replace(/\/+$/, "")
  return `${base}/api/ninjatrader/sync`
}

export async function POST(req: Request) {
  if (!relayConfigured()) return fail(404, "Hosted NinjaTrader isn't enabled on this server.")
  if (!checkRelaySecret(keyFromAuthorization(req.headers.get("authorization")))) return fail(401, "Not authorized.")

  let body: { userId?: unknown }
  try {
    body = (await req.json()) as { userId?: unknown }
  } catch {
    return fail(400, "The request wasn't valid JSON.")
  }
  const userId = typeof body.userId === "string" ? body.userId.trim() : ""
  if (!userId) return fail(400, "Give the userId to provision.")

  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1)
  if (!row) return fail(404, "No such user.")
  // Live broker sync is a Pro feature, same as every other NinjaTrader sync.
  if (!(await isPro(userId))) return fail(403, "That user isn't on Pro.")

  const { id, key } = await createDeviceKey(userId)
  tlog("hosted_addon_issued", { provider: "ninjatrader", userId, deviceId: id })
  // UTF-8 BOM, as the download gives, so NinjaScript Editor reads non-ASCII right.
  return Response.json({ ok: true, deviceId: id, keyHint: key.slice(-4), addon: "﻿" + addonSource({ key, syncUrl: syncUrl() }) })
}
