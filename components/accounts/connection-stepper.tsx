"use client"

import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"

const STEPS = [
  { title: "Choose platform", short: "Choose", hint: "Pick where your trades come from" },
  { title: "Connect account", short: "Connect", hint: "Sign in with your platform's details" },
  { title: "Verify & sync", short: "Verify", hint: "We check the account and import trades" },
]

type StepState = "done" | "active" | "upcoming"

function stateOf(step: number, current: number, completed: boolean): StepState {
  if (completed || step < current) return "done"
  return step === current ? "active" : "upcoming"
}

function Circle({ n, state }: { n: number; state: StepState }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors duration-200",
        state === "active" && "bg-primary text-primary-foreground",
        state === "done" && "border border-gain bg-gain/10 text-gain",
        state === "upcoming" && "border bg-card text-muted-foreground",
      )}
    >
      {state === "done" ? <Check className="size-4" aria-hidden /> : n}
    </span>
  )
}

// Where the connect flow is. `completed` marks the last step done (success).
export function ConnectionStepper({ current, completed = false, orientation }: { current: 1 | 2 | 3; completed?: boolean; orientation: "vertical" | "horizontal" }) {
  const t = useT()
  const states = STEPS.map((_, i) => stateOf(i + 1, current, completed && i + 1 === current))

  if (orientation === "horizontal") {
    return (
      <ol className="flex items-start" aria-label={t("Connection steps")}>
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex flex-1 items-start last:flex-none" aria-current={states[i] === "active" ? "step" : undefined}>
            <div className="flex flex-col items-center gap-1.5">
              <Circle n={i + 1} state={states[i]} />
              <span className={cn("text-xs font-medium", states[i] === "upcoming" ? "text-muted-foreground" : "text-foreground")}>{t(step.short)}</span>
            </div>
            {i < STEPS.length - 1 && (
              <span aria-hidden className={cn("mx-2 mt-4 h-px flex-1 transition-colors", states[i] === "done" ? "bg-gain/40" : "bg-border")} />
            )}
          </li>
        ))}
      </ol>
    )
  }

  return (
    <ol aria-label={t("Connection steps")}>
      {STEPS.map((step, i) => (
        <li key={step.title} className="flex gap-3" aria-current={states[i] === "active" ? "step" : undefined}>
          <div className="flex flex-col items-center">
            <Circle n={i + 1} state={states[i]} />
            {i < STEPS.length - 1 && <span aria-hidden className={cn("my-1 h-[52px] w-px transition-colors", states[i] === "done" ? "bg-gain/40" : "bg-border")} />}
          </div>
          <div className="min-w-0 pt-1.5">
            <p className={cn("text-[13px] leading-5 font-semibold", states[i] === "upcoming" ? "text-muted-foreground" : "text-foreground")}>{t(step.title)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t(step.hint)}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
