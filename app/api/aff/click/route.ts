import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { recordClick } from "@/lib/affiliates/attribution"
import { ATTRIBUTION_COOKIE, VISITOR_COOKIE, attributionCookieDomain } from "@/lib/affiliates/token"
import { hashIp, clientIp } from "@/lib/trial-ip"

// Records a referral-link visit. Called by <AffiliateTracker/> when a page
// loads with ?ref=. The body is only ever the PUBLIC parts of the link (the
// code, the link token, UTM tags); who the affiliate is, which campaign the
// link belongs to and the click itself are all decided here, and the result is
// handed back as an httpOnly cookie the server signed.
export const dynamic = "force-dynamic"

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null)

export async function POST(req: Request) {
  // Same-site only: a third-party page can't inflate someone's clicks from
  // its visitors' browsers.
  const site = req.headers.get("sec-fetch-site")
  if (site && site !== "same-origin" && site !== "same-site") return NextResponse.json({ ok: false }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const code = str(body.ref, 40)
  if (!code) return NextResponse.json({ ok: false }, { status: 400 })

  const cookies = parseCookies(req.headers.get("cookie"))
  const known = cookies[VISITOR_COOKIE]
  const visitorId = known && /^[a-f0-9-]{36}$/.test(known) ? known : randomUUID()

  let result: Awaited<ReturnType<typeof recordClick>> = null
  try {
    result = await recordClick({
      code,
      linkToken: str(body.lk, 40),
      landingPage: str(body.landing, 200),
      referrer: str(body.referrer, 500),
      utm: { source: str(body.utm_source, 80), medium: str(body.utm_medium, 80), campaign: str(body.utm_campaign, 80), content: str(body.utm_content, 80) },
      visitorId,
      existingToken: cookies[ATTRIBUTION_COOKIE] ?? null,
      ipHash: hashIp(clientIp(req.headers)),
      userAgent: req.headers.get("user-agent"),
      country: req.headers.get("x-vercel-ip-country"),
    })
  } catch (e) {
    console.error("[affiliates] click tracking failed:", e instanceof Error ? e.message : e)
  }

  const res = NextResponse.json({ ok: true })
  const domain = attributionCookieDomain(req.headers.get("host"))
  const secure = process.env.NODE_ENV === "production"
  const base = { path: "/", sameSite: "lax" as const, secure, ...(domain ? { domain } : {}) }
  if (visitorId !== known) res.cookies.set(VISITOR_COOKIE, visitorId, { ...base, httpOnly: true, maxAge: 400 * 86_400 })
  if (result) res.cookies.set(ATTRIBUTION_COOKIE, result.token, { ...base, httpOnly: true, maxAge: result.cookieDays * 86_400 })
  return res
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=")
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
      } catch {}
    }
  }
  return out
}
