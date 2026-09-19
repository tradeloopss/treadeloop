import type { Locale, Messages } from "./index"

// The dictionary for a locale. English is the source language, so it has
// none; Arabic is loaded on demand so it never ships to English visitors.
export async function loadMessages(locale: Locale): Promise<Messages> {
  if (locale === "ar") return (await import("./ar")).ar
  return {}
}
