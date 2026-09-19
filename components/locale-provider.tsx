"use client"

import { createContext, useContext, useMemo } from "react"
import type React from "react"
import { DEFAULT_LOCALE, dirFor, intlLocale, makeT, type Locale, type Messages, type TFunction } from "@/lib/i18n"

interface LocaleContextValue {
  locale: Locale
  dir: "ltr" | "rtl"
  messages: Messages
}

const LocaleContext = createContext<LocaleContextValue>({ locale: DEFAULT_LOCALE, dir: "ltr", messages: {} })

// Hands the request's locale and dictionary to every client component. The
// root layout renders it once; the dictionary is only the current
// language's, so English visitors download nothing extra.
export function LocaleProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, dir: dirFor(locale), messages }), [locale, messages])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale
}

export function useDir(): "ltr" | "rtl" {
  return useContext(LocaleContext).dir
}

// The Intl locale tag for dates in the current language.
export function useIntlLocale(): string {
  return intlLocale(useContext(LocaleContext).locale)
}

export function useT(): TFunction {
  const { messages } = useContext(LocaleContext)
  return useMemo(() => makeT(messages), [messages])
}
