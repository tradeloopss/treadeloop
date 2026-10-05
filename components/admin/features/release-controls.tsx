"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { setFeatureStage } from "@/app/actions/features"
import { setCopyTradingLive } from "@/app/actions/copy-trading"
import { STAGES, STAGE_LABELS, type Stage } from "@/lib/features/release"

const NOTES: Record<Stage, string> = {
  admin: "Only the team can open it. Everyone else sees it in the menu as Coming soon, and can't open it.",
  beta: "Every signed-in user can open it from the menu, marked Beta.",
}

// The release stage of one feature: two choices, the current one marked.
export function ReleaseControl({ feature, label, stage }: { feature: string; label: string; stage: Stage }) {
  const [pending, startTransition] = useTransition()
  const choose = (next: Stage) => {
    if (next === stage) return
    if (next === "beta" && !window.confirm(`Open ${label} to every user as a beta?`)) return
    if (next === "admin" && !window.confirm(`Take ${label} back to admin test only? Users lose access at once; nothing they saved is deleted.`)) return
    startTransition(async () => {
      const result = await setFeatureStage(feature, next)
      if (result.ok) toast.success(result.message ?? "Saved.")
      else toast.error(result.error)
    })
  }
  return (
    <div role="radiogroup" aria-label={`${label} release stage`} className="grid gap-2 sm:grid-cols-2">
      {STAGES.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={s === stage}
          disabled={pending}
          onClick={() => choose(s)}
          className={cn(
            "rounded-lg border p-3 text-start transition-colors disabled:opacity-60",
            s === stage ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/60",
          )}
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <span className={cn("flex size-4 items-center justify-center rounded-full border", s === stage && "border-primary")} aria-hidden>
              {s === stage && <span className="size-2 rounded-full bg-primary" />}
            </span>
            {STAGE_LABELS[s]}
          </span>
          <span className="mt-1 block ps-6 text-xs text-muted-foreground">{NOTES[s]}</span>
        </button>
      ))}
    </div>
  )
}

// Copy Trading only: whether the engine works copies out (simulation) or also
// sends them to brokers (live). Switching to live asks twice.
export function CopyExecutionControl({ live }: { live: boolean }) {
  const [pending, startTransition] = useTransition()
  const choose = (next: boolean) => {
    if (next === live) return
    if (next && !window.confirm("Switch Copy Trading to LIVE?\n\nFollower orders will be sent to brokers for every active copy group. Live mode has not been run against a broker yet: test it on demo accounts first.")) return
    if (next && window.prompt("Type LIVE to confirm.") !== "LIVE") return
    startTransition(async () => {
      const result = await setCopyTradingLive(next)
      if (result.ok) toast.success(result.message)
      else toast.error(result.error)
    })
  }
  const options: [boolean, string, string][] = [
    [false, "Simulation", "The engine reads the Leader, sizes every follower and records each copy. Nothing is sent to a broker."],
    [true, "Live", "Follower orders go to the broker order queue (MetaTrader 5 accounts with a master password), through the prop-rule guard."],
  ]
  return (
    <div role="radiogroup" aria-label="Copy Trading execution" className="grid gap-2 sm:grid-cols-2">
      {options.map(([value, label, text]) => (
        <button key={label} type="button" role="radio" aria-checked={value === live} disabled={pending} onClick={() => choose(value)} className={cn("rounded-lg border p-3 text-start transition-colors disabled:opacity-60", value === live ? (value ? "border-[var(--loss)] bg-[var(--loss)]/5 ring-1 ring-[var(--loss)]" : "border-primary bg-primary/5 ring-1 ring-primary") : "hover:bg-muted/60")}>
          <span className="block text-sm font-medium">{label}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{text}</span>
        </button>
      ))}
    </div>
  )
}
