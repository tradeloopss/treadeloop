"use client"

import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"

const STEPS = [
  { title: "Choose platform", short: "Choose" },
  { title: "Connect account", short: "Connect" },
  { title: "Verify & sync", short: "Verify" },
]

type StepState = "done" | "active" | "upcoming"

// The Add account window's steps: three numbered circles on one line with
// their labels underneath (① Choose platform ── ② Connect account ── ③ Verify
// & sync). `completed` marks the current step done. Short labels when the
// stepper's own box is narrow (@container/steps).
export function ConnectionStepper({ current, completed = false, className }: { current: 1 | 2 | 3; completed?: boolean; className?: string }) {
  const t = useT()
  const states: StepState[] = STEPS.map((_, i) => {
    const n = i + 1
    if (n < current || (completed && n === current)) return "done"
    return n === current ? "active" : "upcoming"
  })
  // How far the connecting line is filled: up to the current step's circle.
  const progress = Math.min(1, (completed ? current : current - 1) / (STEPS.length - 1))

  return (
    <div className={cn("@container/steps", className)}>
      <ol className="relative flex items-start justify-between" aria-label={t("Connection steps")}>
        <span aria-hidden className="absolute inset-x-3 top-3 h-px bg-border" />
        <span aria-hidden className="absolute start-3 top-3 h-px bg-primary transition-[width] duration-300 ease-out" style={{ width: `calc((100% - 1.5rem) * ${progress})` }} />
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            aria-current={states[i] === "active" ? "step" : undefined}
            className={cn("relative flex flex-col gap-1.5", i === 0 ? "items-start" : i === STEPS.length - 1 ? "items-end" : "items-center")}
          >
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-[11px] font-semibold transition-colors duration-200",
                states[i] === "active" && "bg-primary text-primary-foreground ring-4 ring-primary/15",
                states[i] === "done" && "bg-primary text-primary-foreground",
                states[i] === "upcoming" && "border bg-card text-muted-foreground",
              )}
            >
              {states[i] === "done" ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            <span className={cn("text-[11px] font-medium whitespace-nowrap", states[i] === "upcoming" ? "text-muted-foreground" : states[i] === "active" ? "text-primary" : "text-foreground")}>
              <span className="@[270px]/steps:hidden">{t(step.short)}</span>
              <span className="hidden @[270px]/steps:inline">{t(step.title)}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
