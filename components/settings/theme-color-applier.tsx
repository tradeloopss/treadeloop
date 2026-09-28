"use client"

import { useEffect } from "react"

// Applies the user's saved theme colors (accent / win / loss / breakeven) to
// the document by overriding the CSS custom properties the whole app reads
// (--primary, --gain, --loss). Mounted once in the app layout. The source of
// truth is the DB (userSettings.theme, passed as `initial`), mirrored to
// localStorage so it applies instantly on navigation without a server round
// trip; the Theme page dispatches "tl-theme-change" to re-apply on save.
const KEY = "tl-theme-colors"
export type AppliedColors = { color?: string; win?: string; loss?: string; breakeven?: string } | null

function apply(colors: AppliedColors) {
  if (!colors) return
  const root = document.documentElement
  if (colors.color) root.style.setProperty("--primary", colors.color)
  if (colors.win) root.style.setProperty("--gain", colors.win)
  if (colors.loss) root.style.setProperty("--loss", colors.loss)
  if (colors.breakeven) root.style.setProperty("--breakeven", colors.breakeven)
}

export function ThemeColorApplier({ initial }: { initial: AppliedColors }) {
  useEffect(() => {
    // localStorage wins if present (instant, per-device), else seed it from
    // the DB value so other pages pick it up too.
    let colors: AppliedColors = null
    try {
      const stored = localStorage.getItem(KEY)
      colors = stored ? (JSON.parse(stored) as AppliedColors) : null
    } catch {
      // storage unavailable — fall back to the DB value
    }
    if (!colors && initial) {
      colors = initial
      try {
        localStorage.setItem(KEY, JSON.stringify(initial))
      } catch {
        // ignore
      }
    }
    apply(colors)

    const onChange = (e: Event) => apply((e as CustomEvent<AppliedColors>).detail)
    window.addEventListener("tl-theme-change", onChange as EventListener)
    return () => window.removeEventListener("tl-theme-change", onChange as EventListener)
  }, [initial])

  return null
}

// Called by the Theme page after a save to apply + persist without a reload.
export function persistThemeColors(colors: NonNullable<AppliedColors>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(colors))
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent<AppliedColors>("tl-theme-change", { detail: colors }))
}
