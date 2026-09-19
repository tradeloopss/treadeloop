"use server"

import { cookies } from "next/headers"
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n"

// The language switcher's action: remembers the choice for a year. The
// caller refreshes the router so the current page re-renders in it.
export async function setLocale(locale: string) {
  if (!isLocale(locale)) throw new Error("Unsupported language")
  ;(await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" })
}
