"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Languages } from "lucide-react"
import { setLocale } from "@/app/actions/locale"
import { useLocale } from "@/components/locale-provider"
import { cn } from "@/lib/utils"
import { LOCALE_CHOICE_OFFERED, OFFERED_LOCALES, type Locale } from "@/lib/i18n"

// Each language is named in itself, so a visitor who landed in the wrong
// one can still read the way out.
const NAMES: Record<Locale, string> = { en: "English", ar: "العربية" }

// Flips between English and Arabic. Shows the language you'd switch TO,
// and re-renders the current page in it without leaving.
export function LanguageSwitcher({ className, compact = false }: { className?: string; compact?: boolean }) {
  const locale = useLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  // With one language on offer there is nothing to switch to, so the control
  // isn't rendered at all rather than shown doing nothing.
  const next = OFFERED_LOCALES.find((l) => l !== locale)
  if (!LOCALE_CHOICE_OFFERED || !next) return null

  return (
    <button
      type="button"
      lang={next}
      dir={next === "ar" ? "rtl" : "ltr"}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await setLocale(next)
          router.refresh()
        })
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60",
        compact ? "size-9 justify-center" : "px-2 py-1.5",
        className,
      )}
      aria-label={next === "ar" ? "التبديل إلى العربية" : "Switch to English"}
      title={NAMES[next]}
    >
      <Languages className="size-4 shrink-0" />
      {!compact && <span>{NAMES[next]}</span>}
    </button>
  )
}
