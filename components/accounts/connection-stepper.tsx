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

// A compact horizontal step indicator for the connection card:
// ① Choose platform ── ② Connect account ── ③ Verify & sync
// (short labels when the card is narrow). `completed` marks the last step done.
export function ConnectionStepper({ current, completed = false }: { current: 1 | 2 | 3; completed?: boolean }) {
  const t = useT()
  const states: StepState[] = STEPS.map((_, i) => {
    const n = i + 1
    if (n < current || (completed && n === current)) return "done"
    return n === current ? "active" : "upcoming"
  })

  return (
    <ol className="flex w-full min-w-0 items-center @[480px]/ws:w-auto @[480px]/ws:flex-1 @[640px]/ws:flex-none" aria-label={t("Connection steps")}>
      {STEPS.map((step, i) => (
        <li key={step.title} className={cn("flex min-w-0 items-center", i < STEPS.length - 1 && "flex-1 @[640px]/ws:flex-none")} aria-current={states[i] === "active" ? "step" : undefined}>
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors duration-200",
              states[i] === "active" && "bg-primary text-primary-foreground",
              states[i] === "done" && "border border-gain bg-gain/10 text-gain",
              states[i] === "upcoming" && "border bg-card text-muted-foreground",
            )}
          >
            {states[i] === "done" ? <Check className="size-3.5" aria-hidden /> : i + 1}
          </span>
          <span className={cn("ms-2 text-[13px] font-medium whitespace-nowrap", states[i] === "upcoming" ? "text-muted-foreground" : "text-foreground")}>
            <span className="@[640px]/ws:hidden">{t(step.short)}</span>
            <span className="hidden @[640px]/ws:inline">{t(step.title)}</span>
          </span>
          {i < STEPS.length - 1 && (
            <span aria-hidden className={cn("mx-2 h-px min-w-3 flex-1 transition-colors @[640px]/ws:mx-3 @[640px]/ws:w-14 @[640px]/ws:flex-none", states[i] === "done" ? "bg-gain/40" : "bg-border")} />
          )}
        </li>
      ))}
    </ol>
  )
}
