import { NextResponse, type NextRequest } from "next/server"
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, isOffered, localeFromAcceptLanguage, localeFromCountry } from "@/lib/i18n"

// The public marketing pages that stay on the apex/www domain. Everything else
// on the apex (the app itself, and the auth pages) now lives on the app
// subdomain, so it's redirected there — see below. Keep this list in sync when
// a genuinely public page is added; anything not listed is treated as app-only.
const MARKETING_PATHS = ["/", "/pricing", "/privacy", "/terms", "/brokers", "/p", "/help"]

function isMarketingPath(pathname: string) {
  return MARKETING_PATHS.some((p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)))
}

// The app's own origin (app.<domain>), for redirecting app routes off the apex.
// Prefers NEXT_PUBLIC_APP_URL when set, otherwise derives app.<domain> from the
// current host (so it works before that env var is configured).
function appOrigin(hostname: string) {
  const env = process.env.NEXT_PUBLIC_APP_URL
  if (env) return env.replace(/\/+$/, "")
  return `https://app.${hostname.replace(/^(www|affiliate|help)\./, "")}`
}

// The affiliate portal's pages, as they appear on affiliate.<domain> (the
// first path segment). The portal's root is the overview. Keep in sync with
// the folders under app/affiliate.
const AFFILIATE_SECTIONS = new Set(["analytics", "referrals", "campaigns", "links", "coupons", "earnings", "payouts", "resources", "announcements", "support", "settings", "apply", "terms", "onboarding", "export"])
const isAffiliatePath = (pathname: string) => pathname === "/affiliate" || pathname.startsWith("/affiliate/")
// "/affiliate/payouts" → "/payouts"; "/affiliate" → "/"
const stripAffiliate = (pathname: string) => pathname.slice("/affiliate".length) || "/"

// Runs on every page request. It does two things:
//
// 1. Subdomain host routing (a NO-OP on previews and localhost — only active
//    once real `help.` / `app.` subdomains point here):
//      help.<domain>  → the /help center, with clean URLs (help.tradeloop.pro/faq)
//      affiliate.<domain> → the affiliate portal at the root
//                       (affiliate.tradeloop.pro/payouts). Any other page asked
//                       for there belongs to the app and is sent to it. Once
//                       NEXT_PUBLIC_AFFILIATE_URL is set, /affiliate/* on the
//                       other hosts is sent to the portal's own address.
//      app.<domain>   → the app; the root sends you to the dashboard
//      apex / www.    → the marketing site only; app + auth routes (e.g.
//                       /dashboard, /sign-in) 307 to app.<domain> so the old
//                       www URLs no longer serve the app.
//
// 2. Chooses the UI language: a visitor's cookie choice wins (if still offered),
//    otherwise the request's country, then the browser's language. The result
//    travels to the app as a header and is pinned in the cookie.
export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") || "").toLowerCase()
  const hostname = host.split(":")[0]
  const sub = hostname.split(".")[0]
  const url = request.nextUrl

  // --- Subdomain host routing -------------------------------------------
  // The app subdomain shouldn't show the marketing home or the help center.
  if (sub === "app" && (url.pathname === "/" || url.pathname === "/help" || url.pathname.startsWith("/help/"))) {
    const to = url.clone()
    to.pathname = "/dashboard"
    return NextResponse.redirect(to)
  }

  // The apex and www serve the marketing site only. Any app or auth route that
  // isn't a public marketing page is sent to the app subdomain, so links like
  // www.tradeloop.pro/dashboard or /sign-in stop working there. Skipped on
  // localhost, IPs and *.vercel.app previews (which have no app subdomain).
  const labels = hostname.split(".")
  const isLocalOrPreview =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".vercel.app") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(hostname)
  const isApexOrWww = !isLocalOrPreview && (sub === "www" || labels.length === 2)

  // The affiliate subdomain: the portal at the root, with clean URLs.
  let affiliateRewrite: URL | null = null
  if (sub === "affiliate" && !isLocalOrPreview) {
    // The in-app form of the address works too, and lands on the clean one.
    if (isAffiliatePath(url.pathname)) {
      const to = url.clone()
      to.pathname = stripAffiliate(url.pathname)
      return NextResponse.redirect(to)
    }
    const section = url.pathname.split("/")[1] ?? ""
    // Not a portal page: it is a page of the app (sign-in, the dashboard…).
    if (url.pathname !== "/" && !AFFILIATE_SECTIONS.has(section)) {
      return NextResponse.redirect(new URL(`${url.pathname}${url.search}`, appOrigin(hostname)))
    }
    affiliateRewrite = url.clone()
    affiliateRewrite.pathname = url.pathname === "/" ? "/affiliate" : `/affiliate${url.pathname}`
  }
  // Everywhere else, the portal's in-app address moves to its own subdomain
  // once that is configured (never on previews or localhost).
  const affiliateOrigin = process.env.NEXT_PUBLIC_AFFILIATE_URL?.replace(/\/+$/, "")
  if (affiliateOrigin && sub !== "affiliate" && !isLocalOrPreview && isAffiliatePath(url.pathname)) {
    return NextResponse.redirect(new URL(`${stripAffiliate(url.pathname)}${url.search}`, affiliateOrigin))
  }

  if (isApexOrWww && !isMarketingPath(url.pathname)) {
    return NextResponse.redirect(new URL(`${url.pathname}${url.search}`, appOrigin(hostname)))
  }
  // The help subdomain serves the /help routes under clean paths.
  const rewriteTo =
    affiliateRewrite ??
    (sub === "help" && !(url.pathname === "/help" || url.pathname.startsWith("/help/"))
      ? (() => {
          const to = url.clone()
          to.pathname = url.pathname === "/" ? "/help" : `/help${url.pathname}`
          return to
        })()
      : null)

  // --- Locale ------------------------------------------------------------
  const chosen = request.cookies.get(LOCALE_COOKIE)?.value
  // A cookie naming a language that is no longer served — anyone pinned to
  // Arabic before it was shelved — counts as no choice at all, and the
  // cookie is rewritten below so nobody is stranded in it.
  let locale = isOffered(chosen) ? chosen : null
  const needsCookie = locale == null
  if (locale == null) {
    const detected =
      localeFromCountry(request.headers.get("x-vercel-ip-country")) ??
      localeFromAcceptLanguage(request.headers.get("accept-language"))
    locale = isOffered(detected) ? detected : DEFAULT_LOCALE
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(LOCALE_HEADER, locale)
  const response = rewriteTo
    ? NextResponse.rewrite(rewriteTo, { request: { headers: requestHeaders } })
    : NextResponse.next({ request: { headers: requestHeaders } })
  if (needsCookie) {
    response.cookies.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" })
  }
  return response
}

export const config = {
  // Pages only — not Next's own assets, the API routes or files in /public.
  matcher: ["/((?!_next/|api/|.*\.[\w]+$).*)"],
}
