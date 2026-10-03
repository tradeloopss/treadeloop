"use client"

import { useEffect, useState } from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

// Light ⇄ dark in one tap, from the header. (System, and the same choice as a
// setting, live in Admin Settings → Appearance.) The icons swap by CSS so the
// first paint never flashes the wrong one.
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            aria-label="Toggle light / dark mode"
            className={cn("inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", className)}
          />
        }
      >
        <Moon className="size-[18px] dark:hidden" aria-hidden />
        <Sun className="hidden size-[18px] dark:block" aria-hidden />
      </TooltipTrigger>
      <TooltipContent side="bottom">Toggle light / dark mode</TooltipContent>
    </Tooltip>
  )
}

const CHOICES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const

// Light / Dark / System as a segmented control (Admin Settings, the phone menu).
// The app's theme is remembered per browser, like everywhere else in TradeLoop.
export function ThemeChoice({ className, size = "md" }: { className?: string; size?: "sm" | "md" }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const current = mounted ? (theme ?? "system") : null
  return (
    <div role="radiogroup" aria-label="Theme" className={cn("inline-flex w-full gap-1 rounded-xl bg-muted p-1", className)}>
      {CHOICES.map((c) => {
        const selected = current === c.value
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(c.value)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
              size === "sm" ? "h-9 text-xs" : "h-10 text-sm",
              selected ? "bg-background text-foreground shadow-sm dark:bg-card" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <c.icon className="size-4" aria-hidden />
            {c.label}
          </button>
        )
      })}
    </div>
  )
}
