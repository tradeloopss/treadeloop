import { NextResponse, type NextRequest } from "next/server"
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, isOffered, localeFromAcceptLanguage, localeFromCountry } from "@/lib/i18n"

// Decides the UI language for every page request. A choice the visitor made
// (the cookie, set by the language switcher) wins, as long as that language
// is still on offer; otherwise the request's own country — Vercel stamps one
// on — and then the browser's language decide. The result travels to the app
// as a request header and is pinned in the cookie so it stays put.
//
// Only one language is offered at the moment (lib/i18n OFFERED_LOCALES), so
// every branch here lands on English until Arabic is put back.
export function proxy(request: NextRequest) {
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
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  if (needsCookie) {
    response.cookies.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" })
  }
  return response
}

export const config = {
  // Pages only — not Next's own assets, the API routes or files in /public.
  matcher: ["/((?!_next/|api/|.*\.[\w]+$).*)"],
}
