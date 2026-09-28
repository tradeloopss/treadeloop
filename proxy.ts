import { NextResponse, type NextRequest } from "next/server"
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, isOffered, localeFromAcceptLanguage, localeFromCountry } from "@/lib/i18n"

// Runs on every page request. It does two things:
//
// 1. Subdomain host routing (a NO-OP on the apex domain, www, previews and
//    localhost — only active once real `help.` / `app.` subdomains point here):
//      help.<domain>  → the /help center, with clean URLs (help.tradeloop.pro/faq)
//      app.<domain>   → the app; the root sends you to the dashboard
//
// 2. Chooses the UI language: a visitor's cookie choice wins (if still offered),
//    otherwise the request's country, then the browser's language. The result
//    travels to the app as a header and is pinned in the cookie.
export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") || "").toLowerCase()
  const sub = host.split(":")[0].split(".")[0]
  const url = request.nextUrl

  // --- Subdomain host routing -------------------------------------------
  // The app subdomain shouldn't show the marketing home or the help center.
  if (sub === "app" && (url.pathname === "/" || url.pathname === "/help" || url.pathname.startsWith("/help/"))) {
    const to = url.clone()
    to.pathname = "/dashboard"
    return NextResponse.redirect(to)
  }
  // The help subdomain serves the /help routes under clean paths.
  const rewriteTo =
    sub === "help" && !(url.pathname === "/help" || url.pathname.startsWith("/help/"))
      ? (() => {
          const to = url.clone()
          to.pathname = url.pathname === "/" ? "/help" : `/help${url.pathname}`
          return to
        })()
      : null

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
