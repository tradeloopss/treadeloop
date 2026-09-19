import { NextResponse, type NextRequest } from "next/server"
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, isLocale, localeFromAcceptLanguage, localeFromCountry } from "@/lib/i18n"

// Decides the UI language for every page request. A choice the visitor made
// (the cookie, set by the language switcher) always wins; a first visit is
// judged by where the request comes from — Vercel stamps the country onto
// every request — and then by the browser's language, so visitors from the
// Arab world land on the Arabic version. The result travels to the app as a
// request header and is pinned in the cookie so it stays put.
export function proxy(request: NextRequest) {
  const chosen = request.cookies.get(LOCALE_COOKIE)?.value
  let locale = isLocale(chosen) ? chosen : null
  const firstVisit = locale == null
  if (locale == null) {
    locale =
      localeFromCountry(request.headers.get("x-vercel-ip-country")) ??
      localeFromAcceptLanguage(request.headers.get("accept-language")) ??
      DEFAULT_LOCALE
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(LOCALE_HEADER, locale)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  if (firstVisit) {
    response.cookies.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" })
  }
  return response
}

export const config = {
  // Pages only — not Next's own assets, the API routes or files in /public.
  matcher: ["/((?!_next/|api/|.*\.[\w]+$).*)"],
}
