"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Moon, Sun } from "lucide-react"
import { cn } from "@/lib/utils"

// Light / night mode for the affiliate portal: the same two-way control as the
// app's own (dashboard-sidebar), on the same theme store. The choice is
// remembered on this device; until one is made, the device's setting is followed.
//
//   compact   one icon button, for a header
//   default   the labelled Light | Night pair, for the sidebar
export function ThemeSwitch({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  // The theme is only known in the browser; nothing is marked as chosen before then.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = mounted && resolvedTheme === "dark"

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => setTheme(dark ? "light" : "dark")}
        aria-label={dark ? "Switch to light mode" : "Switch to night mode"}
        title={dark ? "Switch to light mode" : "Switch to night mode"}
        className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40", className)}
      >
        {/* Chosen by the theme class itself, so the right icon shows from the first paint. */}
        <Moon className="size-4 dark:hidden" aria-hidden />
        <Sun className="hidden size-4 dark:block" aria-hidden />
      </button>
    )
  }

  return (
    <div role="group" aria-label="Theme" className={cn("flex items-center gap-0.5 rounded-lg bg-muted p-0.5", className)}>
      {(
        [
          ["light", "Light", Sun],
          ["dark", "Night", Moon],
        ] as const
      ).map(([value, text, Icon]) => {
        const on = mounted && resolvedTheme === value
        return (
          <button
            key={value}
            type="button"
            aria-pressed={on}
            onClick={() => setTheme(value)}
            className={cn("flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40", on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            <Icon className="size-3.5" aria-hidden /> {text}
          </button>
        )
      })}
    </div>
  )
}
