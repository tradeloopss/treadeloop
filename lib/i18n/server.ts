import { cookies, headers } from "next/headers"
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, isOffered, makeT, type Locale, type TFunction } from "./index"
import { loadMessages } from "./messages"

// The request's locale: what proxy.ts decided (its header), else the
// cookie directly — for the odd request the proxy doesn't run on.
export async function getLocale(): Promise<Locale> {
  const fromProxy = (await headers()).get(LOCALE_HEADER)
  if (isOffered(fromProxy)) return fromProxy
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value
  return isOffered(fromCookie) ? fromCookie : DEFAULT_LOCALE
}

// t() for server components and server actions.
export async function getT(): Promise<TFunction> {
  return makeT(await loadMessages(await getLocale()))
}
