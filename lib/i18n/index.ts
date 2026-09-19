// Locale plumbing shared by the proxy (edge), server components and the
// client. Deliberately dependency-free: proxy.ts imports it, and the Arabic
// dictionary itself lives in ./ar.ts so only Arabic requests load it.
//
// Strings are translated by their English text: t("Save") looks "Save" up
// in the current locale's dictionary and falls back to the English when
// there's no entry, so an untranslated string is never blank. Placeholders
// are written {name} and filled from the second argument.
export const LOCALES = ["en", "ar"] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = "en"
export const LOCALE_COOKIE = "locale"
// The request header proxy.ts sets so server components know the locale
// without re-deriving it.
export const LOCALE_HEADER = "x-locale"

export type Messages = Record<string, string>
export type Vars = Record<string, string | number>
export type TFunction = (key: string, vars?: Vars) => string

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value)
}

export function dirFor(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr"
}

export function translate(messages: Messages, key: string, vars?: Vars): string {
  const template = messages[key] ?? key
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
}

export function makeT(messages: Messages): TFunction {
  return (key, vars) => translate(messages, key, vars)
}

// Countries where Arabic is the (or an) official language — the Arab
// League's members across the Middle East and North/East Africa, plus
// Western Sahara and Chad. Someone visiting from one of these gets the
// Arabic version by default; Iran, Turkey and Israel are Middle Eastern
// but not Arabic-speaking, so they stay on English.
export const ARABIC_COUNTRIES: ReadonlySet<string> = new Set([
  // Gulf and the Levant
  "SA", "AE", "QA", "KW", "BH", "OM", "YE", "IQ", "SY", "JO", "LB", "PS",
  // Africa
  "EG", "LY", "TN", "DZ", "MA", "EH", "SD", "MR", "SO", "DJ", "KM", "TD",
])

export function localeFromCountry(country: string | null | undefined): Locale | null {
  if (!country) return null
  return ARABIC_COUNTRIES.has(country.toUpperCase()) ? "ar" : null
}

// The browser's own language preference, used when the visitor's country
// doesn't decide it (a VPN, or an Arabic speaker living elsewhere).
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";")
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="))
      return { tag: tag.toLowerCase(), q: q ? Number(q.slice(2)) : 1, index }
    })
    .filter((r) => r.tag && r.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
  for (const { tag } of ranked) {
    const language = tag.split("-")[0]
    if (language === "ar") return "ar"
    if (language === "en") return "en"
  }
  return null
}

// The date/number locale for a UI locale: Arabic month and day names, but
// Western digits — every figure in the app is money or a price, and the
// Arabic-script digits would put them out of step with the broker's own
// statements and the charts.
export function intlLocale(locale: Locale): string {
  return locale === "ar" ? "ar-u-nu-latn" : "en-US"
}
